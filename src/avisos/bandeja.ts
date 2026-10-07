/**
 * Bandeja de salida (2.9.0; R3.1–R3.5, ADR 0022).
 *
 * Cada alerta genera un aviso por canal activo, guardado en el estado de la
 * vigilancia (`estado.bandeja`). Así un canal caído o un reinicio no pierden
 * nada: lo que no se entregó sigue ahí en la ronda siguiente. Entrega «al
 * menos una vez»: tras un corte entre enviar y guardar, un aviso puede llegar
 * dos veces, con el mismo id.
 */

import { createHash } from 'crypto';
import { paredDeChile } from '../utils/fechas.js';
import { redact, safeError } from '../utils/redact.js';
import type { Alerta } from './mensaje.js';
import type { Aviso, Canal, LoteDeAvisos, NombreCanal } from './canal.js';

export type Bandeja = Record<string, Aviso>;

/** 30 s, 1, 2, 4, 8, 16, 32 y 60 min. */
export const ESPERAS_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000];
export const MAX_INTENTOS = ESPERAS_MS.length;
/** Procesos por lote: Telegram además divide por caracteres al formatear. */
export const TOPE_POR_LOTE: Record<NombreCanal, number> = { telegram: 50, correo: 50, webhook: 100 };

export interface ConfigBandeja {
  /** Hora de Chile «HH:MM», puede cruzar la medianoche (22:00–07:00). */
  silencio?: { desde: string; hasta: string };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const diaUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Estable entre reinicios y dentro del mismo día. */
export const idDeAviso = (canal: NombreCanal, codigo: string, creadoMs: number) => sha(`${canal}:${codigo}:${diaUtc(creadoMs)}`);

export function encolar(b: Bandeja, alertas: Alerta[], canales: NombreCanal[], ahoraMs: number): number {
  let nuevos = 0;
  for (const alerta of alertas) {
    for (const canal of canales) {
      const id = idDeAviso(canal, alerta.codigo, alerta.creada);
      if (b[id]) continue;
      b[id] = { id, canal, alerta, estado: 'pendiente', intentos: 0, proximoIntento: ahoraMs, creado: ahoraMs };
      nuevos++;
    }
  }
  return nuevos;
}

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function enSilencio(ahoraMs: number, silencio: ConfigBandeja['silencio']): boolean {
  if (!silencio) return false;
  const actual = minutos(paredDeChile(new Date(ahoraMs)).slice(11, 16));
  const desde = minutos(silencio.desde);
  const hasta = minutos(silencio.hasta);
  return desde <= hasta ? actual >= desde && actual < hasta : actual >= desde || actual < hasta;
}

export interface ResultadoEnvios {
  entregados: number;
  fallidos: number;
  reintentos: number;
  porCanal: Record<string, { entregados: number; fallidos: number; reintentos: number }>;
}

export async function enviarPendientes(b: Bandeja, canales: Canal[], ahoraMs: number, config: ConfigBandeja = {}): Promise<ResultadoEnvios> {
  const r: ResultadoEnvios = { entregados: 0, fallidos: 0, reintentos: 0, porCanal: {} };
  if (enSilencio(ahoraMs, config.silencio)) return r;
  for (const canal of canales) {
    const cuenta = (r.porCanal[canal.nombre] = { entregados: 0, fallidos: 0, reintentos: 0 });
    const listos = Object.values(b)
      .filter((a) => a.canal === canal.nombre && a.estado === 'pendiente' && a.proximoIntento <= ahoraMs)
      .sort((x, y) => x.creado - y.creado || x.alerta.codigo.localeCompare(y.alerta.codigo));
    const tope = TOPE_POR_LOTE[canal.nombre];
    for (let i = 0; i < listos.length; i += tope) {
      const avisos = listos.slice(i, i + tope);
      const lote: LoteDeAvisos = {
        id: sha(avisos.map((a) => a.id).join(',')),
        canal: canal.nombre,
        avisos,
        resumenDeSilencio: avisos.some((a) => enSilencio(a.alerta.creada, config.silencio)),
      };
      let resultado;
      try {
        resultado = await canal.enviar(lote, ahoraMs);
      } catch (e) {
        // Un canal que lanza es un defecto del canal: se reintenta, no se pierde el aviso.
        resultado = { ok: false as const, tipo: 'transitorio' as const, motivo: safeError(e) };
      }
      for (const aviso of avisos) {
        aviso.intentos++;
        aviso.actualizado = ahoraMs;
        if (resultado.ok) {
          aviso.estado = 'entregado';
          delete aviso.ultimoError;
          cuenta.entregados++;
        } else if (resultado.tipo === 'permanente' || aviso.intentos >= MAX_INTENTOS) {
          aviso.estado = 'fallido';
          // El motivo lo arma el canal y queda en disco: se redacta aquí también (R4.5).
          aviso.ultimoError = redact(resultado.motivo).slice(0, 200);
          cuenta.fallidos++;
        } else {
          aviso.proximoIntento = ahoraMs + (resultado.reintentarEnMs ?? ESPERAS_MS[aviso.intentos - 1]);
          aviso.ultimoError = redact(resultado.motivo).slice(0, 200);
          cuenta.reintentos++;
        }
      }
    }
    r.entregados += cuenta.entregados;
    r.fallidos += cuenta.fallidos;
    r.reintentos += cuenta.reintentos;
  }
  return r;
}

/** Entregados y fallidos de más de 7 días. Los pendientes no se tocan. */
export function podarBandeja(b: Bandeja, ahoraMs: number): void {
  const limite = ahoraMs - 7 * 24 * 3600_000;
  for (const [id, a] of Object.entries(b)) {
    if (a.estado !== 'pendiente' && (a.actualizado ?? a.creado) < limite) delete b[id];
  }
}
