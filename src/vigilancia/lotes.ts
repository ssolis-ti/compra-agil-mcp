/**
 * Lotes de cambios de la API (2.9.0; ADR 0021, medición del 7-oct-2026).
 *
 * La API registra los cambios en lotes cada 5 minutos: todos los de un lote
 * llevan la misma marca y entre lotes no hay nada. La vigilancia lee lote por
 * lote. Cada lote se identifica por el instante UTC real en que empieza: en
 * abril, cuando Chile atrasa la hora, la hora de pared se repite, pero cada
 * lote UTC sigue siendo distinto. La consulta se escribe en hora de Chile con
 * «Z», que es como la API compara (ADR 0015).
 */

import { aFormatoApi } from '../utils/fechas.js';

export const PERIODO_LOTE_MS = 5 * 60_000;
/** Medido: el lote estaba completo 2 minutos después de su marca y no cambió después. */
export const ASENTAMIENTO_MS = 2 * 60_000;
/** Los bordes se incluyen: hasta la marca + 4:59 entra un solo lote aunque la marca traiga milisegundos. */
export const ANCHO_CONSULTA_MS = PERIODO_LOTE_MS - 1000;
/** Más atrás que esto no se lee: se informa como hueco (R1.3). */
export const RECUPERACION_MS = 48 * 3600_000;

/** COMPRA_AGIL_VIGILANCIA_RECUPERACION_H (1–168 h); fuera de rango o ausente, 48 h. */
export function recuperacionDesdeEntorno(env: Record<string, string | undefined>): number {
  const h = Number.parseInt(env.COMPRA_AGIL_VIGILANCIA_RECUPERACION_H ?? '', 10);
  return Number.isInteger(h) && h >= 1 && h <= 168 ? h * 3600_000 : RECUPERACION_MS;
}
/** Primer ciclo, sin marca: la última hora. */
export const PRIMERA_VENTANA_MS = 60 * 60_000;

export const inicioDeLote = (ms: number) => Math.floor(ms / PERIODO_LOTE_MS) * PERIODO_LOTE_MS;

export const ultimoLoteAsentado = (ahoraMs: number) => inicioDeLote(ahoraMs - ASENTAMIENTO_MS);

export function ventanaDeLote(loteMs: number): { cambio_desde: string; cambio_hasta: string } {
  return { cambio_desde: aFormatoApi(new Date(loteMs)), cambio_hasta: aFormatoApi(new Date(loteMs + ANCHO_CONSULTA_MS)) };
}

export interface PlanDeLotes {
  /** Lotes por leer, en orden. Incluye los que fallaron antes (siguen después de la marca). */
  lotes: number[];
  /** Lo que queda más atrás que la recuperación: no se lee, se informa. */
  hueco: { desde: number; hasta: number } | null;
}

/**
 * Los lotes entre la marca (exclusive) y el último asentado, menos los ya
 * leídos tras la marca.
 */
export function planificarLotes(
  estado: { marca: number | null; leidos: number[] },
  ahoraMs: number,
  recuperacionMs = RECUPERACION_MS,
): PlanDeLotes {
  const ultimo = ultimoLoteAsentado(ahoraMs);
  const marca = estado.marca ?? ultimo - PRIMERA_VENTANA_MS;
  const primeroPosible = ultimo - recuperacionMs + PERIODO_LOTE_MS;
  let desde = marca + PERIODO_LOTE_MS;
  let hueco: PlanDeLotes['hueco'] = null;
  if (desde < primeroPosible) {
    hueco = { desde, hasta: primeroPosible - PERIODO_LOTE_MS };
    desde = primeroPosible;
  }
  const leidos = new Set(estado.leidos);
  const lotes: number[] = [];
  for (let l = desde; l <= ultimo; l += PERIODO_LOTE_MS) if (!leidos.has(l)) lotes.push(l);
  return { lotes, hueco };
}

/**
 * Un lote paginado se leyó entero si su total no cambió entre la primera y la
 * última consulta y se leyeron tantos códigos distintos como ese total. Un
 * lote pasado solo puede perder procesos (los que vuelven a cambiar pasan al
 * lote nuevo), así que un total igual descarta el corrimiento de páginas.
 */
export function lecturaConsistente(totalInicial: number, totalFinal: number, codigosDistintos: number): boolean {
  return totalInicial === totalFinal && codigosDistintos === totalInicial;
}
