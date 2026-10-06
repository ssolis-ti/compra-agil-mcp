import { describe, it, expect } from 'vitest';
import type { CompraAgilDetalle } from '../src/api/compra-agil-client.js';
import { construirBorradorCotizacion } from '../src/tools/generar-borrador.js';
import { recolectarDatosPrecios } from '../src/tools/analizar-precios-mercado.js';
import { recolectarDatosAuditoria } from '../src/tools/auditar-desiertas.js';
import { compararCotizantes } from '../src/utils/competencia.js';
import { renderCotizacionInforme } from '../src/reports/templates/cotizacion.js';
import { renderPrecioInforme } from '../src/reports/templates/precio.js';
import { renderAuditoriaInforme } from '../src/reports/templates/auditoria.js';
import { renderCompetenciaInforme } from '../src/reports/templates/competencia.js';

const AHORA = new Date('2026-10-01T15:00:00Z');

function detalle(over: Partial<CompraAgilDetalle> = {}): CompraAgilDetalle {
  return {
    codigo: '5519-136-COT26',
    nombre: 'Compra de resmas',
    descripcion: '',
    estado: { id_estado: 2, codigo: 'publicada', glosa: 'Publicada' },
    convocatoria: {
      estado_convocatoria: 1,
      descripcion: 'Primer llamado',
      fecha_cierre_primer_llamado: null,
      fecha_cierre_segundo_llamado: null,
    },
    fechas: {
      fecha_publicacion: '2026-09-01T00:00:00Z',
      fecha_cierre: '2026-09-02T00:00:00Z',
      fecha_ultimo_cambio: '2026-09-02T00:00:00Z',
      fecha_cancelacion: null,
    },
    entrega: { direccion_entrega: '', plazo_entrega_dias: 5 },
    documentos: [],
    presupuesto: {
      tipo_presupuesto: 'Estimado',
      moneda: 'CLP',
      presupuesto_estimado: 100_000,
      monto_disponible: 100_000,
      monto_disponible_clp: 100_000,
      valor_cambio_moneda: null,
      fecha_cambio_moneda: null,
    },
    institucion: {
      organismo_comprador: 'A & B',
      rut: '60.910.000-1',
      unidad_compra: '',
      region: 13,
      nombre_region: 'Metropolitana',
    },
    productos_solicitados: [
      { codigo_producto: 32101637, nombre: 'Resma', descripcion: null, cantidad: 2, unidad_medida: 'EA' },
    ],
    proveedores_cotizando: [],
    resumen: { multa_sancion: null, total_ofertas_recibidas: 0, total_demandas: 0 },
    motivos: { motivo_cancelacion: null, motivo_desierta: 'Sin oferentes válidos' },
    flags: {
      considera_requisitos_medioambientales: false,
      considera_requisitos_impacto_social_economico: false,
    },
    ...over,
  };
}

function clienteDetalle(d: CompraAgilDetalle) {
  return {
    detalle: async () => d,
    buscar: async () => { throw new Error('no debe consultar mercado si el precio viene dado'); },
    detallesEnParalelo: async () => [],
  };
}

describe('construirBorradorCotizacion', () => {
  it('calcula neto, IVA 19 % y total, y marca los placeholders', async () => {
    const borrador = await construirBorradorCotizacion(
      clienteDetalle(detalle({ nombre: '<script>alert(1)</script>' })) as never,
      { codigo_compra: '5519-136-COT26', precio_unitario_personalizado: 1000, descripcion_propuesta: 'Entrega en bodega' },
    );

    expect(borrador.valor_neto).toBe(2000);
    expect(borrador.porcentaje_impuesto).toBe(19);
    expect(borrador.total_impuesto).toBe(380);
    expect(borrador.monto_total).toBe(2380);
    expect(borrador.rut_proveedor).toBe('76.000.000-0');
    expect(borrador.razon_social).toBe('Proveedor Demo SpA');
    expect(borrador._campos_a_revisar.join(' ')).toMatch(/rut_proveedor/);
    expect(borrador._campos_a_revisar.join(' ')).toMatch(/razon_social/);
    expect(borrador.descripcion_cotizacion).toContain('Entrega en bodega');
    expect(borrador.descripcion_cotizacion).not.toContain('cotización formal');
    expect(borrador._nota_campos_fijos).toMatch(/no son un dictamen/i);
    expect(borrador.metadata_estimacion.precio_unitario_sugerido_automatico).toBe(false);
    expect(borrador.metadata_estimacion.fuente_precio_unitario).toMatch(/ingresado por el usuario/);
    expect(JSON.stringify(borrador)).not.toContain('proveedor_seleccionado');
  });

  it('el informe escapa el nombre y muestra el total', async () => {
    const borrador = await construirBorradorCotizacion(
      clienteDetalle(detalle({ nombre: '<script>alert(1)</script>' })) as never,
      {
        codigo_compra: '5519-136-COT26',
        precio_unitario_personalizado: 1000,
        rut_proveedor: '76.123.456-7',
        razon_social: 'Mi Pyme SpA',
      },
    );
    const html = renderCotizacionInforme({ borrador, generadoEn: AHORA, formato: 'carta' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('$2.380');
    expect(html).toContain('size: letter');
    expect(html).not.toMatch(/src="https?:/);
  });
});

describe('recolectarDatosPrecios', () => {
  it('rechaza la llamada sin código ni término, sin consultar la API', async () => {
    const buscar = async () => { throw new Error('no'); };
    const rec = await recolectarDatosPrecios({ buscar, detalle: buscar, detallesEnParalelo: buscar } as never, {});
    expect(rec.kind).toBe('mensaje');
    if (rec.kind !== 'mensaje') return;
    expect(rec.isError).toBe(true);
    expect(rec.texto).toBe('Error de validación: debes proporcionar "codigo_compra" o un término de búsqueda "q".');
  });

  it('arma la distribución y separa la inadmisible sin tratarla como adjudicación', async () => {
    const cotizacion = (razon: string, unitario: number, neto: number, motivo: string | null) => ({
      razon_social: razon,
      es_emt: false,
      valor_neto: neto,
      monto_total: neto,
      justificacion_inadmisibilidad: motivo,
      proveedor_seleccionado: 0,
      productos_cotizados: [{
        nombre_producto: 'resma',
        precio_unitario: unitario,
        cantidad: 1,
        codigo_producto: 1,
        descripcion: null,
        monto_total_producto: unitario,
      }],
    });
    const det = {
      estado: { glosa: 'Desierta' },
      institucion: { organismo_comprador: 'Servicio <X>' },
      proveedores_cotizando: [
        cotizacion('Alfa', 1000, 1000, null),
        cotizacion('Beta & Cía', 1000, 1000, null),
        cotizacion('Gamma', 20000, 20000, 'sobrepasa el monto máximo'),
      ],
    };
    let tamano = 0;
    const client = {
      detalle: async () => { throw new Error('no'); },
      buscar: async (q: { tamano_pagina: number }) => {
        tamano = q.tamano_pagina;
        return {
          items: [{ codigo: '1-1-COT26' }, { codigo: '2-2-COT26' }, { codigo: '3-3-COT26' }],
          paginacion: { total_resultados: 3, total_paginas: 1, numero_pagina: 1, tamano_pagina: q.tamano_pagina },
        };
      },
      detallesEnParalelo: async () => [det, det, det],
    };
    const rec = await recolectarDatosPrecios(client as never, { q: 'resma', limite_analisis: 3 });
    expect(tamano).toBe(10);
    expect(rec.kind).toBe('datos');
    if (rec.kind !== 'datos') return;
    expect(rec.datos.precio_sugerido_competitivo).toBe(1000);
    expect(rec.datos.muestra_homogenea).toBe(false);
    expect(rec.datos._advertencia_dispersion).toMatch(/veces la mediana/);
    expect(rec.datos.cobertura.adjudicaciones_detectadas).toBe(0);
    expect(rec.datos.cobertura.motivos_de_inadmisibilidad).toEqual(['sobrepasa el monto máximo']);
    expect(rec.datos._nota_metodologica).toMatch(/NO adjudicados/);

    const html = renderPrecioInforme({ datos: rec.datos, generadoEn: AHORA });
    expect(html).toContain('<svg');
    expect(html).toContain('Percentil 25');
    expect(html).toContain('Beta &amp; Cía');
    expect(html).toContain('Servicio &lt;X&gt;');
    expect(html).not.toContain('<script');
    expect(html).toContain('sobrepasa el monto máximo');
  });

  it('si todos los detalles fallan, no concluye sobre el mercado', async () => {
    const client = {
      detalle: async () => { throw new Error('no'); },
      buscar: async () => ({
        items: [{ codigo: '1-1-COT26' }],
        paginacion: { total_resultados: 1, total_paginas: 1, numero_pagina: 1, tamano_pagina: 10 },
      }),
      detallesEnParalelo: async () => [null],
      ultimoHttpDeConcurrencia: () => 504,
    };
    const rec = await recolectarDatosPrecios(client as never, { q: 'resma' });
    expect(rec.kind).toBe('mensaje');
    if (rec.kind !== 'mensaje') return;
    expect(rec.isError).toBe(true);
    expect(rec.texto).toContain('Esto NO significa que no haya precios publicados');
    expect(rec.texto).toContain('las 1 consultas fallaron');
    expect(rec.texto).toContain('ya pidió el mínimo');
    expect(rec.texto).toContain('HTTP 504');
    expect(rec.texto).not.toContain('limite_analisis');
  });

  it('con varios detalles caídos sí pide bajar el límite', async () => {
    const client = {
      detalle: async () => { throw new Error('no'); },
      buscar: async () => ({
        items: [{ codigo: '1-1-COT26' }, { codigo: '2-2-COT26' }, { codigo: '3-3-COT26' }],
        paginacion: { total_resultados: 3, total_paginas: 1, numero_pagina: 1, tamano_pagina: 10 },
      }),
      detallesEnParalelo: async () => [null, null, null],
    };
    const rec = await recolectarDatosPrecios(client as never, { q: 'resma', limite_analisis: 3 });
    expect(rec.kind).toBe('mensaje');
    if (rec.kind !== 'mensaje') return;
    expect(rec.texto).toContain('baja "limite_analisis"');
  });
});

describe('recolectarDatosAuditoria', () => {
  it('exige código o término', async () => {
    const rec = await recolectarDatosAuditoria({
      buscar: async () => { throw new Error('no'); },
      detalle: async () => { throw new Error('no'); },
      detallesEnParalelo: async () => [],
    } as never, {});
    expect(rec.kind).toBe('mensaje');
    if (rec.kind !== 'mensaje') return;
    expect(rec.isError).toBe(true);
    expect(rec.texto).toBe('Error de validación: Debes proporcionar "codigo_compra" o un término de búsqueda "q" para encontrar un proceso a auditar.');
  });

  it('marca presupuesto y plazo, y conserva la nota metodológica', async () => {
    const objetivo = detalle();
    const comparable = detalle({
      codigo: '9-9-COT26',
      fechas: {
        fecha_publicacion: '2026-08-01T00:00:00Z',
        fecha_cierre: '2026-08-10T00:00:00Z',
        fecha_ultimo_cambio: '2026-08-10T00:00:00Z',
        fecha_cancelacion: null,
      },
      proveedores_cotizando: [
        {
          rut_proveedor: '1-9',
          razon_social: 'Oferente',
          es_emt: false,
          valor_neto: 500_000,
          monto_total: 595_000,
        },
      ],
    });
    const client = {
      detalle: async (codigo: string) => (codigo === '9-9-COT26' ? comparable : objetivo),
      buscar: async () => ({
        items: [{
          codigo: '9-9-COT26',
          institucion: { organismo_comprador: 'Municipalidad' },
          fechas: { fecha_cierre: '2026-08-10T00:00:00Z' },
        }],
      }),
      detallesEnParalelo: async () => [comparable],
    };
    const rec = await recolectarDatosAuditoria(client as never, { codigo_compra: '5519-136-COT26', limite_analisis: 3 });
    expect(rec.kind).toBe('datos');
    if (rec.kind !== 'datos') return;
    expect(rec.datos.analisis_de_brechas.presupuesto_insuficiente).toBe(true);
    expect(rec.datos.analisis_de_brechas.plazo_insuficiente).toBe(true);
    // La evidencia del propio proceso va primero (S1); la de mercado sigue presente.
    expect(rec.datos.recomendaciones_de_optimizacion.some((r) => r.includes('Aumentar el presupuesto disponible'))).toBe(true);
    expect(rec.datos._nota_metodologica).toBe(
      'La comparación usa el MENOR monto cotizado de cada proceso similar (cerrado o desierto), no montos adjudicados: la API de Mercado Público no expone qué oferta ganó. Revisa también "motivo_desierta": muchas deserciones se explican por incumplimientos formales (garantías, certificados) y no por precio.',
    );

    const html = renderAuditoriaInforme({ datos: rec.datos, generadoEn: AHORA, formato: 'oficio' });
    expect(html).toContain('Aumentar el presupuesto disponible');
    expect(html).toContain('Sin oferentes válidos');
    expect(html).toContain('size: 216mm 330mm');
    expect(html).not.toContain('<script');
  });

  it('no compara el proceso consigo mismo cuando es el único resultado', async () => {
    const objetivo = detalle({
      codigo: '1391-601-COT26',
      proveedores_cotizando: [
        { rut_proveedor: '1-9', razon_social: 'Oferente', es_emt: false, valor_neto: 238_425, monto_total: 283_726 },
      ],
    });
    const client = {
      detalle: async () => objetivo,
      buscar: async () => ({
        items: [{ codigo: '1391-601-COT26', institucion: { organismo_comprador: 'Gendarmería' }, fechas: {} }],
      }),
      detallesEnParalelo: async () => [objetivo],
    };
    const rec = await recolectarDatosAuditoria(client as never, { codigo_compra: '1391-601-COT26', limite_analisis: 1 });
    expect(rec.kind).toBe('datos');
    if (rec.kind !== 'datos') return;
    expect(rec.datos.busqueda_comparativa.sin_comparables_distintos).toBe(true);
    expect(rec.datos.busqueda_comparativa.procesos_comparables_con_cotizaciones).toBe(0);
    expect(rec.datos.analisis_de_brechas.diferencia_presupuesto_porcentaje).toBe(0);
    expect(rec.datos.recomendaciones_de_optimizacion.some((r) => /consigo mismo/.test(r))).toBe(true);
    // Sin comparables se conserva la evidencia propia: su única cotización supera el presupuesto.
    expect(rec.datos.analisis_de_brechas.presupuesto_insuficiente).toBe(true);
    expect(rec.datos.recomendaciones_de_optimizacion[0]).toMatch(/única cotización de este mismo proceso superó/);
  });
});

describe('compararCotizantes', () => {
  it('ordena por neto, muestra la inadmisible y no nombra un ganador', () => {
    const datos = compararCotizantes(detalle({
      proveedores_cotizando: [
        {
          rut_proveedor: '761234567',
          razon_social: 'Caro SpA',
          es_emt: false,
          valor_neto: 80_000,
          monto_total: 95_200,
          justificacion_inadmisibilidad: null,
          proveedor_seleccionado: 1,
        },
        {
          rut_proveedor: '123456785',
          razon_social: 'Barato & Cía',
          es_emt: true,
          valor_neto: 20_000,
          monto_total: 23_800,
          descripcion_cotizacion: '<b>oferta</b>',
          justificacion_inadmisibilidad: '  no acompaña garantía  ',
        },
      ],
    }));

    expect(datos.cotizantes.map((c) => c.razon_social)).toEqual(['Barato & Cía', 'Caro SpA']);
    expect(datos.cotizantes[0].admisible).toBe(false);
    expect(datos.cotizantes[0].justificacion_inadmisibilidad).toBe('no acompaña garantía');
    expect(datos.cotizantes[1].admisible).toBe(true);
    expect(datos.cotizantes[1].justificacion_inadmisibilidad).toBeUndefined();
    expect(datos.spread.brecha_neto).toBe(60_000);
    expect(datos.spread.brecha_porcentaje).toBe(300);
    expect(JSON.stringify(datos)).not.toContain('proveedor_seleccionado');
    expect(JSON.stringify(datos)).not.toMatch(/ganador/i);

    const html = renderCompetenciaInforme({ datos, generadoEn: AHORA });
    expect(html.indexOf('Barato')).toBeLessThan(html.indexOf('Caro SpA'));
    expect(html).toContain('Barato &amp; Cía');
    expect(html).toContain('&lt;b&gt;oferta&lt;/b&gt;');
    expect(html).toContain('no acompaña garantía');
    expect(html).toContain('No identifica un proveedor adjudicado');
    expect(html).not.toContain('Ganador');
    expect(html).not.toContain('<script');
  });

  it('un proceso sin cotizaciones no inventa un adjudicado', () => {
    const datos = compararCotizantes(detalle());
    expect(datos.spread.cotizaciones).toBe(0);
    expect(datos.spread.brecha_neto).toBeNull();
    const html = renderCompetenciaInforme({ datos, generadoEn: AHORA });
    expect(html).toContain('Sin cotizaciones');
  });
});
