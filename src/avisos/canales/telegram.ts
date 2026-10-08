/**
 * Canal de Telegram por la Bot API, con `fetch` nativo (2.9.0; R5, ADR 0025).
 *
 * - `sendMessage` con `parse_mode: HTML` y sin vista previa de enlaces.
 * - Un mensaje por segundo al mismo chat (límite de Telegram).
 * - 429 con `retry_after`: transitorio, esperando lo que pide Telegram.
 *   400 (HTML mal formado), 401 (token) y 403 (bot bloqueado): permanentes.
 *
 * El token va en la ruta de la URL (`/bot<token>/`): se registra para la
 * redacción al crear el canal, y ningún motivo de error incluye la URL.
 */

import { registrarSecreto, safeError } from '../../utils/redact.js';
import { clasificarErrorDeRed, clasificarHttp, type Canal, type LoteDeAvisos, type ResultadoEnvio } from '../canal.js';
import { formatearTelegram } from '../formato/telegram.js';
import { sistemaTelegram } from '../formato/sistema.js';
import type { Notificacion } from '../notificacion.js';

export interface OpcionesTelegram {
  token: string;
  chatId: string;
  apiBase?: string;
  /** Inyectable en los tests; en producción, un setTimeout. */
  esperar?: (ms: number) => Promise<void>;
  /** Reloj para el ritmo entre mensajes; en producción, el del sistema. */
  reloj?: () => number;
}

const API = 'https://api.telegram.org';
const PAUSA_ENTRE_MENSAJES_MS = 1000;
const CORTE_MS = 10_000;

interface RespuestaBot { ok: boolean; error_code?: number; description?: string; parameters?: { retry_after?: number }; result?: unknown }

export class CanalTelegram implements Canal {
  readonly nombre = 'telegram' as const;
  private ultimoEnvio = -Infinity;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly reloj: () => number;

  constructor(private readonly o: OpcionesTelegram) {
    registrarSecreto(o.token);
    this.esperar = o.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.reloj = o.reloj ?? (() => performance.now());
  }

  /** Un mensaje suelto (HTML), con el mismo ritmo y la misma clasificación de errores. */
  async enviarTexto(texto: string): Promise<ResultadoEnvio> {
    const espera = this.ultimoEnvio + PAUSA_ENTRE_MENSAJES_MS - this.reloj();
    if (espera > 0) await this.esperar(espera);
    this.ultimoEnvio = this.reloj();
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.o.apiBase ?? API}/bot${this.o.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.o.chatId, text: texto, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(CORTE_MS),
      });
    } catch (e) {
      return { ok: false, ...clasificarErrorDeRed(e) };
    }
    const cuerpo = (await respuesta.json().catch(() => ({}))) as RespuestaBot;
    if (respuesta.ok && cuerpo.ok !== false) return { ok: true };
    const motivo = safeError(`Telegram ${respuesta.status}: ${cuerpo.description ?? respuesta.statusText}`);
    const retry = cuerpo.parameters?.retry_after;
    const c = clasificarHttp(respuesta.status, retry !== undefined ? String(retry) : respuesta.headers.get('retry-after'));
    return c.tipo === 'transitorio'
      ? { ok: false, tipo: 'transitorio', motivo, reintentarEnMs: c.reintentarEnMs }
      : { ok: false, tipo: 'permanente', motivo };
  }

  /**
   * Un lote puede ser varios mensajes. Si uno falla, el lote entero se
   * reintenta: los ya enviados llegarán dos veces, nunca cero (ADR 0022).
   */
  async enviar(lote: LoteDeAvisos, ahoraMs: number): Promise<ResultadoEnvio> {
    for (const texto of formatearTelegram(lote, ahoraMs)) {
      const r = await this.enviarTexto(texto);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  notificar(n: Notificacion): Promise<ResultadoEnvio> {
    return this.enviarTexto(sistemaTelegram(n));
  }

  probar(): Promise<ResultadoEnvio> {
    return this.enviarTexto('<b>Prueba de mcp-compra-agil</b>\nEste chat recibirá los avisos de la vigilancia de Compra Ágil.');
  }
}

/**
 * El chat del último mensaje que alguien le envió al bot (R5.4): así se obtiene
 * el chat id sin herramientas externas. Un fallo vuelve como `{ error }`, ya
 * redactado: no se lanza, para que ningún `cause` arrastre la URL con el token.
 */
export type ResultadoUltimoChat = { chat: { id: string; tipo: string; nombre: string } | null } | { error: string };

export async function ultimoChat(token: string, opciones: { apiBase?: string } = {}): Promise<ResultadoUltimoChat> {
  registrarSecreto(token);
  let respuesta: Response;
  try {
    respuesta = await fetch(`${opciones.apiBase ?? API}/bot${token}/getUpdates`, { signal: AbortSignal.timeout(CORTE_MS) });
  } catch (e) {
    return { error: `No se pudo consultar a Telegram: ${safeError(e)}` };
  }
  const cuerpo = (await respuesta.json().catch(() => ({}))) as RespuestaBot & {
    result?: Array<{ message?: { chat?: { id: number; type: string; title?: string; first_name?: string; username?: string } } }>;
  };
  if (!respuesta.ok || !cuerpo.ok) return { error: safeError(`Telegram respondió ${respuesta.status}: ${cuerpo.description ?? 'sin detalle'}`) };
  const chats = (cuerpo.result ?? []).map((u) => u.message?.chat).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const ultimo = chats.at(-1);
  if (!ultimo) return { chat: null };
  return { chat: { id: String(ultimo.id), tipo: ultimo.type, nombre: ultimo.title ?? ultimo.first_name ?? ultimo.username ?? '' } };
}
