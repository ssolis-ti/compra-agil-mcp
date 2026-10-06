/**
 * Un ciclo del daemon de monitoreo: pide los cambios recientes, aplica los
 * filtros y devuelve las alertas nuevas.
 *
 * Separado de `monitor.ts` (fase 1.6 del plan 2.8.0): el daemon era un script
 * que arrancaba un temporizador al cargarse, así que no se podía probar. Aquí
 * no hay entorno, temporizadores ni consola: el cliente, la configuración, el
 * estado y la escritura llegan como parámetros.
 */

import type { CompraAgilClient, CompraAgilItem } from '../api/compra-agil-client.js';
import { enHoraDeChile, ventanaUltimosMinutos } from '../utils/fechas.js';
import { normalizar } from '../utils/doc-search.js';
import { TAMANO_PAGINA_SEGURO } from '../utils/paginacion.js';

export interface ConfigMonitor {
  intervaloMinutos: number;
  presupuestoMinimo: number;
  /** Ya normalizadas o no: se comparan sin tildes ni mayúsculas. */
  palabrasClave: string[];
}

export interface Alerta {
  codigo: string;
  coincidencia: string;
  linea: string;
}

/** Solapamiento entre ciclos, para no perder cambios en el borde. */
export const MARGEN_CICLO_MINUTOS = 5;

/** ¿El proceso merece alerta? Devuelve la palabra que coincidió, o `null`. */
export function coincidenciaDeAlerta(item: CompraAgilItem, cfg: ConfigMonitor): string | null {
  if (item.estado.codigo !== 'publicada') return null;
  if (item.resumen.total_ofertas_recibidas !== 0) return null;
  // Sin monto publicado no se alerta: `undefined < MIN_BUDGET` es false y
  // dejaba pasar el proceso hasta un toLocaleString() sobre undefined.
  const presupuesto = item.montos.monto_disponible_clp;
  if (typeof presupuesto !== 'number' || presupuesto < cfg.presupuestoMinimo) return null;
  const nombre = normalizar(item.nombre);
  return cfg.palabrasClave.find((kw) => nombre.includes(normalizar(kw))) ?? null;
}

export function lineaDeAlerta(item: CompraAgilItem, coincidencia: string, cuando: Date): string {
  // El cierre se informa declarando la zona: la API lo entrega en hora de
  // Chile sin decirlo (ver utils/fechas.ts). En una alerta cuyo propósito es
  // avisar a tiempo, una hora sin zona es justo la confusión a evitar.
  const cierreChile = enHoraDeChile(item.fechas.fecha_cierre);
  const cierre = cierreChile ? `${cierreChile} (hora de Chile)` : String(item.fechas.fecha_cierre);
  const presupuesto = (item.montos.monto_disponible_clp ?? 0).toLocaleString('es-CL');
  return `[${cuando.toISOString()}] [ALERTA] Código: ${item.codigo} | Presupuesto: $${presupuesto} CLP | Cierre: ${cierre} | ` +
    `Institución: ${item.institucion.organismo_comprador ?? 'No informada'} | Coincidencia: "${coincidencia}" | Nombre: ${item.nombre.trim()}\n`;
}

/**
 * Ejecuta un ciclo. Marca en `alertados` los códigos nuevos con `ahoraMs`.
 * Los errores de la API se propagan: quien llama decide cómo informarlos.
 */
export async function ejecutarCiclo(
  client: Pick<CompraAgilClient, 'buscarTodo'>,
  cfg: ConfigMonitor,
  alertados: Map<string, number>,
  ahoraMs: number,
): Promise<{ revisados: number; alertas: Alerta[] }> {
  // ⚠ Rango absoluto, no `ttl_cambio_ms`: la API compara sus marcas (hora de
  //   Chile con "Z") contra la hora UTC real, y el ttl dejaba fuera las tres
  //   horas más recientes. Ver utils/fechas.ts.
  // Hasta 10 páginas de 10. Una de 50 agota la pasarela (HTTP 504).
  const items = await client.buscarTodo({
    ...ventanaUltimosMinutos(cfg.intervaloMinutos + MARGEN_CICLO_MINUTOS, ahoraMs),
    estado: 'publicada',
    tamano_pagina: TAMANO_PAGINA_SEGURO,
  });

  const alertas: Alerta[] = [];
  for (const item of items) {
    const coincidencia = coincidenciaDeAlerta(item, cfg);
    if (!coincidencia) continue;
    // Deduplicación: no re-alertar un proceso ya notificado en ciclos previos.
    if (alertados.has(item.codigo)) continue;
    alertados.set(item.codigo, ahoraMs);
    alertas.push({ codigo: item.codigo, coincidencia, linea: lineaDeAlerta(item, coincidencia, new Date(ahoraMs)) });
  }
  return { revisados: items.length, alertas };
}
