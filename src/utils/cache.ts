/**
 * Caché de respuestas de la API, con vencimiento y persistencia en disco.
 *
 * ⚠ POR QUÉ EXISTE: la cuota del ticket se agotaba en minutos. Medido en
 *   auditoría, evaluar UNA oportunidad con el flujo natural (radar → detalle →
 *   analizar_precios → generar_borrador → auditar_desiertas) costaba ~29
 *   consultas, porque las tres herramientas de análisis repiten exactamente la
 *   misma pareja de llamadas —`buscar({q, estado:'desierta'})` y luego
 *   `detalle()` sobre los primeros resultados— y no existía ninguna caché: el
 *   mismo histórico se descargaba hasta tres veces en cuestión de minutos.
 *
 *   Un proceso ya declarado desierto es inmutable, así que reutilizarlo es
 *   gratis en exactitud y enorme en cuota.
 *
 * 🔒 El ticket NUNCA entra aquí: se excluye al construir la clave (el endpoint
 *   heredado de Órdenes de Compra lo lleva en el query string) y solo se
 *   guarda el cuerpo de la respuesta, que es información pública.
 */

import fs from 'fs';
import { logger } from './logger.js';
import { escribirAtomico } from './archivo-atomico.js';

/** Parámetros que jamás deben formar parte de la clave ni tocar el disco. */
const PARAMS_SECRETOS = new Set(['ticket']);

interface Entrada {
  /** Momento (epoch ms) en que la entrada deja de ser válida. */
  expira: number;
  valor: unknown;
  /** Momento (epoch ms) en que se guardó. Falta en archivos de versiones anteriores. */
  creado?: number;
}

export interface OpcionesCache {
  /** Ruta del archivo de persistencia, o `null` para vivir solo en memoria. */
  rutaEstado?: string | null;
  /** Máximo de entradas retenidas; al excederlo se descartan las más antiguas. */
  maxEntradas?: number;
  /** Espera antes de escribir a disco, para agrupar una ráfaga de respuestas. */
  esperaEscrituraMs?: number;
}

/** Cachés con escritura pendiente: se vacían al cerrar el proceso. */
const pendientesAlSalir = new Set<ResponseCache>();
let salidaRegistrada = false;
function registrarVaciadoAlSalir(): void {
  if (salidaRegistrada) return;
  salidaRegistrada = true;
  process.on('exit', () => {
    for (const cache of pendientesAlSalir) cache.vaciar();
  });
}

export class ResponseCache {
  private entradas = new Map<string, Entrada>();
  private readonly rutaEstado: string | null;
  private readonly maxEntradas: number;
  private aciertos = 0;
  private fallos = 0;
  private readonly esperaEscrituraMs: number;
  private temporizador: NodeJS.Timeout | null = null;

  constructor(opciones: OpcionesCache = {}) {
    this.rutaEstado = opciones.rutaEstado ?? null;
    this.maxEntradas = opciones.maxEntradas ?? 500;
    this.esperaEscrituraMs = opciones.esperaEscrituraMs ?? 1000;
    this.cargar();
  }

  /**
   * Clave estable para una consulta: mismo endpoint y mismos parámetros
   * producen la misma clave sin importar el orden en que se escribieron.
   */
  static clave(path: string, params?: Record<string, unknown>): string {
    const limpios = Object.entries(params ?? {})
      .filter(([k, v]) => !PARAMS_SECRETOS.has(k.toLowerCase()) && v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('&');
    return limpios ? `${path}?${limpios}` : path;
  }

  /** Dice si hay una entrada vigente, sin contarla como acierto ni como fallo. */
  vigente(clave: string): boolean {
    const e = this.entradas.get(clave);
    return Boolean(e && Date.now() < e.expira);
  }

  /**
   * Segundos desde que se guardó una entrada vigente, sin contarla como
   * acierto. `undefined` si no está, venció o no se sabe cuándo se creó.
   */
  edad(clave: string): number | undefined {
    const e = this.entradas.get(clave);
    if (!e || Date.now() >= e.expira || typeof e.creado !== 'number') return undefined;
    return Math.max(0, Math.round((Date.now() - e.creado) / 1000));
  }

  /** Devuelve el valor vigente, o `undefined` si no está o ya venció. */
  obtener<T>(clave: string): T | undefined {
    const e = this.entradas.get(clave);
    if (!e) {
      this.fallos++;
      return undefined;
    }
    if (Date.now() >= e.expira) {
      this.entradas.delete(clave);
      this.fallos++;
      return undefined;
    }
    // Renovar posición para que la purga descarte lo realmente frío.
    this.entradas.delete(clave);
    this.entradas.set(clave, e);
    this.aciertos++;
    return e.valor as T;
  }

  guardar(clave: string, valor: unknown, ttlSegundos: number): void {
    if (ttlSegundos <= 0) return;
    const ahora = Date.now();
    this.entradas.set(clave, { expira: ahora + ttlSegundos * 1000, valor, creado: ahora });
    this.purgar();
    this.persistir();
  }

  /** Elimina lo vencido y, si aún sobra, lo más antiguo. */
  private purgar(): void {
    const ahora = Date.now();
    for (const [k, e] of this.entradas) {
      if (ahora >= e.expira) this.entradas.delete(k);
    }
    while (this.entradas.size > this.maxEntradas) {
      const primera = this.entradas.keys().next();
      if (primera.done) break;
      this.entradas.delete(primera.value);
    }
  }

  estadisticas(): { entradas: number; aciertos: number; fallos: number; ahorroPorcentaje: number } {
    const total = this.aciertos + this.fallos;
    return {
      entradas: this.entradas.size,
      aciertos: this.aciertos,
      fallos: this.fallos,
      ahorroPorcentaje: total === 0 ? 0 : Math.round((this.aciertos / total) * 100),
    };
  }

  /** Vacía la caché (memoria y disco), sin esperar. */
  limpiar(): void {
    this.entradas.clear();
    this.vaciar(true);
  }

  /**
   * Escribe ya lo pendiente. Lo llama el temporizador, el cierre del proceso y
   * quien necesite el disco al día (tests, `limpiar`).
   */
  vaciar(forzar = false): void {
    const habiaPendiente = this.temporizador !== null;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = null;
    pendientesAlSalir.delete(this);
    if (habiaPendiente || forzar) this.escribir();
  }

  private cargar(): void {
    if (!this.rutaEstado) return;
    try {
      if (!fs.existsSync(this.rutaEstado)) return;
      const crudo = JSON.parse(fs.readFileSync(this.rutaEstado, 'utf8')) as Record<string, Entrada>;
      const ahora = Date.now();
      for (const [k, e] of Object.entries(crudo)) {
        if (e && typeof e.expira === 'number' && ahora < e.expira) {
          this.entradas.set(k, e);
        }
      }
      if (this.entradas.size > 0) {
        logger.debug(`Caché: ${this.entradas.size} respuesta(s) vigente(s) recuperada(s) del disco.`);
      }
    } catch {
      // Una caché ilegible se descarta: es una optimización, no un requisito.
    }
  }

  /**
   * Programa la escritura a disco.
   *
   * ⚠ Fase 1.2 (auditoría QA 2.6.1): antes cada respuesta reescribía el JSON
   *   entero —hasta 500 entradas, varios MB— con `writeFileSync`, y una tanda
   *   de 20 detalles en paralelo eran 20 escrituras síncronas que bloqueaban el
   *   proceso. Ahora la ráfaga se agrupa en una sola escritura.
   */
  private persistir(): void {
    if (!this.rutaEstado) return;
    if (this.temporizador) return;
    this.temporizador = setTimeout(() => this.vaciar(), this.esperaEscrituraMs);
    this.temporizador.unref();
    pendientesAlSalir.add(this);
    registrarVaciadoAlSalir();
  }

  /**
   * Escritura atómica: a un temporal y luego `rename`. Un corte a mitad deja
   * el archivo anterior completo, nunca uno a medias e ilegible.
   */
  private escribir(): void {
    if (!this.rutaEstado) return;
    // Si el disco no deja escribir, se sigue con la caché en memoria.
    escribirAtomico(this.rutaEstado, JSON.stringify(Object.fromEntries(this.entradas)));
  }
}
