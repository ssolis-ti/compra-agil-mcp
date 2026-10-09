import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { iniciarVinculo, confirmarVinculo } from '../src/avisos/vincular-telegram.js';
import { leerPreferencias } from '../src/avisos/preferencias.js';
import { configAvisosDelEquipo } from '../src/avisos/preferencias.js';
// @ts-expect-error: módulo JavaScript sin tipos
import { iniciarMockTelegram } from '../scripts/qa/mock-telegram.mjs';

/**
 * Vincular el chat de Telegram conversando, con código (anexo, RA3/RA4;
 * ADR 0027): el destino solo queda fijado si quien escribe en el chat del
 * agente tiene en su Telegram el código que llegó a ese chat.
 */
const T = Date.parse('2026-10-08T15:00:00Z');
let tg: { url: string; token: string; recibidos: Array<{ chat_id: string; text: string }>; mensajeAlBot(c: unknown): void; cerrar(): Promise<void> };
beforeAll(async () => { tg = await iniciarMockTelegram(); });
afterAll(async () => { await tg.cerrar(); });

const preferencias = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vinculo-')), '.preferencias.json');
const codigoEnviado = () => tg.recibidos.at(-1)!.text.match(/(\d{6})/)![1];

describe('vincular Telegram con código', () => {
  it('sin token o sin mensajes al bot, lo dice', async () => {
    expect((await iniciarVinculo({ rutaPreferencias: preferencias(), ahoraMs: T })).estado).toBe('sin_token');
    expect((await iniciarVinculo({ token: tg.token, rutaPreferencias: preferencias(), ahoraMs: T, apiBase: tg.url })).estado).toBe('sin_mensajes');
  });

  it('envía el código al chat, guarda solo su hash, y con el código correcto conecta y activa Telegram', async () => {
    tg.mensajeAlBot({ id: -100555, type: 'group', title: 'Compras Oficina' });
    const ruta = preferencias();
    const r = await iniciarVinculo({ token: tg.token, rutaPreferencias: ruta, ahoraMs: T, apiBase: tg.url });
    expect(r).toEqual({ estado: 'codigo_enviado', chatNombre: 'Compras Oficina' });
    const codigo = codigoEnviado();
    expect(String(tg.recibidos.at(-1)!.chat_id)).toBe('-100555');
    expect(fs.readFileSync(ruta, 'utf8')).not.toContain(codigo);
    // Ni un hash rápido sin sal: con el archivo a mano, el millón de códigos se probaría en menos de un segundo.
    const v = leerPreferencias(ruta).verificacion!;
    expect(v.sal).toMatch(/^[0-9a-f]{32}$/);
    expect(v.hash).not.toBe(createHash('sha256').update(`compra-agil:${codigo}`).digest('hex'));
    const ok = await confirmarVinculo({ token: tg.token, codigo, rutaPreferencias: ruta, ahoraMs: T + 60_000, apiBase: tg.url });
    expect(ok).toEqual({ estado: 'conectado', chatNombre: 'Compras Oficina' });
    expect(leerPreferencias(ruta).telegramChatId).toBe('-100555');
    expect(tg.recibidos.at(-1)!.text).toMatch(/Listo/);
    // Sin COMPRA_AGIL_AVISOS ni chat en el entorno, Telegram queda activo con el chat confirmado.
    const config = configAvisosDelEquipo({ COMPRA_AGIL_TELEGRAM_TOKEN: tg.token }, ruta);
    expect(config.canales).toEqual(['telegram']);
    expect(config.telegram?.chatId).toBe('-100555');
  });

  it('un código equivocado no conecta; a los 5 intentos hay que pedir otro', async () => {
    tg.mensajeAlBot({ id: 999, type: 'private', first_name: 'Intruso' });
    const ruta = preferencias();
    await iniciarVinculo({ token: tg.token, rutaPreferencias: ruta, ahoraMs: T, apiBase: tg.url });
    const real = codigoEnviado();
    const otro = real === '123456' ? '654321' : '123456';
    for (let i = 0; i < 4; i++) expect((await confirmarVinculo({ codigo: otro, rutaPreferencias: ruta, ahoraMs: T })).estado).toBe('error');
    const quinto = await confirmarVinculo({ codigo: otro, rutaPreferencias: ruta, ahoraMs: T });
    expect(quinto).toMatchObject({ estado: 'error', detalle: expect.stringMatching(/Demasiados intentos/) });
    // Ni el código correcto sirve ya: se invalidó.
    expect((await confirmarVinculo({ codigo: real, rutaPreferencias: ruta, ahoraMs: T })).estado).toBe('error');
    expect(leerPreferencias(ruta).telegramChatId).toBeUndefined();
  });

  it('el código vence a los 10 minutos', async () => {
    tg.mensajeAlBot({ id: 777, type: 'private', first_name: 'Ana' });
    const ruta = preferencias();
    await iniciarVinculo({ token: tg.token, rutaPreferencias: ruta, ahoraMs: T, apiBase: tg.url });
    const r = await confirmarVinculo({ codigo: codigoEnviado(), rutaPreferencias: ruta, ahoraMs: T + 11 * 60_000 });
    expect(r).toMatchObject({ estado: 'error', detalle: expect.stringMatching(/venció/) });
  });
});
