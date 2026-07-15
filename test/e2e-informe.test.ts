/**
 * Test end-to-end del camino completo: cliente HTTP → recolectarDatosRadar → plantilla.
 *
 * POR QUÉ CON FIXTURES
 * Este era el tramo nunca ejercitado del sistema, porque probarlo exigía un
 * ticket real — y usar credenciales en pruebas arriesga exponerlas en logs,
 * transcripciones o capturas. Se sustituye `fetch` por una respuesta grabada y
 * sanitizada: se ejercita el código real (incluido handleApiResponse y el
 * parseo del envoltorio payload) sin que exista credencial alguna.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { recolectarDatosRadar } from '../src/tools/radar-oportunidades.js';
import { renderRadarInforme } from '../src/reports/templates/radar-oportunidades.js';
import { registrarSecreto, _resetSecretos } from '../src/utils/redact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/compra-agil-listado.json'), 'utf8')
);

const TICKET_FALSO = 'TICKET-DE-PRUEBA-NO-REAL-0000';
/** "Ahora" fijo para que el cálculo de horas restantes sea determinista. */
const AHORA = new Date('2026-07-15T12:00:00Z').getTime();

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _resetSecretos();
  fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => FIXTURE,
  }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('E2E: API → cliente → radar → informe', () => {
  it('recorre el camino completo y produce un informe válido', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    const datos = await recolectarDatosRadar(client, { max_paginas: 1 }, AHORA);

    // El fixture trae 3 procesos, pero uno ya cerró → el radar debe descartarlo.
    expect(datos.totalAnalizadas).toBe(2);
    expect(datos.oportunidades.map((o) => o.codigo)).not.toContain('9999-99-COT26');

    // El de 0 oferentes y cierre próximo debe rankear primero.
    expect(datos.oportunidades[0].codigo).toBe('1057539-228-COT26');

    const html = renderRadarInforme({
      oportunidades: datos.oportunidades,
      totalAnalizadas: datos.totalAnalizadas,
      filtros: { paginasEscaneadas: 1 },
      generadoEn: new Date(AHORA),
      formato: 'carta',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Radar de Oportunidades');
    expect(html).toContain('1057539-228-COT26');
    expect(html).toContain('$8.450.000');
    expect(html).toContain('size: letter');
  });

  it('el cliente envía el ticket por header, nunca en la query del endpoint v2', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    await client.buscar({ tamano_pagina: 10 });

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain(TICKET_FALSO);
    expect((opts as RequestInit).headers).toMatchObject({ ticket: TICKET_FALSO });
  });

  it('el informe generado NUNCA contiene el ticket', async () => {
    registrarSecreto(TICKET_FALSO);
    const client = new CompraAgilClient(TICKET_FALSO);
    const datos = await recolectarDatosRadar(client, { max_paginas: 1 }, AHORA);
    const html = renderRadarInforme({
      oportunidades: datos.oportunidades,
      totalAnalizadas: datos.totalAnalizadas,
      filtros: { paginasEscaneadas: 1 },
      generadoEn: new Date(AHORA),
    });
    expect(html).not.toContain(TICKET_FALSO);
  });

  it('escapa datos reales de la API con caracteres peligrosos', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    const datos = await recolectarDatosRadar(client, { max_paginas: 1 }, AHORA);
    const html = renderRadarInforme({
      oportunidades: datos.oportunidades,
      totalAnalizadas: datos.totalAnalizadas,
      filtros: { paginasEscaneadas: 1 },
      generadoEn: new Date(AHORA),
    });
    // El fixture trae "soporte & mantención de equipos <computacionales>"
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;computacionales&gt;');
    expect(html).not.toContain('<computacionales>');
  });

  it('propaga errores de la API como CompraAgilApiError accionable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        success: 'NOK',
        payload: null,
        trace: null,
        errors: [{ codigo: '403', mensaje: 'El ticket no existe, es inválido o no tiene permisos.', detalle: null }],
      }),
    })));

    const client = new CompraAgilClient(TICKET_FALSO);
    await expect(client.buscar({})).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('un mensaje de error de la API que haga eco del ticket sale redactado', async () => {
    registrarSecreto(TICKET_FALSO);
    // Escenario defensivo: la API devuelve un error que incluye la URL solicitada.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        success: 'NOK',
        payload: null,
        trace: null,
        errors: [{ codigo: '400', mensaje: `Request inválida: /v2/compra-agil?ticket=${TICKET_FALSO}`, detalle: null }],
      }),
    })));

    const client = new CompraAgilClient(TICKET_FALSO);
    try {
      await client.buscar({});
      expect.unreachable('debió lanzar');
    } catch (e: any) {
      expect(e.actionableMessage).not.toContain(TICKET_FALSO);
      expect(e.actionableMessage).toContain('[REDACTED]');
    }
  });
});
