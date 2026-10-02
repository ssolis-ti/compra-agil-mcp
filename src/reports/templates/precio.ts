/**
 * Template: distribución de precios cotizados.
 *
 * Recibe el mismo objeto que devuelve `analizar_precios_mercado`.
 * Los precios son cotizados, no adjudicados.
 */

import type { DatosPreciosMercado } from '../../tools/analizar-precios-mercado.js';
import type { EstadisticasPrecio } from '../../utils/quotation.js';
import { renderDocumento } from '../render.js';
import { portada, kpiRow, tabla, badge, callout, barChartSVG, pieDoc, esc } from '../components.js';
import { clp, numero, fecha, fechaLarga } from '../format.js';
import { TOKENS, PAPEL, FORMATO_POR_DEFECTO, type FormatoPapel } from '../theme.js';

export interface PrecioInformeData {
  datos: DatosPreciosMercado;
  generadoEn: Date;
  formato?: FormatoPapel;
}

function distribucion(stats: EstadisticasPrecio): string {
  return barChartSVG([
    { etiqueta: 'Mínimo', valor: stats.minimo, valorTexto: clp(stats.minimo), color: TOKENS.color.tintaSuave },
    { etiqueta: 'Percentil 25', valor: stats.p25, valorTexto: clp(stats.p25), color: TOKENS.color.marca },
    { etiqueta: 'Mediana', valor: stats.mediana, valorTexto: clp(stats.mediana), color: TOKENS.color.marca },
    { etiqueta: 'Promedio', valor: stats.promedio, valorTexto: clp(stats.promedio), color: TOKENS.color.alerta },
    { etiqueta: 'Máximo', valor: stats.maximo, valorTexto: clp(stats.maximo), color: TOKENS.color.critico },
  ], { anchoEtiqueta: 130 });
}

export function renderPrecioInforme(data: PrecioInformeData): string {
  const d = data.datos;
  const formato = data.formato ?? FORMATO_POR_DEFECTO;
  const stats = d.estadisticas_precio_unitario ?? d.estadisticas_monto_neto;
  const glosaBase = d.base_de_la_sugerencia === 'precio_unitario' ? 'precio unitario' : 'monto neto';
  const motivos = d.cobertura.motivos_de_inadmisibilidad;

  const cuerpo = `
${portada({
  eyebrow: 'Mercado Público · Compra Ágil',
  titulo: 'Precios de mercado',
  subtitulo: d.termino_busqueda,
  meta: [
    { label: 'Alcance', valor: d.region_analisis },
    { label: 'Generado', valor: fechaLarga(data.generadoEn) },
    { label: 'Cotizaciones', valor: String(d.cobertura.cotizaciones_totales) },
  ],
})}

${d.contexto ? `<p><small>${esc(d.contexto)}</small></p>` : ''}

${kpiRow([
  { label: 'Sugerido (p25)', valor: clp(d.precio_sugerido_competitivo), nota: glosaBase },
  { label: 'Desde', valor: clp(d.rango_competitivo.desde), nota: 'mínimo observado' },
  { label: 'Hasta la mediana', valor: clp(d.rango_competitivo.hasta) },
  { label: 'Muestra', valor: numero(stats?.muestras ?? 0), nota: d.muestra_homogenea ? 'homogénea' : 'dispersa' },
])}

${d._advertencia_dispersion ? callout('Muestra dispersa', `<p style="margin:0">${esc(d._advertencia_dispersion)}</p>`, 'critico') : ''}

${d.cobertura._aviso_cobertura ? callout('Cobertura incompleta', `<p style="margin:0">${esc(d.cobertura._aviso_cobertura)}</p>`, 'alerta') : ''}

${stats ? `<h2>Distribución de ${esc(glosaBase)}</h2>${distribucion(stats)}` : ''}

<h2>Cotizaciones observadas</h2>
${tabla(d.cotizaciones_observadas, [
  {
    header: 'Proceso',
    ancho: '32mm',
    celda: (c) => `<span class="mono">${esc(c.codigo_proceso)}</span><br><small>${esc(c.institucion)}</small>`,
  },
  {
    header: 'Proveedor',
    celda: (c) => {
      const motivo = !c.admisible && c.motivo_inadmisibilidad
        ? `<br><small>${esc(c.motivo_inadmisibilidad)}</small>`
        : '';
      return `${esc(c.proveedor)}${motivo}`;
    },
  },
  { header: 'Unitario', ancho: '24mm', numerica: true, celda: (c) => clp(c.precio_unitario) },
  { header: 'Neto', ancho: '24mm', numerica: true, celda: (c) => clp(c.monto_neto) },
  {
    header: 'Estado',
    ancho: '24mm',
    celda: (c) => badge(c.admisible ? 'Admisible' : 'Inadmisible', c.admisible ? 'exito' : 'alerta'),
  },
])}

${motivos.length > 0 ? callout('Motivos de inadmisibilidad', `<p style="margin:0">${esc(motivos.join(' · '))}</p>`) : ''}

${callout('Cómo leer estos precios', `<p style="margin:0">${esc(d._nota_metodologica)} ${esc(d.criterio_sugerencia)}</p>`)}

${pieDoc(`Informe generado por mcp-compra-agil el ${fecha(data.generadoEn.toISOString())}. Precios cotizados en procesos desiertos, no adjudicados. · Formato de impresión: ${PAPEL[formato].glosa}`)}
`.trim();

  return renderDocumento({
    titulo: `Precios de mercado — ${d.termino_busqueda}`,
    cuerpo,
    formato,
  });
}
