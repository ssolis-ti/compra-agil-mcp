/**
 * Template: Informe de Radar de Oportunidades.
 *
 * Recibe datos ya recolectados (no consulta la API) — así el mismo dataset
 * alimenta tanto la respuesta JSON de la tool como este informe.
 */

import { renderDocumento } from '../render.js';
import {
  portada, kpiRow, tabla, badge, callout, barChartSVG, pieDoc, esc,
  type TonoBadge,
} from '../components.js';
import { clp, numero, fecha, fechaLarga, horasRestantes } from '../format.js';
import { TOKENS, PAPEL, FORMATO_POR_DEFECTO, type FormatoPapel } from '../theme.js';

/** Forma mínima que el informe necesita de cada oportunidad. */
export interface OportunidadInforme {
  codigo: string;
  nombre: string;
  organismo: string;
  region: string;
  presupuesto_disponible: number;
  ofertas_recibidas: number;
  horas_restantes: number;
  fecha_cierre: string;
  puntuacion_caliente: number;
  factores_calificacion: string[];
}

export interface RadarInformeData {
  oportunidades: OportunidadInforme[];
  totalAnalizadas: number;
  filtros: {
    region?: string;
    q?: string;
    presupuestoMinimo?: number;
    paginasEscaneadas: number;
  };
  generadoEn: Date;
  /** Tamaño de papel del informe. Por defecto Carta. */
  formato?: FormatoPapel;
}

/** Clasifica el hot score en un tono semántico. Máximo teórico: 105 pts. */
export function tonoScore(score: number): { tono: TonoBadge; glosa: string } {
  if (score >= 80) return { tono: 'critico', glosa: 'Muy caliente' };
  if (score >= 55) return { tono: 'alerta', glosa: 'Caliente' };
  if (score >= 30) return { tono: 'neutro', glosa: 'Templada' };
  return { tono: 'neutro', glosa: 'Fría' };
}

function colorScore(score: number): string {
  if (score >= 80) return TOKENS.color.critico;
  if (score >= 55) return TOKENS.color.alerta;
  return TOKENS.color.marca;
}

export function renderRadarInforme(data: RadarInformeData): string {
  const { filtros } = data;
  const formato = data.formato ?? FORMATO_POR_DEFECTO;

  // Orden defensivo: aunque `recolectarDatosRadar` ya entrega los datos rankeados,
  // el template no debe confiar en el orden de su entrada — un gráfico "Top N"
  // desordenado es un error visible y silencioso. Ordenar aquí es O(n log n) sobre
  // decenas de filas y hace al template correcto ante cualquier llamador.
  const ops = [...data.oportunidades].sort((a, b) => b.puntuacion_caliente - a.puntuacion_caliente);

  // ── KPIs de cabecera ──
  const sinOferentes = ops.filter((o) => o.ofertas_recibidas === 0).length;
  const cierran24h = ops.filter((o) => o.horas_restantes <= 24).length;
  const montoTotal = ops.reduce((acc, o) => acc + (o.presupuesto_disponible || 0), 0);

  const kpis = kpiRow([
    { label: 'Oportunidades', valor: numero(ops.length), nota: `de ${numero(data.totalAnalizadas)} analizadas` },
    { label: 'Sin oferentes', valor: numero(sinOferentes), nota: 'competencia cero' },
    { label: 'Cierran en 24h', valor: numero(cierran24h), nota: 'requieren acción' },
    { label: 'Monto en juego', valor: clp(montoTotal), nota: 'presupuesto sumado' },
  ]);

  // ── Filtros aplicados ──
  const filtrosTexto = [
    filtros.region ? `Región ${filtros.region}` : 'Todas las regiones',
    filtros.q ? `Búsqueda: “${filtros.q}”` : 'Sin filtro de rubro',
    filtros.presupuestoMinimo ? `Presupuesto ≥ ${clp(filtros.presupuestoMinimo)}` : 'Sin mínimo de presupuesto',
    `${filtros.paginasEscaneadas} página(s) escaneada(s)`,
  ].join(' · ');

  // ── Gráfico: top 10 por puntuación ──
  const top = ops.slice(0, 10);
  const grafico = top.length > 0
    ? barChartSVG(
        top.map((o) => ({
          etiqueta: o.nombre,
          valor: o.puntuacion_caliente,
          valorTexto: `${o.puntuacion_caliente} pts`,
          color: colorScore(o.puntuacion_caliente),
        }))
      )
    : '';

  // ── Tabla principal ──
  const tablaOps = tabla(ops, [
    {
      header: '#',
      ancho: '6mm',
      celda: (_o, i) => `<span class="num">${i + 1}</span>`,
    },
    {
      header: 'Código',
      ancho: '28mm',
      celda: (o) => `<span class="mono">${esc(o.codigo)}</span>`,
    },
    {
      header: 'Proceso',
      celda: (o) => `${esc(o.nombre)}<br><small>${esc(o.organismo)}</small>`,
    },
    {
      header: 'Región',
      ancho: '20mm',
      celda: (o) => esc(o.region),
    },
    {
      header: 'Presupuesto',
      ancho: '22mm',
      numerica: true,
      celda: (o) => clp(o.presupuesto_disponible),
    },
    {
      header: 'Ofertas',
      ancho: '14mm',
      numerica: true,
      celda: (o) =>
        o.ofertas_recibidas === 0
          ? badge('0', 'exito')
          : `${numero(o.ofertas_recibidas)}`,
    },
    {
      header: 'Cierra en',
      ancho: '18mm',
      numerica: true,
      celda: (o) => {
        const txt = horasRestantes(o.horas_restantes);
        return o.horas_restantes <= 12 ? badge(txt, 'critico') : esc(txt);
      },
    },
    {
      header: 'Score',
      ancho: '22mm',
      numerica: true,
      celda: (o) => {
        const { tono, glosa } = tonoScore(o.puntuacion_caliente);
        return `${badge(`${o.puntuacion_caliente} · ${glosa}`, tono)}`;
      },
    },
  ]);

  // ── Fichas detalladas del top 3 ──
  const fichas = ops.slice(0, 3).map((o, i) => {
    const { tono } = tonoScore(o.puntuacion_caliente);
    const cuerpo = `
      <p style="margin-bottom:2mm"><b>${esc(o.organismo)}</b> — ${esc(o.region)}<br>
      <span class="mono">${esc(o.codigo)}</span></p>
      <p style="margin-bottom:2mm">
        Presupuesto <b>${clp(o.presupuesto_disponible)}</b> ·
        Ofertas recibidas: <b>${numero(o.ofertas_recibidas)}</b> ·
        Cierra el <b>${fecha(o.fecha_cierre)}</b> (${esc(horasRestantes(o.horas_restantes))})
      </p>
      <div><small>Factores de puntuación:</small>
        <ul style="margin:1mm 0 0;padding-left:4mm">
          ${o.factores_calificacion.map((f) => `<li><small>${esc(f)}</small></li>`).join('')}
        </ul>
      </div>`;
    return callout(`${i + 1}. ${o.nombre} — ${o.puntuacion_caliente} pts`, cuerpo, tono === 'exito' ? 'neutro' : tono);
  }).join('');

  // ── Ensamblado ──
  const cuerpo = `
${portada({
  eyebrow: 'Mercado Público · Compra Ágil',
  titulo: 'Radar de Oportunidades',
  subtitulo: 'Procesos activos priorizados por facilidad de adjudicación',
  meta: [
    { label: 'Generado', valor: fechaLarga(data.generadoEn) },
    { label: 'Alcance', valor: filtros.region ? `Región ${filtros.region}` : 'Nacional' },
    { label: 'Oportunidades', valor: String(ops.length) },
  ],
})}

${kpis}

<p><small>${esc(filtrosTexto)}</small></p>

${ops.length === 0 ? callout('Sin resultados', '<p>No se encontraron Compras Ágiles activas que coincidan con los filtros aplicados.</p>', 'alerta') : ''}

${top.length > 0 ? `<h2>Top ${top.length} por puntuación</h2>${grafico}` : ''}

${fichas ? `<h2>Oportunidades destacadas</h2>${fichas}` : ''}

${ops.length > 0 ? `<h2>Listado completo</h2>${tablaOps}` : ''}

${callout(
  'Cómo se calcula la puntuación',
  `<p style="margin:0">Fórmula ponderada sobre 105 puntos: baja competencia (hasta 50 pts) + urgencia de cierre (hasta 30 pts) + tamaño de presupuesto (hasta 20 pts) + ausencia de bases adjuntas (5 pts). Una puntuación alta indica un proceso con pocos oferentes, cierre próximo y monto atractivo.</p>`
)}

${pieDoc(`Informe generado automáticamente por mcp-compra-agil el ${fecha(data.generadoEn.toISOString())} a partir de datos públicos de la API Compra Ágil v2 de Mercado Público (ChileCompra). Los datos reflejan el estado al momento de la consulta y pueden variar. · Formato de impresión: ${PAPEL[formato].glosa}`)}
`.trim();

  return renderDocumento({
    titulo: `Radar de Oportunidades — ${fechaLarga(data.generadoEn)}`,
    cuerpo,
    formato,
  });
}
