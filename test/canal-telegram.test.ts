import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CanalTelegram, ultimoChat } from '../src/avisos/canales/telegram.js';
import { registrarSecreto, redact } from '../src/utils/redact.js';
import type { LoteDeAvisos } from '../src/avisos/canal.js';
import type { Alerta } from '../src/avisos/mensaje.js';
// @ts-expect-error: módulo JavaScript sin tipos
import { iniciarMockTelegram } from '../scripts/qa/mock-telegram.mjs';

/**
 * Canal de Telegram contra una Bot API simulada por HTTP (T4.2–T4.3 de la
 * 2.9.0; R5.1–R5.4). La espera entre mensajes se inyecta: el test no espera
 * segundos reales, pero comprueba que se pidió esperar.
 */
const AHORA = Date.parse('2026-10-07T22:00:00Z');
let t: { url: string; token: string; recibidos: Array<Record<string, unknown>>; programar(l: unknown[]): void; mensajeAlBot(c: unknown): void; cerrar(): Promise<void> };
const esperas: number[] = [];
const esperar = async (ms: number) => { esperas.push(ms); };

const alerta = (codigo: string, nombre = 'Compra de resmas'): Alerta => ({
  codigo, nombre, organismo: 'Organismo', region: 'Metropolitana', presupuestoClp: 300_000,
  cierreHoraChile: '2026-10-09 12:00', cierreUtc: '2026-10-09T15:00:00.000Z', coincidencia: 'resmas',
  ficha: `https://buscador.mercadopublico.cl/ficha?code=${codigo}`, creada: AHORA,
});
const lote = (alertas: Alerta[]): LoteDeAvisos => ({
  id: 'l1', canal: 'telegram', resumenDeSilencio: false,
  avisos: alertas.map((a, i) => ({ id: `a${i}`, canal: 'telegram', alerta: a, estado: 'pendiente', intentos: 0, proximoIntento: AHORA, creado: AHORA })),
});

beforeAll(async () => {
  t = await iniciarMockTelegram();
  registrarSecreto(t.token);
});
afterAll(async () => { await t.cerrar(); });
beforeEach(() => { t.recibidos.length = 0; esperas.length = 0; });

const canal = (token = t.token) => new CanalTelegram({ token, chatId: '-100123', apiBase: t.url, esperar });

describe('CanalTelegram', () => {
  it('envía con parse_mode HTML, sin vista previa, al chat configurado (R5.1)', async () => {
    expect(await canal().enviar(lote([alerta('A-1-COT26')]), AHORA)).toEqual({ ok: true });
    expect(t.recibidos).toHaveLength(1);
    expect(t.recibidos[0]).toMatchObject({ chat_id: '-100123', parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    expect(String(t.recibidos[0].text)).toContain('A-1-COT26');
  });

  it('varios mensajes al mismo chat van separados por 1 segundo (R5.3)', async () => {
    const muchos = Array.from({ length: 60 }, (_, i) => alerta(`${1000 + i}-1-COT26`, `Proceso ${'x'.repeat(120)}`));
    const c = canal();
    expect(await c.enviar(lote(muchos), AHORA)).toEqual({ ok: true });
    expect(t.recibidos.length).toBeGreaterThan(1);
    expect(esperas.length).toBe(t.recibidos.length - 1);
    for (const e of esperas) expect(e).toBeGreaterThan(900);
  });

  it('429 con retry_after: transitorio, reintentar en esos segundos (R5.2)', async () => {
    t.programar([{ status: 429, retry_after: 7, description: 'Too Many Requests: retry after 7' }]);
    expect(await canal().enviar(lote([alerta('A')]), AHORA)).toMatchObject({ ok: false, tipo: 'transitorio', reintentarEnMs: 7000 });
  });

  it('400 de entidades mal formadas y 403 de bot bloqueado: permanentes', async () => {
    t.programar([{ status: 400, description: "Bad Request: can't parse entities" }]);
    expect(await canal().enviar(lote([alerta('A')]), AHORA)).toMatchObject({ ok: false, tipo: 'permanente', motivo: expect.stringMatching(/parse entities/) });
    t.programar([{ status: 403, description: 'Forbidden: bot was blocked by the user' }]);
    expect(await canal().enviar(lote([alerta('A')]), AHORA)).toMatchObject({ ok: false, tipo: 'permanente' });
  });

  it('5xx y red caída: transitorios, y el motivo nunca trae el token (va en la URL)', async () => {
    t.programar([{ status: 502 }]);
    expect(await canal().enviar(lote([alerta('A')]), AHORA)).toMatchObject({ ok: false, tipo: 'transitorio' });
    const caido = new CanalTelegram({ token: t.token, chatId: '1', apiBase: 'http://127.0.0.1:9', esperar });
    const r = await caido.enviar(lote([alerta('A')]), AHORA);
    expect(r).toMatchObject({ ok: false, tipo: 'transitorio' });
    expect(JSON.stringify(r)).not.toContain(t.token);
  });

  it('token inválido (401): permanente, sin mostrar el token', async () => {
    const r = await canal('111:otro-token-de-prueba-no-real-xx').enviar(lote([alerta('A')]), AHORA);
    expect(r).toMatchObject({ ok: false, tipo: 'permanente' });
    expect(JSON.stringify(r)).not.toContain('otro-token');
  });

  it('probar envía un mensaje de prueba al chat configurado (R10.2)', async () => {
    expect(await canal().probar(AHORA)).toEqual({ ok: true });
    expect(String(t.recibidos[0].text)).toMatch(/prueba/i);
  });
});

describe('ultimoChat (para --telegram-chat-id, R5.4)', () => {
  it('devuelve el chat del último mensaje enviado al bot', async () => {
    t.mensajeAlBot({ id: 111, type: 'private', first_name: 'Ana' });
    t.mensajeAlBot({ id: -100999, type: 'group', title: 'Compras Oficina' });
    expect(await ultimoChat(t.token, { apiBase: t.url })).toEqual({ chat: { id: '-100999', tipo: 'group', nombre: 'Compras Oficina' } });
  });

  it('un token malo vuelve como error, sin lanzar y sin mostrar el token', async () => {
    const r = await ultimoChat('111:otro-token-de-prueba-no-real-xx', { apiBase: t.url });
    expect(r).toEqual({ error: expect.stringMatching(/401/) });
    expect(JSON.stringify(r)).not.toContain('otro-token');
    registrarSecreto('111:otro-token-de-prueba-no-real-xx');
    expect(redact('bot111:otro-token-de-prueba-no-real-xx')).not.toContain('otro-token');
  });
});

describe('notificar (fase 7)', () => {
  it('envía la notificación del sistema al chat', async () => {
    expect(await canal().notificar({ clave: 'resumen:x', evento: 'resumen', titulo: 'Resumen', lineas: ['50 procesos revisados'] }, AHORA)).toEqual({ ok: true });
    expect(String(t.recibidos.at(-1)!.text)).toMatch(/Resumen[\s\S]*50 procesos/);
  });
});
