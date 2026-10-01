import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { tieneFiltroDeApi, inputSchema } from '../src/tools/buscar-compras.js';

describe('tieneFiltroDeApi', () => {
  it('una llamada vacía no es una búsqueda', () => {
    expect(tieneFiltroDeApi({})).toBe(false);
  });

  it('página, orden y palabras locales no cuentan', () => {
    expect(tieneFiltroDeApi({})).toBe(false);
    expect(tieneFiltroDeApi({ estado: '   ' })).toBe(false);
  });

  it('sin tamaño de página pide 10, no deja el default a la API', () => {
    expect(z.object(inputSchema).parse({ estado: 'publicada' }).tamano_pagina).toBe(10);
  });

  it('basta un filtro real', () => {
    expect(tieneFiltroDeApi({ estado: 'publicada' })).toBe(true);
    expect(tieneFiltroDeApi({ region: '13' })).toBe(true);
    expect(tieneFiltroDeApi({ q: 'resma' })).toBe(true);
    expect(tieneFiltroDeApi({ id: '4629-54-COT26' })).toBe(true);
    expect(tieneFiltroDeApi({ publicado_desde: '2026-10-01T00:00:00Z' })).toBe(true);
  });
});
