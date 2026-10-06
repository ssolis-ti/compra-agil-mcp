import { describe, it, expect, vi, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';
import { LimitadorConcurrencia } from '../src/utils/concurrencia.js';
import { conPresupuesto, describirFallosDetalle, instalarPresupuesto, tiempoRestante } from '../src/utils/presupuesto.js';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';
import { recolectarDatosPrecios } from '../src/tools/analizar-precios-mercado.js';

/**
 * Fase 1.1: el freno de 15 consultas/min retenía una consulta hasta ~60 s
 * (57 s medidos en scripts/qa) y la herramienta terminaba cortada por el
 * cliente MCP. En la simulación con agentes, cuatro llamadas tardaron 25-45 s
 * con la API respondiendo en ~400 ms.
 */

describe('RateLimiter — turnos en orden, sin ráfagas', () => {
  it('nunca hay más del máximo en una ventana de 60 s, aunque muchas pidan a la vez', () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T12:00:00Z') });
    try {
      const rl = new RateLimiter(15);
      const turnos = Array.from({ length: 40 }, () => Date.now() + rl.reservarTurno());
      for (const t of turnos) {
        const enVentana = turnos.filter((x) => x > t - 60_000 && x <= t).length;
        expect(enVentana).toBeLessThanOrEqual(15);
      }
      // Orden de llegada: los turnos nunca retroceden.
      for (let i = 1; i < turnos.length; i++) expect(turnos[i]).toBeGreaterThanOrEqual(turnos[i - 1]);
      // Las primeras 15 salen ya; la 16.ª espera a que la 1.ª salga de la ventana.
      expect(turnos[14]).toBe(Date.now());
      expect(turnos[15] - Date.now()).toBeGreaterThanOrEqual(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('esperaPrevista no reserva turno', () => {
    const rl = new RateLimiter(2);
    rl.reservarTurno();
    rl.reservarTurno();
    const a = rl.esperaPrevista();
    const b = rl.esperaPrevista();
    expect(a).toBeGreaterThan(55_000);
    expect(Math.abs(a - b)).toBeLessThan(50);
  });
});

describe('Presupuesto de tiempo por llamada', () => {
  afterEach(() => vi.unstubAllGlobals());

  const listado = (codigo = 'A-1-COT26') => ({
    success: 'OK',
    payload: { items: [{ codigo }], paginacion: { total_paginas: 1, numero_pagina: 1, tamano_pagina: 10, total_resultados: 1 } },
  });

  /** Cliente con el freno de 15/min ya lleno por consultas anteriores. */
  async function clienteConFrenoLleno() {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => listado() }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = new CompraAgilClient('TICKET-TEST');
    for (let i = 0; i < 15; i++) await client.buscar({ q: `relleno-${i}` });
    fetchSpy.mockClear();
    return { client, fetchSpy };
  }

  it('fuera de una herramienta no hay presupuesto', () => {
    expect(tiempoRestante()).toBeUndefined();
  });

  it('si la espera en el freno no cabe, no envía la consulta y lo explica', async () => {
    const { client, fetchSpy } = await clienteConFrenoLleno();
    const inicio = Date.now();
    const error = await conPresupuesto(() => client.buscar({ q: 'resmas' }), 10_000).catch((e) => e);

    expect(Date.now() - inicio).toBeLessThan(1_000);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(CompraAgilApiError);
    expect(error.causa).toBe('tiempo_agotado');
    expect(error.actionableMessage).toMatch(/habría tenido que esperar ~\d+ s en el límite propio/);
    expect(error.actionableMessage).toContain('No se envió ni gastó cuota');
  });

  it('el análisis de precios responde a tiempo y no confunde la omisión con un fallo de la API', async () => {
    const { client, fetchSpy } = await clienteConFrenoLleno();
    // La búsqueda la sirve un cliente de prueba; los detalles, el real con el freno lleno.
    const mixto = {
      buscar: async () => listado('B-2-COT26').payload,
      detalle: (c: string) => client.detalle(c),
      detallesEnParalelo: (c: string[]) => client.detallesEnParalelo(c),
    };
    const inicio = Date.now();
    const rec = await conPresupuesto(() => recolectarDatosPrecios(mixto as never, { q: 'resmas' }), 3_000);
    expect(Date.now() - inicio).toBeLessThan(1_500);
    expect(fetchSpy).not.toHaveBeenCalled();
    if (rec.kind !== 'mensaje') throw new Error('se esperaba mensaje');
    expect(rec.texto).toMatch(/^No alcanzó el tiempo para consultar el detalle/);
    expect(rec.texto).toContain('no gastó cuota');
    expect(rec.texto).not.toMatch(/la API no respondió/);
  });

  it('describirFallosDetalle separa API y tiempo dentro de la misma llamada', async () => {
    const { client } = await clienteConFrenoLleno();
    await conPresupuesto(async () => {
      await client.detallesEnParalelo(['X-1-COT26']); // freno lleno: se omite
      const d = describirFallosDetalle(['X-1-COT26', 'Y-2-COT26'], 3);
      expect(d.porTiempo).toEqual(['X-1-COT26']);
      expect(d.porApi).toEqual(['Y-2-COT26']);
      expect(d.texto).toBe('2 de 3 consultas de detalle no se completaron: 1 falló porque la API no respondió (Y-2-COT26), y 1 no se pidió para no pasar el tiempo límite de la herramienta (X-1-COT26); eso no gastó cuota.');
    }, 5_000);
  });

  it('instalarPresupuesto da a cada herramienta su propio presupuesto', async () => {
    const handlers: Record<string, () => Promise<number | undefined>> = {};
    const server = { registerTool: (n: string, _c: unknown, h: () => Promise<number | undefined>) => { handlers[n] = h; } };
    instalarPresupuesto(server as unknown as McpServer, 20_000);
    (server as unknown as McpServer).registerTool('x', {} as never, (async () => tiempoRestante()) as never);
    const restante = await handlers.x();
    expect(restante).toBeGreaterThan(19_000);
    expect(restante).toBeLessThanOrEqual(20_000);
  });
});

describe('LimitadorConcurrencia — límite global entre herramientas', () => {
  it('dos tandas simultáneas no superan juntas el límite', async () => {
    const lim = new LimitadorConcurrencia({ maximo: 2 });
    let enVuelo = 0;
    let maximo = 0;
    const tarea = () => async () => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 10));
      enVuelo--;
      return 1;
    };
    const [a, b] = await Promise.all([
      lim.ejecutar(Array.from({ length: 5 }, tarea)),
      lim.ejecutar(Array.from({ length: 5 }, tarea)),
    ]);
    expect(maximo).toBe(2);
    expect([...a, ...b].every((x) => x === 1)).toBe(true);
  });
});
