import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { _resetSecretos } from '../src/utils/redact.js';

/**
 * `detalleEnCache()` es la pieza que permite que `verificar_orden_compra`
 * siga siendo útil sin gastar cuota: reutiliza el detalle si ya se pagó y,
 * si no, devuelve undefined para que la herramienta responda igual con su
 * explicación. Su contrato tiene una condición que no se puede relajar:
 * NUNCA debe salir a la red. Si algún día lo hiciera, la herramienta volvería
 * a consumir una consulta para responder algo que la API no publica.
 */

const TICKET_FALSO = 'TICKET-DE-PRUEBA-NO-REAL-0000';
const CODIGO = '5519-136-COT26';

const detalleFalso = (codigo: string) => ({
  success: 'OK',
  trace: null,
  errors: null,
  payload: {
    codigo,
    nombre: 'Compra de prueba',
    id_orden_compra: null,
    presupuesto: { monto_disponible_clp: 4_800_000 },
  },
});

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _resetSecretos();
  fetchSpy = vi.fn(async (url: string) => {
    const codigo = decodeURIComponent(String(url).split('/').pop() ?? '');
    return { ok: true, status: 200, json: async () => detalleFalso(codigo) };
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detalleEnCache — nunca sale a la red', () => {
  it('sin nada en caché devuelve undefined y NO consulta la API', () => {
    const client = new CompraAgilClient(TICKET_FALSO);

    expect(client.detalleEnCache(CODIGO)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('con el detalle en caché tampoco consulta la API', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    await client.detalle(CODIGO);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    client.detalleEnCache(CODIGO);
    client.detalleEnCache(CODIGO);

    // Sigue en 1: las lecturas de caché no generan tráfico.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('detalleEnCache — reutiliza lo ya pagado', () => {
  it('devuelve el detalle que trajo una consulta previa', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    const traido = await client.detalle(CODIGO);

    expect(client.detalleEnCache(CODIGO)).toEqual(traido);
  });

  it('construye la misma clave que usa detalle() internamente', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    await client.detalle(CODIGO);

    // Si las claves no coincidieran, esto sería undefined y la herramienta
    // perdería el dato aunque estuviera pagado.
    expect(client.detalleEnCache(CODIGO)).toBeDefined();
  });

  it('funciona con códigos que requieren escapado en la URL', async () => {
    const raro = '1057539-228/COT26';
    const client = new CompraAgilClient(TICKET_FALSO);
    await client.detalle(raro);

    expect(client.detalleEnCache(raro)).toBeDefined();
  });
});

describe('detalleEnCache — no confunde procesos', () => {
  it('otro código sigue sin estar en caché', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    await client.detalle(CODIGO);

    expect(client.detalleEnCache('9999-1-COT26')).toBeUndefined();
  });

  it('no devuelve el detalle de un proceso distinto', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    await client.detalle('AAA-1-COT26');
    await client.detalle('BBB-2-COT26');

    expect((client.detalleEnCache('AAA-1-COT26') as any).codigo).toBe('AAA-1-COT26');
    expect((client.detalleEnCache('BBB-2-COT26') as any).codigo).toBe('BBB-2-COT26');
  });

  it('una búsqueda no se confunde con el detalle del mismo rubro', async () => {
    const client = new CompraAgilClient(TICKET_FALSO);
    await client.buscar({ q: CODIGO, tamano_pagina: 10 });

    // La búsqueda usa otro path: no debe aparecer como detalle.
    expect(client.detalleEnCache(CODIGO)).toBeUndefined();
  });
});

describe('detalleEnCache — aislamiento entre instancias', () => {
  it('sin persistencia, un cliente nuevo no ve la caché del anterior', async () => {
    const primero = new CompraAgilClient(TICKET_FALSO);
    await primero.detalle(CODIGO);

    // Persistencia apagada por defecto: cada instancia arranca limpia y los
    // tests no comparten estado a través del disco.
    expect(new CompraAgilClient(TICKET_FALSO).detalleEnCache(CODIGO)).toBeUndefined();
  });
});
