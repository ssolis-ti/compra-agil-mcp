/**
 * Varios tickets con rotación (2.10.0, T1–T5; MEJORA-006 de Hermes; ADR 0031).
 *
 * Cada ticket lleva su 429 y su conteo del día. El freno por minuto es uno
 * solo y compartido: varios tickets no suben la velocidad hacia la API, solo
 * evitan que un 429 o un ticket rechazado detenga el servidor (ADR 0031). Las
 * consultas salen por turno entre los activos. Un ticket rechazado (401/403)
 * queda fuera hasta reiniciar; uno con 429 se salta hasta que pase su espera.
 * Con un solo ticket todo funciona como antes.
 *
 * En disco cada ticket se identifica por un hash, nunca por su valor.
 */

import fs from 'fs';
import { createHash } from 'crypto';
import { RateLimiter, rutaEstadoPorDefecto } from '../utils/rate-limiter.js';
import { rutaDeDatos } from '../utils/rutas.js';
import { pista, registrarSecreto } from '../utils/redact.js';
import { logger } from '../utils/logger.js';

export const MAXIMO_POR_MINUTO = 15;

export interface Ticket {
  readonly valor: string;
  readonly clave: string;
  readonly mascara: string;
  readonly limitador: RateLimiter;
  rechazado: boolean;
}

export type EstadoTicket = 'activo' | 'limitado' | 'rechazado';

const clave = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);

/** `COMPRA_AGIL_TICKET` primero y después `COMPRA_AGIL_TICKETS` (separados por coma), sin repetidos. */
export function ticketsDelEntorno(env: NodeJS.ProcessEnv = process.env): string[] {
  const todos = [env.COMPRA_AGIL_TICKET ?? '', ...(env.COMPRA_AGIL_TICKETS ?? '').split(',')]
    .map((t) => t.trim()).filter(Boolean);
  return [...new Set(todos)];
}

function rutaDeTicket(c: string): string {
  return rutaDeDatos(`.rate-limit-state-${c}.json`);
}

export class Tickets {
  readonly lista: Ticket[];
  /** Freno por minuto compartido por todos los tickets. */
  readonly freno: RateLimiter;
  /** Índice del último usado: la próxima consulta sale por el siguiente (turno, T1). */
  private ultimo = -1;

  constructor(valores: string[], opciones: { persistir?: boolean; maximoPorMinuto?: number } = {}) {
    const persistir = opciones.persistir === true;
    this.freno = new RateLimiter(opciones.maximoPorMinuto ?? MAXIMO_POR_MINUTO, null);
    this.lista = valores.map((valor, i) => {
      registrarSecreto(valor);
      const c = clave(valor);
      let ruta: string | null = null;
      if (persistir) {
        ruta = rutaDeTicket(c);
        // El estado de antes (un solo archivo, sin hash) pasa al primer ticket.
        const anterior = rutaEstadoPorDefecto();
        if (i === 0 && !fs.existsSync(ruta) && fs.existsSync(anterior)) {
          try { fs.copyFileSync(anterior, ruta); } catch { /* se empieza de cero */ }
        }
      }
      return {
        valor, clave: c, mascara: pista(valor), rechazado: false,
        limitador: new RateLimiter(opciones.maximoPorMinuto ?? MAXIMO_POR_MINUTO, ruta),
      };
    });
  }

  get cantidad(): number { return this.lista.length; }

  /**
   * El ticket por el que debe salir la próxima consulta: el siguiente en turno
   * entre los activos no limitados. Si todos los
   * activos están limitados, devuelve el que antes se libera, para que la
   * consulta informe su 429 como siempre. `null` si no queda ninguno activo.
   */
  elegir(excepto: ReadonlySet<string> = new Set()): Ticket | null {
    const activos = this.lista.filter((t) => !t.rechazado && !excepto.has(t.clave));
    if (activos.length === 0) return null;
    const libres = activos.filter((t) => !t.limitador.checkLimit().limited);
    if (libres.length === 0) {
      return [...activos].sort((a, b) => fin(a) - fin(b))[0];
    }
    const elegido = libres.find((t) => this.lista.indexOf(t) > this.ultimo) ?? libres[0];
    this.ultimo = this.lista.indexOf(elegido);
    return elegido;
  }

  /** ¿Queda otro ticket utilizable si se descarta este? */
  hayOtro(excepto: ReadonlySet<string>): boolean {
    return this.lista.some((t) => !t.rechazado && !excepto.has(t.clave) && !t.limitador.checkLimit().limited);
  }

  rechazar(t: Ticket, http: number): void {
    if (t.rechazado) return;
    t.rechazado = true;
    logger.warn(`El ticket ${t.mascara} fue rechazado por la API (HTTP ${http}). No se usa más hasta reiniciar el servidor.`);
  }

  estado(): Array<{ ticket: string; estado: EstadoTicket; consultas_hoy: number; limitado_hasta: string | null }> {
    return this.lista.map((t) => {
      const s = t.limitador.getStats();
      const estado: EstadoTicket = t.rechazado ? 'rechazado' : t.limitador.checkLimit().limited ? 'limitado' : 'activo';
      return { ticket: t.mascara, estado, consultas_hoy: s.requestsToday, limitado_hasta: estado === 'limitado' ? s.resetTime : null };
    });
  }
}

function fin(t: Ticket): number {
  const r = t.limitador.getStats().resetTime;
  return r ? new Date(r).getTime() : 0;
}
