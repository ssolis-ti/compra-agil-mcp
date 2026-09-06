import { describe, it, expect } from 'vitest';
import { estimarPrecioUnitario, PRECIO_PLACEHOLDER } from '../src/tools/generar-borrador.js';
import type { CompraAgilDetalle } from '../src/api/compra-agil-client.js';

/**
 * Regresión del defecto encontrado en auditoría: la consulta de precios de
 * mercado y el respaldo por presupuesto vivían en el mismo try/catch, así que
 * un 429 durante la consulta hacía que el borrador saliera con $1.000 aunque
 * el presupuesto del comprador ya estuviera disponible en el detalle.
 */

const detalleBase = (over: Partial<CompraAgilDetalle> = {}): CompraAgilDetalle => ({
  codigo: '5519-136-COT26',
  nombre: 'Compra de 2 computadores de alto rendimiento',
  descripcion: '',
  estado: { id_estado: 2, codigo: 'publicada', glosa: 'Publicada' },
  convocatoria: {
    estado_convocatoria: 1, descripcion: 'Primer llamado',
    fecha_cierre_primer_llamado: null, fecha_cierre_segundo_llamado: null,
  },
  fechas: {
    fecha_publicacion: '', fecha_cierre: '',
    fecha_ultimo_cambio: '', fecha_cancelacion: null,
  },
  entrega: { direccion_entrega: '', plazo_entrega_dias: 5 },
  documentos: [],
  presupuesto: {
    tipo_presupuesto: 'Estimado', moneda: 'CLP', presupuesto_estimado: 4_800_000,
    monto_disponible: 4_800_000, monto_disponible_clp: 4_800_000,
    valor_cambio_moneda: null, fecha_cambio_moneda: null,
  },
  institucion: {
    organismo_comprador: 'UNIVERSIDAD DE CHILE', rut: '60.910.000-1',
    unidad_compra: '', region: 13, nombre_region: 'RM',
  },
  productos_solicitados: [
    { codigo_producto: 32101637, nombre: 'Procesadores de red', descripcion: null, cantidad: 2, unidad_medida: 'EA' },
  ],
  proveedores_cotizando: [],
  resumen: { multa_sancion: null, total_ofertas_recibidas: 0, total_demandas: 0 },
  motivos: { motivo_cancelacion: null, motivo_desierta: null },
  flags: {
    considera_requisitos_medioambientales: false,
    considera_requisitos_impacto_social_economico: false,
  },
  ...over,
});

/** Cliente que revienta, como cuando se agota la cuota diaria. */
const clienteQueFalla = {
  buscar: async () => { throw new Error('429 cuota agotada'); },
  detalle: async () => { throw new Error('429 cuota agotada'); },
} as any;

/** Cliente que responde, pero sin procesos comparables. */
const clienteSinResultados = {
  buscar: async () => ({ items: [], paginacion: { total_paginas: 0, numero_pagina: 1, tamano_pagina: 50, total_resultados: 0 } }),
  detalle: async () => { throw new Error('no debería llamarse'); },
} as any;

describe('estimarPrecioUnitario — el precio ingresado manda', () => {
  it('usa el precio del usuario sin consultar la API', async () => {
    const e = await estimarPrecioUnitario(clienteQueFalla, detalleBase(), 850_000);
    expect(e.precio).toBe(850_000);
    expect(e.sugerido).toBe(true);
    expect(e.fuente).toMatch(/ingresado por el usuario/);
  });

  it('ignora un precio inválido y sigue estimando', async () => {
    const e = await estimarPrecioUnitario(clienteSinResultados, detalleBase(), 0);
    expect(e.precio).not.toBe(0);
  });
});

describe('estimarPrecioUnitario — respaldo por presupuesto (el defecto)', () => {
  it('si la API falla, USA el presupuesto en vez de caer al placeholder', async () => {
    const e = await estimarPrecioUnitario(clienteQueFalla, detalleBase());
    // 4.800.000 * 0,9 / 2 unidades
    expect(e.precio).toBe(2_160_000);
    expect(e.sugerido).toBe(true);
    expect(e.precio).not.toBe(PRECIO_PLACEHOLDER);
  });

  it('si no hay comparables, también usa el presupuesto', async () => {
    const e = await estimarPrecioUnitario(clienteSinResultados, detalleBase());
    expect(e.precio).toBe(2_160_000);
    expect(e.fuente).toMatch(/presupuesto del comprador/i);
  });

  it('reparte el presupuesto entre la cantidad total solicitada', async () => {
    const d = detalleBase({
      productos_solicitados: [
        { codigo_producto: 1, nombre: 'A', descripcion: null, cantidad: 3, unidad_medida: 'EA' },
        { codigo_producto: 2, nombre: 'B', descripcion: null, cantidad: 5, unidad_medida: 'EA' },
      ],
    });
    const e = await estimarPrecioUnitario(clienteQueFalla, d);
    expect(e.precio).toBe(Math.round((4_800_000 * 0.9) / 8));
  });

  it('cae al presupuesto_estimado cuando los montos disponibles vienen nulos', async () => {
    const d = detalleBase({
      presupuesto: {
        tipo_presupuesto: 'Estimado', moneda: 'CLP', presupuesto_estimado: 4_800_000,
        monto_disponible: null, monto_disponible_clp: null,
        valor_cambio_moneda: null, fecha_cambio_moneda: null,
      },
    });
    const e = await estimarPrecioUnitario(clienteQueFalla, d);
    expect(e.precio).toBe(2_160_000);
  });
});

describe('estimarPrecioUnitario — placeholder solo como último recurso', () => {
  it('sin presupuesto ni cotizaciones, avisa que es placeholder', async () => {
    const d = detalleBase({
      presupuesto: {
        tipo_presupuesto: 'Estimado', moneda: 'CLP', presupuesto_estimado: null,
        monto_disponible: null, monto_disponible_clp: null,
        valor_cambio_moneda: null, fecha_cambio_moneda: null,
      },
    });
    const e = await estimarPrecioUnitario(clienteQueFalla, d);
    expect(e.precio).toBe(PRECIO_PLACEHOLDER);
    expect(e.sugerido).toBe(false);
  });
});

describe('estimarPrecioUnitario — precios de mercado cuando existen', () => {
  it('prefiere el percentil 25 de lo cotizado por sobre el presupuesto', async () => {
    const cliente = {
      buscar: async () => ({
        items: [{ codigo: 'X-1-COT26' }],
        paginacion: { total_paginas: 1, numero_pagina: 1, tamano_pagina: 50, total_resultados: 1 },
      }),
      detalle: async () => ({
        proveedores_cotizando: [
          { productos_cotizados: [{ nombre_producto: 'Procesadores de red', precio_unitario: 100_000, cantidad: 1, codigo_producto: 1, descripcion: null, monto_total_producto: 100_000 }] },
          { productos_cotizados: [{ nombre_producto: 'Procesadores de red', precio_unitario: 200_000, cantidad: 1, codigo_producto: 1, descripcion: null, monto_total_producto: 200_000 }] },
        ],
      }),
    } as any;

    const e = await estimarPrecioUnitario(cliente, detalleBase());
    expect(e.fuente).toMatch(/percentil 25/);
    expect(e.precio).toBeLessThan(2_160_000);
  });
});
