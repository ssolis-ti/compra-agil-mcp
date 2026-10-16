/**
 * Texto de cualquier adjunto (2.10.0, L1–L6, S2, S3).
 *
 * Un solo punto de entrada para PDF, Word (.docx y .doc), Excel (.xlsx), CSV,
 * texto y ZIP. El formato sale del contenido (formato.ts). Los lectores pesados
 * se cargan al usarse, como el de PDF: el arranque no carga nada nativo.
 */

import { unzipSync } from 'fflate';
import { detectarFormato, type Formato } from './formato.js';
import { hojasEnTexto, leerDocx, leerXlsx, type Hoja } from './ooxml.js';
import { LIMITES } from './limites.js';
import { textoDePdf } from '../utils/pdf.js';

export type Lectura =
  | { ok: true; formato: Formato; texto: string; hojas?: Hoja[] }
  | { ok: false; formato: Formato; motivo: string };

const NO_SOPORTADO: Partial<Record<Formato, string>> = {
  imagen: 'es una imagen (foto o escaneo): no tiene texto que leer',
  xls: 'es un Excel antiguo (.xls), que no se lee: ábrelo en Excel',
  desconocido: 'no es un formato que se pueda leer',
};

/** Texto plano: UTF-8, o Latin-1 si no es UTF-8 válido (planillas de Windows). */
function decodificar(datos: Uint8Array): string {
  const sinBom = datos[0] === 0xef && datos[1] === 0xbb && datos[2] === 0xbf ? datos.subarray(3) : datos;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(sinBom);
  } catch {
    return new TextDecoder('latin1').decode(sinBom);
  }
}

/** CSV con «;» o «,», comillas dobles y saltos dentro de comillas. */
export function leerCsv(texto: string): string[][] {
  const primera = texto.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') comillas = false; else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda.trim()); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda.trim()); celda = '';
      if (fila.some(Boolean)) filas.push(fila);
      fila = [];
      if (filas.length >= LIMITES.filasPorHoja) return filas;
    } else celda += c;
  }
  fila.push(celda.trim());
  if (fila.some(Boolean)) filas.push(fila);
  return filas;
}

async function leerDoc(datos: Uint8Array): Promise<string> {
  const { default: WordExtractor } = await import('word-extractor');
  const doc = await new WordExtractor().extract(Buffer.from(datos));
  return doc.getBody().trim();
}

/** Cada archivo legible del ZIP, con su nombre como encabezado. Sin ZIP dentro de ZIP (S3). */
async function leerZip(datos: Uint8Array): Promise<string> {
  let total = 0;
  let cantidad = 0;
  const omitidos: string[] = [];
  const archivos = unzipSync(datos, {
    filter: (f) => {
      if (f.name.endsWith('/')) return false;
      if (cantidad >= LIMITES.archivosEnZip) { omitidos.push(f.name); return false; }
      total += f.originalSize;
      if (total > LIMITES.descomprimidoMaxBytes) throw new Error(`el .zip descomprimido pasa de ${LIMITES.descomprimidoMaxBytes / 1024 / 1024} MB`);
      cantidad++;
      return true;
    },
  });
  const partes: string[] = [];
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const formato = detectarFormato(contenido, nombre);
    if (formato === 'zip') { partes.push(`### ${nombre}\n(un .zip dentro del .zip: no se abre)`); continue; }
    const r = await leerDocumento(contenido, nombre, false);
    partes.push(`### ${nombre}\n${r.ok ? r.texto : `(${r.motivo})`}`);
  }
  if (omitidos.length > 0) partes.push(`(${omitidos.length} archivo(s) más en el .zip no se leyeron: el máximo es ${LIMITES.archivosEnZip})`);
  return partes.join('\n\n');
}

export async function leerDocumento(datos: Uint8Array, nombre = '', permitirZip = true): Promise<Lectura> {
  const formato = detectarFormato(datos, nombre);
  if (NO_SOPORTADO[formato]) return { ok: false, formato, motivo: NO_SOPORTADO[formato]! };
  if (datos.length > LIMITES.archivoMaxBytes) return { ok: false, formato, motivo: `pesa más de ${LIMITES.archivoMaxBytes / 1024 / 1024} MB` };
  try {
    switch (formato) {
      case 'pdf': return { ok: true, formato, texto: await textoDePdf(datos) };
      case 'docx': return { ok: true, formato, texto: leerDocx(datos) };
      case 'doc': return { ok: true, formato, texto: await leerDoc(datos) };
      case 'xlsx': {
        const hojas = leerXlsx(datos);
        return { ok: true, formato, texto: hojasEnTexto(hojas), hojas };
      }
      case 'csv': {
        const hojas = [{ nombre: nombre || 'CSV', filas: leerCsv(decodificar(datos)) }];
        return { ok: true, formato, texto: hojasEnTexto(hojas), hojas };
      }
      case 'texto': return { ok: true, formato, texto: decodificar(datos) };
      case 'zip':
        if (!permitirZip) return { ok: false, formato, motivo: 'un .zip dentro de otro no se abre' };
        return { ok: true, formato, texto: await leerZip(datos) };
      default: return { ok: false, formato, motivo: 'no es un formato que se pueda leer' };
    }
  } catch (e) {
    return { ok: false, formato, motivo: `no se pudo leer (${e instanceof Error ? e.message : String(e)})` };
  }
}

