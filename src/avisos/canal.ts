/**
 * Contrato de un canal de aviso y clasificación de sus errores (2.9.0; R3.2).
 *
 * Un canal solo sabe enviar un lote y decir qué pasó. Qué se reintenta, cuándo
 * y cuántas veces lo decide la bandeja. Un error transitorio (5xx, 408, 429,
 * red) se reintenta; uno permanente (4xx, credenciales, destinatario
 * bloqueado) no, porque reintentarlo solo gasta y llena los logs.
 */

import { safeError } from '../utils/redact.js';
import type { Alerta } from './mensaje.js';

export type NombreCanal = 'telegram' | 'webhook' | 'correo';

export interface Aviso {
  /** sha256(canal:código:día) recortado: estable entre reinicios (ADR 0022). */
  id: string;
  canal: NombreCanal;
  alerta: Alerta;
  estado: 'pendiente' | 'entregado' | 'fallido';
  intentos: number;
  /** Epoch ms desde el que se puede volver a intentar. */
  proximoIntento: number;
  creado: number;
  actualizado?: number;
  ultimoError?: string;
}

export interface LoteDeAvisos {
  /** Estable para el mismo conjunto de avisos: el webhook lo entrega como Idempotency-Key. */
  id: string;
  canal: NombreCanal;
  avisos: Aviso[];
  /** Avisos retenidos durante el horario de silencio, enviados juntos al terminar. */
  resumenDeSilencio: boolean;
}

export type ResultadoEnvio =
  | { ok: true }
  | { ok: false; tipo: 'transitorio' | 'permanente'; motivo: string; reintentarEnMs?: number };

export interface Canal {
  readonly nombre: NombreCanal;
  enviar(lote: LoteDeAvisos, ahoraMs: number): Promise<ResultadoEnvio>;
  /** Mensaje de prueba (R10.2). Sin destino como parámetro: el destino lo fija el entorno (ADR 0023). */
  probar(ahoraMs: number): Promise<ResultadoEnvio>;
}

/** Retry-After en segundos o como fecha HTTP. */
function esperaDeRetryAfter(valor: string | null | undefined, ahoraMs: number): number | undefined {
  if (!valor) return undefined;
  if (/^\d+$/.test(valor.trim())) return Number(valor.trim()) * 1000;
  const fecha = Date.parse(valor);
  return Number.isNaN(fecha) ? undefined : Math.max(0, fecha - ahoraMs);
}

export function clasificarHttp(
  status: number,
  retryAfter?: string | null,
  ahoraMs = 0,
): { tipo: 'ok' | 'transitorio' | 'permanente'; reintentarEnMs?: number } {
  if (status >= 200 && status < 300) return { tipo: 'ok' };
  if (status === 408 || status === 429 || status >= 500) return { tipo: 'transitorio', reintentarEnMs: esperaDeRetryAfter(retryAfter, ahoraMs) };
  return { tipo: 'permanente' };
}

/** Un fallo antes de tener respuesta (timeout, red, DNS) siempre se reintenta. El motivo va redactado. */
export function clasificarErrorDeRed(e: unknown): { tipo: 'transitorio'; motivo: string } {
  return { tipo: 'transitorio', motivo: safeError(e) };
}
