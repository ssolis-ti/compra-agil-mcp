import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Tickets, ticketsDelEntorno } from '../src/api/tickets.js';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';
import { redact } from '../src/utils/redact.js';

/** Varios tickets con rotación (2.10.0, T1–T5). */

const A = 'TICKET-A-NO-REAL-000000000000AAAA';
const B = 'TICKET-B-NO-REAL-000000000000BBBB';

function listado() {
  return new Response(JSON.stringify({ success: 'OK', payload: { items: [], paginacion: { total_paginas: 0, numero_pagina: 1, tamano_pagina: 10, total_resultados: 0 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
}
const estado = (s: number) => new Response(JSON.stringify({ success: false, errores: [{ codigo: String(s), mensaje: 'x' }] }), { status: s, headers: { 'content-type': 'application/json' } });

let usados: string[];
function simularApi(respuesta: (ticket: string) => Response) {
  usados = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const t = (init.headers as Record<string, string>).ticket;
    usados.push(t);
    return respuesta(t);
  }));
}

let n = 0;
const buscar = (c: CompraAgilClient) => c.buscar({ estado: 'publicada', numero_pagina: ++n });

afterEach(() => { vi.unstubAllGlobals(); });

describe('ticketsDelEntorno', () => {
  it('COMPRA_AGIL_TICKET primero, luego COMPRA_AGIL_TICKETS, sin vacíos ni repetidos', () => {
    expect(ticketsDelEntorno({ COMPRA_AGIL_TICKET: A, COMPRA_AGIL_TICKETS: ` ${B}, ,${A}` })).toEqual([A, B]);
    expect(ticketsDelEntorno({ COMPRA_AGIL_TICKETS: `${B},${A}` })).toEqual([B, A]);
    expect(ticketsDelEntorno({})).toEqual([]);
  });
});

describe('Tickets', () => {
  it("reparte en turno; si uno tiene que esperar, sale por el otro", () => {
    const t = new Tickets([A, B]);
    expect([t.elegir()!.valor, t.elegir()!.valor, t.elegir()!.valor]).toEqual([A, B, A]);
    const lento = new Tickets([A, B], { maximoPorMinuto: 1 });
    lento.lista[1].limitador.reservarTurno(); // B ya usó su cupo del minuto
    expect([lento.elegir()!.valor, lento.elegir()!.valor]).toEqual([A, A]);
  });

  it('el estado muestra cada ticket enmascarado, nunca su valor', () => {
    const t = new Tickets([A, B]);
    t.rechazar(t.lista[1], 401);
    const e = t.estado();
    expect(e).toEqual([
      { ticket: '••••AAAA', estado: 'activo', consultas_hoy: 0, limitado_hasta: null },
      { ticket: '••••BBBB', estado: 'rechazado', consultas_hoy: 0, limitado_hasta: null },
    ]);
    expect(JSON.stringify(e)).not.toContain('NO-REAL');
  });

  it('los registra como secretos', () => {
    new Tickets([A, B]);
    expect(redact(`x ${B} y`)).not.toContain(B);
  });
});

describe('CompraAgilClient con varios tickets', () => {
  beforeEach(() => { n = 0; });

  it('un solo ticket: un 401 se informa como siempre y no se marca rechazado', async () => {
    simularApi(() => estado(401));
    const c = new CompraAgilClient(A, 'https://api.invalid');
    await expect(buscar(c)).rejects.toMatchObject({ httpStatus: 401 });
    await expect(buscar(c)).rejects.toMatchObject({ httpStatus: 401 });
    expect(usados).toEqual([A, A]);
    expect(c.estadoTickets()[0].estado).toBe('activo');
  });

  it('401 en uno: la misma consulta sale con el otro, y el rechazado no se vuelve a usar (T3)', async () => {
    simularApi((t) => (t === A ? estado(401) : listado()));
    const c = new CompraAgilClient([A, B], 'https://api.invalid');
    await buscar(c);
    await buscar(c);
    await buscar(c);
    expect(usados).toEqual([A, B, B, B]);
    expect(c.estadoTickets().map((e) => e.estado)).toEqual(['rechazado', 'activo']);
  });

  it('429 en uno: se salta hasta que pase su espera y la consulta no falla (T4)', async () => {
    simularApi((t) => (t === A ? estado(429) : listado()));
    const c = new CompraAgilClient([A, B], 'https://api.invalid');
    await buscar(c);
    expect(usados).toEqual([A, B]);
    await buscar(c);
    await buscar(c);
    expect(usados.slice(2)).toEqual([B, B]);
    expect(c.estadoTickets().map((e) => e.estado)).toEqual(['limitado', 'activo']);
    expect(c.getRateLimitStats().isLimited).toBe(false);
  });

  it('todos limitados: no envía y responde 429 diciendo que son todos', async () => {
    simularApi(() => estado(429));
    const c = new CompraAgilClient([A, B], 'https://api.invalid');
    await expect(buscar(c)).rejects.toMatchObject({ httpStatus: 429 });
    expect(usados).toEqual([A, B]);
    const e = await buscar(c).catch((x: CompraAgilApiError) => x);
    expect(usados).toHaveLength(2);
    expect(JSON.stringify((e as CompraAgilApiError).apiErrors)).toContain('Todos los tickets');
    expect(c.getRateLimitStats().isLimited).toBe(true);
  });

  it('todos rechazados: no envía nada más', async () => {
    simularApi(() => estado(403));
    const c = new CompraAgilClient([A, B], 'https://api.invalid');
    await expect(buscar(c)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(buscar(c)).rejects.toMatchObject({ httpStatus: 401 });
    expect(usados).toEqual([A, B]);
  });

  it('un 500 no se reintenta con otro ticket', async () => {
    simularApi(() => estado(500));
    const c = new CompraAgilClient([A, B], 'https://api.invalid');
    await expect(buscar(c)).rejects.toMatchObject({ httpStatus: 500 });
    expect(usados).toHaveLength(1);
  });

  it('el conteo del día es por ticket y la estadística suma', async () => {
    simularApi(() => listado());
    const c = new CompraAgilClient([A, B], 'https://api.invalid');
    for (let i = 0; i < 4; i++) await buscar(c);
    const e = c.estadoTickets();
    expect(e[0].consultas_hoy + e[1].consultas_hoy).toBe(4);
    expect(e[0].consultas_hoy).toBeGreaterThan(0);
    expect(e[1].consultas_hoy).toBeGreaterThan(0);
    expect(c.getRateLimitStats().requestsToday).toBe(4);
  });
});

describe('cuota en disco por ticket (T2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tickets-'));
    vi.stubEnv('COMPRA_AGIL_DATA_DIR', dir);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('un archivo por hash, sin el ticket; el archivo anterior pasa al primero', () => {
    const hoy = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(dir, '.rate-limit-state.json'), JSON.stringify({ day: hoy, requestCount: 37, isLimited: false, limitResetTime: null }));
    const t = new Tickets([A, B], { persistir: true });
    expect(t.estado().map((e) => e.consultas_hoy)).toEqual([37, 0]);
    t.lista[1].limitador.recordRequest();
    const archivos = fs.readdirSync(dir).filter((f) => f.startsWith('.rate-limit-state-'));
    expect(archivos).toHaveLength(2);
    for (const f of archivos) {
      expect(f).toMatch(/^\.rate-limit-state-[0-9a-f]{16}\.json$/);
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toContain('NO-REAL');
    }
    // Reordenar los tickets no cambia de quién es cada conteo.
    expect(new Tickets([B, A], { persistir: true }).estado().map((e) => e.consultas_hoy)).toEqual([1, 37]);
  });
});

describe('herramientas con varios tickets (T5)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('verificar_ticket y obtener_estadisticas_uso muestran cada ticket enmascarado', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { registerVerificarTicket } = await import('../src/tools/verificar-ticket.js');
    const { registerEstadisticasUso } = await import('../src/tools/estadisticas-uso.js');
    vi.stubEnv('COMPRA_AGIL_TICKET', A);
    vi.stubEnv('COMPRA_AGIL_TICKETS', B);
    simularApi((t) => (t === A ? estado(401) : listado()));
    const api = new CompraAgilClient([A, B], 'https://api.invalid');
    const server = new McpServer({ name: 'p', version: '0' });
    registerVerificarTicket(server, api);
    registerEstadisticasUso(server, api);
    const [x, y] = InMemoryTransport.createLinkedPair();
    await server.connect(x);
    const cliente = new Client({ name: 'c', version: '0' });
    await cliente.connect(y);
    const texto = async (name: string) => ((await cliente.callTool({ name, arguments: {} })).content as Array<{ text: string }>)[0].text;

    const v = await texto('verificar_ticket');
    expect(v).toContain('Tickets configurados: 2');
    expect(v).toMatch(/••••AAAA: rechazado/);
    expect(v).toMatch(/••••BBBB: activo, 1 consulta/);
    const s = JSON.parse(await texto('obtener_estadisticas_uso'));
    expect(s.tickets.map((t: { estado: string }) => t.estado)).toEqual(['rechazado', 'activo']);
    expect(v + JSON.stringify(s)).not.toContain('NO-REAL');
  });
});
