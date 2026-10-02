import { describe, it, expect } from 'vitest';
import { handleApiResponse, CompraAgilApiError } from '../src/utils/error-handler.js';

/** Crea un objeto Response simulado a partir de un status y un body JSON. */
function fakeResponse(status: number, body: unknown, ok?: boolean): Response {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('handleApiResponse', () => {
  it('extrae payload de una respuesta OK envuelta', async () => {
    const body = { success: 'OK', trace: null, payload: { items: [1, 2, 3] }, errors: null };
    const result = await handleApiResponse(fakeResponse(200, body));
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('soporta respuestas legacy sin envoltorio payload (OrdenCompra.json)', async () => {
    const body = { Cantidad: 1, Listado: [{ Codigo: 'X' }] };
    const result = await handleApiResponse(fakeResponse(200, body));
    expect(result).toEqual(body);
  });

  it('lanza CompraAgilApiError cuando success es NOK aunque HTTP sea 200', async () => {
    const body = { success: 'NOK', trace: null, payload: null, errors: [{ codigo: '400', mensaje: 'malo', detalle: null }] };
    await expect(handleApiResponse(fakeResponse(200, body))).rejects.toBeInstanceOf(CompraAgilApiError);
  });

  it('lanza CompraAgilApiError en respuestas de error HTTP con body JSON', async () => {
    const body = { success: 'NOK', trace: null, payload: null, errors: [{ codigo: '403', mensaje: 'ticket inválido', detalle: null }] };
    await expect(handleApiResponse(fakeResponse(403, body))).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('lanza CompraAgilApiError aunque el body de error no sea JSON', async () => {
    const resp = { ok: false, status: 500, json: async () => { throw new Error('not json'); } } as unknown as Response;
    await expect(handleApiResponse(resp)).rejects.toMatchObject({ httpStatus: 500 });
  });
});

describe('CompraAgilApiError.actionableMessage', () => {
  it('da mensaje accionable de ticket para 401', () => {
    const err = new CompraAgilApiError(401, []);
    expect(err.actionableMessage).toContain('COMPRA_AGIL_TICKET');
  });

  it('explica cuota diaria agotada para 429', () => {
    const err = new CompraAgilApiError(429, []);
    expect(err.actionableMessage.toLowerCase()).toContain('cuota diaria');
  });

  it('incluye el detalle de la API cuando está presente', () => {
    const err = new CompraAgilApiError(400, [{ codigo: '400', mensaje: 'fecha inválida', detalle: null }]);
    expect(err.actionableMessage).toContain('fecha inválida');
  });

  it('un 504 sin llamada no inventa la causa desierta', () => {
    const err = new CompraAgilApiError(504, []);
    expect(err.actionableMessage).toContain('HTTP 504');
    expect(err.actionableMessage).not.toContain('desierta');
    expect(err.actionableMessage).not.toContain('La llamada que falló');
  });

  it('un 504 nombra la llamada publicada y no culpa a desierta', () => {
    const consulta = 'GET /v2/compra-agil?estado=publicada&region=13&tamano_pagina=50&numero_pagina=1';
    const err = new CompraAgilApiError(504, [], consulta);
    expect(err.actionableMessage).toContain(consulta);
    expect(err.actionableMessage).not.toContain('desierta');
  });

  it('un 504 de detalle por código no pide bajar el tamaño de página', () => {
    const consulta = 'GET /v2/compra-agil/3658-476-COT26';
    const err = new CompraAgilApiError(504, [], consulta);
    expect(err.actionableMessage).toContain(consulta);
    expect(err.actionableMessage).toContain('No reintentes en ráfaga');
    expect(err.actionableMessage).not.toContain('tamano_pagina');
    expect(err.actionableMessage).toContain('no dejó el detalle en caché');
  });

  it('un 504 de texto sobre desierta sí nombra esa combinación', () => {
    const consulta = 'GET /v2/compra-agil?estado=desierta&q=resma&tamano_pagina=50';
    const err = new CompraAgilApiError(504, [], consulta);
    expect(err.actionableMessage).toContain(consulta);
    expect(err.actionableMessage).toContain('búsqueda de texto y estado=desierta');
    expect(err.actionableMessage).toContain("Baja 'tamano_pagina' hasta 10");
  });

  it('un 504 sin tamaño de página no nombra perillas que la llamada no tiene', () => {
    const err = new CompraAgilApiError(504, [], 'GET /v2/compra-agil?estado=publicada');
    expect(err.actionableMessage).not.toContain('tamano_pagina');
    expect(err.actionableMessage).not.toContain('limite_analisis');
    expect(err.actionableMessage).not.toContain('max_paginas');
  });

  it('un 504 que ya pidió 10 no pide bajar el tamaño', () => {
    const err = new CompraAgilApiError(504, [], 'GET /v2/compra-agil?estado=publicada&tamano_pagina=10');
    expect(err.actionableMessage).not.toContain("Baja 'tamano_pagina'");
  });

  it('redacta el ticket si la llamada que falló lo trae', () => {
    const err = new CompraAgilApiError(502, [], 'GET /servicios/v1/publico/OrdenCompra.json?ticket=SECRETO-NO-IMPRIMIR&codigo=X');
    expect(err.actionableMessage).not.toContain('SECRETO-NO-IMPRIMIR');
    expect(err.actionableMessage).toContain('ticket=[REDACTED]');
  });
});
