/**
 * Formato de un archivo por su contenido, no por su nombre (2.10.0, L6).
 *
 * Los adjuntos traen la extensión que puso el comprador, y un «.pdf» puede ser
 * un Word renombrado. La firma de los primeros bytes manda; la extensión solo
 * desempata dentro de un ZIP o de un archivo OLE.
 */

import { unzipSync } from 'fflate';

export type Formato = 'pdf' | 'docx' | 'xlsx' | 'zip' | 'doc' | 'xls' | 'csv' | 'texto' | 'imagen' | 'desconocido';

const empieza = (b: Uint8Array, firma: number[]) => firma.every((x, i) => b[i] === x);

/** Las rutas internas de un ZIP, sin descomprimir su contenido. */
export function rutasDelZip(datos: Uint8Array): string[] {
  const rutas: string[] = [];
  try {
    unzipSync(datos, { filter: (f) => { rutas.push(f.name); return false; } });
  } catch {
    return rutas;
  }
  return rutas;
}

export function detectarFormato(datos: Uint8Array, nombre = ''): Formato {
  const ext = nombre.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? '';
  if (empieza(datos, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (empieza(datos, [0x50, 0x4b, 0x03, 0x04]) || empieza(datos, [0x50, 0x4b, 0x05, 0x06])) {
    const rutas = rutasDelZip(datos);
    if (rutas.includes('word/document.xml')) return 'docx';
    if (rutas.includes('xl/workbook.xml')) return 'xlsx';
    return 'zip';
  }
  if (empieza(datos, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return ext === 'xls' ? 'xls' : 'doc'; // OLE
  if (empieza(datos, [0x89, 0x50, 0x4e, 0x47]) || empieza(datos, [0xff, 0xd8, 0xff]) || empieza(datos, [0x47, 0x49, 0x46])) return 'imagen';
  if (esTexto(datos)) return ext === 'csv' || pareceCsv(datos) ? 'csv' : 'texto';
  return 'desconocido';
}

/** Sin bytes de control (salvo tab, saltos y BOM) en el primer KB. */
function esTexto(datos: Uint8Array): boolean {
  if (datos.length === 0) return false;
  const muestra = datos.subarray(0, 1024);
  return muestra.every((b) => b === 9 || b === 10 || b === 13 || b >= 32);
}

function pareceCsv(datos: Uint8Array): boolean {
  const lineas = new TextDecoder().decode(datos.subarray(0, 2048)).split(/\r?\n/).filter(Boolean).slice(0, 5);
  if (lineas.length < 2) return false;
  return [';', ','].some((sep) => {
    const n = lineas[0].split(sep).length;
    return n >= 2 && lineas.every((l) => l.split(sep).length === n);
  });
}
