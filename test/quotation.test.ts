import { describe, it, expect } from 'vitest';
import { esGanador, extraerPrecioUnitario, extraerMontoNeto } from '../src/utils/quotation.js';
import type { ProveedorCotizando } from '../src/api/compra-agil-client.js';

function prov(overrides: Partial<ProveedorCotizando> = {}): ProveedorCotizando {
  return {
    rut_proveedor: '76.111.111-1',
    razon_social: 'Test SpA',
    es_emt: true,
    ...overrides,
  };
}

describe('esGanador', () => {
  it('detecta proveedor_seleccionado booleano', () => {
    expect(esGanador(prov({ proveedor_seleccionado: true }))).toBe(true);
  });

  it('detecta proveedor_seleccionado numérico (1)', () => {
    expect(esGanador(prov({ proveedor_seleccionado: 1 }))).toBe(true);
  });

  it('detecta seleccion.proveedor_seleccionado anidado', () => {
    expect(esGanador(prov({ seleccion: { proveedor_seleccionado: true, motivo_seleccion: null, criterio_seleccion: null } }))).toBe(true);
  });

  it('detecta estado_por_comprador === "1" (señal observada en la API real)', () => {
    expect(esGanador(prov({ estado_por_comprador: '1' }))).toBe(true);
  });

  it('detecta motivo/criterio de selección presente', () => {
    expect(esGanador(prov({ seleccion: { proveedor_seleccionado: false, motivo_seleccion: 'mejor precio', criterio_seleccion: null } }))).toBe(true);
  });

  it('retorna false cuando no hay ninguna señal de adjudicación', () => {
    expect(esGanador(prov())).toBe(false);
    expect(esGanador(prov({ proveedor_seleccionado: 0, estado_por_comprador: null }))).toBe(false);
  });
});

describe('extraerPrecioUnitario', () => {
  it('retorna null cuando no hay productos cotizados', () => {
    expect(extraerPrecioUnitario(prov())).toBeNull();
  });

  it('retorna el unitario de un único producto', () => {
    const p = prov({ productos_cotizados: [{ codigo_producto: 1, nombre_producto: 'Resma', descripcion: null, cantidad: 10, precio_unitario: 2500, monto_total_producto: 25000 }] });
    expect(extraerPrecioUnitario(p)).toBe(2500);
  });

  it('casa la keyword entre varios productos', () => {
    const p = prov({ productos_cotizados: [
      { codigo_producto: 1, nombre_producto: 'Toner negro', descripcion: null, cantidad: 1, precio_unitario: 40000, monto_total_producto: 40000 },
      { codigo_producto: 2, nombre_producto: 'Resma papel', descripcion: null, cantidad: 5, precio_unitario: 2600, monto_total_producto: 13000 },
    ] });
    expect(extraerPrecioUnitario(p, 'resma')).toBe(2600);
  });

  it('ignora precios unitarios no válidos (0 o null) y cae al siguiente', () => {
    const p = prov({ productos_cotizados: [
      { codigo_producto: 1, nombre_producto: 'A', descripcion: null, cantidad: 1, precio_unitario: 0, monto_total_producto: 0 },
      { codigo_producto: 2, nombre_producto: 'B', descripcion: null, cantidad: 1, precio_unitario: 999, monto_total_producto: 999 },
    ] });
    expect(extraerPrecioUnitario(p)).toBe(999);
  });
});

describe('extraerMontoNeto', () => {
  it('prefiere valor_neto sobre monto_total', () => {
    expect(extraerMontoNeto(prov({ valor_neto: 10000, monto_total: 11900 }))).toBe(10000);
  });

  it('cae a monto_total si no hay valor_neto', () => {
    expect(extraerMontoNeto(prov({ valor_neto: null, monto_total: 11900 }))).toBe(11900);
  });

  it('retorna null si ambos son inválidos', () => {
    expect(extraerMontoNeto(prov({ valor_neto: null, monto_total: null }))).toBeNull();
    expect(extraerMontoNeto(prov({ valor_neto: 0, monto_total: 0 }))).toBeNull();
  });
});
