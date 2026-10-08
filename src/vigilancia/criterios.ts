/**
 * Criterios de alerta de la vigilancia (2.9.0; R2.1–R2.4).
 *
 * Vienen de `services/ciclo-monitor.ts` de la 2.8.0, con exclusiones, regiones
 * y «solo sin ofertas» configurable. Las variables `MONITOR_*` de la 2.8.0
 * siguen valiendo. El entorno lo lee la entrada (daemon o servidor) y lo pasa
 * aquí: el núcleo no toca `process.env`.
 */

import type { CompraAgilItem } from '../api/compra-agil-client.js';
import { normalizar } from '../utils/doc-search.js';
import { enHoraDeChile, parsearFechaApi } from '../utils/fechas.js';
import { EN_TU_REGION } from '../avisos/mensaje.js';

export interface Criterios {
  /** Alguna debe estar en el nombre (sin tildes ni mayúsculas). Vacía: cualquier nombre. */
  palabras: string[];
  /** Ninguna puede estar en el nombre. */
  excluidas: string[];
  /** Códigos de región 1–16. Vacía: todas. */
  regiones: number[];
  /** En CLP. 0: sin filtro de monto, y se aceptan procesos sin monto publicado. */
  presupuestoMinimo: number;
  soloSinOfertas: boolean;
  /**
   * Alerta total de la región: además de las del rubro, avisa todo proceso
   * publicado en `regiones`, sin mirar palabras ni monto. Sin regiones no
   * aplica (serían todas las del país, cientos al día).
   */
  todasEnRegion: boolean;
  /**
   * Solo compras nuevas (pedido del 8-oct): la API entrega lo que CAMBIÓ en
   * cada lote, y eso incluye procesos de días atrás que recibieron una oferta
   * o se modificaron. Con esto se avisan solo los publicados en las últimas
   * 24 h y los que se reabren en segundo llamado sin ofertas. Por defecto, sí.
   */
  soloNuevas: boolean;
}

/** Ventana de «recién publicada», medida desde el lote en que se vio el cambio. */
export const VENTANA_NUEVA_MS = 24 * 3600_000;

export { EN_TU_REGION };

/**
 * El mínimo por defecto es 0: con los $5.000.000 de la 2.8.0 quedaba fuera el
 * 84 % de los procesos publicados (medición del 7-oct-2026, mediana $800.000).
 * Un filtro que el dueño no eligió no debe ocultar procesos.
 */
export const CRITERIOS_POR_DEFECTO: Criterios = {
  palabras: ['software', 'desarrollo', 'licencias', 'plataforma', 'sistema'],
  excluidas: [],
  regiones: [],
  presupuestoMinimo: 0,
  soloSinOfertas: true,
  todasEnRegion: false,
  soloNuevas: true,
};

const lista = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function criteriosDesdeEntorno(env: Record<string, string | undefined>): Criterios {
  const minimo = Number.parseFloat(env.MONITOR_MIN_BUDGET_CLP ?? '');
  return {
    palabras: env.MONITOR_KEYWORDS !== undefined ? lista(env.MONITOR_KEYWORDS) : CRITERIOS_POR_DEFECTO.palabras,
    excluidas: lista(env.MONITOR_EXCLUIR),
    regiones: lista(env.MONITOR_REGIONES).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 16),
    presupuestoMinimo: Number.isFinite(minimo) && minimo > 0 ? minimo : 0,
    soloSinOfertas: (env.MONITOR_SOLO_SIN_OFERTAS ?? 'true').trim().toLowerCase() !== 'false',
    todasEnRegion: (env.MONITOR_TODAS_EN_REGION ?? '').trim().toLowerCase() === 'true',
    soloNuevas: (env.MONITOR_SOLO_NUEVAS ?? 'true').trim().toLowerCase() !== 'false',
  };
}

export const esSegundoLlamado = (item: CompraAgilItem) => item.convocatoria.estado_convocatoria === 2;

/**
 * Publicada en las 24 h previas al lote, o reabierta en segundo llamado y aún
 * sin ofertas. Sin fecha de publicación no se puede saber: se avisa, porque
 * perder una compra nueva es peor que avisar una de más.
 */
export function esNueva(item: CompraAgilItem, loteMs: number): boolean {
  if (esSegundoLlamado(item)) return item.resumen.total_ofertas_recibidas === 0;
  const publicada = parsearFechaApi(item.fechas.fecha_publicacion ?? null);
  return !publicada || publicada.getTime() >= loteMs - VENTANA_NUEVA_MS;
}

/**
 * La palabra que coincidió, `'(cualquier proceso)'` si no hay palabras,
 * `EN_TU_REGION` si solo entra por la alerta total de la región, o `null`.
 * Las exclusiones y «solo sin ofertas» valen también para la alerta total.
 */
export function coincidencia(item: CompraAgilItem, c: Criterios): string | null {
  if (item.estado.codigo !== 'publicada') return null;
  if (c.soloSinOfertas && item.resumen.total_ofertas_recibidas !== 0) return null;
  const region = item.institucion.region;
  if (c.regiones.length > 0 && (typeof region !== 'number' || !c.regiones.includes(region))) return null;
  const nombre = normalizar(item.nombre);
  if (c.excluidas.some((x) => nombre.includes(normalizar(x)))) return null;
  const presupuesto = item.montos.monto_disponible_clp;
  const montoOk = c.presupuestoMinimo <= 0 || (typeof presupuesto === 'number' && presupuesto >= c.presupuestoMinimo);
  const palabra = c.palabras.length === 0 ? '(cualquier proceso)' : c.palabras.find((kw) => nombre.includes(normalizar(kw)));
  if (palabra && montoOk) return palabra;
  return c.todasEnRegion && c.regiones.length > 0 ? EN_TU_REGION : null;
}

export function lineaDeAlerta(item: CompraAgilItem, palabra: string, cuando: Date): string {
  // El cierre se informa declarando la zona: la API lo entrega en hora de
  // Chile sin decirlo (ver utils/fechas.ts). En una alerta cuyo propósito es
  // avisar a tiempo, una hora sin zona es justo la confusión a evitar.
  const cierreChile = enHoraDeChile(item.fechas.fecha_cierre);
  const cierre = cierreChile ? `${cierreChile} (hora de Chile)` : String(item.fechas.fecha_cierre);
  const presupuesto = typeof item.montos.monto_disponible_clp === 'number'
    ? `$${item.montos.monto_disponible_clp.toLocaleString('es-CL')} CLP`
    : 'sin monto publicado';
  return `[${cuando.toISOString()}] [ALERTA] Código: ${item.codigo} | Presupuesto: ${presupuesto} | Cierre: ${cierre} | ` +
    `Institución: ${item.institucion.organismo_comprador ?? 'No informada'} | Coincidencia: "${palabra}" | Nombre: ${item.nombre.trim()}\n`;
}
