import { describe, it, expect, vi, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizarDetalle, normalizarListado, RespuestaInvalidaError } from '../src/api/normalizar.js';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { registerBuscarCompras } from '../src/tools/buscar-compras.js';
import { registerDetalleCompra } from '../src/tools/detalle-compra.js';
import { registerRadarOportunidades } from '../src/tools/radar-oportunidades.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

/** Servidor MCP mínimo: solo guarda el handler de cada herramienta registrada. */
function servidorFalso() {
  const handlers: Record<string, Handler> = {};
  const server = { registerTool: (nombre: string, _cfg: unknown, h: Handler) => { handlers[nombre] = h; } };
  return { server: server as unknown as McpServer, handlers };
}

const paginacion = { total_paginas: 1, numero_pagina: 1, tamano_pagina: 10, total_resultados: 1 };

describe('normalizarListado', () => {
  it('un sub-objeto nulo pasa a {} en vez de romper a quien lo lee', () => {
    const r = normalizarListado({
      items: [{ codigo: 'A', nombre: 'X', montos: null, institucion: null, fechas: null, estado: null, resumen: null }],
      paginacion,
    });
    const item = r.items[0];
    expect(item.montos).toEqual({});
    expect(item.institucion).toEqual({});
    expect(item.fechas).toEqual({});
    expect(item.estado).toEqual({ codigo: '', glosa: '' });
    expect(item.documentos).toEqual([]);
  });

  it('no inventa montos: un presupuesto ausente queda ausente, no en 0', () => {
    const r = normalizarListado({ items: [{ codigo: 'A', montos: null }], paginacion });
    expect(r.items[0].montos.monto_disponible_clp).toBeUndefined();
  });

  it('los textos que el código manipula con métodos de string nunca quedan nulos', () => {
    const r = normalizarListado({ items: [{ codigo: null, nombre: null }], paginacion });
    expect(r.items[0].nombre.toLowerCase()).toBe('');
    expect(r.items[0].codigo).toBe('');
  });

  it('descarta elementos de la lista que no son objetos', () => {
    const r = normalizarListado({ items: [null, 'basura', 7, { codigo: 'A' }], paginacion });
    expect(r.items.map((i) => i.codigo)).toEqual(['A']);
  });

  it('conserva los campos que la guía no documenta', () => {
    const r = normalizarListado({
      items: [{ codigo: 'A', campo_nuevo: 1, montos: { monto_disponible_clp: 5, extra: 'y' } }],
      paginacion: { ...paginacion, campo_pag: true },
    });
    expect((r.items[0] as unknown as Record<string, unknown>).campo_nuevo).toBe(1);
    expect((r.items[0].montos as unknown as Record<string, unknown>).extra).toBe('y');
    expect(r.items[0].montos.monto_disponible_clp).toBe(5);
  });

  it('una paginación ausente o con basura cuenta como 0, no como NaN', () => {
    const r = normalizarListado({ items: [], paginacion: { total_paginas: 'x', numero_pagina: null } });
    expect(r.paginacion).toMatchObject({ total_paginas: 0, numero_pagina: 0, tamano_pagina: 0, total_resultados: 0 });
  });

  it('un listado sin items NO se lee como "sin resultados": es una respuesta inválida', () => {
    expect(() => normalizarListado({ paginacion })).toThrow(RespuestaInvalidaError);
    expect(() => normalizarListado({ items: 'x', paginacion })).toThrow(RespuestaInvalidaError);
    expect(() => normalizarListado(null)).toThrow(RespuestaInvalidaError);
    expect(() => normalizarListado([])).toThrow(RespuestaInvalidaError);
  });

  it('es idempotente: normalizar dos veces da lo mismo', () => {
    const una = normalizarListado({ items: [{ codigo: 'A', montos: null }], paginacion });
    expect(normalizarListado(una)).toEqual(una);
  });
});

describe('normalizarDetalle', () => {
  it('listas ausentes pasan a [] y los proveedores conservan sus campos', () => {
    const d = normalizarDetalle({
      codigo: 'A',
      productos_solicitados: null,
      proveedores_cotizando: [{ rut_proveedor: '1-9', razon_social: null, valor_neto: 10, productos_cotizados: null }],
    });
    expect(d.productos_solicitados).toEqual([]);
    expect(d.proveedores_cotizando[0].razon_social).toBe('');
    expect(d.proveedores_cotizando[0].valor_neto).toBe(10);
    expect(d.proveedores_cotizando[0].productos_cotizados).toEqual([]);
    expect(d.presupuesto.moneda).toBe('');
  });

  it('un detalle que no es objeto es una respuesta inválida', () => {
    expect(() => normalizarDetalle('html de error')).toThrow(RespuestaInvalidaError);
  });
});

describe('herramientas con datos incompletos de la API', () => {
  afterEach(() => vi.unstubAllGlobals());

  function apiCon(payload: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ success: 'OK', payload }),
    })));
    return new CompraAgilClient('TICKET-TEST');
  }

  const itemsNulos = {
    items: [{ codigo: '1-1-COT26', nombre: 'Licencias', estado: null, montos: null, institucion: null, fechas: null, resumen: null }],
    paginacion,
  };

  it('buscar_compras_agiles no se cae con montos nulos (caso de la auditoría QA)', async () => {
    const { server, handlers } = servidorFalso();
    registerBuscarCompras(server, apiCon(itemsNulos));

    const r = await handlers.buscar_compras_agiles({ q: 'licencias', tamano_pagina: 10 });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).not.toMatch(/Cannot read properties/);
    expect(r.content[0].text).toContain('1-1-COT26');
  });

  it('radar_oportunidades_calientes no se cae con sub-objetos nulos', async () => {
    const { server, handlers } = servidorFalso();
    registerRadarOportunidades(server, apiCon(itemsNulos));

    const r = await handlers.radar_oportunidades_calientes({});
    expect(r.content[0].text).not.toMatch(/Cannot read properties|undefined|NaN/);
  });

  it('obtener_detalle_compra no se cae con un detalle mínimo', async () => {
    const { server, handlers } = servidorFalso();
    registerDetalleCompra(server, apiCon({ codigo: '1-1-COT26', nombre: 'X' }));

    const r = await handlers.obtener_detalle_compra({ codigo: '1-1-COT26' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('1-1-COT26');
  });

  it('una respuesta sin forma de listado se explica, no se lee como cero resultados', async () => {
    const { server, handlers } = servidorFalso();
    registerBuscarCompras(server, apiCon({ mensaje: 'mantenimiento' }));

    const r = await handlers.buscar_compras_agiles({ q: 'licencias', tamano_pagina: 10 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('forma inesperada');
  });
});
