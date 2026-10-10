/**
 * Canal de Telegram por la Bot API, con `fetch` nativo (2.9.0; R5, ADR 0025).
 *
 * - `sendMessage` con `parse_mode: HTML` y sin vista previa de enlaces.
 * - Un mensaje por segundo al mismo chat (límite de Telegram).
 * - 429 con `retry_after`: transitorio, esperando lo que pide Telegram.
 *   400 (HTML mal formado), 401 (token) y 403 (bot bloqueado): permanentes.
 * - Chat privado, grupo, supergrupo (con temas) o canal (2.9.1). Si un grupo
 *   pasa a supergrupo, Telegram responde con el nuevo id: se reintenta ahí y
 *   se avisa a quien guardó el chat.
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
  /** Tema de un supergrupo con temas (message_thread_id). */
  hilo?: string;
  apiBase?: string;
  /** El grupo pasó a supergrupo y cambió de id: quien guardó el chat lo actualiza. */
  alMigrar?: (nuevoChatId: string) => void;
  /** Inyectable en los tests; en producción, un setTimeout. */
  esperar?: (ms: number) => Promise<void>;
  /** Reloj para el ritmo entre mensajes; en producción, el del sistema. */
  reloj?: () => number;
}

const API = 'https://api.telegram.org';
const PAUSA_ENTRE_MENSAJES_MS = 1000;
const CORTE_MS = 10_000;

interface RespuestaBot {
  ok: boolean; error_code?: number; description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number }; result?: unknown;
}

/**
 * Lo que Telegram dice, más qué hacer, en palabras del dueño. Los textos de
 * Telegram son estables y en inglés; se reconocen por partes.
 */
export function explicarErrorTelegram(status: number, descripcion = ''): string {
  const d = descripcion.toLowerCase();
  if (status === 401) return 'el token del bot no es válido: revisa que lo copiaste completo desde @BotFather';
  if (d.includes('bot was kicked') || d.includes('bot is not a member')) return 'el bot ya no está en ese grupo o canal: vuelve a agregarlo y conéctalo de nuevo';
  if (d.includes('bot was blocked')) return 'bloqueaste al bot en Telegram: desbloquéalo y escríbele de nuevo';
  if (d.includes('need administrator rights') || d.includes('not enough rights')) {
    return 'el bot no tiene permiso para publicar: en un canal, hazlo administrador con permiso para «Publicar mensajes»; en un grupo, revisa que pueda enviar mensajes';
  }
  if (d.includes('chat not found')) return 'el chat no existe o el bot no está en él: agrega el bot al grupo o canal y conéctalo de nuevo';
  if (d.includes('message thread not found')) return 'ese tema del grupo ya no existe: conéctalo de nuevo desde el tema donde quieres los avisos';
  if (status === 409) return 'este bot tiene un webhook configurado (lo usa otro servicio), y así no se pueden leer sus mensajes: usa un bot nuevo para los avisos';
  return descripcion || `Telegram respondió ${status}`;
}

export class CanalTelegram implements Canal {
  readonly nombre = 'telegram' as const;
  private ultimoEnvio = -Infinity;
  private chatId: string;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly reloj: () => number;

  constructor(private readonly o: OpcionesTelegram) {
    registrarSecreto(o.token);
    this.chatId = o.chatId;
    this.esperar = o.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.reloj = o.reloj ?? (() => performance.now());
  }

  /** Un mensaje suelto (HTML), con el mismo ritmo y la misma clasificación de errores. */
  async enviarTexto(texto: string, migrado = false): Promise<ResultadoEnvio> {
    const espera = this.ultimoEnvio + PAUSA_ENTRE_MENSAJES_MS - this.reloj();
    if (espera > 0) await this.esperar(espera);
    this.ultimoEnvio = this.reloj();
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.o.apiBase ?? API}/bot${this.o.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId, text: texto, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
          ...(this.o.hilo ? { message_thread_id: Number(this.o.hilo) } : {}),
        }),
        signal: AbortSignal.timeout(CORTE_MS),
      });
    } catch (e) {
      return { ok: false, ...clasificarErrorDeRed(e) };
    }
    const cuerpo = (await respuesta.json().catch(() => ({}))) as RespuestaBot;
    if (respuesta.ok && cuerpo.ok !== false) return { ok: true };
    // El grupo pasó a supergrupo: Telegram da el id nuevo. Se reintenta una vez ahí.
    const nuevo = cuerpo.parameters?.migrate_to_chat_id;
    if (nuevo !== undefined && !migrado) {
      this.chatId = String(nuevo);
      this.o.alMigrar?.(this.chatId);
      return this.enviarTexto(texto, true);
    }
    const motivo = safeError(`Telegram ${respuesta.status}: ${explicarErrorTelegram(respuesta.status, cuerpo.description ?? respuesta.statusText)}`);
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

export interface ChatEncontrado {
  id: string;
  /** private, group, supergroup o channel. */
  tipo: string;
  nombre: string;
  /** Tema del supergrupo desde donde se escribió, si tiene temas. */
  hilo?: string;
}

/**
 * El chat más reciente donde el bot recibió algo (R5.4): así se obtiene el
 * chat id sin herramientas externas. Un fallo vuelve como `{ error }`, ya
 * redactado: no se lanza, para que ningún `cause` arrastre la URL con el token.
 *
 * Además de los mensajes privados, cuenta lo que el bot ve en grupos y
 * canales aunque tenga el modo privacidad activo (2.9.1): que lo agreguen
 * (`my_chat_member`), una publicación del canal (`channel_post`) o un comando
 * dirigido a él. Un «hola» en un grupo no le llega con el modo privacidad, y
 * antes los canales no se detectaban nunca.
 */
export type ResultadoUltimoChat = { chat: ChatEncontrado | null } | { error: string };

interface ChatTg { id: number; type: string; title?: string; first_name?: string; username?: string }
interface MensajeTg { chat?: ChatTg; message_thread_id?: number; is_topic_message?: boolean; migrate_to_chat_id?: number }
interface UpdateTg {
  message?: MensajeTg; edited_message?: MensajeTg; channel_post?: MensajeTg; edited_channel_post?: MensajeTg;
  my_chat_member?: { chat?: ChatTg; new_chat_member?: { status?: string } };
}

const nombreDe = (c: ChatTg) => c.title ?? c.first_name ?? c.username ?? '';

export async function ultimoChat(token: string, opciones: { apiBase?: string } = {}): Promise<ResultadoUltimoChat> {
  registrarSecreto(token);
  let respuesta: Response;
  try {
    respuesta = await fetch(`${opciones.apiBase ?? API}/bot${token}/getUpdates`, { signal: AbortSignal.timeout(CORTE_MS) });
  } catch (e) {
    return { error: `No se pudo consultar a Telegram: ${safeError(e)}` };
  }
  const cuerpo = (await respuesta.json().catch(() => ({}))) as RespuestaBot & { result?: UpdateTg[] };
  if (!respuesta.ok || !cuerpo.ok) return { error: safeError(`Telegram respondió ${respuesta.status}: ${explicarErrorTelegram(respuesta.status, cuerpo.description ?? 'sin detalle')}`) };

  let elegido: ChatEncontrado | null = null;
  for (const u of cuerpo.result ?? []) {
    const miembro = u.my_chat_member;
    if (miembro?.chat) {
      const estado = miembro.new_chat_member?.status ?? '';
      // Lo sacaron del grupo o canal: ese chat ya no sirve.
      if (estado === 'left' || estado === 'kicked') {
        if (elegido?.id === String(miembro.chat.id)) elegido = null;
      } else {
        elegido = { id: String(miembro.chat.id), tipo: miembro.chat.type, nombre: nombreDe(miembro.chat) };
      }
      continue;
    }
    const m = u.message ?? u.edited_message ?? u.channel_post ?? u.edited_channel_post;
    if (!m?.chat) continue;
    if (m.migrate_to_chat_id !== undefined) {
      elegido = { id: String(m.migrate_to_chat_id), tipo: 'supergroup', nombre: nombreDe(m.chat) };
      continue;
    }
    elegido = {
      id: String(m.chat.id), tipo: m.chat.type, nombre: nombreDe(m.chat),
      ...(m.is_topic_message && m.message_thread_id !== undefined ? { hilo: String(m.message_thread_id) } : {}),
    };
  }
  return { chat: elegido };
}

/** Qué hacer para que el bot vea el chat, según dónde se quieran los avisos. */
export const COMO_CONECTAR_TELEGRAM = [
  'Chat personal: abre tu bot en Telegram y escríbele «hola».',
  'Grupo: agrega el bot al grupo (eso basta para que lo vea). Si ya estaba, escribe en el grupo /start@NombreDeTuBot.',
  'Canal: agrega el bot como administrador con permiso para «Publicar mensajes» y publica cualquier mensaje en el canal.',
].join(' ');
