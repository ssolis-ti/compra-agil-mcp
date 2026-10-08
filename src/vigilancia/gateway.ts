/**
 * Cola del modo gateway (2.9.0; R9, ADR 0026).
 *
 * Un gateway siempre encendido (OpenClaw, Hermes) pide las alertas nuevas,
 * las envía por su propio canal y confirma el lote. Lo no confirmado en 30
 * minutos se vuelve a ofrecer con los mismos datos: el gateway pudo caerse
 * entre recibir y enviar. Entrega «al menos una vez».
 */

import { createHash } from 'crypto';
import type { Alerta } from '../avisos/mensaje.js';
import type { EstadoVigilancia } from './estado.js';
import type { Criterios } from './criterios.js';

export const REOFERTA_MS = 30 * 60_000;
const RETENCION_MS = 7 * 24 * 3600_000;
/** Tope para que la cola no crezca sin límite si nadie la consume. */
export const MAX_EN_COLA = 5000;

export function registrarParaGateway(e: EstadoVigilancia, alertas: Alerta[]): void {
  for (const a of alertas) {
    const id = `${a.codigo}@${new Date(a.creada).toISOString().slice(0, 10)}`;
    e.alertas[id] ??= { alerta: a, lote: null, ofrecida: null, confirmada: null };
  }
  const ids = Object.keys(e.alertas);
  if (ids.length > MAX_EN_COLA) {
    const viejas = ids.sort((x, y) => e.alertas[x].alerta.creada - e.alertas[y].alerta.creada).slice(0, ids.length - MAX_EN_COLA);
    for (const id of viejas) delete e.alertas[id];
  }
}

/** Las no confirmadas que nunca se ofrecieron o se ofrecieron hace más de 30 min, las más antiguas primero. */
export function ofrecerLote(e: EstadoVigilancia, max: number, ahoraMs: number): { loteId: string | null; alertas: Alerta[]; quedan: number } {
  const listas = Object.entries(e.alertas)
    .filter(([, g]) => g.confirmada === null && (g.ofrecida === null || ahoraMs - g.ofrecida >= REOFERTA_MS))
    .sort(([, x], [, y]) => x.alerta.creada - y.alerta.creada || x.alerta.codigo.localeCompare(y.alerta.codigo));
  const elegidas = listas.slice(0, max);
  if (elegidas.length === 0) return { loteId: null, alertas: [], quedan: 0 };
  const loteId = createHash('sha256').update(`${elegidas.map(([id]) => id).join(',')}@${ahoraMs}`).digest('hex').slice(0, 16);
  for (const [, g] of elegidas) { g.lote = loteId; g.ofrecida = ahoraMs; }
  return { loteId, alertas: elegidas.map(([, g]) => g.alerta), quedan: listas.length - elegidas.length };
}

/** Idempotente: confirmar dos veces el mismo lote no cambia nada. */
export function confirmarLote(e: EstadoVigilancia, loteId: string, ahoraMs: number): number {
  let n = 0;
  for (const g of Object.values(e.alertas)) {
    if (g.lote === loteId && g.confirmada === null) { g.confirmada = ahoraMs; n++; }
  }
  return n;
}

export function podarGateway(e: EstadoVigilancia, ahoraMs: number): void {
  for (const [id, g] of Object.entries(e.alertas)) if (g.alerta.creada < ahoraMs - RETENCION_MS) delete e.alertas[id];
}

/** Los criterios fijados por herramienta mandan sobre los del entorno. */
export const criteriosEfectivos = (e: EstadoVigilancia, entorno: Criterios): Criterios => {
  if (!e.criterios) return entorno;
  const { palabras, excluidas, regiones, presupuestoMinimo, soloSinOfertas, todasEnRegion, soloNuevas } = e.criterios;
  // Criterios guardados antes de existir la alerta total no la traen.
  return { palabras, excluidas, regiones, presupuestoMinimo, soloSinOfertas, todasEnRegion: todasEnRegion ?? false, soloNuevas: soloNuevas ?? true };
};
