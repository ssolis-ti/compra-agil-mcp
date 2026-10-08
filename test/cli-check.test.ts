import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/**
 * `--check` y `--probar-avisos` (T8.5 de la 2.9.0; R10.1, R10.2): una línea
 * por punto, código de salida 0/1, sin mostrar secretos ni enviar mensajes
 * (--check). La hora del SHOA bloqueada es advertencia, no fallo.
 */
vi.mock('../src/utils/ntp.js', async (original) => ({
  ...(await original<typeof import('../src/utils/ntp.js')>()),
  consultarHoraOficial: async () => ({ ok: false, servidor: 'ntp.shoa.cl', motivo: 'UDP 123 bloqueado' }),
}));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICKET = 'TICKET-DE-PRUEBA-NO-REAL-0000';
let api = '';

beforeAll(async () => {
  const puerto = await new Promise<number>((r) => { const s = net.createServer().listen(0, () => { const { port } = s.address() as net.AddressInfo; s.close(() => r(port)); }); });
  process.env.PORT = String(puerto);
  await import(pathToFileURL(path.join(RAIZ, 'scripts', 'qa', 'mock-api.mjs')).href + '?check');
  api = `http://127.0.0.1:${puerto}`;
});

const correr = async (fn: 'comandoCheck' | 'comandoProbarAvisos', env: Record<string, string>) => {
  const mod = await import('../src/cli/check.js');
  const lineas: string[] = [];
  const codigo = await mod[fn]({ COMPRA_AGIL_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'check-')), ...env }, (l) => lineas.push(l));
  return { codigo, salida: lineas.join('\n') };
};

describe('--check', () => {
  it('todo bien: código 0, el ticket solo como pista, el SHOA bloqueado como advertencia', async () => {
    const r = await correr('comandoCheck', { COMPRA_AGIL_TICKET: TICKET, COMPRA_AGIL_BASE_URL: api });
    expect(r.salida).toMatch(/✔ API de Mercado Público: responde/);
    expect(r.salida).toMatch(/⚠ Hora oficial del SHOA no disponible/);
    expect(r.salida).toMatch(/✔ Carpeta de datos escribible/);
    expect(r.salida).not.toContain(TICKET);
    expect(r.codigo).toBe(0);
  });

  it('sin ticket: código 1 y dice qué falta', async () => {
    const r = await correr('comandoCheck', {});
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/✘ Ticket: falta COMPRA_AGIL_TICKET/);
  });

  it('API caída o canal mal configurado: código 1', async () => {
    const caida = await correr('comandoCheck', { COMPRA_AGIL_TICKET: TICKET, COMPRA_AGIL_BASE_URL: 'http://127.0.0.1:9' });
    expect(caida.codigo).toBe(1);
    expect(caida.salida).toMatch(/✘ API de Mercado Público/);
    const canal = await correr('comandoCheck', { COMPRA_AGIL_TICKET: TICKET, COMPRA_AGIL_BASE_URL: api, COMPRA_AGIL_AVISOS: 'telegram' });
    expect(canal.codigo).toBe(1);
    expect(canal.salida).toMatch(/✘ Avisos: Telegram no se activa/);
  });
});

describe('--probar-avisos', () => {
  it('sin canales: código 1 y cómo configurarlos', async () => {
    const r = await correr('comandoProbarAvisos', {});
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/COMPRA_AGIL_AVISOS/);
  });
});
