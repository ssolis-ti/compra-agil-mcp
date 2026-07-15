/**
 * Vista previa de informes con datos de muestra.
 *
 * Permite iterar el diseño sin consumir cuota de la API ni requerir ticket.
 * Uso: npx tsx scripts/preview-informe.ts
 */

import { renderRadarInforme, type OportunidadInforme } from '../src/reports/templates/radar-oportunidades.js';
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
  const { ruta, bytes } = escribirInforme(html, `preview-radar-${formato}.html`, 'informes');
  console.log(`  ${PAPEL[formato].glosa.padEnd(32)} → ${ruta} (${(bytes / 1024).toFixed(1)} KB)`);
}
