/**
 * Adjuntos de Compra Ágil (2.9.2): listar los de un proceso y descargar uno.
 *
 * Endpoint del portal público, no de la API con ticket: no gasta cuota del
 * ticket. No es una API oficial y puede cambiar; se apaga con
 * COMPRA_AGIL_ADJUNTOS=off, y la clave se puede reemplazar con
 * COMPRA_AGIL_ADJUNTO_KEY. Medido el 10-oct-2026: el portal exige la clave y
 * un User-Agent de navegador (con otro responde 403).
 */

import { normalizar } from '../utils/doc-search.js';
import { safeError } from '../utils/redact.js';

const BASE = 'https://adjunto.mercadopublico.cl/adjunto-compra-agil/v1/adjuntos-compra-agil';
const CLAVE_POR_DEFECTO = '41186b85826e80d1a0d445a6ce67d1a3';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const TIMEOUT_ADJUNTO_MS = 30_000;
export const MAX_BYTES_ADJUNTO = 20 * 1024 * 1024;

export const adjuntosHabilitados = (env: Record<string, string | undefined> = process.env) =>
  (env.COMPRA_AGIL_ADJUNTOS ?? 'on').trim().toLowerCase() !== 'off';

const encabezados = (env: Record<string, string | undefined>) => ({
  user_key: env.COMPRA_AGIL_ADJUNTO_KEY?.trim() || CLAVE_POR_DEFECTO,
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
});

export interface Adjunto { id: string; nombre: string }
export type Fallo = { ok: false; motivo: string };

export const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Qué falló, en palabras simples. */
function motivoHttp(status: number, que: 'listar' | 'descargar'): string {
  if (status === 403) return 'el portal rechazó la descarga (HTTP 403)';
  if (status === 400 && que === 'listar') return 'el portal no encontró ese proceso (HTTP 400)';
  if (status === 404) return que === 'listar' ? 'el portal no encontró ese proceso (HTTP 404)' : 'el portal no encontró ese archivo (HTTP 404)';
  if (status === 429) return 'el portal pidió esperar (HTTP 429): reintenta en unos minutos';
  if (status >= 500) return que === 'descargar' ? 'el portal no pudo entregar ese archivo (HTTP ' + status + ')' : `el portal falló (HTTP ${status})`;
  return `el portal respondió HTTP ${status}`;
}

async function pedir(url: string, env: Record<string, string | undefined>): Promise<Response | Fallo> {
  try {
    return await fetch(url, { headers: encabezados(env), signal: AbortSignal.timeout(TIMEOUT_ADJUNTO_MS) });
  } catch (e) {
    const timeout = (e as { name?: string } | null)?.name === 'TimeoutError';
    return { ok: false, motivo: timeout ? `el portal no respondió en ${TIMEOUT_ADJUNTO_MS / 1000} s` : `no se pudo conectar con el portal (${safeError(e)})` };
  }
}

export async function listarAdjuntos(codigo: string, env: Record<string, string | undefined> = process.env): Promise<{ ok: true; adjuntos: Adjunto[] } | Fallo> {
  const r = await pedir(`${BASE}/listar/${encodeURIComponent(codigo)}`, env);
  if (!(r instanceof Response)) return r;
  if (!r.ok) return { ok: false, motivo: motivoHttp(r.status, 'listar') };
  const cuerpo = (await r.json().catch(() => null)) as { payload?: { files?: Array<{ id?: unknown; nombreArchivo?: unknown }> } } | null;
  const files = cuerpo?.payload?.files;
  if (!Array.isArray(files)) return { ok: false, motivo: 'el portal respondió con una forma inesperada' };
  return {
    ok: true,
    adjuntos: files.filter((f) => typeof f.id === 'string').map((f) => ({ id: f.id as string, nombre: typeof f.nombreArchivo === 'string' ? f.nombreArchivo : '(sin nombre)' })),
  };
}

/** Por nombre (parcial, sin tildes ni mayúsculas); sin nombre o sin coincidencia, el primero. */
export function elegirAdjunto(adjuntos: Adjunto[], nombre?: string): Adjunto | undefined {
  if (!nombre?.trim()) return adjuntos[0];
  const buscado = normalizar(nombre);
  return adjuntos.find((a) => normalizar(a.nombre).includes(buscado));
}

/**
 * Con dos descargas a la vez el portal entrega una y las otras vuelven vacías
 * (HTTP 200 con 0 bytes; medido el 10-oct-2026): se descargan de a una, y una
 * respuesta vacía se reintenta.
 */
let cola: Promise<unknown> = Promise.resolve();
const ESPERAS_VACIO_MS = [1500, 4000];

export function descargarAdjunto(id: string, env: Record<string, string | undefined> = process.env, esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ ok: true; datos: Buffer; tipo: string } | Fallo> {
  const turno = cola.then(async () => {
    for (let intento = 0; ; intento++) {
      const r = await descargarUnaVez(id, env);
      if (!r.ok || r.datos.length > 0) return r;
      if (intento >= ESPERAS_VACIO_MS.length) return { ok: false as const, motivo: 'el portal entregó el archivo vacío; reintenta en un momento' };
      await esperar(ESPERAS_VACIO_MS[intento]);
    }
  });
  cola = turno.catch(() => undefined);
  return turno;
}

async function descargarUnaVez(id: string, env: Record<string, string | undefined>): Promise<{ ok: true; datos: Buffer; tipo: string } | Fallo> {
  const r = await pedir(`${BASE}/descargar/${encodeURIComponent(id)}`, env);
  if (!(r instanceof Response)) return r;
  if (!r.ok) return { ok: false, motivo: motivoHttp(r.status, 'descargar') };
  const declarado = Number(r.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_ADJUNTO) {
    return { ok: false, motivo: `el archivo pesa ${(declarado / 1024 / 1024).toFixed(1)} MB, sobre el máximo de ${MAX_BYTES_ADJUNTO / 1024 / 1024} MB` };
  }
  const datos = Buffer.from(await r.arrayBuffer());
  if (datos.length > MAX_BYTES_ADJUNTO) return { ok: false, motivo: `el archivo pasa de ${MAX_BYTES_ADJUNTO / 1024 / 1024} MB` };
  return { ok: true, datos, tipo: r.headers.get('content-type') ?? '' };
}
