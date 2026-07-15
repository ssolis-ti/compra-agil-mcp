/**
 * Componentes de informe: funciones puras que emiten fragmentos de HTML.
 *
 * REGLA DE SEGURIDAD: todo dato que provenga de la API (nombres de organismos,
 * razones sociales, descripciones) DEBE pasar por `esc()`. Un nombre con "&" o
 * "<" rompería el documento — y en un HTML que el usuario abre en su navegador,
 * inyectar marcado no escapado es una vulnerabilidad, no solo un bug visual.
 */

import { TOKENS } from './theme.js';

/** Escapa texto para interpolación segura en HTML. */
export function esc(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Portada ──────────────────────────────────────────────────────────

export interface PortadaOpts {
  eyebrow: string;
  titulo: string;
  subtitulo?: string;
  meta?: Array<{ label: string; valor: string }>;
}

export function portada(o: PortadaOpts): string {
  const meta = (o.meta ?? [])
    .map((m) => `<span>${esc(m.label)}: <b>${esc(m.valor)}</b></span>`)
    .join('');
  return `
<header class="portada">
  <div class="eyebrow">${esc(o.eyebrow)}</div>
  <h1 class="titulo">${esc(o.titulo)}</h1>
  ${o.subtitulo ? `<p class="subtitulo">${esc(o.subtitulo)}</p>` : ''}
  ${meta ? `<div class="meta">${meta}</div>` : ''}
</header>`.trim();
}

// ─── KPIs ─────────────────────────────────────────────────────────────

export interface Kpi {
  label: string;
  valor: string;
  nota?: string;
}

export function kpiRow(kpis: Kpi[]): string {
  const items = kpis
    .map(
      (k) => `
    <div class="kpi">
      <div class="label">${esc(k.label)}</div>
      <div class="valor">${esc(k.valor)}</div>
      ${k.nota ? `<div class="nota">${esc(k.nota)}</div>` : ''}
    </div>`
    )
    .join('');
  return `<div class="kpi-row">${items}</div>`;
}

// ─── Tabla ────────────────────────────────────────────────────────────

export interface Columna<T> {
  header: string;
  /** Devuelve HTML ya escapado o seguro (usa `esc()` dentro si interpolas datos). */
  celda: (fila: T, indice: number) => string;
  /** Alinea a la derecha con cifras tabulares. */
  numerica?: boolean;
  ancho?: string;
}

export function tabla<T>(filas: T[], columnas: Array<Columna<T>>): string {
  if (filas.length === 0) {
    return `<p><small>Sin datos para mostrar.</small></p>`;
  }
  const head = columnas
    .map((c) => `<th${c.ancho ? ` style="width:${c.ancho}"` : ''}>${esc(c.header)}</th>`)
    .join('');
  const body = filas
    .map((fila, i) => {
      const celdas = columnas
        .map((c) => `<td${c.numerica ? ' class="num"' : ''}>${c.celda(fila, i)}</td>`)
        .join('');
      return `<tr>${celdas}</tr>`;
    })
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ─── Badge ────────────────────────────────────────────────────────────

export type TonoBadge = 'exito' | 'alerta' | 'critico' | 'neutro';

export function badge(texto: string, tono: TonoBadge = 'neutro'): string {
  return `<span class="badge badge-${tono}">${esc(texto)}</span>`;
}

// ─── Callout ──────────────────────────────────────────────────────────

export function callout(titulo: string, cuerpoHtml: string, tono: 'neutro' | 'alerta' | 'critico' = 'neutro'): string {
  const clase = tono === 'neutro' ? 'callout' : `callout callout-${tono}`;
  return `
<div class="${clase}">
  <div class="titulo">${esc(titulo)}</div>
  <div>${cuerpoHtml}</div>
</div>`.trim();
}

export function lista(items: string[]): string {
  if (items.length === 0) return '';
  return `<ul style="margin:0;padding-left:4mm">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

// ─── Gráfico de barras horizontal (SVG puro, sin dependencias) ────────

export interface BarraDato {
  etiqueta: string;
  valor: number;
  /** Texto mostrado al final de la barra. Por defecto, el valor crudo. */
  valorTexto?: string;
  color?: string;
}

/**
 * Gráfico de barras horizontal en SVG inline.
 *
 * SVG en vez de una librería de charts: es vectorial (imprime nítido a cualquier
 * DPI), no requiere JS en tiempo de impresión y no añade dependencias.
 */
export function barChartSVG(datos: BarraDato[], opts: { ancho?: number; alturaBarra?: number; anchoEtiqueta?: number } = {}): string {
  if (datos.length === 0) return '';

  const ancho = opts.ancho ?? 680;
  const alturaBarra = opts.alturaBarra ?? 22;
  const gap = 8;
  const anchoEtiqueta = opts.anchoEtiqueta ?? 190;
  const margenDerecho = 90;
  const alto = datos.length * (alturaBarra + gap) + gap;
  const anchoUtil = ancho - anchoEtiqueta - margenDerecho;

  const maxValor = Math.max(...datos.map((d) => d.valor), 1);

  const barras = datos
    .map((d, i) => {
      const y = gap + i * (alturaBarra + gap);
      const w = Math.max(1, (d.valor / maxValor) * anchoUtil);
      const color = d.color ?? TOKENS.color.marca;
      const texto = d.valorTexto ?? String(d.valor);
      // Etiqueta truncada para no romper el layout
      const etiqueta = d.etiqueta.length > 30 ? `${d.etiqueta.slice(0, 29)}…` : d.etiqueta;
      return `
    <g>
      <text x="${anchoEtiqueta - 6}" y="${y + alturaBarra / 2}" text-anchor="end" dominant-baseline="central"
            font-size="10" fill="${TOKENS.color.tintaSuave}">${esc(etiqueta)}</text>
      <rect x="${anchoEtiqueta}" y="${y}" width="${anchoUtil}" height="${alturaBarra}" fill="#f1f4f7" rx="2"/>
      <rect x="${anchoEtiqueta}" y="${y}" width="${w.toFixed(1)}" height="${alturaBarra}" fill="${color}" rx="2"/>
      <text x="${anchoEtiqueta + w + 6}" y="${y + alturaBarra / 2}" dominant-baseline="central"
            font-size="10" font-weight="600" fill="${TOKENS.color.tinta}">${esc(texto)}</text>
    </g>`;
    })
    .join('');

  return `
<div class="chart">
  <svg viewBox="0 0 ${ancho} ${alto}" role="img" xmlns="http://www.w3.org/2000/svg">
    ${barras}
  </svg>
</div>`.trim();
}

// ─── Pie de documento ─────────────────────────────────────────────────

export function pieDoc(texto: string): string {
  return `<div class="pie-doc">${esc(texto)}</div>`;
}
