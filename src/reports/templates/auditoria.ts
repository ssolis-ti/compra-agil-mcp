/**
 * Template: auditoría de un proceso desierto.
 *
 * Recibe el mismo objeto que devuelve `auditar_compras_desiertas`,
 * incluidas las recomendaciones ya redactadas.
 */

import type { DatosAuditoria } from '../../tools/auditar-desiertas.js';
import { renderDocumento } from '../render.js';
import { portada, kpiRow, tabla, badge, callout, lista, pieDoc, esc } from '../components.js';
import { clp, numero, fechaLarga, instante } from '../format.js';
import { PAPEL, FORMATO_POR_DEFECTO, type FormatoPapel } from '../theme.js';

export interface AuditoriaInformeData {
  datos: DatosAuditoria;
  generadoEn: Date;
  formato?: FormatoPapel;
}

/** `null` es «no evaluable»: sin comparables ni evidencia no se afirma que esté en rango. */
function marca(activa: boolean | null, si: string, no: string, tema: string): string {
  if (activa === null) return badge(`${tema}: no evaluable`, 'neutro');
  return badge(activa ? si : no, activa ? 'critico' : 'exito');
}

export function renderAuditoriaInforme(data: AuditoriaInformeData): string {
  const d = data.datos;
  const formato = data.formato ?? FORMATO_POR_DEFECTO;
  const p = d.proceso_auditado;
  const b = d.busqueda_comparativa;
  const g = d.analisis_de_brechas;
  const montos = b.estadisticas_montos_cotizados;

  const cuerpo = `
${portada({
  eyebrow: 'Mercado Público · Compra Ágil',
  titulo: 'Auditoría de desierta',
  subtitulo: p.nombre,
  meta: [
    { label: 'Código', valor: p.codigo },
    { label: 'Estado', valor: p.estado },
    { label: 'Generada', valor: fechaLarga(data.generadoEn) },
  ],
})}

${kpiRow([
  { label: 'Presupuesto', valor: clp(p.presupuesto_disponible), nota: p.region },
  { label: 'Plazo', valor: `${numero(p.duracion_dias, 1)} días`, nota: 'publicación a cierre' },
  // Segundo enjambre: el término aparecía como un rótulo suelto; ahora dice qué es.
  { label: 'Comparables', valor: numero(b.procesos_comparables_con_cotizaciones), nota: `buscados con «${b.termino_clave}»` },
  { label: 'Promedio cotizado', valor: clp(montos?.promedio_cotizado), nota: 'menor monto de cada uno' },
])}

<p>
  ${marca(g.presupuesto_insuficiente, 'Presupuesto bajo', 'Presupuesto en rango', 'Presupuesto')}
  ${marca(g.plazo_insuficiente, 'Plazo corto', 'Plazo en rango', 'Plazo')}
  ${marca(g.requisitos_complejos, 'Requisitos exigentes', 'Sin requisito extra', 'Requisitos')}
</p>
${g.lectura_diferencia ? `<p><small>${esc(g.lectura_diferencia)}</small></p>` : ''}

${callout('Motivo de deserción', `<p style="margin:0">${esc(p.motivo_desierta)}</p>`, p.motivo_desierta === 'No especificado en el sistema' ? 'neutro' : 'alerta')}

${(() => {
  const e = d.evidencia_del_proceso_auditado;
  if (!e) return '';
  const sobre = e.cotizaciones_sobre_presupuesto;
  const lineas = [
    `${numero(e.cotizaciones_recibidas)} cotización(es) recibida(s), ${numero(e.cotizaciones_inadmisibles)} inadmisible(s).`,
    e.menor_monto_neto !== null
      ? `Menor monto cotizado: ${clp(e.menor_monto_neto)} neto${e.menor_monto_total !== null ? ` (${clp(e.menor_monto_total)} con IVA)` : ''}, frente a un presupuesto de ${clp(p.presupuesto_disponible)}.`
      : '',
    sobre !== null && e.cotizaciones_recibidas > 0 ? `${numero(sobre)} de ${numero(e.cotizaciones_recibidas)} superan el presupuesto en neto.` : '',
    e.motivos_de_inadmisibilidad.length > 0 ? `Motivos de inadmisibilidad: ${e.motivos_de_inadmisibilidad.join('; ')}.` : '',
  ].filter(Boolean).map((l) => `<p style="margin:0">${esc(l)}</p>`).join('');
  return callout('Evidencia del propio proceso', lineas, sobre ? 'alerta' : 'neutro');
})()}

${b._aviso_cobertura ? callout('Cobertura incompleta', `<p style="margin:0">${esc(b._aviso_cobertura)}</p>`, 'alerta') : ''}

<h2>Recomendaciones</h2>
${lista(d.recomendaciones_de_optimizacion)}

${p.items_solicitados.length > 0 ? `<h2>Ítems solicitados</h2>${tabla(p.items_solicitados, [
  { header: 'Ítem', celda: (it) => esc(it.nombre) },
  { header: 'Cantidad', ancho: '22mm', numerica: true, celda: (it) => numero(it.cantidad) },
  { header: 'Unidad', ancho: '22mm', celda: (it) => esc(it.unidad) },
])}` : ''}

<h2>Procesos comparables</h2>
${tabla(d.procesos_comparables_analizados, [
  { header: 'Código', ancho: '28mm', celda: (c) => `<span class="mono">${esc(c.codigo)}</span>` },
  { header: 'Institución', celda: (c) => esc(c.institucion) },
  { header: 'Menor cotizado', ancho: '28mm', numerica: true, celda: (c) => clp(c.menor_monto_cotizado) },
  { header: 'Días', ancho: '16mm', numerica: true, celda: (c) => numero(c.duracion_dias, 1) },
  {
    header: 'Inadmisibles',
    ancho: '24mm',
    numerica: true,
    celda: (c) => `${numero(c.cotizaciones_inadmisibles)}/${numero(c.cotizaciones_recibidas)}`,
  },
])}

${callout('Cómo se compara', `<p style="margin:0">${esc(d._nota_metodologica)}</p>`)}

${pieDoc(`Informe generado por mcp-compra-agil el ${instante(data.generadoEn)}. La comparación usa montos cotizados, no adjudicados. · Formato de impresión: ${PAPEL[formato].glosa}`)}
`.trim();

  return renderDocumento({
    titulo: `Auditoría ${p.codigo}`,
    cuerpo,
    formato,
  });
}
