/**
 * Design system de los informes — print-first.
 *
 * Decisiones de diseño:
 * - El papel es blanco: no hay modo oscuro. Se optimiza contraste, no "look".
 * - Se evitan fondos de página completos (gasto de tinta); el color se usa
 *   como acento semántico y en superficies pequeñas (badges, cabeceras de tabla).
 * - Toda la escala (tipografía, espaciado, color) vive aquí: un template nunca
 *   debe inventar un color o un tamaño suelto.
 * - Unidades en mm/pt para impresión; rem solo para texto.
 */

/**
 * Formatos de papel soportados.
 *
 * OJO con el Oficio: en Chile mide 216 × 330 mm. NO equivale al `legal` de CSS
 * (216 × 356 mm, que es el US Legal) — usarlo agregaría 26 mm de alto y descuadraría
 * la caja de texto. Por eso se declara con dimensiones explícitas.
 *
 * Carta es el formato de oficina más habitual en Chile; A4 es el estándar ISO
 * y el default de la mayoría de impresoras; Oficio/Folio se usa en documentos
 * oficiales y legales.
 */
export type FormatoPapel = 'a4' | 'carta' | 'oficio';

export interface DefinicionPapel {
  /** Valor para la regla CSS `@page { size: ... }`. */
  size: string;
  ancho: string;
  alto: string;
  glosa: string;
  /** Dimensiones en mm para exportadores (ej. Puppeteer width/height). */
  mm: { ancho: number; alto: number };
}

export const PAPEL: Record<FormatoPapel, DefinicionPapel> = {
  a4: {
    size: 'A4',
    ancho: '210mm',
    alto: '297mm',
    glosa: 'A4 (210 × 297 mm)',
    mm: { ancho: 210, alto: 297 },
  },
  carta: {
    size: 'letter',
    ancho: '216mm',
    alto: '279mm',
    glosa: 'Carta (216 × 279 mm)',
    mm: { ancho: 216, alto: 279 },
  },
  oficio: {
    // Oficio/Folio chileno: dimensiones explícitas, NO el `legal` de CSS.
    size: '216mm 330mm',
    ancho: '216mm',
    alto: '330mm',
    glosa: 'Oficio / Folio (216 × 330 mm)',
    mm: { ancho: 216, alto: 330 },
  },
};

export const FORMATO_POR_DEFECTO: FormatoPapel = 'carta';

export const TOKENS = {
  // Paleta institucional sobria — azul pizarra + acentos semánticos
  color: {
    tinta: '#12263a',        // texto principal
    tintaSuave: '#5b6b7c',   // texto secundario
    tintaTenue: '#8a97a5',   // metadatos
    marca: '#1b4965',        // primario (encabezados, líneas)
    marcaClara: '#e7eef4',   // superficies suaves
    borde: '#d6dee6',
    exito: '#1b6b4a',
    exitoFondo: '#e6f4ec',
    alerta: '#8a5a00',
    alertaFondo: '#fdf2dd',
    critico: '#9b2226',
    criticoFondo: '#fbe9e9',
    papel: '#ffffff',
  },
  // Escala tipográfica modular (ratio ~1.25) anclada a 10.5pt de cuerpo
  fuente: {
    familia: "'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif",
    mono: "'Cascadia Mono', 'SF Mono', Consolas, monospace",
    cuerpo: '10.5pt',
    micro: '7.5pt',
    pequena: '8.5pt',
    h3: '11pt',
    h2: '13pt',
    h1: '18pt',
    portada: '26pt',
  },
  espacio: {
    xs: '2mm',
    sm: '3mm',
    md: '5mm',
    lg: '8mm',
    xl: '12mm',
  },
  pagina: {
    margen: '16mm 15mm 18mm 15mm',
  },
} as const;

/**
 * Hoja de estilos base del informe. Se inyecta inline en el HTML
 * (los informes deben ser un único archivo autocontenido y portable).
 *
 * @param formato Tamaño de papel. Por defecto Carta (el más usado en oficinas chilenas).
 */
export function baseCSS(formato: FormatoPapel = FORMATO_POR_DEFECTO): string {
  const t = TOKENS;
  const papel = PAPEL[formato];
  return `
@page {
  size: ${papel.size};
  margin: ${t.pagina.margen};
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: ${t.color.papel};
  color: ${t.color.tinta};
  font-family: ${t.fuente.familia};
  font-size: ${t.fuente.cuerpo};
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── Tipografía ────────────────────────────────────────────── */
h1, h2, h3 {
  color: ${t.color.marca};
  margin: 0 0 ${t.espacio.sm} 0;
  line-height: 1.2;
  break-after: avoid;
  page-break-after: avoid;
}
h1 { font-size: ${t.fuente.h1}; }
h2 {
  font-size: ${t.fuente.h2};
  margin-top: ${t.espacio.lg};
  padding-bottom: ${t.espacio.xs};
  border-bottom: 1.5pt solid ${t.color.marca};
}
h3 { font-size: ${t.fuente.h3}; margin-top: ${t.espacio.md}; }
p { margin: 0 0 ${t.espacio.sm} 0; orphans: 3; widows: 3; }
strong { color: ${t.color.tinta}; }
small { font-size: ${t.fuente.pequena}; color: ${t.color.tintaSuave}; }

/* ── Portada ───────────────────────────────────────────────── */
.portada {
  border-top: 4pt solid ${t.color.marca};
  padding-top: ${t.espacio.md};
  margin-bottom: ${t.espacio.lg};
}
.portada .eyebrow {
  font-size: ${t.fuente.micro};
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${t.color.tintaTenue};
  margin-bottom: ${t.espacio.xs};
}
.portada .titulo {
  font-size: ${t.fuente.portada};
  font-weight: 600;
  color: ${t.color.marca};
  line-height: 1.15;
  margin: 0 0 ${t.espacio.sm} 0;
}
.portada .subtitulo {
  font-size: ${t.fuente.h3};
  color: ${t.color.tintaSuave};
  font-weight: 400;
  margin: 0;
}
.portada .meta {
  margin-top: ${t.espacio.md};
  padding-top: ${t.espacio.sm};
  border-top: 0.5pt solid ${t.color.borde};
  font-size: ${t.fuente.pequena};
  color: ${t.color.tintaSuave};
  display: flex;
  flex-wrap: wrap;
  gap: ${t.espacio.md};
}
.portada .meta b { color: ${t.color.tinta}; font-weight: 600; }

/* ── KPIs ──────────────────────────────────────────────────── */
.kpi-row {
  display: flex;
  gap: ${t.espacio.sm};
  margin: ${t.espacio.md} 0;
  break-inside: avoid;
  page-break-inside: avoid;
}
.kpi {
  flex: 1;
  border: 0.5pt solid ${t.color.borde};
  border-left: 2.5pt solid ${t.color.marca};
  border-radius: 1mm;
  padding: ${t.espacio.sm};
  background: ${t.color.marcaClara};
}
.kpi .label {
  font-size: ${t.fuente.micro};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${t.color.tintaSuave};
  margin-bottom: 1mm;
}
.kpi .valor {
  font-size: ${t.fuente.h2};
  font-weight: 600;
  color: ${t.color.marca};
  line-height: 1.1;
}
.kpi .nota { font-size: ${t.fuente.micro}; color: ${t.color.tintaTenue}; margin-top: 0.5mm; }

/* ── Tablas ────────────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: ${t.fuente.pequena};
  margin: ${t.espacio.sm} 0;
}
thead { display: table-header-group; } /* repite cabecera al saltar de página */
tr { break-inside: avoid; page-break-inside: avoid; }
th {
  background: ${t.color.marca};
  color: #fff;
  text-align: left;
  padding: 1.8mm 2mm;
  font-size: ${t.fuente.micro};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
td {
  padding: 1.8mm 2mm;
  border-bottom: 0.5pt solid ${t.color.borde};
  vertical-align: top;
}
tbody tr:nth-child(even) td { background: #fafbfc; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mono { font-family: ${t.fuente.mono}; font-size: ${t.fuente.micro}; }

/* ── Badges ────────────────────────────────────────────────── */
.badge {
  display: inline-block;
  padding: 0.6mm 1.6mm;
  border-radius: 1mm;
  font-size: ${t.fuente.micro};
  font-weight: 600;
  white-space: nowrap;
}
.badge-exito   { background: ${t.color.exitoFondo};   color: ${t.color.exito}; }
.badge-alerta  { background: ${t.color.alertaFondo};  color: ${t.color.alerta}; }
.badge-critico { background: ${t.color.criticoFondo}; color: ${t.color.critico}; }
.badge-neutro  { background: ${t.color.marcaClara};   color: ${t.color.marca}; }

/* ── Callouts ──────────────────────────────────────────────── */
.callout {
  border-left: 2.5pt solid ${t.color.marca};
  background: ${t.color.marcaClara};
  padding: ${t.espacio.sm};
  margin: ${t.espacio.sm} 0;
  border-radius: 0 1mm 1mm 0;
  break-inside: avoid;
  page-break-inside: avoid;
  font-size: ${t.fuente.pequena};
}
.callout .titulo { font-weight: 600; color: ${t.color.marca}; margin-bottom: 1mm; }
.callout-alerta  { border-left-color: ${t.color.alerta};  background: ${t.color.alertaFondo}; }
.callout-alerta .titulo { color: ${t.color.alerta}; }
.callout-critico { border-left-color: ${t.color.critico}; background: ${t.color.criticoFondo}; }
.callout-critico .titulo { color: ${t.color.critico}; }

/* ── Gráficos ──────────────────────────────────────────────── */
.chart { margin: ${t.espacio.md} 0; break-inside: avoid; page-break-inside: avoid; }
.chart svg { width: 100%; height: auto; }

/* ── Utilidades de paginación ──────────────────────────────── */
.salto-pagina { break-before: page; page-break-before: always; }
.no-cortar { break-inside: avoid; page-break-inside: avoid; }

/* ── Pie de documento ──────────────────────────────────────── */
.pie-doc {
  margin-top: ${t.espacio.lg};
  padding-top: ${t.espacio.sm};
  border-top: 0.5pt solid ${t.color.borde};
  font-size: ${t.fuente.micro};
  color: ${t.color.tintaTenue};
}

/* ── Solo pantalla: simula la hoja al abrir en el navegador ── */
/* El ancho sigue al formato real (${papel.glosa}) para que lo que se ve
   en pantalla coincida con lo que sale impreso. */
@media screen {
  body {
    max-width: ${papel.ancho};
    margin: 8mm auto;
    padding: 16mm 15mm;
    box-shadow: 0 0 0 1px #e5e7eb, 0 4px 24px rgba(0,0,0,.07);
  }
}
`.trim();
}
