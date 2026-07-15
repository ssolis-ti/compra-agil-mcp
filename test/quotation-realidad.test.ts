/**
 * Tests de regresión sobre la REALIDAD medida de la API (julio 2026).
 *
 * Cada aserción aquí codifica un hecho verificado empíricamente contra el
 * servicio real. Si alguien "corrige" el código para volver a confiar en la
 * documentación oficial, estos tests fallan y explican por qué.
 */

import { describe, it, expect } from 'vitest';
import {
  esGanador, esAdmisible, extraerPrecioUnitario, extraerMontoNeto,
  calcularEstadisticas, percentil,
} from '../src/utils/quotation.js';
import type { ProveedorCotizando } from '../src/api/compra-agil-client.js';

/**
 * Cotización con la forma REAL observada en la API (proceso 758-329-COT26).
 * Nótese lo que NO viene: `seleccion`, `estado_cotizacion`.
 * Y que `proveedor_seleccionado` es un NÚMERO, no un booleano.
 */
function cotizacionReal(over: Partial<ProveedorCotizando> = {}): ProveedorCotizando {
  return {
    rut_proveedor: '76.111.111-1',
    razon_social: 'INVERSIONES Y PROYECTOS SPA',
    es_emt: true,
    id_cotizacion: 12345,
    proveedor_seleccionado: 0,     // ← siempre 0 en la API real
    estado_por_comprador: null,
    activo: null,
    valor_neto: 378150,
    total_impuesto: 71849,
    monto_total: 449999,
    justificacion_inadmisibilidad: null,
    productos_cotizados: [{
      codigo_producto: 40151532,
      nombre_producto: 'Bombas de combustible',
      descripcion: 'Servicio de reparación',
      cantidad: 1,
      precio_unitario: 378150,
      monto_total_producto: 378150,
    }],
    ...over,
  };
}

describe('esGanador — comportamiento con datos reales de la API', () => {
  it('retorna FALSE con la forma real: proveedor_seleccionado siempre vale 0', () => {
    // Hecho medido: 52/52 cotizaciones tenían proveedor_seleccionado = 0.
    expect(esGanador(cotizacionReal())).toBe(false);
  });

  it('sigue detectando al ganador si la API alguna vez publica proveedor_seleccionado=1', () => {
    // La lógica es correcta; simplemente el dato no existe hoy.
    expect(esGanador(cotizacionReal({ proveedor_seleccionado: 1 }))).toBe(true);
  });

  it('no depende de `seleccion`, que NO existe en la respuesta real', () => {
    const real = cotizacionReal();
    expect(real.seleccion).toBeUndefined();
    expect(() => esGanador(real)).not.toThrow();
  });
});

describe('esAdmisible — separa cotizaciones descartadas por el comprador', () => {
  it('una cotización sin justificación de inadmisibilidad es admisible', () => {
    expect(esAdmisible(cotizacionReal())).toBe(true);
  });

  it('detecta la inadmisibilidad con el texto real observado en la API', () => {
    const rechazada = cotizacionReal({
      justificacion_inadmisibilidad: 'Oferta no cumple con garantia solicitada',
    });
    expect(esAdmisible(rechazada)).toBe(false);
  });

  it('trata una justificación en blanco como admisible', () => {
    expect(esAdmisible(cotizacionReal({ justificacion_inadmisibilidad: '   ' }))).toBe(true);
  });
});

describe('extraerPrecioUnitario — con la forma real de productos_cotizados', () => {
  it('extrae el precio unitario real observado', () => {
    expect(extraerPrecioUnitario(cotizacionReal())).toBe(378150);
  });

  it('extraerMontoNeto prefiere valor_neto sobre monto_total', () => {
    // En el dato real: neto 378150 vs total 449999 (total incluye impuestos).
    expect(extraerMontoNeto(cotizacionReal())).toBe(378150);
  });
});

describe('percentil', () => {
  it('p25 sobre una serie conocida', () => {
    expect(percentil([100, 200, 300, 400, 500], 25)).toBe(200);
  });

  it('interpola cuando la posición cae entre dos valores', () => {
    expect(percentil([100, 200], 50)).toBe(150);
  });

  it('maneja series de un solo elemento y vacías', () => {
    expect(percentil([42], 25)).toBe(42);
    expect(percentil([], 25)).toBe(0);
  });
});

describe('calcularEstadisticas', () => {
  it('calcula la distribución completa incluyendo p25', () => {
    const s = calcularEstadisticas([500, 100, 300, 200, 400])!;
    expect(s).toMatchObject({ muestras: 5, minimo: 100, maximo: 500, promedio: 300, mediana: 300, p25: 200 });
  });

  it('retorna null sin datos — distingue "sin muestra" de "cero"', () => {
    expect(calcularEstadisticas([])).toBeNull();
  });

  it('no muta el arreglo de entrada', () => {
    const original = [300, 100, 200];
    calcularEstadisticas(original);
    expect(original).toEqual([300, 100, 200]);
  });
});
