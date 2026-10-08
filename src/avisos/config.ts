/**
 * Configuración de los canales de aviso, solo desde el entorno (2.9.0; R4.4,
 * R4.5, ADR 0023).
 *
 * Ninguna herramienta MCP fija ni cambia un destino: el texto de un proceso
 * podría pedirle al modelo que los desvíe. Cada secreto se registra para la
 * redacción aquí, antes de que cualquier canal lo use o lo pueda nombrar un
 * error. Los errores dicen qué variable falta o está mal, nunca su valor.
 *
 * Es frontera del núcleo: recibe el entorno como parámetro (quien llama pasa
 * `process.env`), así se prueba sin tocar el entorno real.
 */

import { registrarSecreto } from '../utils/redact.js';
import type { ConfigBandeja } from './bandeja.js';
import type { NombreCanal } from './canal.js';

export interface ConfigAvisos {
  /** Canales listados y completos. Uno con variables faltantes no se activa. */
  canales: NombreCanal[];
  /** `apiBase`: solo para pruebas (COMPRA_AGIL_TELEGRAM_API apunta a la Bot API simulada). */
  telegram?: { token: string; chatId: string; apiBase?: string };
  webhook?: { url: string; secreto: string };
  correo?: { host: string; puerto: number; usuario: string; clave: string; de: string; para: string[] };
  bandeja: ConfigBandeja;
  /** Hora de Chile «HH:MM» del resumen diario (fase 7). */
  resumen: string;
  errores: string[];
}

const CANALES: NombreCanal[] = ['telegram', 'webhook', 'correo'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const LARGO_MINIMO_SECRETO = 32;
const CORREO = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** https, o http solo hacia la propia máquina (R6.3). */
function urlAceptable(texto: string): boolean {
  try {
    const u = new URL(texto);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

/**
 * `guardado.telegramChatId`: el chat confirmado con código por la herramienta
 * conectar_telegram (anexo de instalación, RA3/RA4). El entorno manda si lo fija.
 */
export function leerConfigAvisos(env: Record<string, string | undefined>, guardado: { telegramChatId?: string } = {}): ConfigAvisos {
  const c: ConfigAvisos = { canales: [], bandeja: {}, resumen: '08:00', errores: [] };
  const valor = (k: string) => env[k]?.trim() || undefined;

  const pedidos = (valor('COMPRA_AGIL_AVISOS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Sin COMPRA_AGIL_AVISOS, Telegram se activa solo si ya tiene token y chat:
  // así la extensión funciona sin que el usuario sepa de variables.
  const chatTelegram = valor('COMPRA_AGIL_TELEGRAM_CHAT_ID') ?? guardado.telegramChatId;
  if (!valor('COMPRA_AGIL_AVISOS') && valor('COMPRA_AGIL_TELEGRAM_TOKEN') && chatTelegram) pedidos.push('telegram');
  for (const p of pedidos) {
    if (!CANALES.includes(p as NombreCanal)) c.errores.push(`COMPRA_AGIL_AVISOS: canal desconocido «${p}» (válidos: ${CANALES.join(', ')}).`);
  }

  // Los secretos se registran aunque el canal no esté pedido: si están en el
  // entorno, no deben salir en ningún texto.
  registrarSecreto(valor('COMPRA_AGIL_TELEGRAM_TOKEN'));
  registrarSecreto(valor('COMPRA_AGIL_WEBHOOK_URL'));
  registrarSecreto(valor('COMPRA_AGIL_WEBHOOK_SECRETO'));
  registrarSecreto(valor('COMPRA_AGIL_SMTP_CLAVE'));

  if (pedidos.includes('telegram')) {
    const token = valor('COMPRA_AGIL_TELEGRAM_TOKEN');
    const chatId = chatTelegram;
    const faltan = [!token && 'COMPRA_AGIL_TELEGRAM_TOKEN', !chatId && 'COMPRA_AGIL_TELEGRAM_CHAT_ID'].filter(Boolean);
    if (faltan.length > 0) c.errores.push(`Telegram no se activa: falta ${faltan.join(' y ')}.`);
    else {
      c.telegram = { token: token!, chatId: chatId!, apiBase: valor('COMPRA_AGIL_TELEGRAM_API') };
      c.canales.push('telegram');
    }
  }

  if (pedidos.includes('webhook')) {
    const url = valor('COMPRA_AGIL_WEBHOOK_URL');
    const secreto = valor('COMPRA_AGIL_WEBHOOK_SECRETO');
    const problemas: string[] = [];
    if (!url) problemas.push('falta COMPRA_AGIL_WEBHOOK_URL');
    else if (!urlAceptable(url)) problemas.push('COMPRA_AGIL_WEBHOOK_URL debe ser https (o http a localhost / 127.0.0.1, para pruebas)');
    if (!secreto) problemas.push('falta COMPRA_AGIL_WEBHOOK_SECRETO');
    else if (secreto.length < LARGO_MINIMO_SECRETO) {
      problemas.push(`COMPRA_AGIL_WEBHOOK_SECRETO debe tener al menos ${LARGO_MINIMO_SECRETO} caracteres (ej. openssl rand -hex 32)`);
    }
    if (problemas.length > 0) c.errores.push(`El webhook no se activa: ${problemas.join('; ')}.`);
    else {
      c.webhook = { url: url!, secreto: secreto! };
      c.canales.push('webhook');
    }
  }

  if (pedidos.includes('correo')) {
    const host = valor('COMPRA_AGIL_SMTP_HOST');
    const usuario = valor('COMPRA_AGIL_SMTP_USUARIO');
    const clave = valor('COMPRA_AGIL_SMTP_CLAVE');
    const puerto = Number(valor('COMPRA_AGIL_SMTP_PUERTO') ?? 587);
    const para = (valor('COMPRA_AGIL_CORREO_PARA') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const de = valor('COMPRA_AGIL_SMTP_DE') ?? usuario;
    const problemas: string[] = [];
    for (const [k, v] of [['COMPRA_AGIL_SMTP_HOST', host], ['COMPRA_AGIL_SMTP_USUARIO', usuario], ['COMPRA_AGIL_SMTP_CLAVE', clave]] as const) {
      if (!v) problemas.push(`falta ${k}`);
    }
    if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) problemas.push('COMPRA_AGIL_SMTP_PUERTO no es un puerto válido');
    if (para.length === 0) problemas.push('falta COMPRA_AGIL_CORREO_PARA (destinatarios separados por coma)');
    const malos = para.filter((p) => !CORREO.test(p));
    if (malos.length > 0) problemas.push(`COMPRA_AGIL_CORREO_PARA tiene direcciones inválidas: ${malos.join(', ')}`);
    if (de && !CORREO.test(de)) problemas.push('COMPRA_AGIL_SMTP_DE no es una dirección de correo');
    if (problemas.length > 0) c.errores.push(`El correo no se activa: ${problemas.join('; ')}.`);
    else {
      c.correo = { host: host!, puerto, usuario: usuario!, clave: clave!, de: de!, para };
      c.canales.push('correo');
    }
  }

  const silencio = valor('COMPRA_AGIL_AVISOS_SILENCIO');
  if (silencio) {
    const [desde, hasta] = silencio.split('-').map((s) => s.trim());
    if (HORA.test(desde ?? '') && HORA.test(hasta ?? '')) c.bandeja.silencio = { desde, hasta };
    else c.errores.push('COMPRA_AGIL_AVISOS_SILENCIO debe tener la forma HH:MM-HH:MM (ej. 22:00-07:00), en hora de Chile.');
  }
  const resumen = valor('COMPRA_AGIL_AVISOS_RESUMEN');
  if (resumen) {
    if (HORA.test(resumen)) c.resumen = resumen;
    else c.errores.push('COMPRA_AGIL_AVISOS_RESUMEN debe tener la forma HH:MM (ej. 08:00), en hora de Chile.');
  }
  return c;
}
