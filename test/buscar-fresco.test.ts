import { describe, it, expect, vi, afterEach } from 'vitest';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';

/**
 * La vigilancia necesita respuestas frescas (2.9.0, fase 2): la comprobación
 * de un lote paginado vuelve a pedir la página 1 para ver si el total cambió.
 * Servida desde la caché de búsquedas (5 min), sería la misma respuesta y la
 * comprobación no vería nada. `buscarFresco` no lee la caché, pero la renueva.
 */
const respuesta = (total: number) => new Response(JSON.stringify({
  success: 'OK',
  payload: { items: [], paginacion: { total_resultados: total, total_paginas: 1, numero_pagina: 1, tamano_pagina: 10 } },
}), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('buscarFresco', () => {
  it('buscar repite desde la caché; buscarFresco va a la API y renueva la caché', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respuesta(35))
      .mockResolvedValueOnce(respuesta(34));
    const api = new CompraAgilClient('TICKET-DE-PRUEBA-NO-REAL-0000', 'http://127.0.0.1:9', { persistir: false });
    const p = { cambio_desde: '2026-10-07T18:05:00Z', cambio_hasta: '2026-10-07T18:09:59Z', estado: 'publicada', tamano_pagina: 10, numero_pagina: 1 };

    expect((await api.buscar(p)).paginacion.total_resultados).toBe(35);
    expect((await api.buscar(p)).paginacion.total_resultados).toBe(35);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect((await api.buscarFresco(p)).paginacion.total_resultados).toBe(34);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((await api.buscar(p)).paginacion.total_resultados).toBe(34);
  });
});
