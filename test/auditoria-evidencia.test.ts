import { describe, it, expect } from 'vitest';
import type { CompraAgilDetalle, ProveedorCotizando } from '../src/api/compra-agil-client.js';
import { clasificarMotivo, recolectarDatosAuditoria } from '../src/tools/auditar-desiertas.js';
import { renderAuditoriaInforme } from '../src/reports/templates/auditoria.js';

/**
 * S1 de la simulación con agentes (6-oct): la auditoría de desiertas solo
 * miraba procesos comparables. Un proceso desierto por «Ofertas sobre el
 * presupuesto disponible», con una cotización 33 % sobre su presupuesto,
 * recibió «No se detectaron discrepancias… amarrados a una única marca».
 */

function cotizacion(neto: number, extra: Partial<ProveedorCotizando> = {}): ProveedorCotizando {
  return { rut_proveedor: '1-9', razon_social: 'Oferente SpA', es_emt: false, valor_neto: neto, monto_total: Math.round(neto * 1.19), ...extra };
}

function proceso(codigo: string, over: Partial<CompraAgilDetalle> = {}): CompraAgilDetalle {
  return {
    codigo,
    nombre: 'Computadores portátiles para docentes',
    descripcion: '',
    estado: { id_estado: 5, codigo: 'desierta', glosa: 'Desierta' },
    convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado', fecha_cierre_primer_llamado: null, fecha_cierre_segundo_llamado: null },
    fechas: { fecha_publicacion: '2026-09-01 12:00', fecha_cierre: '2026-09-05 12:00', fecha_ultimo_cambio: '2026-09-05T12:00:00Z', fecha_cancelacion: null },
    entrega: { direccion_entrega: '', plazo_entrega_dias: 10 },
    documentos: [],
    presupuesto: { tipo_presupuesto: 'Disponible', moneda: 'CLP', presupuesto_estimado: 1_259_000, monto_disponible: 1_259_000, monto_disponible_clp: 1_259_000, valor_cambio_moneda: null, fecha_cambio_moneda: null },
    institucion: { organismo_comprador: 'Universidad de Concepción', rut: '69.000.000-0', unidad_compra: '', region: 8, nombre_region: 'Biobío' },
    productos_solicitados: [{ codigo_producto: 43211503, nombre: 'Computadores portátiles', descripcion: null, cantidad: 2, unidad_medida: 'Unidad' }],
    proveedores_cotizando: [],
    resumen: { multa_sancion: null, total_ofertas_recibidas: 0, total_demandas: 0 },
    motivos: { motivo_cancelacion: null, motivo_desierta: null },
    flags: { considera_requisitos_medioambientales: false, considera_requisitos_impacto_social_economico: false },
    ...over,
  };
}

/** Cliente con un comparable cuyo menor monto queda en rango del presupuesto. */
function clienteCon(objetivo: CompraAgilDetalle) {
  const comparable = proceso('2-2-COT26', {
    presupuesto: { ...objetivo.presupuesto, monto_disponible_clp: 1_200_000 },
    proveedores_cotizando: [cotizacion(1_150_000)],
  });
  return {
    detalle: async (c: string) => (c === objetivo.codigo ? objetivo : comparable),
    buscar: async () => ({ items: [{ codigo: '2-2-COT26', institucion: { organismo_comprador: 'Otra' }, fechas: {} }] }),
    detallesEnParalelo: async () => [comparable],
  };
}

describe('clasificarMotivo', () => {
  it('reconoce las causas habituales sin importar tildes ni mayúsculas', () => {
    expect(clasificarMotivo('Ofertas sobre el presupuesto disponible')).toBe('presupuesto');
    expect(clasificarMotivo('Las ofertas SOBREPASAN el monto máximo')).toBe('presupuesto');
    expect(clasificarMotivo('Ofertas no cumplen requisitos técnicos')).toBe('requisitos');
    expect(clasificarMotivo('No adjunta garantía de seriedad')).toBe('requisitos');
    expect(clasificarMotivo('No se recibieron ofertas')).toBe('sin_ofertas');
    expect(clasificarMotivo('Plazo de entrega insuficiente')).toBe('plazo');
  });

  it('no inventa una causa', () => {
    expect(clasificarMotivo(null)).toBe('no_informado');
    expect(clasificarMotivo('   ')).toBe('no_informado');
    expect(clasificarMotivo('Decisión de la jefatura')).toBe('otra');
  });
});

describe('auditar_compras_desiertas — evidencia del propio proceso (S1)', () => {
  it('el caso de la simulación: desierta por presupuesto y cotización sobre él', async () => {
    const objetivo = proceso('5930-100-COT26', {
      motivos: { motivo_cancelacion: null, motivo_desierta: 'Ofertas sobre el presupuesto disponible' },
      proveedores_cotizando: [cotizacion(1_679_096)],
    });
    const rec = await recolectarDatosAuditoria(clienteCon(objetivo) as never, { codigo_compra: '5930-100-COT26' });
    expect(rec.kind).toBe('datos');
    if (rec.kind !== 'datos') return;
    const d = rec.datos;

    expect(d.evidencia_del_proceso_auditado).toMatchObject({
      causa_segun_motivo_oficial: 'presupuesto',
      cotizaciones_recibidas: 1,
      menor_monto_neto: 1_679_096,
      cotizaciones_sobre_presupuesto: 1,
    });
    expect(d.analisis_de_brechas.presupuesto_insuficiente).toBe(true);
    expect(d.recomendaciones_de_optimizacion[0]).toMatch(/^Presupuesto: la única cotización de este mismo proceso superó el presupuesto de \$1\.259\.000\. La menor fue \$1\.679\.096 neto, 33 %/);
    // Lo que la simulación encontró: la conclusión opuesta a la evidencia.
    expect(d.recomendaciones_de_optimizacion.join(' ')).not.toMatch(/No se detectaron discrepancias|amarrados a una única marca/);
  });

  it('desierta por requisitos: lo marca y cita los motivos de inadmisibilidad', async () => {
    const objetivo = proceso('1790-121-COT26', {
      motivos: { motivo_cancelacion: null, motivo_desierta: 'Ofertas no cumplen requisitos técnicos' },
      proveedores_cotizando: [
        cotizacion(900_000, { justificacion_inadmisibilidad: 'No adjunta ficha técnica solicitada' }),
        cotizacion(950_000),
      ],
    });
    const rec = await recolectarDatosAuditoria(clienteCon(objetivo) as never, { codigo_compra: '1790-121-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');

    expect(rec.datos.analisis_de_brechas.requisitos_complejos).toBe(true);
    expect(rec.datos.analisis_de_brechas.presupuesto_insuficiente).toBe(false);
    const requisitos = rec.datos.recomendaciones_de_optimizacion.find((r) => r.startsWith('Requisitos:'));
    expect(requisitos).toContain('1 de 2 inadmisibles');
    expect(requisitos).toContain('«No adjunta ficha técnica solicitada»');
  });

  it('cabe en neto pero no con IVA: sugiere que el presupuesto incluye IVA', async () => {
    const objetivo = proceso('3-3-COT26', {
      motivos: { motivo_cancelacion: null, motivo_desierta: 'Ofertas exceden el monto disponible' },
      proveedores_cotizando: [cotizacion(1_200_000)], // 1.428.000 con IVA > 1.259.000
    });
    const rec = await recolectarDatosAuditoria(clienteCon(objetivo) as never, { codigo_compra: '3-3-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.recomendaciones_de_optimizacion[0]).toMatch(/cabe en neto \(\$1\.200\.000\) pero no con IVA \(\$1\.428\.000\)/);
  });

  it('sin motivo ni evidencia ni brechas: no atribuye una causa', async () => {
    const objetivo = proceso('4-4-COT26', { proveedores_cotizando: [cotizacion(1_000_000)] });
    const rec = await recolectarDatosAuditoria(clienteCon(objetivo) as never, { codigo_compra: '4-4-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.recomendaciones_de_optimizacion).toHaveLength(1);
    expect(rec.datos.recomendaciones_de_optimizacion[0]).toMatch(/^Los datos disponibles no muestran una causa clara/);
  });

  it('el informe impreso muestra la evidencia del propio proceso', async () => {
    const objetivo = proceso('5930-100-COT26', {
      motivos: { motivo_cancelacion: null, motivo_desierta: 'Ofertas sobre el presupuesto disponible' },
      proveedores_cotizando: [cotizacion(1_679_096)],
    });
    const rec = await recolectarDatosAuditoria(clienteCon(objetivo) as never, { codigo_compra: '5930-100-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    const html = renderAuditoriaInforme({ datos: rec.datos, generadoEn: new Date('2026-10-06T12:00:00Z') });
    expect(html).toContain('Evidencia del propio proceso');
    expect(html).toContain('$1.679.096');
    expect(html).toContain('Presupuesto bajo');
  });
});
