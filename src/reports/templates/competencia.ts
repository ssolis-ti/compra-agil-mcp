/**
 * Template: tabla comparativa de cotizantes y spread.
 *
 * No nombra un adjudicado. Una justificación de inadmisibilidad se muestra.
 */

import type { DatosCompetencia } from '../../utils/competencia.js';
import { renderDocumento } from '../render.js';
import { portada, kpiRow, tabla, badge, callout, pieDoc, esc } from '../components.js';
import { clp, numero, porcentaje, fechaLarga, instante, rut } from '../format.js';
import { sinContactos } from '../../utils/privacidad.js';
import { PAPEL, FORMATO_POR_DEFECTO, type FormatoPapel } from '../theme.js';

export interface CompetenciaInformeData {
  datos: DatosCompetencia;
  generadoEn: Date;
  formato?: FormatoPapel;
}

export function renderCompetenciaInforme(data: CompetenciaInformeData): string {
  const d = data.datos;
  const formato = data.formato ?? FORMATO_POR_DEFECTO;
  const s = d.spread;

  const cuerpo = `
${portada({
  eyebrow: 'Mercado Público · Compra Ágil',
  titulo: 'Competencia del proceso',
  subtitulo: d.nombre,
  meta: [
    { label: 'Código', valor: d.codigo },
    { label: 'Organismo', valor: d.organismo },
    { label: 'Generado', valor: fechaLarga(data.generadoEn) },
  ],
})}

${kpiRow([
  { label: 'Cotizaciones', valor: numero(s.cotizaciones), nota: `${numero(s.admisibles)} admisibles` },
  { label: 'Menor neto', valor: clp(s.neto_minimo) },
  { label: 'Mayor neto', valor: clp(s.neto_maximo) },
  {
    label: 'Brecha',
    valor: clp(s.brecha_neto),
    nota: s.brecha_porcentaje === null ? 'hace falta más de una' : porcentaje(s.brecha_porcentaje, 0),
  },
])}

<p><small>${esc(d.estado)} · ${esc(d.region)} · presupuesto ${clp(d.presupuesto_clp)} ${esc(d.moneda)}</small></p>

${d.cotizantes.length === 0
  ? callout('Sin cotizaciones', '<p style="margin:0">Este proceso no trae proveedores cotizando. La API no publica un adjudicado en su lugar.</p>', 'alerta')
  : `<h2>Cotizantes</h2>${tabla(d.cotizantes, [
    {
      header: 'Proveedor',
      celda: (c) => {
        const extra = c.justificacion_inadmisibilidad
          ? `<br><small>${esc(c.justificacion_inadmisibilidad)}</small>`
          : '';
        // E8: sin teléfonos ni correos personales de la descripción libre.
        const desc = c.descripcion ? `<br><small>${esc(sinContactos(c.descripcion))}</small>` : '';
        return `<b>${esc(c.razon_social)}</b><br><span class="mono">${esc(rut(c.rut))}</span>${desc}${extra}`;
      },
    },
    { header: 'Neto', ancho: '24mm', numerica: true, celda: (c) => clp(c.valor_neto) },
    { header: 'Total', ancho: '24mm', numerica: true, celda: (c) => clp(c.monto_total) },
    {
      header: 'EMT',
      ancho: '14mm',
      celda: (c) => badge(c.es_empresa_menor_tamano ? 'Sí' : 'No', 'neutro'),
    },
    {
      header: 'Estado',
      ancho: '24mm',
      celda: (c) => badge(c.admisible ? 'Admisible' : 'Inadmisible', c.admisible ? 'exito' : 'alerta'),
    },
  ])}`}

${callout('Qué no dice esta tabla', `<p style="margin:0">${esc(d._nota)}</p>`)}

${pieDoc(`Informe generado por mcp-compra-agil el ${instante(data.generadoEn)}. Orden por monto neto. No hay proveedor adjudicado en estos datos. · Formato de impresión: ${PAPEL[formato].glosa}`)}
`.trim();

  return renderDocumento({
    titulo: `Competencia ${d.codigo}`,
    cuerpo,
    formato,
  });
}
