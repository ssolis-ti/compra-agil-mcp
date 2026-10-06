import { describe, it, expect, vi, afterEach } from 'vitest';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';
import { esSenalDeCongestion } from '../src/utils/concurrencia.js';

/** Respuesta mínima que el cliente sabe leer. */
function respuestaOk(payload: unknown = { items: [], paginacion: { total_paginas: 0, numero_pagina: 1, tamano_pagina: 10, total_resultados: 0 } }) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => ({ success: 'OK', payload }) };
}

/** Un fetch que nunca responde, pero sí obedece a la señal de corte. */
function fetchQueCuelga() {
  return vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  }));
}

function falloDeRed() {
  return Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
}

async function capturar(p: Promise<unknown>): Promise<CompraAgilApiError> {
  try {
    await p;
  } catch (e) {
    return e as CompraAgilApiError;
  }
  throw new Error('se esperaba un error');
}

describe('CompraAgilClient — tiempo límite', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('una API que no responde se corta en el tiempo límite, no cuelga la herramienta', async () => {
    const fetchSpy = fetchQueCuelga();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new CompraAgilClient('TICKET-TEST', undefined, { timeoutMs: 50 });

    const inicio = Date.now();
    const error = await capturar(client.detalle('1-1-COT26'));

    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(error).toBeInstanceOf(CompraAgilApiError);
    expect(error.causa).toBe('timeout');
    expect(error.actionableMessage).toContain('no respondió en 0 s');
    expect(error.actionableMessage).toContain('GET /v2/compra-agil/1-1-COT26');
  });

  it('no reintenta un timeout: repetirlo pasaría el límite del cliente MCP', async () => {
    const fetchSpy = fetchQueCuelga();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new CompraAgilClient('TICKET-TEST', undefined, { timeoutMs: 30 });

    await capturar(client.detalle('1-1-COT26'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('el timeout cuenta como congestión para el limitador de concurrencia', async () => {
    vi.stubGlobal('fetch', fetchQueCuelga());
    const client = new CompraAgilClient('TICKET-TEST', undefined, { timeoutMs: 30 });

    const error = await capturar(client.detalle('1-1-COT26'));
    expect(esSenalDeCongestion(error)).toBe(true);
  });

  it('un timeout no queda en caché: la siguiente llamada vuelve a la red', async () => {
    const fetchSpy = vi.fn()
      .mockImplementationOnce(fetchQueCuelga())
      .mockResolvedValueOnce(respuestaOk({ codigo: '1-1-COT26' }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = new CompraAgilClient('TICKET-TEST', undefined, { timeoutMs: 30 });

    await capturar(client.detalle('1-1-COT26'));
    await expect(client.detalle('1-1-COT26')).resolves.toEqual({ codigo: '1-1-COT26' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('toma el límite de COMPRA_AGIL_TIMEOUT_MS si no se pasa por opción', async () => {
    vi.stubEnv('COMPRA_AGIL_TIMEOUT_MS', '40');
    vi.stubGlobal('fetch', fetchQueCuelga());
    try {
      const client = new CompraAgilClient('TICKET-TEST');
      const error = await capturar(client.detalle('1-1-COT26'));
      expect(error.causa).toBe('timeout');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('CompraAgilClient — fallos de red', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reintenta UNA vez un corte de red y entrega la respuesta', async () => {
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(falloDeRed())
      .mockResolvedValueOnce(respuestaOk({ codigo: 'X' }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = new CompraAgilClient('TICKET-TEST');

    await expect(client.detalle('X')).resolves.toEqual({ codigo: 'X' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('si el reintento también falla, explica el fallo de red sin texto crudo de JavaScript', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(falloDeRed());
    vi.stubGlobal('fetch', fetchSpy);
    const client = new CompraAgilClient('TICKET-TEST');

    const error = await capturar(client.detalle('X'));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(error.causa).toBe('red');
    expect(error.actionableMessage).toContain('No se pudo conectar con la API');
    expect(error.actionableMessage).toContain('Se reintentó una vez');
  });

  it('no reintenta un 504: la pasarela ya esperó ~30 s', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false, status: 504, headers: new Headers(), json: async () => { throw new Error('no json'); },
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new CompraAgilClient('TICKET-TEST');

    const error = await capturar(client.detalle('X'));
    expect(error.httpStatus).toBe(504);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('el mensaje de red no filtra el ticket', async () => {
    const conTicket = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET' },
      message: 'fetch failed https://api.mercadopublico.cl/x?ticket=TICKET-SECRETO-RED',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(conTicket));
    const client = new CompraAgilClient('TICKET-SECRETO-RED');

    const error = await capturar(client.detalle('X'));
    expect(error.actionableMessage).not.toContain('TICKET-SECRETO-RED');
  });
});

describe('CompraAgilClient — respuesta que no es JSON', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('un 200 con cuerpo cortado da un mensaje accionable y no se guarda en caché', async () => {
    const roto = { ok: true, status: 200, headers: new Headers(), json: async () => JSON.parse('{"payload": [trunc') };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(roto)
      .mockResolvedValueOnce(respuestaOk({ codigo: 'X' }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = new CompraAgilClient('TICKET-TEST');

    const error = await capturar(client.detalle('X'));
    expect(error.causa).toBe('respuesta_invalida');
    expect(error.actionableMessage).toContain('no es JSON válido');
    expect(error.actionableMessage).toContain('GET /v2/compra-agil/X');
    expect(error.actionableMessage).not.toMatch(/Unexpected token/);

    await expect(client.detalle('X')).resolves.toEqual({ codigo: 'X' });
  });
});
