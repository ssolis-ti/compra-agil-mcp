/**
 * Límite de concurrencia adaptativo para las consultas a la API.
 *
 * ⚠ POR QUÉ EXISTE: las herramientas de análisis piden varios detalles a la vez
 *   —en serie tardaban más de 105 s y ningún cliente MCP espera tanto—, pero un
 *   paralelismo fijo es igual de ingenuo en el otro sentido. Medido en
 *   producción el 8 de septiembre de 2026, el endpoint de detalle tardaba 20-25 s
 *   y devolvía HTTP 504 en 1 de cada 3 consultas: cuando el servicio está así,
 *   insistir con la misma tanda solo produce más 504 y gasta cuota en llamadas
 *   condenadas.
 *
 *   La política es la de control de congestión de TCP (AIMD): ante una señal de
 *   saturación se baja a la mitad de inmediato, y se sube de a uno solo cuando
 *   una tanda completa sale limpia. Bajar rápido y subir despacio es lo correcto
 *   aquí porque el costo de los errores es asimétrico — un 504 desperdicia 30
 *   segundos de espera, mientras que ir un poco lento solo cuesta unos segundos.
 *
 *   Lo que NO cuenta como congestión: 400, 404 y demás errores por consulta.
 *   Esos hablan del ítem pedido, no del estado del servicio, y reaccionar a
 *   ellos bajaría el paralelismo por motivos equivocados. El 429 tampoco: de la
 *   cuota se encarga el RateLimiter, que sabe esperar el `Retry-After`.
 */

import { logger } from './logger.js';

/** Códigos que indican que la pasarela no dio abasto, no que la consulta fuera inválida. */
const CODIGOS_DE_CONGESTION = new Set([502, 503, 504]);

export interface OpcionesConcurrencia {
  /** Tareas simultáneas al empezar. */
  inicial?: number;
  /** Nunca se baja de aquí: con 0 no avanzaría nada. */
  minimo?: number;
  /** Techo al recuperarse. */
  maximo?: number;
}

/** ¿El fallo habla del servicio saturado o del ítem que se pidió? */
export function esSenalDeCongestion(error: unknown): boolean {
  const e = error as { httpStatus?: number; message?: string } | null;
  if (!e) return false;
  if (typeof e.httpStatus === 'number' && CODIGOS_DE_CONGESTION.has(e.httpStatus)) return true;
  // Los cortes de red y timeouts cuentan igual: el servicio no alcanzó a responder.
  return /timeout|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i.test(String(e.message ?? ''));
}

export class LimitadorConcurrencia {
  private limite: number;
  private readonly minimo: number;
  private readonly maximo: number;
  private tandas = 0;
  private congestiones = 0;

  constructor(opciones: OpcionesConcurrencia = {}) {
    this.maximo = Math.max(1, opciones.maximo ?? 5);
    this.minimo = Math.max(1, Math.min(opciones.minimo ?? 1, this.maximo));
    this.limite = Math.min(this.maximo, Math.max(this.minimo, opciones.inicial ?? this.maximo));
  }

  get limiteActual(): number {
    return this.limite;
  }

  estadisticas(): { limiteActual: number; minimo: number; maximo: number; tandas: number; congestiones: number } {
    return {
      limiteActual: this.limite,
      minimo: this.minimo,
      maximo: this.maximo,
      tandas: this.tandas,
      congestiones: this.congestiones,
    };
  }

  /** Disminución multiplicativa: a la mitad, en cuanto aparece la primera señal. */
  private reducir(): void {
    const antes = this.limite;
    this.limite = Math.max(this.minimo, Math.floor(this.limite / 2));
    this.congestiones++;
    if (this.limite !== antes) {
      logger.warn(`Concurrencia: señal de saturación, se baja de ${antes} a ${this.limite} consultas simultáneas.`);
    }
  }

  /** Aumento aditivo: de a uno, y solo tras una tanda entera sin congestión. */
  private aumentar(): void {
    if (this.limite >= this.maximo) return;
    this.limite++;
    logger.debug(`Concurrencia: tanda limpia, se sube a ${this.limite} consultas simultáneas.`);
  }

  /**
   * Ejecuta las tareas respetando el límite vigente, que puede bajar A MITAD DE
   * TANDA: si las primeras consultas ya vienen con 504, las que quedan salen con
   * menos paralelismo en vez de repetir el error en bloque.
   *
   * Devuelve un arreglo del mismo largo y en el mismo orden que `tareas`, con
   * `null` en las que fallaron. Nunca lanza: quien llama distingue el fallo por
   * el `null`, que es lo que las herramientas de análisis ya esperan.
   */
  async ejecutar<T>(tareas: Array<() => Promise<T>>): Promise<Array<T | null>> {
    const resultados: Array<T | null> = new Array(tareas.length).fill(null);
    if (tareas.length === 0) return resultados;

    this.tandas++;
    let huboCongestion = false;
    let siguiente = 0;
    let enVuelo = 0;

    await new Promise<void>((resolve) => {
      const lanzar = () => {
        while (enVuelo < this.limite && siguiente < tareas.length) {
          const i = siguiente++;
          enVuelo++;
          tareas[i]()
            .then((valor) => { resultados[i] = valor; })
            .catch((e) => {
              resultados[i] = null;
              if (esSenalDeCongestion(e)) {
                huboCongestion = true;
                this.reducir(); // efecto inmediato sobre lo que queda por lanzar
              }
            })
            .finally(() => {
              enVuelo--;
              if (siguiente >= tareas.length && enVuelo === 0) resolve();
              else lanzar();
            });
        }
      };
      lanzar();
    });

    if (!huboCongestion) this.aumentar();
    return resultados;
  }
}
