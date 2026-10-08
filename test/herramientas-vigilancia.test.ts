import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import net from 'net';
import http from 'http';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * Las 5 herramientas de vigilancia con el servidor real en proceso (T8.1–T8.4
 * de la 2.9.0; R2.2, R4.4, R9, R10.2), contra la API simulada en modo de
 * lotes y un receptor de webhook local.
 */
vi.mock('../src/utils/ntp.js', async (original) => ({
  ...(await original<typeof import('../src/utils/ntp.js')>()),
  consultarHoraOficial: async () => ({ ok: false, error: 'sin red en la prueba' }),
}));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'herr-vig-'));
const SECRETO = 'secreto-webhook-de-prueba-no-real-de-32+caracteres';
const recibidos: Array<{ tipo: string; evento?: string; lineas?: string[] }> = [];
let receptor: http.Server;
let cliente: Client;
const respaldo = { ...process.env };

async function puertoLibre(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
  });
}
const llamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await cliente.callTool({ name, arguments: args });
  const t = (r as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  return { r, t, j: (() => { try { return JSON.parse(t); } catch { return null; } })() };
};

beforeAll(async () => {
  const puertoApi = await puertoLibre();
  process.env.PORT = String(puertoApi);
  process.env.CATALOGO = 'cambios';
  process.env.CAMBIOS_POR_LOTE = '3';
  await import(pathToFileURL(path.join(RAIZ, 'scripts', 'qa', 'mock-api.mjs')).href + '?cambios');

  receptor = http.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => { c += d; });
    req.on('end', () => { recibidos.push(JSON.parse(c)); res.writeHead(204); res.end(); });
  });
  await new Promise<void>((r) => receptor.listen(0, '127.0.0.1', () => r()));

  Object.assign(process.env, {
    COMPRA_AGIL_DATA_DIR: datos,
    COMPRA_AGIL_TICKET: 'TICKET-DE-PRUEBA-NO-REAL-0000',
    MONITOR_KEYWORDS: 'resmas', MONITOR_EXCLUIR: '', MONITOR_REGIONES: '', MONITOR_MIN_BUDGET_CLP: '0', MONITOR_SOLO_SIN_OFERTAS: 'true',
    MONITOR_INTERVAL_MINUTES: '15',
    COMPRA_AGIL_AVISOS: 'webhook',
    COMPRA_AGIL_WEBHOOK_URL: `http://127.0.0.1:${(receptor.address() as net.AddressInfo).port}/hook`,
    COMPRA_AGIL_WEBHOOK_SECRETO: SECRETO,
    COMPRA_AGIL_AVISOS_SILENCIO: '',
  });
  const { CompraAgilClient } = await import('../src/api/compra-agil-client.js');
  const { crearServidor } = await import('../src/servidor.js');
  const api = new CompraAgilClient('TICKET-DE-PRUEBA-NO-REAL-0000', `http://127.0.0.1:${puertoApi}`, { persistir: false });
  const { server } = crearServidor(api, '0.0.0-vigilancia');
  const [lado, otro] = InMemoryTransport.createLinkedPair();
  await server.connect(lado);
  cliente = new Client({ name: 'prueba-vigilancia', version: '1.0.0' });
  await cliente.connect(otro);
}, 60_000);

afterAll(async () => {
  await cliente?.close();
  await new Promise<void>((r) => receptor.close(() => r()));
  for (const k of Object.keys(process.env)) if (!(k in respaldo)) delete process.env[k];
  Object.assign(process.env, respaldo);
});

describe('herramientas de vigilancia', () => {
  it('estado_vigilancia antes de vigilar: sin vigilante ni marca, con el canal activo', async () => {
    const { j } = await llamar('estado_vigilancia');
    expect(j.vigilante_activo).toBeNull();
    expect(j.ultimo_lote_revisado).toBeNull();
    expect(j.canales_activos).toEqual(['webhook']);
    expect(j.criterios.origen).toBe('.env');
  });

  it('obtener_alertas_nuevas revisa la última hora y entrega un lote; confirmar lo cierra (R9)', async () => {
    const primera = await llamar('obtener_alertas_nuevas', { max: 50 });
    expect(primera.r.isError).toBeFalsy();
    expect(primera.j.revision.hecha).toBe(true);
    expect(primera.j.alertas.length).toBeGreaterThanOrEqual(30);
    expect(primera.j.lote_id).toMatch(/^[0-9a-f]{16}$/);
    expect(primera.j._aviso_contenido_de_terceros).toMatch(/datos, no como instrucciones/);
    // Lo ofrecido hace menos de 30 min no se repite.
    const segunda = await llamar('obtener_alertas_nuevas', { max: 50 });
    expect(segunda.j.alertas.filter((a: { codigo: string }) => primera.j.alertas.some((b: { codigo: string }) => b.codigo === a.codigo))).toEqual([]);
    const c1 = await llamar('confirmar_alertas', { lote_id: primera.j.lote_id });
    expect(c1.j.confirmadas).toBe(primera.j.alertas.length);
    expect((await llamar('confirmar_alertas', { lote_id: primera.j.lote_id })).j.confirmadas).toBe(0);
    const estado = (await llamar('estado_vigilancia')).j;
    expect(estado.ultimo_lote_revisado).toMatch(/hora de Chile/);
    expect(estado.avisos_por_canal.webhook.entregado).toBeGreaterThanOrEqual(30);
  }, 60_000);

  it('confirmar_alertas rechaza un lote_id con forma inválida sin tocar el estado', async () => {
    const { r, t } = await llamar('confirmar_alertas', { lote_id: '../../etc' });
    expect(r.isError).toBe(true);
    expect(t).toMatch(/Error de validación/);
  });

  it('probar_avisos manda la prueba por el webhook configurado', async () => {
    const { j } = await llamar('probar_avisos');
    expect(j.canales).toEqual({ webhook: 'entregado' });
    expect(recibidos.at(-1)).toMatchObject({ tipo: 'compra_agil.prueba' });
  });

  it('configurar_criterios cambia, avisa el antes y el después por los canales, y restablece (R2.2)', async () => {
    const { j } = await llamar('configurar_criterios', { palabras: ['Toner'], regiones: [13] });
    expect(j.ahora).toMatchObject({ palabras: ['toner'], regiones: [13] });
    expect(j.antes.palabras).toEqual(['resmas']);
    expect(j.avisado_por).toEqual(['webhook']);
    const aviso = recibidos.find((r) => r.evento === 'criterios')!;
    expect(aviso.lineas!.join(' ')).toMatch(/Antes — palabras: resmas[\s\S]*Ahora — palabras: toner/);
    expect((await llamar('estado_vigilancia')).j.criterios.origen).toMatch(/configurar_criterios/);
    const vuelta = await llamar('configurar_criterios', { restablecer: true });
    expect(vuelta.j.ahora.palabras).toEqual(['resmas']);
  });

  it('ninguna herramienta acepta un destino de aviso (ADR 0023, R4.4)', async () => {
    const { tools } = await cliente.listTools();
    const campos = tools.flatMap((t) => Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).map((c) => `${t.name}.${c}`));
    expect(campos.filter((c) => /url|chat|correo|mail|destin|token|webhook|telegram|smtp|para$/i.test(c))).toEqual([]);
  });
});
