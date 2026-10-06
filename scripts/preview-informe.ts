/**
 * Vista previa de informes con datos de muestra.
 *
 * Permite iterar el diseño sin consumir cuota de la API ni requerir ticket.
 * Uso: npx tsx scripts/preview-informe.ts
 */

import { renderRadarInforme, type OportunidadInforme } from '../src/reports/templates/radar-oportunidades.js';
import { renderCotizacionInforme } from '../src/reports/templates/cotizacion.js';
import { renderPrecioInforme } from '../src/reports/templates/precio.js';
import { renderAuditoriaInforme } from '../src/reports/templates/auditoria.js';
import { renderCompetenciaInforme } from '../src/reports/templates/competencia.js';
import type { BorradorCotizacion } from '../src/tools/generar-borrador.js';
import type { DatosPreciosMercado } from '../src/tools/analizar-precios-mercado.js';
import type { DatosAuditoria } from '../src/tools/auditar-desiertas.js';
import type { DatosCompetencia } from '../src/utils/competencia.js';
import { escribirInforme } from '../src/reports/export.js';
import { PAPEL, type FormatoPapel } from '../src/reports/theme.js';

const AHORA = new Date();
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3600_000).toISOString();

const MUESTRA: OportunidadInforme[] = [
  {
    codigo: '1057539-228-COT26',
    nombre: 'Adquisición de licencias de software de ofimática para 200 puestos',
    organismo: 'Servicio de Salud Metropolitano Occidente',
    region: 'Metropolitana',
    presupuesto_disponible: 8_450_000,
    ofertas_recibidas: 0,
    horas_restantes: 3.2,
    fecha_cierre: enHoras(3.2),
    puntuacion_caliente: 105,
    factores_calificacion: [
      'Sin oferentes activos (+50 pts)',
      'Urgencia crítica: cierra en menos de 4 horas (+30 pts)',
      'Presupuesto de alto valor (>= $5.000.000 CLP) (+20 pts)',
      'Sin documentos adjuntos (postulación rápida sin leer bases) (+5 pts)',
    ],
  },
  {
    codigo: '2494-141-COT26',
    nombre: 'Servicio de soporte y mantención de equipos computacionales',
    organismo: 'Municipalidad de Ñuñoa',
    region: 'Metropolitana',
    presupuesto_disponible: 6_200_000,
    ofertas_recibidas: 0,
    horas_restantes: 9.5,
    fecha_cierre: enHoras(9.5),
    puntuacion_caliente: 95,
    factores_calificacion: [
      'Sin oferentes activos (+50 pts)',
      'Cierre inminente: cierra en menos de 12 horas (+20 pts)',
      'Presupuesto de alto valor (>= $5.000.000 CLP) (+20 pts)',
      'Sin documentos adjuntos (postulación rápida sin leer bases) (+5 pts)',
    ],
  },
  {
    codigo: '1057532-156-COT26',
    nombre: 'Desarrollo de plataforma web de trámites municipales & portal ciudadano',
    organismo: 'Ilustre Municipalidad de Valparaíso',
    region: 'Valparaíso',
    presupuesto_disponible: 12_800_000,
    ofertas_recibidas: 1,
    horas_restantes: 20,
    fecha_cierre: enHoras(20),
    puntuacion_caliente: 65,
    factores_calificacion: [
      'Baja competencia: solo 1 oferente (+30 pts)',
      'Cierre cercano: cierra en menos de 24 horas (+10 pts)',
      'Presupuesto de alto valor (>= $5.000.000 CLP) (+20 pts)',
      'Sin documentos adjuntos (postulación rápida sin leer bases) (+5 pts)',
    ],
  },
  {
    codigo: '881-92-COT26',
    nombre: 'Suministro de insumos computacionales y accesorios',
    organismo: 'Universidad de Santiago de Chile',
    region: 'Metropolitana',
    presupuesto_disponible: 3_100_000,
    ofertas_recibidas: 1,
    horas_restantes: 46,
    fecha_cierre: enHoras(46),
    puntuacion_caliente: 45,
    factores_calificacion: [
      'Baja competencia: solo 1 oferente (+30 pts)',
      'Presupuesto medio-alto (>= $2.000.000 CLP) (+15 pts)',
    ],
  },
  {
    codigo: '3421-77-COT26',
    nombre: 'Servicio de hosting y certificados SSL para sitios institucionales',
    organismo: 'Gobierno Regional del Biobío',
    region: 'Biobío',
    presupuesto_disponible: 2_400_000,
    ofertas_recibidas: 2,
    horas_restantes: 11,
    fecha_cierre: enHoras(11),
    puntuacion_caliente: 50,
    factores_calificacion: [
      'Competencia moderada: 2 oferentes (+15 pts)',
      'Cierre inminente: cierra en menos de 12 horas (+20 pts)',
      'Presupuesto medio-alto (>= $2.000.000 CLP) (+15 pts)',
    ],
  },
  {
    codigo: '5120-33-COT26',
    nombre: 'Capacitación en ciberseguridad para funcionarios',
    organismo: 'Servicio Nacional de Capacitación y Empleo',
    region: 'Metropolitana',
    presupuesto_disponible: 890_000,
    ofertas_recibidas: 3,
    horas_restantes: 72,
    fecha_cierre: enHoras(72),
    puntuacion_caliente: 10,
    factores_calificacion: ['Presupuesto medio (>= $500.000 CLP) (+10 pts)'],
  },
  {
    codigo: '7788-12-COT26',
    nombre: 'Arriendo de impresoras multifuncionales <sin bases adjuntas>',
    organismo: 'Corporación Municipal de Maipú',
    region: 'Metropolitana',
    presupuesto_disponible: 450_000,
    ofertas_recibidas: 0,
    horas_restantes: 30,
    fecha_cierre: enHoras(30),
    puntuacion_caliente: 60,
    factores_calificacion: [
      'Sin oferentes activos (+50 pts)',
      'Presupuesto bajo (< $500.000 CLP) (+5 pts)',
      'Sin documentos adjuntos (postulación rápida sin leer bases) (+5 pts)',
    ],
  },
];

// Genera una vista previa por cada formato de papel para comparar la maquetación.
const FORMATOS: FormatoPapel[] = ['carta', 'oficio', 'a4'];

console.log('\nVistas previas generadas:\n');
for (const formato of FORMATOS) {
  const html = renderRadarInforme({
    oportunidades: MUESTRA,
    totalAnalizadas: 143,
    filtros: { q: 'software', presupuestoMinimo: 400_000, paginasEscaneadas: 3 },
    generadoEn: AHORA,
    formato,
  });
  const { ruta, bytes } = escribirInforme(html, `preview-radar-${formato}.html`);
  console.log(`  ${PAPEL[formato].glosa.padEnd(32)} → ${ruta} (${(bytes / 1024).toFixed(1)} KB)`);
}

const borradorMuestra: BorradorCotizacion = {
  _advertencia: '⚠ BORRADOR AUTOGENERADO. Revisa y reemplaza los campos marcados como placeholder antes de presentar la cotización real. Este documento no ha sido enviado a Mercado Público.',
  _campos_a_revisar: ['rut_proveedor es un valor PLACEHOLDER; reemplázalo por el RUT real del proveedor antes de presentar.'],
  codigo_compra: '1057539-228-COT26',
  nombre_compra: 'Adquisición de licencias de software de ofimática',
  organismo_comprador: 'Servicio de Salud Metropolitano Occidente',
  rut_proveedor: '76.000.000-0',
  razon_social: 'Proveedor Demo SpA',
  es_emt: null,
  activo: true,
  plazo_entrega_dias: 5,
  valor_neto: 2_000_000,
  porcentaje_impuesto: 19,
  nombre_impuesto: 'IVA',
  total_impuesto: 380_000,
  monto_total: 2_380_000,
  descripcion_cotizacion: 'Estimados Servicio de Salud,\n\nPresentamos nuestra cotización formal.\n\nAtentamente,\nProveedor Demo SpA',
  productos_cotizados: [
    { codigo_producto: 43211500, nombre_producto: 'Licencia de ofimática', descripcion: 'Suscripción anual', cantidad: 200, precio_unitario: 10_000, monto_total_producto: 2_000_000 },
  ],
  metadata_estimacion: {
    precio_unitario_utilizado: 10_000,
    fuente_precio_unitario: 'Precio neto ingresado por el usuario',
    precio_unitario_sugerido_automatico: true,
  },
};

const precioMuestra: DatosPreciosMercado = {
  _nota_metodologica: 'Precios COTIZADOS por proveedores, NO adjudicados.',
  termino_busqueda: 'resmas papel',
  region_analisis: 'Región 13',
  cobertura: {
    procesos_encontrados: 8,
    procesos_revisados: 5,
    procesos_que_fallaron: 0,
    procesos_con_cotizaciones: 4,
    cotizaciones_totales: 3,
    cotizaciones_declaradas_inadmisibles: 1,
    motivos_de_inadmisibilidad: ['no cumple con garantía solicitada'],
    adjudicaciones_detectadas: 0,
  },
  estadisticas_precio_unitario: { muestras: 3, minimo: 2800, maximo: 4500, promedio: 3500, mediana: 3200, p25: 2900 },
  estadisticas_monto_neto: { muestras: 3, minimo: 140000, maximo: 225000, promedio: 175000, mediana: 160000, p25: 145000 },
  base_de_la_sugerencia: 'precio_unitario',
  muestra_homogenea: true,
  precio_sugerido_competitivo: 2900,
  criterio_sugerencia: 'Percentil 25 de la distribución cotizada.',
  rango_competitivo: { desde: 2800, hasta: 3200 },
  cotizaciones_observadas: [
    { codigo_proceso: '1-1-COT26', estado_proceso: 'Desierta', institucion: 'Municipalidad', proveedor: 'Papelera Sur', es_emt: true, precio_unitario: 2800, monto_neto: 140000, monto_total: 166600, admisible: true, motivo_inadmisibilidad: null },
    { codigo_proceso: '2-2-COT26', estado_proceso: 'Desierta', institucion: 'Servicio de Salud', proveedor: 'Oficina Norte', es_emt: false, precio_unitario: 4500, monto_neto: 225000, monto_total: 267750, admisible: false, motivo_inadmisibilidad: 'no cumple con garantía solicitada' },
  ],
};

const auditoriaMuestra: DatosAuditoria = {
  proceso_auditado: {
    codigo: '758-329-COT26',
    nombre: 'Compra de resmas de papel',
    region: 'Región 13',
    estado: 'Desierta',
    presupuesto_disponible: 180000,
    duracion_dias: 1,
    items_solicitados: [{ nombre: 'Resma carta', cantidad: 100, unidad: 'EA' }],
    motivo_desierta: 'No se recibieron ofertas admisibles',
  },
  busqueda_comparativa: {
    termino_clave: 'resmas papel',
    procesos_comparables_con_cotizaciones: 2,
    estadisticas_montos_cotizados: { minimo_cotizado: 240000, maximo_cotizado: 310000, promedio_cotizado: 275000 },
    estadisticas_duracion: { minimo_dias: 4, maximo_dias: 7, promedio_dias: 5.5 },
  },
  analisis_de_brechas: {
    presupuesto_insuficiente: true,
    plazo_insuficiente: true,
    requisitos_complejos: false,
    diferencia_presupuesto_porcentaje: -35,
    diferencia_plazo_dias: -4.5,
  },
  recomendaciones_de_optimizacion: [
    'Aumentar el presupuesto disponible. El mercado cotizó por encima del monto publicado.',
    'Extender el plazo de postulación a un mínimo de 3 a 5 días hábiles.',
  ],
  procesos_comparables_analizados: [
    { codigo: '9-9-COT26', estado: 'Desierta', institucion: 'Municipalidad de Ñuñoa', cotizaciones_recibidas: 3, cotizaciones_inadmisibles: 2, menor_monto_cotizado: 240000, mayor_monto_cotizado: 310000, duracion_dias: 5, fecha_cierre: '2026-08-10T00:00:00Z', motivo_desierta: null },
  ],
  _nota_metodologica: 'La comparación usa el MENOR monto cotizado de cada proceso similar (cerrado o desierto), no montos adjudicados.',
};

const competenciaMuestra: DatosCompetencia = {
  codigo: '1057539-228-COT26',
  nombre: 'Adquisición de licencias de software',
  organismo: 'Servicio de Salud Metropolitano Occidente',
  region: 'Metropolitana',
  estado: 'Desierta',
  presupuesto_clp: 8_450_000,
  moneda: 'CLP',
  cotizantes: [
    { rut: '761234567', razon_social: 'Software Austral SpA', es_empresa_menor_tamano: true, monto_total: 5_950_000, valor_neto: 5_000_000, impuesto: 950_000, despacho: 0, descripcion: 'Licencias anuales', admisible: true },
    { rut: '123456785', razon_social: 'Nube Andina Ltda.', es_empresa_menor_tamano: false, monto_total: 8_330_000, valor_neto: 7_000_000, impuesto: 1_330_000, despacho: 0, descripcion: '', admisible: false, justificacion_inadmisibilidad: 'no acompaña garantía' },
  ],
  spread: { cotizaciones: 2, admisibles: 1, inadmisibles: 1, neto_minimo: 5_000_000, neto_maximo: 7_000_000, brecha_neto: 2_000_000, brecha_porcentaje: 40 },
  _nota: 'La tabla ordena las cotizaciones por monto neto, de menor a mayor. No identifica un proveedor adjudicado: la API no publica quién ganó.',
};

const vistas: Array<[string, string]> = [
  ['preview-cotizacion-carta.html', renderCotizacionInforme({ borrador: borradorMuestra, generadoEn: AHORA, formato: 'carta' })],
  ['preview-precio-carta.html', renderPrecioInforme({ datos: precioMuestra, generadoEn: AHORA, formato: 'carta' })],
  ['preview-auditoria-carta.html', renderAuditoriaInforme({ datos: auditoriaMuestra, generadoEn: AHORA, formato: 'carta' })],
  ['preview-competencia-carta.html', renderCompetenciaInforme({ datos: competenciaMuestra, generadoEn: AHORA, formato: 'carta' })],
];
for (const [nombre, html] of vistas) {
  const { ruta, bytes } = escribirInforme(html, nombre);
  console.log(`  ${nombre.padEnd(32)} → ${ruta} (${(bytes / 1024).toFixed(1)} KB)`);
}
