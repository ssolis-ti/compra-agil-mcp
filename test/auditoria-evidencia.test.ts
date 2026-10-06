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
    expect(rec.datos.recomendaciones_de_optimizacion[0]).toMatch(/ninguna cotización cabe con IVA — la menor es \$1\.200\.000 neto y \$1\.428\.000 con IVA/);
    expect(rec.datos.recomendaciones_de_optimizacion[0]).toContain('probablemente el presupuesto incluye IVA');
  });

  it('S1b: no cabe con IVA aunque el motivo oficial sea requisitos (caso del tóner, segunda simulación)', async () => {
    const objetivo = proceso('3851-115-COT26', {
      presupuesto: { ...proceso('x').presupuesto, monto_disponible_clp: 21_537_000, monto_disponible: 21_537_000 },
      motivos: { motivo_cancelacion: null, motivo_desierta: 'Ofertas no cumplen requisitos técnicos' },
      proveedores_cotizando: [cotizacion(23_915_150), cotizacion(29_412_600), cotizacion(18_736_550), cotizacion(29_221_150)],
    });
    const rec = await recolectarDatosAuditoria(clienteCon(objetivo) as never, { codigo_compra: '3851-115-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.analisis_de_brechas.presupuesto_insuficiente).toBe(true);
    expect(rec.datos.analisis_de_brechas.requisitos_complejos).toBe(true);
    const r = rec.datos.recomendaciones_de_optimizacion[0];
    expect(r).toMatch(/^Presupuesto: ninguna cotización cabe con IVA — la menor es \$18\.736\.550 neto y \$22\.296\.495 con IVA frente a \$21\.537\.000, y 3 de 4 lo superan ya en neto/);
    expect(r).toContain('Aunque el motivo oficial es otro («Ofertas no cumplen requisitos técnicos»)');
    // Y sigue la recomendación de requisitos, que es el motivo oficial.
    expect(rec.datos.recomendaciones_de_optimizacion.some((x) => x.startsWith('Requisitos:'))).toBe(true);
  });

  it('S1b: la mayoría sobre el presupuesto en neto se marca aunque la menor quepa', async () => {
    const objetivo = proceso('6-6-COT26', {
      motivos: { motivo_cancelacion: null, motivo_desierta: 'Ofertas no cumplen requisitos técnicos' },
      // Presupuesto 1.259.000: la menor (900.000) cabe con IVA (1.071.000); 2 de 3 superan en neto.
      proveedores_cotizando: [cotizacion(900_000), cotizacion(1_300_000), cotizacion(1_400_000)],
    });
    const rec = await recolectarDatosAuditoria(clienteCon(objetivo) as never, { codigo_compra: '6-6-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.analisis_de_brechas.presupuesto_insuficiente).toBe(true);
    expect(rec.datos.recomendaciones_de_optimizacion[0]).toMatch(/^Presupuesto: 2 de 3 cotizaciones de este proceso superan en neto/);
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

describe('auditar_compras_desiertas — «no evaluable» y comparación por unidad (S5)', () => {
  /** Comparable con precio unitario: 5 unidades a $800.000. */
  function comparableConUnitario() {
    const cot: ProveedorCotizando = {
      ...cotizacion(4_000_000),
      productos_cotizados: [{ codigo_producto: 1, nombre_producto: 'Computadores portátiles', descripcion: null, cantidad: 5, precio_unitario: 800_000, monto_total_producto: 4_000_000 }],
    };
    return proceso('7-7-COT26', { proveedores_cotizando: [cot] });
  }

  it('sin comparables ni evidencia propia: presupuesto y plazo no evaluables, no «en rango»', async () => {
    const objetivo = proceso('8-8-COT26');
    const rec = await recolectarDatosAuditoria({
      detalle: async () => objetivo,
      buscar: async () => ({ items: [{ codigo: '8-8-COT26' }] }),
      detallesEnParalelo: async () => [],
    } as never, { codigo_compra: '8-8-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.analisis_de_brechas).toMatchObject({
      presupuesto_insuficiente: null, plazo_insuficiente: null, diferencia_presupuesto_porcentaje: null, base_comparacion: null,
    });
    const html = renderAuditoriaInforme({ datos: rec.datos, generadoEn: new Date('2026-10-06T12:00:00Z') });
    expect(html).toContain('Presupuesto: no evaluable');
    expect(html).not.toContain('Presupuesto en rango');
  });

  it('compara por unidad cuando los comparables traen precio unitario', async () => {
    // Objetivo: 2 portátiles con $1.259.000 → $629.500 por unidad.
    // Comparable: 5 a $800.000. En totales ($1.259.000 vs $4.000.000) saldría −69 %.
    const objetivo = proceso('9-9-COT26');
    const comparable = comparableConUnitario();
    const rec = await recolectarDatosAuditoria({
      detalle: async (c: string) => (c === '9-9-COT26' ? objetivo : comparable),
      buscar: async () => ({ items: [{ codigo: '7-7-COT26', institucion: {}, fechas: {} }] }),
      detallesEnParalelo: async () => [comparable],
    } as never, { codigo_compra: '9-9-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    const g = rec.datos.analisis_de_brechas;
    expect(g.base_comparacion).toBe('precio_unitario');
    expect(g.diferencia_presupuesto_porcentaje).toBe(-21);
    expect(g.lectura_diferencia).toBe('El presupuesto por unidad está 21 % bajo el promedio de lo cotizado por unidad en procesos comparables.');
    expect(g.presupuesto_insuficiente).toBe(true);
    expect(rec.datos.procesos_comparables_analizados[0].menor_precio_unitario).toBe(800_000);
    expect(rec.datos.recomendaciones_de_optimizacion.join(' ')).toContain('Para 2 unidades, se sugiere al menos $1.680.000');
  });
});
