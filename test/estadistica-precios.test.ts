import { describe, it, expect } from 'vitest';
import {
  calcularEstadisticas, percentil, extraerPrecioUnitario, extraerMontoNeto, esAdmisible,
} from '../src/utils/quotation.js';
import type { ProveedorCotizando } from '../src/api/compra-agil-client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Exactitud del cálculo estadístico sobre una muestra fija de cotizaciones.
 *
 * El archivo tiene dos mitades, y la distinción importa:
 *
 *   1. Una muestra SINTÉTICA con valores elegidos para que sus estadísticos se
 *      puedan calcular a mano. Sirve para cubrir casos límite que rara vez
 *      aparecen juntos en datos reales —n par e impar, muestra de un elemento,
 *      valores atípicos, precios nulos o negativos—.
 *
 *   2. Una muestra REAL capturada de la API (ver el último bloque y
 *      `fixtures/cotizaciones-reales.json`). Comprueba lo que la sintética no
 *      puede: que sobre una respuesta genuina, con su forma y sus valores tal
 *      como llegan, la extracción y el cálculo den lo mismo que hacerlo a mano.
 *
 * Los estadísticos de ambas están verificados contra aritmética manual, no
 * copiados de la salida del código —que sería tautológico—. Se validaron por
 * mutación: alterar el índice de la mediana o calcular el p25 como p75 rompe
 * varios de estos tests.
 */

/** Cotización con la forma real de la API. */
function cotizacion(over: Partial<ProveedorCotizando> = {}): ProveedorCotizando {
  return {
    rut_proveedor: '76.000.000-0',
    razon_social: 'Proveedor de prueba',
    es_emt: true,
    justificacion_inadmisibilidad: null,
    ...over,
  } as ProveedorCotizando;
}

/** Cotización de un solo producto con precio unitario conocido. */
function conPrecio(precio: number, nombre = 'Computador de escritorio'): ProveedorCotizando {
  return cotizacion({
    productos_cotizados: [{
      codigo_producto: 43211507,
      nombre_producto: nombre,
      descripcion: null,
      cantidad: 1,
      precio_unitario: precio,
      monto_total_producto: precio,
    }],
  });
}

/**
 * Muestra fija: nueve precios unitarios cuyos estadísticos se pueden calcular
 * a mano, para que el test compruebe el cálculo y no se limite a repetirlo.
 *
 * Ordenados: 100.000 · 150.000 · 200.000 · 250.000 · 300.000 · 350.000 ·
 *            400.000 · 450.000 · 900.000
 *   n = 9 · mínimo 100.000 · máximo 900.000
 *   mediana = valor central (5º) = 300.000
 *   promedio = 3.100.000 / 9 = 344.444,44… → 344.444
 *   p25 por interpolación: pos = 0,25 × 8 = 2 → exacto en el 3º = 200.000
 */
const PRECIOS = [300_000, 100_000, 900_000, 250_000, 150_000, 400_000, 200_000, 450_000, 350_000];

describe('calcularEstadisticas — exactitud sobre una muestra conocida', () => {
  const stats = calcularEstadisticas(PRECIOS)!;

  it('cuenta todas las muestras', () => {
    expect(stats.muestras).toBe(9);
  });

  it('mínimo y máximo son los extremos reales', () => {
    expect(stats.minimo).toBe(100_000);
    expect(stats.maximo).toBe(900_000);
  });

  it('la mediana es el valor central, no el promedio', () => {
    expect(stats.mediana).toBe(300_000);
    expect(stats.mediana).not.toBe(stats.promedio);
  });

  it('el promedio coincide con la suma dividida por n', () => {
    const suma = PRECIOS.reduce((a, b) => a + b, 0);
    expect(suma).toBe(3_100_000);
    expect(stats.promedio).toBe(Math.round(suma / PRECIOS.length));
    expect(stats.promedio).toBe(344_444);
  });

  it('el p25 deja un cuarto de la muestra por debajo', () => {
    expect(stats.p25).toBe(200_000);
    const pordebajo = PRECIOS.filter((p) => p < stats.p25).length;
    expect(pordebajo).toBe(2); // 2 de 9 ≈ 22%, el cuartil inferior
  });

  it('el p25 es menor que la mediana: posiciona la oferta más barato', () => {
    expect(stats.p25).toBeLessThan(stats.mediana);
  });

  it('el orden de entrada no altera el resultado', () => {
    const alreves = calcularEstadisticas([...PRECIOS].reverse())!;
    expect(alreves).toEqual(stats);
  });

  it('no muta el arreglo que recibe', () => {
    const original = [...PRECIOS];
    calcularEstadisticas(PRECIOS);
    expect(PRECIOS).toEqual(original);
  });
});

describe('calcularEstadisticas — casos límite', () => {
  it('una muestra vacía devuelve null, para distinguir "sin datos" de "cero"', () => {
    expect(calcularEstadisticas([])).toBeNull();
  });

  it('con un solo precio, todos los estadísticos son ese precio', () => {
    const s = calcularEstadisticas([120_000])!;
    expect(s.minimo).toBe(120_000);
    expect(s.maximo).toBe(120_000);
    expect(s.mediana).toBe(120_000);
    expect(s.promedio).toBe(120_000);
    expect(s.p25).toBe(120_000);
  });

  it('con n par, la mediana promedia los dos centrales', () => {
    // [100, 200, 300, 400] → (200 + 300) / 2 = 250
    expect(calcularEstadisticas([100, 200, 300, 400])!.mediana).toBe(250);
  });

  it('un valor atípico dispara el máximo pero casi no mueve la mediana', () => {
    const conOutlier = calcularEstadisticas([...PRECIOS, 50_000_000])!;
    expect(conOutlier.maximo).toBe(50_000_000);
    expect(conOutlier.mediana).toBe(325_000); // apenas se desplaza
    expect(conOutlier.promedio).toBeGreaterThan(5_000_000); // el promedio sí se destruye
  });
});

describe('percentil — interpolación lineal', () => {
  it('el percentil 0 es el mínimo y el 100 el máximo', () => {
    const ord = [...PRECIOS].sort((a, b) => a - b);
    expect(percentil(ord, 0)).toBe(100_000);
    expect(percentil(ord, 100)).toBe(900_000);
  });

  it('el percentil 50 coincide con la mediana en n impar', () => {
    const ord = [...PRECIOS].sort((a, b) => a - b);
    expect(percentil(ord, 50)).toBe(300_000);
  });

  it('interpola cuando la posición cae entre dos valores', () => {
    // [100, 200]: pos = 0,5 × 1 = 0,5 → 100 + (200-100) × 0,5 = 150
    expect(percentil([100, 200], 50)).toBe(150);
  });

  it('una serie vacía devuelve 0 y una de un elemento, ese elemento', () => {
    expect(percentil([], 25)).toBe(0);
    expect(percentil([42], 25)).toBe(42);
  });
});

describe('extracción de precios — la forma real de la API', () => {
  it('toma el precio unitario de productos_cotizados, no el monto total', () => {
    const p = cotizacion({
      valor_neto: 999_999,
      productos_cotizados: [{
        codigo_producto: 1, nombre_producto: 'Computador', descripcion: null,
        cantidad: 10, precio_unitario: 250_000, monto_total_producto: 2_500_000,
      }],
    });
    expect(extraerPrecioUnitario(p)).toBe(250_000);
  });

  it('no confunde precio unitario con monto neto total', () => {
    const p = cotizacion({ valor_neto: 2_500_000, productos_cotizados: [] });
    expect(extraerPrecioUnitario(p)).toBeNull();
    expect(extraerMontoNeto(p)).toBe(2_500_000);
  });

  it('con varios productos, elige el que coincide con la búsqueda', () => {
    const p = cotizacion({
      productos_cotizados: [
        { codigo_producto: 1, nombre_producto: 'Cable de red', descripcion: null, cantidad: 1, precio_unitario: 3_000, monto_total_producto: 3_000 },
        { codigo_producto: 2, nombre_producto: 'Computador de escritorio', descripcion: null, cantidad: 1, precio_unitario: 400_000, monto_total_producto: 400_000 },
      ],
    });
    expect(extraerPrecioUnitario(p, 'computador')).toBe(400_000);
  });

  it('descarta precios nulos, cero o negativos', () => {
    for (const malo of [null, 0, -5000]) {
      const p = cotizacion({
        productos_cotizados: [{
          codigo_producto: 1, nombre_producto: 'X', descripcion: null,
          cantidad: 1, precio_unitario: malo as any, monto_total_producto: null,
        }],
      });
      expect(extraerPrecioUnitario(p)).toBeNull();
    }
  });

  it('las inadmisibles SÍ aportan precio: son señal de mercado igual', () => {
    const p = conPrecio(180_000);
    p.justificacion_inadmisibilidad = 'No cumple con la garantía solicitada.';
    expect(esAdmisible(p)).toBe(false);
    expect(extraerPrecioUnitario(p)).toBe(180_000);
  });
});

describe('control de dispersión — la regla que usa la herramienta', () => {
  // analizar_precios_mercado advierte cuando maximo / mediana > 10, porque
  // entonces el término de búsqueda está mezclando productos incomparables.
  const dispersion = (v: number[]) => {
    const s = calcularEstadisticas(v)!;
    return s.maximo / s.mediana;
  };

  it('una muestra homogénea NO supera el umbral', () => {
    expect(dispersion(PRECIOS)).toBeLessThanOrEqual(10);
  });

  it('mezclar cables con servidores SÍ lo supera', () => {
    expect(dispersion([3_000, 5_000, 4_000, 8_000, 5_000_000])).toBeGreaterThan(10);
  });
});

/**
 * Verificación sobre DATOS REALES, no sintéticos.
 *
 * Los bloques anteriores comprueban la aritmética con una muestra construida a
 * medida. Este comprueba lo que faltaba: que sobre una respuesta real de la API
 * —con su forma, sus tipos y sus valores tal como llegan— la extracción y el
 * cálculo den lo mismo que hacerlo a mano.
 *
 * La muestra se capturó el 8 de septiembre de 2026 del proceso
 * 1057491-1711-COT26 (insumos para crioablación, Hospital Luis Calvo Mackenna,
 * segundo llamado). Costó tres intentos: la API devolvía HTTP 504 de forma
 * intermitente. Son datos públicos, visibles en la ficha del proceso.
 */
describe('estadística sobre una muestra REAL de la API', () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/cotizaciones-reales.json'), 'utf8')
  );
  const provs = fixture.proveedores_cotizando as ProveedorCotizando[];
  const precios = provs
    .map((p) => extraerPrecioUnitario(p))
    .filter((v): v is number => v !== null);

  it('extrae un precio de cada una de las 6 cotizaciones', () => {
    expect(provs).toHaveLength(6);
    expect(precios).toHaveLength(6);
  });

  it('los precios son los que devolvió la API, sin transformar', () => {
    expect([...precios].sort((a, b) => a - b)).toEqual([
      3_400_000, 3_473_977, 4_206_806, 4_906_218, 4_968_235, 5_023_361,
    ]);
  });

  it('los estadísticos coinciden con el cálculo a mano', () => {
    const s = calcularEstadisticas(precios)!;
    // Verificados uno a uno contra la aritmética manual:
    //   suma = 25.978.597 · n = 6 (par)
    //   mediana = (4.206.806 + 4.906.218) / 2 = 4.556.512
    //   promedio = 25.978.597 / 6 = 4.329.766,17 → 4.329.766
    //   p25: pos = 0,25 × 5 = 1,25 → 3.473.977 + (4.206.806 − 3.473.977) × 0,25
    expect(s.muestras).toBe(6);
    expect(s.minimo).toBe(3_400_000);
    expect(s.maximo).toBe(5_023_361);
    expect(s.mediana).toBe(4_556_512);
    expect(s.promedio).toBe(4_329_766);
    expect(s.p25).toBe(3_657_184);
  });

  it('el p25 posiciona por debajo de la mediana y del promedio', () => {
    const s = calcularEstadisticas(precios)!;
    expect(s.p25).toBeLessThan(s.mediana);
    expect(s.p25).toBeLessThan(s.promedio);
  });

  it('no advierte dispersión: es un rubro homogéneo', () => {
    const s = calcularEstadisticas(precios)!;
    expect(s.maximo / s.mediana).toBeLessThan(10);
  });

  it('con cantidad 1, el monto neto coincide con el precio unitario', () => {
    for (const p of provs) {
      expect(p.productos_cotizados?.[0].cantidad).toBe(1);
      expect(extraerMontoNeto(p)).toBe(extraerPrecioUnitario(p));
    }
  });

  it('monto_total incluye el IVA sobre el neto (19%)', () => {
    for (const p of provs) {
      const esperado = Math.round(p.valor_neto! * 1.19);
      // Tolerancia de $1 por el redondeo que aplique el portal.
      expect(Math.abs(p.monto_total! - esperado)).toBeLessThanOrEqual(1);
    }
  });

  it('⚠ en este proceso NINGUNA cotización es inadmisible', () => {
    // Contrasta con los procesos `desierta`, donde casi todas lo son: es lo
    // que los deja desiertos. Aquí, un segundo llamado con 6 ofertas válidas,
    // la muestra es limpia. La nota metodológica de analizar_precios_mercado
    // habla de las desiertas, no de este caso.
    expect(provs.every((p) => esAdmisible(p))).toBe(true);
  });
});
