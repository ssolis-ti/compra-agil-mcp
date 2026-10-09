/**
 * Vincular el chat de Telegram conversando, con código de verificación
 * (anexo de instalación por agente, RA3; ADR 0027).
 *
 * 1. `iniciarVinculo`: busca el chat del último mensaje al bot del dueño, le
 *    envía un código de 6 dígitos y guarda solo su hash, por 10 minutos.
 * 2. `confirmarVinculo`: el usuario le dicta al agente el código que le llegó;
 *    si coincide, ese chat queda como destino de los avisos.
 *
 * Por qué el código: el último mensaje al bot podría ser de un tercero, y el
 * modelo lee texto de terceros que podría pedirle confirmar cualquier chat.
 * El código solo lo ve quien tiene el chat en su Telegram.
 */

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';
import { ultimoChat, CanalTelegram } from './canales/telegram.js';
import { actualizarPreferencias, leerPreferencias } from './preferencias.js';

const VIGENCIA_MS = 10 * 60_000;
const MAX_INTENTOS = 5;
/**
 * scrypt con sal, lento a propósito (~0,1 s). Con un hash rápido, quien lea
 * .preferencias.json (un agente con acceso a archivos al que un texto le pidió
 * «confirma el chat») recupera el código de 6 dígitos probando el millón de
 * valores en menos de un segundo. Con este, probarlos lleva más de un día, y
 * el código vence a los 10 minutos.
 */
const hash = (codigo: string, sal: string) =>
  scryptSync(codigo, Buffer.from(sal, 'hex'), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');

export type ResultadoVinculo =
  | { estado: 'codigo_enviado'; chatNombre: string }
  | { estado: 'conectado'; chatNombre: string }
  | { estado: 'sin_mensajes' | 'sin_token' | 'error'; detalle: string };

export async function iniciarVinculo(o: { token?: string; rutaPreferencias: string; ahoraMs: number; apiBase?: string }): Promise<ResultadoVinculo> {
  if (!o.token) return { estado: 'sin_token', detalle: 'Falta el token del bot.' };
  const r = await ultimoChat(o.token, { apiBase: o.apiBase });
  if ('error' in r) return { estado: 'error', detalle: r.error };
  if (!r.chat) return { estado: 'sin_mensajes', detalle: 'El bot no ha recibido mensajes todavía.' };
  const codigo = String(randomInt(100_000, 1_000_000));
  const canal = new CanalTelegram({ token: o.token, chatId: r.chat.id, apiBase: o.apiBase });
  const envio = await canal.enviarTexto(
    `<b>Código para conectar los avisos de Compra Ágil: ${codigo}</b>\nEscríbelo en la conversación con tu asistente. Vence en 10 minutos.\nSi no lo pediste tú, ignora este mensaje.`,
  );
  if (!envio.ok) return { estado: 'error', detalle: envio.motivo };
  const chatNombre = r.chat.nombre || r.chat.tipo;
  actualizarPreferencias(o.rutaPreferencias, (p) => {
    const sal = randomBytes(16).toString('hex');
    p.verificacion = { hash: hash(codigo, sal), sal, chatId: r.chat!.id, chatNombre, expira: o.ahoraMs + VIGENCIA_MS, intentos: 0 };
  });
  return { estado: 'codigo_enviado', chatNombre };
}

export async function confirmarVinculo(o: { token?: string; codigo: string; rutaPreferencias: string; ahoraMs: number; apiBase?: string }): Promise<ResultadoVinculo> {
  const resultado = actualizarPreferencias(o.rutaPreferencias, (p): ResultadoVinculo => {
    const v = p.verificacion;
    if (!v) return { estado: 'error', detalle: 'No hay un código pendiente: primero hay que pedir uno.' };
    if (o.ahoraMs > v.expira) { delete p.verificacion; return { estado: 'error', detalle: 'El código venció (10 minutos). Hay que pedir uno nuevo.' }; }
    v.intentos++;
    // Una verificación sin sal es de una versión anterior: se pide un código nuevo.
    if (!v.sal) { delete p.verificacion; return { estado: 'error', detalle: 'El código es de una versión anterior. Hay que pedir uno nuevo.' }; }
    const recibido = Buffer.from(hash(o.codigo.trim(), v.sal));
    const esperado = Buffer.from(v.hash);
    if (recibido.length !== esperado.length || !timingSafeEqual(recibido, esperado)) {
      if (v.intentos >= MAX_INTENTOS) { delete p.verificacion; return { estado: 'error', detalle: 'Demasiados intentos con un código equivocado. Hay que pedir uno nuevo.' }; }
      return { estado: 'error', detalle: `Ese código no coincide (quedan ${MAX_INTENTOS - v.intentos} intentos).` };
    }
    p.telegramChatId = v.chatId;
    p.telegramChatNombre = v.chatNombre;
    delete p.verificacion;
    return { estado: 'conectado', chatNombre: v.chatNombre };
  });
  if (resultado.estado === 'conectado' && o.token) {
    const p = leerPreferencias(o.rutaPreferencias);
    await new CanalTelegram({ token: o.token, chatId: p.telegramChatId!, apiBase: o.apiBase })
      .enviarTexto('✅ <b>Listo:</b> desde ahora aquí te llegarán los avisos de Compra Ágil que calcen con lo que vendes.')
      .catch(() => undefined);
  }
  return resultado;
}
