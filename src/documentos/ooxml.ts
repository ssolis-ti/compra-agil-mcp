/**
 * Lectores de Word (.docx) y Excel (.xlsx) sobre fflate (2.10.0, L1, L3, S2).
 *
 * Los dos formatos son un ZIP de XML. Se leen solo los textos y los valores
 * guardados: nunca se ejecuta una macro ni se evalúa una fórmula. Sin
 * dependencias además de fflate (ADR 0029).
 */

import { unzipSync, strFromU8 } from 'fflate';
import { LIMITES } from './limites.js';

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const desescapar = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTIDADES[e] ?? m);

/** Descomprime solo las rutas pedidas, con tope de tamaño (S3). */
function abrir(datos: Uint8Array, quiero: (ruta: string) => boolean): Record<string, string> {
  let total = 0;
  const archivos = unzipSync(datos, {
    filter: (f) => {
      if (!quiero(f.name)) return false;
      total += f.originalSize;
      if (total > LIMITES.descomprimidoMaxBytes) throw new Error(`el archivo descomprimido pasa de ${LIMITES.descomprimidoMaxBytes / 1024 / 1024} MB`);
      return true;
    },
  });
  return Object.fromEntries(Object.entries(archivos).map(([k, v]) => [k, strFromU8(v)]));
}

// ─── Word ──────────────────────────────────────────────────────────────

/** Texto de un párrafo: <w:t>, tabulaciones y saltos. */
function textoDeParrafo(xml: string): string {
  let s = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
    if (m[1] !== undefined) s += desescapar(m[1]);
    else s += m[0] === '<w:tab/>' ? '\t' : '\n';
  }
  return s;
}

/** Fin del elemento que abre en `desde` (cuenta anidados del mismo nombre). */
function cierre(xml: string, desde: number, etiqueta: string): number {
  const re = new RegExp(`<(/?)${etiqueta}(?=[\\s>/])[^>]*?(/?)>`, 'g');
  re.lastIndex = desde;
  let nivel = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[2] === '/') { if (nivel === 0) return re.lastIndex; continue; }
    nivel += m[1] === '/' ? -1 : 1;
    if (nivel === 0) return re.lastIndex;
  }
  return xml.length;
}

/** Párrafos y tablas en orden. Las tablas, una fila por línea: «celda | celda». */
function bloquesWord(xml: string): string[] {
  const salida: string[] = [];
  const re = /<w:(tbl|p)(?=[\s>])/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const fin = cierre(xml, m.index, `w:${m[1]}`);
    const trozo = xml.slice(m.index, fin);
    if (m[1] === 'p') {
      salida.push(textoDeParrafo(trozo));
    } else {
      for (const fila of filasDeTabla(trozo)) salida.push(fila);
    }
    re.lastIndex = fin;
  }
  return salida;
}

function filasDeTabla(xml: string): string[] {
  const filas: string[] = [];
  const reFila = /<w:tr(?=[\s>])/g;
  for (let f = reFila.exec(xml); f; f = reFila.exec(xml)) {
    const finFila = cierre(xml, f.index, 'w:tr');
    const fila = xml.slice(f.index, finFila);
    const celdas: string[] = [];
    const reCelda = /<w:tc(?=[\s>])/g;
    for (let c = reCelda.exec(fila); c; c = reCelda.exec(fila)) {
      const finCelda = cierre(fila, c.index, 'w:tc');
      celdas.push(bloquesWord(fila.slice(c.index, finCelda)).map((x) => x.trim()).filter(Boolean).join(' '));
      reCelda.lastIndex = finCelda;
    }
    if (celdas.some(Boolean)) filas.push(celdas.join(' | '));
    reFila.lastIndex = finFila;
  }
  return filas;
}

export function leerDocx(datos: Uint8Array): string {
  const xml = abrir(datos, (r) => r === 'word/document.xml')['word/document.xml'];
  if (!xml) throw new Error('el .docx no tiene word/document.xml');
  const cuerpo = xml.slice(Math.max(0, xml.indexOf('<w:body')));
  return bloquesWord(cuerpo).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Excel ─────────────────────────────────────────────────────────────

export interface Hoja { nombre: string; filas: string[][] }

const columna = (ref: string) => {
  let n = 0;
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

/** Valores guardados de cada celda; una fórmula entrega su último resultado, nunca se evalúa. */
export function leerXlsx(datos: Uint8Array): Hoja[] {
  const a = abrir(datos, (r) => r === 'xl/workbook.xml' || r === 'xl/_rels/workbook.xml.rels' || r === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(r));
  const compartidos = [...(a['xl/sharedStrings.xml'] ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => desescapar(t[1])).join(''));
  const rels = Object.fromEntries([...(a['xl/_rels/workbook.xml.rels'] ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1]?.replace(/^\/?xl\//, '').replace(/^\//, ''),
  ]));
  const hojas: Hoja[] = [];
  for (const m of (a['xl/workbook.xml'] ?? '').matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = desescapar(m[0].match(/name="([^"]*)"/)?.[1] ?? 'Hoja');
    const destino = rels[m[0].match(/r:id="([^"]+)"/)?.[1] ?? ''];
    const xml = destino ? a[`xl/${destino}`] : undefined;
    if (!xml) continue;
    const filas: string[][] = [];
    for (const fila of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (filas.length >= LIMITES.filasPorHoja) break;
      const celdas: string[] = [];
      for (const c of fila[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const cuerpo = c[2] ?? '';
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const tipo = attrs.match(/t="([^"]+)"/)?.[1];
        const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let valor = '';
        if (tipo === 's' && v !== undefined) valor = compartidos[Number(v)] ?? '';
        else if (tipo === 'inlineStr') valor = [...cuerpo.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => desescapar(t[1])).join('');
        else if (tipo === 'b' && v !== undefined) valor = v === '1' ? 'VERDADERO' : 'FALSO';
        else if (v !== undefined) valor = desescapar(v);
        const i = ref ? columna(ref) : celdas.length;
        while (celdas.length < i) celdas.push('');
        celdas[i] = valor.trim();
      }
      while (celdas.length > 0 && !celdas[celdas.length - 1]) celdas.pop();
      if (celdas.some(Boolean)) filas.push(celdas);
    }
    hojas.push({ nombre, filas });
  }
  return hojas;
}

export const hojasEnTexto = (hojas: Hoja[]) =>
  hojas.map((h) => `## Hoja: ${h.nombre}\n${h.filas.map((f) => f.join(' | ')).join('\n')}`).join('\n\n');
