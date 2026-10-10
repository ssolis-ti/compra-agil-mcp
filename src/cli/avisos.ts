/**
 * Comandos de terminal de los avisos (2.9.0).
 *
 * `--telegram-chat-id` (R5.4): el dueño le escribe cualquier cosa a su bot y
 * este comando le dice qué valor poner en COMPRA_AGIL_TELEGRAM_CHAT_ID. Lee el
 * token del entorno (nunca de un argumento: quedaría en el historial) y no lo
 * muestra.
 *
 * Devuelve el código de salida; la entrada (`index.ts`) termina el proceso.
 */

import { ultimoChat, COMO_CONECTAR_TELEGRAM } from '../avisos/canales/telegram.js';

export async function comandoTelegramChatId(env: Record<string, string | undefined>, escribir: (linea: string) => void): Promise<number> {
  const token = env.COMPRA_AGIL_TELEGRAM_TOKEN?.trim();
  if (!token) {
    escribir('Falta COMPRA_AGIL_TELEGRAM_TOKEN en el .env: es el token que te dio @BotFather al crear el bot.');
    return 1;
  }
  const r = await ultimoChat(token, { apiBase: env.COMPRA_AGIL_TELEGRAM_API?.trim() || undefined });
  if ('error' in r) {
    escribir(`No se pudo obtener el chat: ${r.error}`);
    return 1;
  }
  const { chat } = r;
  if (!chat) {
    escribir(`El bot todavía no ve ningún chat. ${COMO_CONECTAR_TELEGRAM} Después vuelve a correr este comando.`);
    return 1;
  }
  escribir(`Último chat que le escribió al bot: ${chat.nombre || '(sin nombre)'} (${chat.tipo}).`);
  escribir('Agrega esta línea a tu .env:');
  escribir(`COMPRA_AGIL_TELEGRAM_CHAT_ID=${chat.id}`);
  if (chat.hilo) escribir(`COMPRA_AGIL_TELEGRAM_THREAD_ID=${chat.hilo}`);
  return 0;
}
