import { describe, it, expect } from 'vitest';
import type { CompraAgilDetalle } from '../src/api/compra-agil-client.js';
import { compararConPresupuesto, construirBorradorCotizacion } from '../src/tools/generar-borrador.js';
import { renderCotizacionInforme } from '../src/reports/templates/cotizacion.js';

/**
 * S2 de la simulación con agentes (6-oct): el borrador ofreció $9.148.113 con
 * IVA frente a un presupuesto de $9.021.000 y respondió con
 * `_campos_a_revisar: []`.
 */

function proceso(presupuesto: number | null, cantidad = 185): CompraAgilDetalle {
  return {
    codigo: '4449-111-COT26',
    nombre: 'Insumos de aseo para dependencias municipales',
    descripcion: '',
    estado: { id_estado: 1, codigo: 'publicada', glosa: 'Publicada' },
    convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado', fecha_cierre_primer_llamado: null, fecha_cierre_segundo_llamado: null },
    fechas: { fecha_publicacion: '2026-10-04 12:00', fecha_cierre: '2026-10-07 03:18', fecha_ultimo_cambio: '2026-10-05T12:00:00Z', fecha_cancelacion: null },
    entrega: { direccion_entrega: 'Bodega central', plazo_entrega_dias: 9 },
    documentos: [],
    presupuesto: {
      tipo_presupuesto: 'Disponible', moneda: 'CLP', presupuesto_estimado: presupuesto,
      monto_disponible: presupuesto, monto_disponible_clp: presupuesto, valor_cambio_moneda: null, fecha_cambio_moneda: null,
    },
    institucion: { organismo_comprador: 'Servicio de Salud Valparaíso San Antonio', rut: '61.606.500-7', unidad_compra: '', region: 5, nombre_region: 'Valparaíso' },
    productos_solicitados: [{ codigo_producto: 47131700, nombre: 'Kit de aseo', descripcion: null, cantidad, unidad_medida: 'Kit' }],
    proveedores_cotizando: [],
    resumen: { multa_sancion: null, total_ofertas_recibidas: 2, total_demandas: 0 },
    motivos: { motivo_cancelacion: null, motivo_desierta: null },
    flags: { considera_requisitos_medioambientales: false, considera_requisitos_impacto_social_economico: false },
  };
}

const clienteCon = (d: CompraAgilDetalle) => ({
  detalle: async () => d,
  buscar: async () => { throw new Error('no debe buscar con precio personalizado'); },
  detallesEnParalelo: async () => [],
});

const argsUsuaria = { codigo_compra: '4449-111-COT26', rut_proveedor: '76.543.210-K', razon_social: 'Oficina Limpia SpA', precio_unitario_personalizado: 41_554 };

describe('compararConPresupuesto', () => {
  it('el caso de la simulación: el neto cabe, el total con IVA no', () => {
    const r = compararConPresupuesto(9_021_000, 7_687_490, 9_148_113, 185)!;
    expect(r.comparacion).toEqual({
      presupuesto_comprador: 9_021_000,
      valor_neto_sobre_presupuesto: false,
      monto_total_sobre_presupuesto: true,
      precio_unitario_maximo_neto: 48_762,
      precio_unitario_maximo_si_incluye_iva: 40_976,
    });
    expect(r.advertencia).toMatch(/total con IVA \(\$9\.148\.113\) supera el presupuesto del comprador \(\$9\.021\.000\) en \$127\.113/);
    expect(r.advertencia).toMatch(/como máximo \$40\.976/);
  });

  it('si el neto ya supera, lo dice primero', () => {
    const r = compararConPresupuesto(1_000_000, 1_100_000, 1_309_000, 10)!;
    expect(r.advertencia).toMatch(/^El valor neto \(\$1\.100\.000\) supera el presupuesto del comprador \(\$1\.000\.000\) en \$100\.000/);
    expect(r.advertencia).toMatch(/como máximo \$100\.000 \(\$84\.033 si el presupuesto incluye IVA\)/);
  });

  it('si cabe con IVA no advierte', () => {
    expect(compararConPresupuesto(2_000_000, 1_000_000, 1_190_000, 10)!.advertencia).toBeNull();
  });

  it('sin presupuesto informado no compara', () => {
    expect(compararConPresupuesto(0, 1, 1, 1)).toBeNull();
  });
});

describe('construirBorradorCotizacion frente al presupuesto (S2)', () => {
  it('el borrador sobre el presupuesto queda en _campos_a_revisar', async () => {
    const b = await construirBorradorCotizacion(clienteCon(proceso(9_021_000)) as never, argsUsuaria);
    expect(b.monto_total).toBe(9_148_113);
    expect(b.comparacion_presupuesto?.monto_total_sobre_presupuesto).toBe(true);
    expect(b._campos_a_revisar).toHaveLength(1);
    expect(b._campos_a_revisar[0]).toMatch(/supera el presupuesto del comprador/);
    expect(b.fecha_cierre_hora_chile).toBe('2026-10-07 03:18');
  });

  it('dentro del presupuesto no agrega advertencias', async () => {
    const b = await construirBorradorCotizacion(clienteCon(proceso(20_000_000)) as never, argsUsuaria);
    expect(b._campos_a_revisar).toEqual([]);
    expect(b.comparacion_presupuesto?.monto_total_sobre_presupuesto).toBe(false);
  });

  it('el informe impreso muestra presupuesto, si el total cabe y el cierre en hora de Chile', async () => {
    const b = await construirBorradorCotizacion(clienteCon(proceso(9_021_000)) as never, argsUsuaria);
    const html = renderCotizacionInforme({ borrador: b, generadoEn: new Date('2026-10-06T01:21:00Z') });
    expect(html).toContain('Presupuesto del comprador: <b>$9.021.000</b>');
    expect(html).toContain('El total supera el presupuesto');
    expect(html).toContain('07-10-2026 03:18');
    expect(html).toContain('Campos por revisar');
  });
});

describe('construirBorradorCotizacion con adjuntos (enjambre, 6-oct)', () => {
  it('avisa que solo cotiza lo que lista la API y que el detalle puede estar en los adjuntos', async () => {
    const d = { ...proceso(9_021_000), documentos: [{ id: '1855508', nombre: 'Materiales de Aseo detalle (1).docx' }] };
    const b = await construirBorradorCotizacion(clienteCon(d) as never, argsUsuaria);
    const aviso = b._campos_a_revisar.find((a) => a.includes('adjunto'));
    expect(aviso).toMatch(/1 adjunto\(s\) \(«Materiales de Aseo detalle \(1\)\.docx»\)/);
    expect(aviso).toMatch(/cotiza solo los 1 producto\(s\) que lista la API/);
    expect(aviso).toMatch(/ficha\?code=4449-111-COT26/);
  });

  it('sin adjuntos no agrega el aviso', async () => {
    const b = await construirBorradorCotizacion(clienteCon(proceso(9_021_000)) as never, argsUsuaria);
    expect(b._campos_a_revisar.some((a) => a.includes('adjunto'))).toBe(false);
  });
});
