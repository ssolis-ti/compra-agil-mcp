import { describe, it, expect, vi, afterEach } from 'vitest';
import { recolectarDatosPrecios } from '../src/tools/analizar-precios-mercado.js';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { ResponseCache } from '../src/utils/cache.js';

/**
 * S9 de la simulación con agentes (6-oct): el analista gastó 2 llamadas en
 * averiguar qué proceso había fallado, recibió `muestra_homogenea: true` con
 * 4 precios de un solo comprador, y una repetición servida desde caché no lo
 * decía.
 */

const cot = (unitario: number) => ({
  rut_proveedor: '1-9', razon_social: `Prov ${unitario}`, es_emt: false, valor_neto: unitario,
  productos_cotizados: [{ nombre_producto: 'Toner', cantidad: 1, precio_unitario: unitario }],
});
const proceso = (codigo: string, institucion: string, precios: number[]) => ({
  codigo, estado: { codigo: 'desierta', glosa: 'Desierta' },
  institucion: { organismo_comprador: institucion }, proveedores_cotizando: precios.map(cot),
});

function cliente(procesos: Array<ReturnType<typeof proceso> | null>, codigos: string[]) {
  return {
    buscar: async () => ({
      items: codigos.map((codigo) => ({ codigo })),
      paginacion: { total_paginas: 1, numero_pagina: 1, tamano_pagina: 10, total_resultados: codigos.length },
    }),
    detalle: async () => { throw new Error('no'); },
    detallesEnParalelo: async () => procesos,
  };
}

describe('analizar_precios_mercado: información para decidir (S9)', () => {
  it('nombra los procesos cuyo detalle falló, con su ficha', async () => {
    const c = cliente([proceso('A-1-COT26', 'Hospital', [53_135, 54_628, 58_520, 66_726]), null], ['A-1-COT26', '3851-115-COT26']);
    const rec = await recolectarDatosPrecios(c as never, { q: 'toner' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.cobertura.procesos_que_fallaron_detalle).toEqual([
      { codigo: '3851-115-COT26', ficha: 'https://buscador.mercadopublico.cl/ficha?code=3851-115-COT26' },
    ]);
    expect(rec.datos.cobertura._aviso_cobertura).toContain('3851-115-COT26');
  });

  it('4 precios de un solo comprador: homogénea, pero suficiencia baja y lo dice', async () => {
    const c = cliente([proceso('A-1-COT26', 'Hospital', [53_135, 54_628, 58_520, 66_726])], ['A-1-COT26']);
    const rec = await recolectarDatosPrecios(c as never, { q: 'toner' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.muestra_homogenea).toBe(true);
    expect(rec.datos.suficiencia_muestra).toMatchObject({ nivel: 'baja', procesos_con_cotizaciones: 1, compradores_distintos: 1, precios_unitarios: 4 });
    expect(rec.datos.criterio_sugerencia).toMatch(/^⚠ Muestra chica/);
  });

  it('una muestra amplia y variada es suficiente', async () => {
    const procs = [1, 2, 3, 4].map((i) => proceso(`P-${i}-COT26`, `Comprador ${i}`, [100 + i, 110 + i, 120 + i]));
    const rec = await recolectarDatosPrecios(cliente(procs, procs.map((p) => p.codigo)) as never, { q: 'toner' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.suficiencia_muestra.nivel).toBe('suficiente');
    expect(rec.datos.criterio_sugerencia).not.toMatch(/Muestra chica/);
  });
});

describe('frescura: una respuesta desde caché lo dice', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('ResponseCache.edad cuenta desde que se guardó y no cuenta como acierto', () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T12:00:00Z') });
    const cache = new ResponseCache();
    cache.guardar('k', 1, 300);
    vi.advanceTimersByTime(90_000);
    expect(cache.edad('k')).toBe(90);
    expect(cache.edad('otra')).toBeUndefined();
    expect(cache.estadisticas().aciertos).toBe(0);
    vi.advanceTimersByTime(300_000);
    expect(cache.edad('k')).toBeUndefined();
  });

  it('la segunda corrida del mismo análisis informa la antigüedad; la primera no', async () => {
    const desierta = proceso('A-1-COT26', 'Hospital', [100, 200, 300]);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({
        success: 'OK',
        payload: new URL(url).pathname === '/v2/compra-agil'
          ? { items: [{ codigo: 'A-1-COT26' }], paginacion: { total_paginas: 1, numero_pagina: 1, tamano_pagina: 10, total_resultados: 1 } }
          : desierta,
      }),
    })));
    const client = new CompraAgilClient('TICKET-TEST');
    const primera = await recolectarDatosPrecios(client, { q: 'toner' });
    const segunda = await recolectarDatosPrecios(client, { q: 'toner' });
    if (primera.kind !== 'datos' || segunda.kind !== 'datos') throw new Error('se esperaban datos');
    expect(primera.datos._frescura).toBeUndefined();
    expect(segunda.datos._frescura).toMatch(/^La búsqueda de históricos salió de la caché local \(guardada hace \d+ s\)/);
  });
});
