import { describe, it, expect } from 'vitest';
import { nuevoCatalogo, clienteFalso, marca } from './ayudas/api-cambios.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';

/**
 * El catálogo simulado reproduce lo medido en la API real el 7-oct-2026
 * (docs/internals/qa/medicion-ventanas.md). Si estas aserciones dejan de
 * calzar con la API, el núcleo de vigilancia se estaría probando contra una
 * API que no existe.
 */
const T = Date.parse('2026-10-07T18:00:00Z'); // pared de Chile como «Z»
const MIN = 60_000;
const hora = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';

describe('catálogo de cambios por lotes', () => {
  const c = nuevoCatalogo();
  c.agregar(T, 4);
  c.agregar(T + 5 * MIN, 114);
  c.agregar(T + 10 * MIN, 6);
  const api = clienteFalso(c);
  const total = async (desde: number, hasta: number) =>
    (await api.buscar({ cambio_desde: hora(desde), cambio_hasta: hora(hasta), tamano_pagina: 10, numero_pagina: 1 })).paginacion.total_resultados;

  it('todos los cambios de un lote llevan la misma marca, hh:m5:00.380', async () => {
    const r = await api.buscar({ cambio_desde: hora(T + 5 * MIN), cambio_hasta: hora(T + 9 * MIN + 59_000), tamano_pagina: 10 });
    expect(new Set(r.items.map((i) => i.fechas.fecha_ultimo_cambio))).toEqual(new Set(['2026-10-07T18:05:00.380Z']));
    expect(marca(T + 7 * MIN)).toBe(T + 5 * MIN + 380);
  });

  it('una ventana entre marcas da 0; una de un minuto que contiene la marca da el lote entero', async () => {
    expect(await total(T + 2 * MIN, T + 3 * MIN)).toBe(0);
    expect(await total(T + 5 * MIN, T + 6 * MIN)).toBe(114);
  });

  it('los bordes se incluyen: dos ventanas contiguas cuentan dos veces el lote del borde', async () => {
    const entera = await total(T, T + 10 * MIN + 1000);
    const partes = (await total(T, T + 5 * MIN + 1000)) + (await total(T + 5 * MIN, T + 10 * MIN + 1000));
    expect(entera).toBe(124);
    expect(partes).toBe(124 + 114);
  });

  it('un proceso que vuelve a cambiar deja su lote y pasa al nuevo', async () => {
    const [codigo] = c.agregar(T + 20 * MIN, 1);
    c.mover(codigo, T + 25 * MIN);
    expect(await total(T + 20 * MIN, T + 24 * MIN)).toBe(0);
    expect(await total(T + 25 * MIN, T + 29 * MIN)).toBe(1);
  });

  it('un lote programado para fallar responde 504 las veces pedidas', async () => {
    c.fallarLote(T + 10 * MIN, 1);
    await expect(total(T + 10 * MIN, T + 14 * MIN)).rejects.toBeInstanceOf(CompraAgilApiError);
    expect(await total(T + 10 * MIN, T + 14 * MIN)).toBe(6);
  });

  it('filtra por estado y región, y una página menor que 10 es un 400', async () => {
    c.agregar(T + 30 * MIN, 3, { region: 5, estado: 'cerrada' });
    c.agregar(T + 30 * MIN, 2, { region: 5 });
    const r = await api.buscar({ cambio_desde: hora(T + 30 * MIN), cambio_hasta: hora(T + 34 * MIN), estado: 'publicada', region: '5', tamano_pagina: 10 });
    expect(r.paginacion.total_resultados).toBe(2);
    await expect(api.buscar({ tamano_pagina: 5 })).rejects.toMatchObject({ httpStatus: 400 });
  });
});
