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

/** Parámetros que jamás deben formar parte de la clave ni tocar el disco. */
const PARAMS_SECRETOS = new Set(['ticket']);

interface Entrada {
  /** Momento (epoch ms) en que la entrada deja de ser válida. */
  expira: number;
  valor: unknown;
}

export interface OpcionesCache {
  /** Ruta del archivo de persistencia, o `null` para vivir solo en memoria. */
  rutaEstado?: string | null;
  /** Máximo de entradas retenidas; al excederlo se descartan las más antiguas. */
  maxEntradas?: number;
}

export class ResponseCache {
  private entradas = new Map<string, Entrada>();
  private readonly rutaEstado: string | null;
  private readonly maxEntradas: number;
  private aciertos = 0;
  private fallos = 0;

  constructor(opciones: OpcionesCache = {}) {
    this.rutaEstado = opciones.rutaEstado ?? null;
    this.maxEntradas = opciones.maxEntradas ?? 500;
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
    this.entradas.set(clave, { expira: Date.now() + ttlSegundos * 1000, valor });
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

  /** Vacía la caché (memoria y disco). */
  limpiar(): void {
    this.entradas.clear();
    this.persistir();
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

  private persistir(): void {
    if (!this.rutaEstado) return;
    try {
      fs.writeFileSync(this.rutaEstado, JSON.stringify(Object.fromEntries(this.entradas)), 'utf8');
    } catch {
      // Si el disco no deja escribir, se sigue con la caché en memoria.
    }
  }
}
