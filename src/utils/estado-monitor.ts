/**
 * Estado de deduplicación del daemon de monitoreo (`.monitor-state.json`).
 *
 * ⚠ Fase 1.7 (auditoría QA 2.6.1): el daemon guardaba la lista de códigos ya
 *   alertados y nunca la podaba: crecía para siempre. Un proceso de Compra Ágil
 *   cierra en días, así que pasado un mes ya no puede volver a alertar. Ahora
 *   cada código guarda cuándo se alertó y se podan los de más de 30 días.
 *
 * Formatos:
 *   antes:  { "alerted": ["1-2-COT26", ...] }
 *   ahora:  { "alertados": { "1-2-COT26": 1759780000000, ... } }   (epoch ms)
 * Un archivo del formato anterior se lee igual: sus códigos toman la fecha de
 * hoy, así que no se re-alertan y se podan dentro de 30 días.
 */

export const DIAS_RETENCION = 30;

export function leerEstadoMonitor(texto: string, ahoraMs: number): Map<string, number> {
  const estado = new Map<string, number>();
  const crudo = JSON.parse(texto) as { alerted?: unknown; alertados?: unknown };
  if (crudo.alertados && typeof crudo.alertados === 'object') {
    for (const [codigo, cuando] of Object.entries(crudo.alertados as Record<string, unknown>)) {
      if (typeof cuando === 'number' && Number.isFinite(cuando)) estado.set(codigo, cuando);
    }
  }
  if (Array.isArray(crudo.alerted)) {
    for (const codigo of crudo.alerted) {
      if (typeof codigo === 'string' && !estado.has(codigo)) estado.set(codigo, ahoraMs);
    }
  }
  return estado;
}

/** Quita los códigos alertados hace más de `dias`. Devuelve cuántos quitó. */
export function podarEstado(estado: Map<string, number>, ahoraMs: number, dias = DIAS_RETENCION): number {
  const limite = ahoraMs - dias * 24 * 60 * 60 * 1000;
  let quitados = 0;
  for (const [codigo, cuando] of estado) {
    if (cuando < limite) {
      estado.delete(codigo);
      quitados++;
    }
  }
  return quitados;
}

export function serializarEstado(estado: Map<string, number>): string {
  return JSON.stringify({ alertados: Object.fromEntries(estado) }, null, 2);
}
