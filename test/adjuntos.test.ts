import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { elegirAdjunto } from '../src/api/adjuntos.js';

/**
 * Adjuntos de Compra Ágil (2.9.2, BUG-002): sí se descargan. Se lista el
 * proceso para obtener el UUID del archivo y se descarga ese UUID. Antes la
 * herramienta afirmaba que era imposible, a partir de un 404 medido sobre otro
 * endpoint (el de licitaciones).
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PDF = fs.readFileSync(path.join(RAIZ, 'docs', 'guias', 'multas-sanciones-procedimientos.pdf'));
const UUID = '903DE5F5-648F-4ED9-96F6-66B9F11075D6';
const listado = (files: Array<{ id: string; nombreArchivo: string }>) =>
  new Response(JSON.stringify({ success: 'OK', trace: null, payload: { files }, errores: null }), { status: 200, headers: { 'content-type': 'application/json' } });
const pdf = () => new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) } });

/** fetch simulado por URL: «listar» y «descargar» del portal de adjuntos. */
function portal(rutas: { listar?: () => Response | Promise<Response>; descargar?: Array<() => Response | Promise<Response>> }) {
  const descargas = [...(rutas.descargar ?? [])];
  const pedidas: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    pedidas.push(u);
    if (u.includes('/listar/')) return rutas.listar ? rutas.listar() : new Response('no', { status: 500 });
    if (u.includes('/descargar/')) return (descargas.shift() ?? (() => new Response('no', { status: 500 })))();
    throw new Error(`URL inesperada: ${u}`);
  });
  return { spy, pedidas };
}

let cliente: Client;
const llamar = async (name: string, args: Record<string, unknown>) => {
  const r = await cliente.callTool({ name, arguments: args }) as { content: Array<{ text: string }>; isError?: boolean };
  return { r, t: r.content[0]?.text ?? '' };
};

beforeAll(async () => {
  const { CompraAgilClient } = await import('../src/api/compra-agil-client.js');
  const { crearServidor } = await import('../src/servidor.js');
  const { server } = crearServidor(new CompraAgilClient('TICKET-DE-PRUEBA-NO-REAL-0000', undefined, { persistir: false }), '0.0.0-test');
  const [a, b] = InMemoryTransport.createLinkedPair();
  cliente = new Client({ name: 'prueba', version: '1' });
  await Promise.all([server.connect(a), cliente.connect(b)]);
});
afterAll(async () => { await cliente.close(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('descargar_y_leer_documento', () => {
  it('con solo el código: lista, toma el UUID real y lee el PDF', async () => {
    const { pedidas } = portal({ listar: () => listado([{ id: UUID, nombreArchivo: 'TDR Puntos de Red.pdf' }]), descargar: [pdf] });
    const { r, t } = await llamar('descargar_y_leer_documento', { codigo_compra: '4626-32-COT26', max_caracteres: 600 });
    expect(r.isError, t).toBeFalsy();
    expect(t).toMatch(/Texto de «TDR Puntos de Red\.pdf»/);
    expect(t.toLowerCase()).toMatch(/multa/);
    expect(pedidas[0]).toMatch(/\/v1\/adjuntos-compra-agil\/listar\/4626-32-COT26$/);
    expect(pedidas[1]).toMatch(new RegExp(`/v1/adjuntos-compra-agil/descargar/${UUID}$`));
  }, 60_000);

  it('varios adjuntos: elige por nombre, y nombra los demás', async () => {
    const tres = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', nombreArchivo: 'Bases administrativas.pdf' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', nombreArchivo: 'Términos de referencia.pdf' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000003', nombreArchivo: 'Anexo económico.pdf' },
    ];
    const { pedidas } = portal({ listar: () => listado(tres), descargar: [pdf] });
    const { t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26', nombre_adjunto: 'terminos', max_caracteres: 500 });
    expect(pedidas[1]).toMatch(/000000000002$/);
    expect(t).toMatch(/Otros adjuntos del proceso: Bases administrativas\.pdf, Anexo económico\.pdf/);
  }, 60_000);

  it('elegirAdjunto: sin nombre el primero; con un nombre que no está, ninguno', () => {
    const a = [{ id: '1', nombre: 'Bases.pdf' }, { id: '2', nombre: 'TDR.pdf' }];
    expect(elegirAdjunto(a)?.id).toBe('1');
    expect(elegirAdjunto(a, 'tdr')?.id).toBe('2');
    expect(elegirAdjunto(a, 'anexo')).toBeUndefined();
  });

  it('con el UUID ya conocido no lista: descarga directo', async () => {
    const { pedidas } = portal({ descargar: [pdf] });
    const { r } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26', id_documento: UUID, query: 'multa' });
    expect(r.isError).toBeFalsy();
    expect(pedidas).toHaveLength(1);
  }, 60_000);

  it('regresión: un id numérico ya no responde «no se puede descargar por programa»', async () => {
    portal({ listar: () => listado([{ id: UUID, nombreArchivo: 'TDR.pdf' }]), descargar: [pdf] });
    const { t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26', id_documento: '1976601', max_caracteres: 500 });
    expect(t).not.toMatch(/no se puede descargar por programa|responde 404|Clave Única/);
    expect(t).toMatch(/Texto de «TDR\.pdf»/);
  }, 60_000);

  it('sin adjuntos: lo dice, sin tratarlo como error', async () => {
    portal({ listar: () => listado([]) });
    const { r, t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26' });
    expect(r.isError).toBeFalsy();
    expect(t).toMatch(/no tiene adjuntos/);
  });

  it('403 del portal: dice qué falló de verdad, y da la ficha', async () => {
    portal({ listar: () => new Response('<title>403</title>', { status: 403 }) });
    const { r, t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26' });
    expect(r.isError).toBe(true);
    expect(t).toMatch(/rechazó la descarga \(HTTP 403\)/);
    expect(t).toMatch(/ficha\?code=1-1-COT26/);
    expect(t).not.toMatch(/Clave Única|imposible/);
  });

  it('proceso que el portal no conoce (400): lo dice', async () => {
    portal({ listar: () => new Response('{"success":"NOK"}', { status: 400 }) });
    expect((await llamar('descargar_y_leer_documento', { codigo_compra: '9999-1-COT26' })).t).toMatch(/no encontró ese proceso/);
  });

  it('respuesta vacía (descargas simultáneas): reintenta y lee', async () => {
    portal({ listar: () => listado([{ id: UUID, nombreArchivo: 'TDR.pdf' }]), descargar: [() => new Response('', { status: 200 }), pdf] });
    const { r, t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26', max_caracteres: 500 });
    expect(r.isError, t).toBeFalsy();
    expect(t).toMatch(/Texto de «TDR\.pdf»/);
  }, 60_000);

  it('el portal no responde a tiempo: lo dice y da la ficha', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    const { r, t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26' });
    expect(r.isError).toBe(true);
    expect(t).toMatch(/no respondió en 30 s/);
    expect(t).toMatch(/ficha\?code=1-1-COT26/);
  });

  it('un adjunto demasiado grande no se procesa', async () => {
    portal({ descargar: [() => new Response('x', { status: 200, headers: { 'content-length': String(500 * 1024 * 1024) } })] });
    const { r, t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26', id_documento: UUID });
    expect(r.isError).toBe(true);
    expect(t).toMatch(/MB/);
  });

  it('un archivo que no es PDF se nombra, sin intentar leerlo', async () => {
    portal({ descargar: [() => new Response('PK\u0003\u0004 un zip', { status: 200, headers: { 'content-type': 'application/zip' } })] });
    const { t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26', id_documento: UUID });
    expect(t).toMatch(/no es un PDF \(application\/zip\)/);
  });

  it('COMPRA_AGIL_ADJUNTOS=off: no sale al portal y da la ficha', async () => {
    vi.stubEnv('COMPRA_AGIL_ADJUNTOS', 'off');
    const { spy } = portal({});
    const { t } = await llamar('descargar_y_leer_documento', { codigo_compra: '1-1-COT26' });
    expect(spy).not.toHaveBeenCalled();
    expect(t).toMatch(/desactivada/);
    expect(t).toMatch(/ficha\?code=1-1-COT26/);
  });
});

describe('obtener_enlace_documento', () => {
  it('da la ficha y la lista de adjuntos con su id', async () => {
    portal({ listar: () => listado([{ id: UUID, nombreArchivo: 'TDR Puntos de Red.pdf' }]) });
    const { r, t } = await llamar('obtener_enlace_documento', { codigo_compra: '4626-32-COT26' });
    expect(r.isError).toBeFalsy();
    expect(t).toMatch(/ficha\?code=4626-32-COT26/);
    expect(t).toContain(`TDR Puntos de Red.pdf (id: ${UUID})`);
    expect(t).not.toMatch(/404|No la abras/);
  });

  it('si no puede listar, igual da la ficha', async () => {
    portal({ listar: () => new Response('x', { status: 503 }) });
    const { r, t } = await llamar('obtener_enlace_documento', { codigo_compra: '1-1-COT26' });
    expect(r.isError).toBeFalsy();
    expect(t).toMatch(/ficha\?code=1-1-COT26/);
    expect(t).toMatch(/No se pudo listar/);
  });
});
