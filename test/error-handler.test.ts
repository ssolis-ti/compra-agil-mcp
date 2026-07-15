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
});
