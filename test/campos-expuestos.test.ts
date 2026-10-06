import { describe, it, expect } from 'vitest';
import type { CompraAgilDetalle, CompraAgilItem, ProveedorCotizando } from '../src/api/compra-agil-client.js';
import { resumirCompraBusqueda } from '../src/tools/buscar-compras.js';
import { fechasDeDetalle, presupuestoDeDetalle, resumirCotizante, ordenCompraDeDetalle } from '../src/tools/detalle-compra.js';

function item(motivo: string | null = null): CompraAgilItem {
  return {
    codigo: '1234-56-COT26',
    nombre: 'Compra de prueba',
    estado: { id_estado: 2, codigo: 'publicada', glosa: 'Publicada' },
    convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado' },
    documentos: [],
    fechas: {
      fecha_publicacion: '2026-09-10 09:00',
      fecha_cierre: '2026-09-11 12:00',
      fecha_ultimo_cambio: '2026-09-10T09:00:00Z',
      fecha_cancelacion: null,
    },
    montos: { moneda: 'CLP', monto_disponible: 1_000_000, monto_disponible_clp: 1_000_000 },
    institucion: {
      organismo_comprador: 'ORGANISMO',
      rut: '60.000.000-0',
      unidad_compra: '',
      region: 13,
      nombre_region: 'RM',
    },
    resumen: { total_ofertas_recibidas: 0 },
    motivos: { motivo_cancelacion: null, motivo_desierta: null, motivo_seleccion: motivo },
    links: { detalle: '' },
  };
}

function presupuesto(moneda: string): CompraAgilDetalle['presupuesto'] {
  return {
    tipo_presupuesto: 'estimado',
    moneda,
    presupuesto_estimado: 1000,
    monto_disponible: 1000,
    monto_disponible_clp: 950000,
    valor_cambio_moneda: moneda.trim().toUpperCase() === 'CLP' ? null : 950,
    fecha_cambio_moneda: moneda.trim().toUpperCase() === 'CLP' ? null : '2026-09-01',
  };
}

function cotizante(justificacion: string | null): ProveedorCotizando {
  return {
    rut_proveedor: '76.123.456-7',
    razon_social: 'Proveedor',
    es_emt: true,
    monto_total: 100,
    valor_neto: 84,
    total_impuesto: 16,
    monto_despacho: 0,
    descripcion: 'oferta',
    estado_por_comprador: null,
    justificacion_inadmisibilidad: justificacion,
    proveedor_seleccionado: 0,
  };
}

describe('buscar expone RUT, último cambio y el motivo solo si hay texto', () => {
  it('trae el RUT del organismo y el último cambio con su lectura en hora de Chile', () => {
    const r = resumirCompraBusqueda(item());
    expect(r.rut_organismo).toBe('60.000.000-0');
    expect(r.fecha_ultimo_cambio).toBe('2026-09-10T09:00:00Z');
    expect(r.fecha_ultimo_cambio_hora_chile).toBe('2026-09-10 09:00');
    expect(r).not.toHaveProperty('motivo_seleccion');
    expect(r.estado_codigo).toBe('publicada');
    expect(r.estado_convocatoria).toBe(1);
    expect(r.tipo_cambio).toBeNull();
    expect(r.tipo_cambio_nota).toMatch(/CLP/);
    expect(r.fecha_publicacion_hora_chile).toBe('2026-09-10 09:00');
    expect(r._nota_ofertas).toMatch(/listado informa 0 ofertas/);
  });

  it('omite un motivo vacío o en blanco', () => {
    expect(resumirCompraBusqueda(item('   '))).not.toHaveProperty('motivo_seleccion');
  });

  it('incluye el motivo cuando la API lo envió', () => {
    expect(resumirCompraBusqueda(item('menor precio')).motivo_seleccion).toBe('menor precio');
  });
});

describe('detalle expone estado, llamado, tipo de cambio e inadmisibilidad', () => {
  it('el último cambio viaja junto al cierre', () => {
    const base = item();
    const r = fechasDeDetalle({
      fechas: base.fechas,
      convocatoria: {
        estado_convocatoria: 2,
        descripcion: 'Segundo llamado',
        fecha_cierre_primer_llamado: null,
        fecha_cierre_segundo_llamado: '2026-09-11T12:00:00Z',
      },
    });
    expect(r.ultimo_cambio).toBe('2026-09-10T09:00:00Z');
    expect(r.ultimo_cambio_hora_chile).toBe('2026-09-10 09:00');
  });

  it('en CLP no agrega el tipo de cambio', () => {
    const r = presupuestoDeDetalle(presupuesto(' clp '));
    expect(r.moneda).toBe(' clp ');
    expect(r).not.toHaveProperty('valor_cambio_moneda');
    expect(r).not.toHaveProperty('fecha_cambio_moneda');
  });

  it('en otra moneda sí lo agrega', () => {
    const r = presupuestoDeDetalle(presupuesto('USD'));
    expect(r).toMatchObject({ valor_cambio_moneda: 950, fecha_cambio_moneda: '2026-09-01' });
  });

  it('una cotización admisible no trae justificación ni al ganador', () => {
    const r = resumirCotizante(cotizante(null));
    expect(r.admisible).toBe(true);
    expect(r).not.toHaveProperty('justificacion_inadmisibilidad');
    expect(r).not.toHaveProperty('proveedor_seleccionado');
  });

  it('una cotización inadmisible trae el texto y nada más', () => {
    const r = resumirCotizante(cotizante('  no acompaña garantía  '));
    expect(r.admisible).toBe(false);
    expect(r.justificacion_inadmisibilidad).toBe('no acompaña garantía');
    expect(r).not.toHaveProperty('proveedor_seleccionado');
  });
});

describe('orden de compra en el detalle (S18)', () => {
  it('sin id de OC es null —no informado—, no false', () => {
    expect(ordenCompraDeDetalle({ id_orden_compra: null, orden_compra: undefined } as never).tiene_oc).toBeNull();
  });

  it('con id de OC es true', () => {
    const oc = ordenCompraDeDetalle({ id_orden_compra: 123, orden_compra: undefined } as never);
    expect(oc).toMatchObject({ tiene_oc: true, id_orden_compra: 123 });
  });
});

describe('notas en la fila de la búsqueda (enjambre, 6-oct)', () => {
  it('E9: un motivo de selección trae su nota en la misma fila', () => {
    const r = resumirCompraBusqueda(item('El proveedor cotizó todos los productos y su precio total fue el más bajo.'));
    expect(r._nota_motivo).toMatch(/no prueba que haya un proveedor adjudicado/);
  });

  it('sin motivo no hay nota', () => {
    expect(resumirCompraBusqueda(item())).not.toHaveProperty('_nota_motivo');
  });

  it('en otra moneda aclara que presupuesto_clp ya está en pesos', () => {
    const base = item();
    const r = resumirCompraBusqueda({ ...base, montos: { ...base.montos, moneda: 'UTM' } });
    expect(r._nota_moneda).toMatch(/ya viene convertido a pesos chilenos; la moneda original del proceso es UTM/);
    expect(resumirCompraBusqueda(base)).not.toHaveProperty('_nota_moneda');
  });
});
