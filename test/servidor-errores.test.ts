import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CompraAgilDetalle } from '../src/api/compra-agil-client.js';

/**
 * Los caminos de error y los poco frecuentes, con el servidor real en proceso
 * (fase 1.6 del plan 2.8.0). La API apunta a un puerto cerrado: toda consulta
 * falla por red, sin salir a internet. La descarga de adjuntos y la OC se
 * simulan en el borde (fetch y el cliente), donde no hay otra forma de
 * provocarlas: la API real nunca expone una OC.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICKET = 'TICKET-DE-PRUEBA-NO-REAL-0000';
let cliente: Client;
let api: import('../src/api/compra-agil-client.js').CompraAgilClient;

const llamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await cliente.callTool({ name, arguments: args });
  return { r, t: ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '') };
};

beforeAll(async () => {
  process.env.COMPRA_AGIL_TICKET = TICKET;
  // Corta rápido la consulta a un puerto cerrado.
  process.env.COMPRA_AGIL_TIMEOUT_MS = '2000';
  const { CompraAgilClient } = await import('../src/api/compra-agil-client.js');
  const { crearServidor } = await import('../src/servidor.js');
  api = new CompraAgilClient(TICKET, 'http://127.0.0.1:9', { persistir: false });
  const { server } = crearServidor(api, '0.0.0-test');
  const [lado, otro] = InMemoryTransport.createLinkedPair();
  await server.connect(lado);
  cliente = new Client({ name: 'prueba-errores', version: '1.0.0' });
  await cliente.connect(otro);
}, 60_000);

afterAll(async () => {
  await cliente?.close();
  vi.restoreAllMocks();
  delete process.env.COMPRA_AGIL_TICKET;
  delete process.env.COMPRA_AGIL_TIMEOUT_MS;
});

describe('cuando la API no responde', () => {
  it('verificar_ticket lo informa como error de conexión, sin mostrar el ticket', async () => {
    const { r, t } = await llamar('verificar_ticket');
    expect(r.isError).toBe(true);
    expect(t).not.toContain(TICKET);
  }, 30_000);

  it('monitorear_cambios_recientes devuelve el error, no «sin resultados»', async () => {
    const { r, t } = await llamar('monitorear_cambios_recientes', { minutos: 30 });
    expect(r.isError).toBe(true);
    expect(t).not.toMatch(/sin resultados/);
  }, 30_000);

  it('obtener_detalle_compra explica el fallo', async () => {
    const { r, t } = await llamar('obtener_detalle_compra', { codigo: '1-1-COT26' });
    expect(r.isError).toBe(true);
    expect(t.length).toBeGreaterThan(20);
  }, 30_000);

  it('obtener_detalle_orden_compra informa el fallo de la API legada', async () => {
    const spy = vi.spyOn(api, 'obtenerDetalleOC').mockRejectedValueOnce(new Error('sin red'));
    const { r } = await llamar('obtener_detalle_orden_compra', { codigo_oc: '1057539-1234-SE26' });
    expect(r.isError).toBe(true);
    spy.mockRestore();
  });

  it('obtener_detalle_orden_compra sin resultados lo dice', async () => {
    const spy = vi.spyOn(api, 'obtenerDetalleOC').mockResolvedValueOnce({ Cantidad: 0, Listado: [] });
    const { t } = await llamar('obtener_detalle_orden_compra', { codigo_oc: '1057539-1234-SE26' });
    expect(t).toMatch(/No se encontr|no se encontr|sin resultados|No hay/i);
    spy.mockRestore();
  });
});

describe('verificar_orden_compra con una OC en el detalle (camino que la API real no expone)', () => {
  it('consulta la OC y la informa', async () => {
    const detalle = {
      codigo: '1-1-COT26', nombre: 'Proceso con OC', id_orden_compra: 999,
      estado: { codigo: 'cerrada', glosa: 'Cerrada' }, convocatoria: { descripcion: 'Primer llamado' },
      orden_compra: { id_orden_compra: 999, id_oc: 1, codigo_orden_compra: null, estado_orden_compra: null },
      proveedores_cotizando: [], productos_solicitados: [], documentos: [], fechas: {}, institucion: {},
      resumen: {}, motivos: {}, entrega: {}, presupuesto: { moneda: 'CLP' }, flags: {},
    } as unknown as CompraAgilDetalle;
    const cache = vi.spyOn(api, 'detalleEnCache').mockReturnValue(detalle);
    const oc = vi.spyOn(api, 'obtenerDetalleOC').mockResolvedValue({
      Cantidad: 1,
      Listado: [{ Codigo: '1057539-1234-SE26', Nombre: 'OC', CodigoEstado: 6, Estado: 'Aceptada', Total: 119_000, FechaCreacion: '2026-10-01', FechaAceptacion: null } as never],
    });
    const { r, t } = await llamar('verificar_orden_compra', { codigo: '1-1-COT26' });
    expect(r.isError).toBeFalsy();
    const j = JSON.parse(t);
    expect(j.verificacion_oc.tiene_orden_compra).toBe(true);
    expect(j.verificacion_oc.codigo_orden_compra).toBe('1057539-1234-SE26');
    cache.mockRestore();
    oc.mockRestore();
  });
});

describe('descargar_y_leer_documento con un id UUID', () => {
  const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('un 404 del portal orienta a la ficha, sin tratarlo como fallo inesperado', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('no', { status: 404 }));
    const { t } = await llamar('descargar_y_leer_documento', { id_documento: UUID, codigo_compra: '1-1-COT26' });
    expect(t).toMatch(/HTTP 404/);
    expect(t).toMatch(/ficha\?code=1-1-COT26/);
    fetchSpy.mockRestore();
  });

  it('un 403 se explica como bloqueo, con el camino alternativo', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('no', { status: 403 }));
    const { t } = await llamar('descargar_y_leer_documento', { id_documento: UUID });
    expect(t).toMatch(/HTTP 403/);
    expect(t).toMatch(/buscador\.mercadopublico\.cl/);
    fetchSpy.mockRestore();
  });

  it('un PDF real se descarga y se lee', async () => {
    const pdf = fs.readFileSync(path.join(RAIZ, 'docs', 'guias', 'multas-sanciones-procedimientos.pdf'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) } }),
    );
    const { r, t } = await llamar('descargar_y_leer_documento', { id_documento: UUID, max_caracteres: 600 });
    expect(r.isError, t).toBeFalsy();
    expect(t.toLowerCase()).toMatch(/multa/);
    fetchSpy.mockRestore();
  }, 60_000);

  it('busca dentro del adjunto descargado, y dice cuando no hay coincidencias', async () => {
    const pdf = fs.readFileSync(path.join(RAIZ, 'docs', 'guias', 'multas-sanciones-procedimientos.pdf'));
    const respuesta = () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(respuesta()).mockResolvedValueOnce(respuesta());
    expect((await llamar('descargar_y_leer_documento', { id_documento: UUID, query: 'multa' })).t.toLowerCase()).toMatch(/multa/);
    const sin = await llamar('descargar_y_leer_documento', { id_documento: UUID, query: 'zzzpalabrainexistente' });
    expect(sin.t).toMatch(/zzzpalabrainexistente/);
    fetchSpy.mockRestore();
  }, 60_000);

  it('un PDF corrupto se informa como error de lectura', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('esto no es un pdf', { status: 200 }));
    const { r } = await llamar('descargar_y_leer_documento', { id_documento: UUID });
    expect(r.isError).toBe(true);
    fetchSpy.mockRestore();
  }, 30_000);

  it('si el portal no responde a tiempo, cancela y orienta a la ficha', async () => {
    const corte = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(corte);
    const { r, t } = await llamar('descargar_y_leer_documento', { id_documento: UUID, codigo_compra: '1-1-COT26' });
    expect(r.isError).toBe(true);
    expect(t).toMatch(/se canceló/);
    expect(t).toMatch(/ficha\?code=1-1-COT26/);
    fetchSpy.mockRestore();
  });

  it('obtener_enlace_documento con un UUID entrega el enlace de adjuntos', async () => {
    const { r, t } = await llamar('obtener_enlace_documento', { id_documento: UUID, codigo_compra: '1-1-COT26' });
    expect(r.isError).toBeFalsy();
    expect(t).toContain(UUID);
  });

  it('una consulta sin coincidencias en los documentos locales dice qué términos buscó', async () => {
    const { t } = await llamar('consultar_documentos_locales', { query: 'zzzpalabrainexistente qqqotra' });
    expect(t).toMatch(/No se encontraron coincidencias/);
    expect(t).toMatch(/zzzpalabrainexistente/);
  }, 60_000);

  it('un adjunto demasiado grande no se procesa', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('x', { status: 200, headers: { 'content-length': String(500 * 1024 * 1024) } }),
    );
    const { r, t } = await llamar('descargar_y_leer_documento', { id_documento: UUID });
    expect(r.isError).toBe(true);
    expect(t).toMatch(/MB/);
    fetchSpy.mockRestore();
  });
});
