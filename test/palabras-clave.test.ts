import { describe, it, expect, vi } from 'vitest';
import { filtrarPorPalabras } from '../src/utils/palabras-clave.js';
import { recolectarDatosPrecios } from '../src/tools/analizar-precios-mercado.js';

/**
 * E7 (enjambre contra la API real, 6-oct): «guantes nitrilo» trajo «Actividad
 * de futbol recreativo y bienestar funcionario» y guantes térmicos de
 * panadería, y el análisis de precios no tenía cómo excluirlos.
 */

const procesos = [
  { codigo: '1-1-COT26', nombre: 'Guantes de nitrilo talla M' },
  { codigo: '2-2-COT26', nombre: 'Actividad de futbol recreativo y bienestar funcionario' },
  { codigo: '3-3-COT26', nombre: 'Guantes térmicos alta temperatura para panadería' },
  { codigo: '4-4-COT26', nombre: 'GUANTES NITRILO SIN POLVO' },
];

describe('filtrarPorPalabras', () => {
  it('requeridas: todas deben estar (Y)', () => {
    expect(filtrarPorPalabras(procesos, { palabras_clave_requeridas: 'guantes,nitrilo' }).items.map((p) => p.codigo))
      .toEqual(['1-1-COT26', '4-4-COT26']);
  });

  it('excluidas: basta una (O)', () => {
    expect(filtrarPorPalabras(procesos, { palabras_clave_excluidas: 'futbol,termicos' }).items.map((p) => p.codigo))
      .toEqual(['1-1-COT26', '4-4-COT26']);
  });

  it('sin tildes ni mayúsculas: «termicos» descarta «térmicos», «panaderia» descarta «panadería»', () => {
    const r = filtrarPorPalabras(procesos, { palabras_clave_excluidas: 'panaderia' });
    expect(r.items.map((p) => p.codigo)).not.toContain('3-3-COT26');
    expect(r.descartados).toBe(1);
  });

  it('sin filtros devuelve todo, sin descartar', () => {
    expect(filtrarPorPalabras(procesos, {})).toEqual({ items: procesos, descartados: 0 });
    expect(filtrarPorPalabras(procesos, { palabras_clave_requeridas: ' , ' }).descartados).toBe(0);
  });
});

function clienteDePrecios() {
  const detallesEnParalelo = vi.fn(async (codigos: string[]) => codigos.map((codigo) => ({
    codigo, nombre: 'x', estado: { codigo: 'desierta', glosa: 'Desierta' }, institucion: { region: 13, organismo_comprador: 'O' }, fechas: {},
    proveedores_cotizando: [{ rut_proveedor: '1-9', razon_social: 'A', valor_neto: 10_000, productos_cotizados: [{ cantidad: 1, precio_unitario: 10_000 }] }],
  })));
  return {
    buscar: async () => ({ items: procesos, paginacion: { total_paginas: 1, numero_pagina: 1, tamano_pagina: 10, total_resultados: 4 } }),
    detalle: async () => { throw new Error('no se usa'); },
    detallesEnParalelo,
  };
}

describe('analizar_precios_mercado con palabras clave (E7)', () => {
  it('filtra el listado ANTES de pedir detalles: el fútbol no gasta cuota', async () => {
    const c = clienteDePrecios();
    const rec = await recolectarDatosPrecios(c as never, { q: 'guantes nitrilo', palabras_clave_excluidas: 'futbol,termicos' });
    expect(c.detallesEnParalelo).toHaveBeenCalledWith(['1-1-COT26', '4-4-COT26']);
    expect(rec.kind).toBe('datos');
    if (rec.kind === 'datos') expect(rec.datos.cobertura.filtrados_por_palabras_clave).toBe(2);
  });

  it('si el filtro deja la muestra vacía, lo dice y no pide ningún detalle', async () => {
    const c = clienteDePrecios();
    const rec = await recolectarDatosPrecios(c as never, { q: 'guantes', palabras_clave_requeridas: 'latex' });
    expect(c.detallesEnParalelo).not.toHaveBeenCalled();
    expect(rec.kind).toBe('mensaje');
    if (rec.kind === 'mensaje') expect(rec.texto).toMatch(/ninguno pasa el filtro de palabras clave \(requeridas «latex»\)/);
  });
});
