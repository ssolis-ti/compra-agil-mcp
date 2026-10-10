import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CanalTelegram, ultimoChat, explicarErrorTelegram } from '../src/avisos/canales/telegram.js';
import { iniciarVinculo, confirmarVinculo } from '../src/avisos/vincular-telegram.js';
import { configAvisosDelEquipo, leerPreferencias, actualizarPreferencias } from '../src/avisos/preferencias.js';
// @ts-expect-error: módulo JavaScript sin tipos
import { iniciarMockTelegram } from '../scripts/qa/mock-telegram.mjs';

/**
 * Telegram en grupos, canales y temas (2.9.1). Un usuario conectó el bot a un
 * canal y no funcionó: solo se leían los `message`, y lo de un canal llega
 * como `channel_post`. En un grupo, con el modo privacidad (activo por
 * defecto), un «hola» no le llega al bot; sí le llega que lo agreguen.
 */
type Mock = {
  url: string; token: string; recibidos: Array<Record<string, unknown>>;
  programar(l: unknown[]): void; mensajeAlBot(c: unknown): void; actualizacion(u: unknown): void; cerrar(): Promise<void>;
};
let t: Mock | null = null;
const mock = async () => (t = (await iniciarMockTelegram()) as Mock);
afterEach(async () => { await t?.cerrar(); t = null; });

const CANAL = { id: -1001234, type: 'channel', title: 'Licitaciones Aysén' };
const GRUPO = { id: -4567, type: 'group', title: 'Compras Oficina' };
const SUPER = { id: -1009999, type: 'supergroup', title: 'Equipo ventas', is_forum: true };

describe('ultimoChat: qué ve el bot', () => {
  it('canal: una publicación (channel_post) basta', async () => {
    const m = await mock();
    m.actualizacion({ channel_post: { message_id: 1, chat: CANAL, text: 'prueba' } });
    expect(await ultimoChat(m.token, { apiBase: m.url })).toEqual({ chat: { id: '-1001234', tipo: 'channel', nombre: 'Licitaciones Aysén' } });
  });

  it('grupo con modo privacidad: que lo agreguen (my_chat_member) basta, sin «hola»', async () => {
    const m = await mock();
    m.actualizacion({ my_chat_member: { chat: GRUPO, new_chat_member: { status: 'member' } } });
    expect(await ultimoChat(m.token, { apiBase: m.url })).toEqual({ chat: { id: '-4567', tipo: 'group', nombre: 'Compras Oficina' } });
  });

  it('si después lo sacan del grupo, ese chat ya no sirve', async () => {
    const m = await mock();
    m.actualizacion({ my_chat_member: { chat: GRUPO, new_chat_member: { status: 'administrator' } } });
    m.actualizacion({ my_chat_member: { chat: GRUPO, new_chat_member: { status: 'kicked' } } });
    expect(await ultimoChat(m.token, { apiBase: m.url })).toEqual({ chat: null });
  });

  it('grupo que pasó a supergrupo: se usa el id nuevo', async () => {
    const m = await mock();
    m.actualizacion({ message: { message_id: 3, chat: GRUPO, migrate_to_chat_id: -1004567 } });
    expect(await ultimoChat(m.token, { apiBase: m.url })).toEqual({ chat: { id: '-1004567', tipo: 'supergroup', nombre: 'Compras Oficina' } });
  });

  it('supergrupo con temas: recuerda el tema desde donde se escribió', async () => {
    const m = await mock();
    m.actualizacion({ message: { message_id: 4, chat: SUPER, message_thread_id: 77, is_topic_message: true, text: '/start@bot' } });
    expect(await ultimoChat(m.token, { apiBase: m.url })).toEqual({ chat: { id: '-1009999', tipo: 'supergroup', nombre: 'Equipo ventas', hilo: '77' } });
  });

  it('gana lo más reciente, sea del tipo que sea', async () => {
    const m = await mock();
    m.mensajeAlBot({ id: 111, type: 'private', first_name: 'Ana' });
    m.actualizacion({ channel_post: { message_id: 1, chat: CANAL, text: 'x' } });
    expect((await ultimoChat(m.token, { apiBase: m.url }) as { chat: { id: string } }).chat.id).toBe('-1001234');
  });
});

describe('CanalTelegram en grupos y canales', () => {
  it('envía al tema (message_thread_id)', async () => {
    const m = await mock();
    const c = new CanalTelegram({ token: m.token, chatId: '-1009999', hilo: '77', apiBase: m.url, esperar: async () => {} });
    expect(await c.probar()).toEqual({ ok: true });
    expect(m.recibidos.at(-1)).toMatchObject({ chat_id: '-1009999', message_thread_id: 77 });
  });

  it('grupo migrado a supergrupo: reintenta en el id nuevo y avisa para guardarlo', async () => {
    const m = await mock();
    m.programar([{ status: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', migrate_to_chat_id: -1004567 }]);
    const migrados: string[] = [];
    const c = new CanalTelegram({ token: m.token, chatId: '-4567', apiBase: m.url, esperar: async () => {}, alMigrar: (n) => migrados.push(n) });
    expect(await c.probar()).toEqual({ ok: true });
    expect(m.recibidos.at(-1)?.chat_id).toBe('-1004567');
    expect(migrados).toEqual(['-1004567']);
  });

  it('canal sin permiso para publicar: el error dice qué hacer', async () => {
    const m = await mock();
    m.programar([{ status: 400, description: 'Bad Request: need administrator rights in the channel chat' }]);
    const r = await new CanalTelegram({ token: m.token, chatId: '-1001234', apiBase: m.url, esperar: async () => {} }).probar();
    expect(r).toMatchObject({ ok: false, tipo: 'permanente' });
    expect(!r.ok && r.motivo).toMatch(/administrador con permiso para «Publicar mensajes»/);
  });

  it('explicarErrorTelegram: casos comunes en palabras simples', () => {
    expect(explicarErrorTelegram(403, 'Forbidden: bot was kicked from the group chat')).toMatch(/vuelve a agregarlo/);
    expect(explicarErrorTelegram(400, 'Bad Request: chat not found')).toMatch(/agrega el bot/);
    expect(explicarErrorTelegram(409, 'Conflict: can\'t use getUpdates method while webhook is active')).toMatch(/webhook/);
    expect(explicarErrorTelegram(401, 'Unauthorized')).toMatch(/token/);
  });
});

describe('conectar un canal con código, y la migración guardada', () => {
  it('el código llega al canal; confirmado, el canal queda como destino', async () => {
    const m = await mock();
    m.actualizacion({ channel_post: { message_id: 1, chat: CANAL, text: 'hola' } });
    const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-canal-')), '.preferencias.json');
    const T = Date.parse('2026-10-10T12:00:00Z');
    expect(await iniciarVinculo({ token: m.token, rutaPreferencias: ruta, ahoraMs: T, apiBase: m.url })).toEqual({ estado: 'codigo_enviado', chatNombre: 'Licitaciones Aysén' });
    const codigo = String(m.recibidos.at(-1)?.text).match(/(\d{6})/)![1];
    expect(m.recibidos.at(-1)?.chat_id).toBe('-1001234');
    expect((await confirmarVinculo({ token: m.token, codigo, rutaPreferencias: ruta, ahoraMs: T + 1000, apiBase: m.url })).estado).toBe('conectado');
    expect(configAvisosDelEquipo({ COMPRA_AGIL_TELEGRAM_TOKEN: m.token }, ruta).telegram?.chatId).toBe('-1001234');
  });

  it('sin chat visible, explica qué hacer en cada caso', async () => {
    const m = await mock();
    const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-nada-')), '.preferencias.json');
    const r = await iniciarVinculo({ token: m.token, rutaPreferencias: ruta, ahoraMs: 0, apiBase: m.url });
    expect(r.estado).toBe('sin_mensajes');
    expect('detalle' in r && r.detalle).toMatch(/Chat personal.*Grupo.*\/start@.*Canal.*administrador/);
  });

  it('el id nuevo de un grupo migrado queda guardado en las preferencias', () => {
    const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-migra-')), '.preferencias.json');
    actualizarPreferencias(ruta, (p) => { p.telegramChatId = '-4567'; p.telegramHilo = '77'; });
    const c = configAvisosDelEquipo({ COMPRA_AGIL_TELEGRAM_TOKEN: '123456789:AAprueba-no-real-TOKEN-telegram' }, ruta);
    expect(c.telegram?.hilo).toBe('77');
    c.telegram?.alMigrar?.('-1004567');
    expect(leerPreferencias(ruta).telegramChatId).toBe('-1004567');
  });
});
