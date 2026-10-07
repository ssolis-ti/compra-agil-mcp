import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { comandoTelegramChatId } from '../src/cli/avisos.js';
// @ts-expect-error: módulo JavaScript sin tipos
import { iniciarMockTelegram } from '../scripts/qa/mock-telegram.mjs';

/**
 * `mcp-compra-agil --telegram-chat-id` (T4.3 de la 2.9.0; R5.4): el dueño le
 * escribe al bot y el comando le dice qué poner en COMPRA_AGIL_TELEGRAM_CHAT_ID.
 * Lo que muestra nunca incluye el token.
 */
let t: { url: string; token: string; mensajeAlBot(c: unknown): void; cerrar(): Promise<void> };
beforeAll(async () => { t = await iniciarMockTelegram(); });
afterAll(async () => { await t.cerrar(); });

const correr = async (env: Record<string, string>) => {
  const lineas: string[] = [];
  const codigo = await comandoTelegramChatId(env, (l) => lineas.push(l));
  return { codigo, salida: lineas.join('\n') };
};

describe('--telegram-chat-id', () => {
  it('sin token: explica qué variable falta y termina con 1', async () => {
    const r = await correr({});
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/COMPRA_AGIL_TELEGRAM_TOKEN/);
  });

  it('sin mensajes al bot: pide escribirle primero', async () => {
    const r = await correr({ COMPRA_AGIL_TELEGRAM_TOKEN: t.token, COMPRA_AGIL_TELEGRAM_API: t.url });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/escríbele/i);
  });

  it('con un mensaje: muestra la línea lista para el .env, sin el token', async () => {
    t.mensajeAlBot({ id: -100555, type: 'group', title: 'Compras' });
    const r = await correr({ COMPRA_AGIL_TELEGRAM_TOKEN: t.token, COMPRA_AGIL_TELEGRAM_API: t.url });
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('COMPRA_AGIL_TELEGRAM_CHAT_ID=-100555');
    expect(r.salida).toContain('Compras');
    expect(r.salida).not.toContain(t.token);
  });
});
