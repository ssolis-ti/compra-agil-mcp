import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
// @ts-expect-error: módulo JavaScript sin tipos
import { iniciarMockTelegram } from '../scripts/qa/mock-telegram.mjs';

/**
 * Herramientas para configurar todo conversando (anexo de instalación por
 * agente: RA3, RA5): conectar_telegram con código y activar_vigilancia, con
 * el servidor real en proceso, una Bot API simulada y un control falso.
 */
vi.mock('../src/utils/ntp.js', async (original) => ({
  ...(await original<typeof import('../src/utils/ntp.js')>()),
  consultarHoraOficial: async () => ({ ok: false, servidor: 'ntp.shoa.cl', motivo: 'sin red en la prueba' }),
}));

const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'herr-inst-'));
const respaldo = { ...process.env };
let tg: { url: string; token: string; recibidos: Array<{ chat_id: string; text: string }>; mensajeAlBot(c: unknown): void; cerrar(): Promise<void> };
let cliente: Client;
const activaciones: string[] = [];
let modo: 'con_claude' | 'siempre' | 'apagada' = 'apagada';

const llamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await cliente.callTool({ name, arguments: args });
  const t = (r as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  return { r, t, j: (() => { try { return JSON.parse(t); } catch { return null; } })() };
};

beforeAll(async () => {
  tg = await iniciarMockTelegram();
  Object.assign(process.env, {
    COMPRA_AGIL_DATA_DIR: datos,
    COMPRA_AGIL_TICKET: 'TICKET-DE-PRUEBA-NO-REAL-0000',
    COMPRA_AGIL_TELEGRAM_TOKEN: tg.token,
    COMPRA_AGIL_TELEGRAM_API: tg.url,
    COMPRA_AGIL_AVISOS: '',
    COMPRA_AGIL_TELEGRAM_CHAT_ID: '',
  });
  const { CompraAgilClient } = await import('../src/api/compra-agil-client.js');
  const { crearServidor } = await import('../src/servidor.js');
  const control = {
    modo: () => modo,
    enEsteProceso: () => modo === 'con_claude',
    activar: async (m: typeof modo) => { activaciones.push(m); modo = m; return { ok: true, detalle: `modo ${m}` }; },
  };
  const { server } = crearServidor(new CompraAgilClient('TICKET-DE-PRUEBA-NO-REAL-0000', 'http://127.0.0.1:9', { persistir: false }), '0.0.0-inst', { vigilancia: control });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  cliente = new Client({ name: 'prueba-instalacion', version: '1.0.0' });
  await cliente.connect(b);
});

afterAll(async () => {
  await cliente?.close();
  await tg.cerrar();
  for (const k of Object.keys(process.env)) if (!(k in respaldo)) delete process.env[k];
  Object.assign(process.env, respaldo);
});

describe('conectar_telegram', () => {
  it('sin mensajes al bot, dice qué hacer', async () => {
    const { j } = await llamar('conectar_telegram');
    expect(j.estado).toBe('sin_mensajes');
    expect(j._siguiente_paso).toMatch(/hola/);
  });

  it('envía el código, rechaza uno inventado y conecta con el que llegó a Telegram', async () => {
    tg.mensajeAlBot({ id: -100321, type: 'group', title: 'Ventas' });
    const paso1 = await llamar('conectar_telegram');
    expect(paso1.j).toMatchObject({ estado: 'codigo_enviado', chatNombre: 'Ventas' });
    const codigo = tg.recibidos.at(-1)!.text.match(/(\d{6})/)![1];
    expect(paso1.t).not.toContain(codigo); // el agente no lo ve
    const malo = await llamar('conectar_telegram', { codigo: codigo === '111111' ? '222222' : '111111' });
    expect(malo.j.estado).toBe('error');
    const formato = await llamar('conectar_telegram', { codigo: '12ab' });
    expect(formato.r.isError).toBe(true);
    const ok = await llamar('conectar_telegram', { codigo });
    expect(ok.j).toMatchObject({ estado: 'conectado', chatNombre: 'Ventas' });
    const estado = (await llamar('estado_vigilancia')).j;
    expect(estado.telegram_conectado_a).toBe('Ventas');
    expect(estado.canales_activos).toEqual(['telegram']);
    expect(JSON.stringify(estado)).not.toContain(tg.token);
  });
});

describe('activar_vigilancia', () => {
  it('con_claude se activa directo y queda visible en estado_vigilancia', async () => {
    const { j } = await llamar('activar_vigilancia', { modo: 'con_claude' });
    expect(j).toMatchObject({ ok: true, modo_actual: 'con_claude', vigilando_en_este_proceso: true });
    expect((await llamar('estado_vigilancia')).j.modo_vigilancia).toBe('con_claude');
  });

  it('siempre exige confirmación explícita: sin confirmo no toca el sistema', async () => {
    const antes = activaciones.length;
    const { j } = await llamar('activar_vigilancia', { modo: 'siempre' });
    expect(j).toMatchObject({ ok: false, requiere_confirmacion: true });
    expect(activaciones.length).toBe(antes);
    expect((await llamar('activar_vigilancia', { modo: 'siempre', confirmo: true })).j.ok).toBe(true);
    expect(activaciones.at(-1)).toBe('siempre');
  });

  it('apagar la detiene', async () => {
    expect((await llamar('activar_vigilancia', { modo: 'apagar' })).j.modo_actual).toBe('apagada');
  });
});
