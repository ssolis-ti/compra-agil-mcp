import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { tieneFiltroDeApi, inputSchema } from '../src/tools/buscar-compras.js';

describe('descripción de buscar_compras_agiles', () => {
  it('no anuncia un HTTP 500 por una llamada que no se hizo', () => {
    const src = readFileSync(new URL('../src/tools/buscar-compras.ts', import.meta.url), 'utf8');
    const descripcion = src.slice(src.indexOf('const TOOL_DESCRIPTION'), src.indexOf('export const inputSchema'));
    expect(descripcion).toContain('no hace la llamada');
    expect(descripcion).not.toContain('HTTP 500');
  });
});

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
    expect(() => z.object(inputSchema).parse({ estado: 'publicada', tamano_pagina: 50 })).toThrow();
  });

  it('basta un filtro real', () => {
    expect(tieneFiltroDeApi({ estado: 'publicada' })).toBe(true);
    expect(tieneFiltroDeApi({ region: '13' })).toBe(true);
    expect(tieneFiltroDeApi({ q: 'resma' })).toBe(true);
    expect(tieneFiltroDeApi({ id: '4629-54-COT26' })).toBe(true);
    expect(tieneFiltroDeApi({ publicado_desde: '2026-10-01T00:00:00Z' })).toBe(true);
  });
});
