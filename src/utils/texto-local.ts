/**
 * Texto de un documento local (PDF, TXT, MD), memorizado por archivo.
 *
 * ⚠ Fase 1.3 (auditoría QA 2.6.1): `consultar_documentos_locales` volvía a
 *   extraer el texto de los 7 PDF en cada consulta, 0,8–1 s por llamada, para
 *   documentos que no cambian. Se memoriza por ruta y se invalida si cambian la
 *   fecha de modificación o el tamaño: si alguien reemplaza una guía, se relee.
 */

import fs from 'fs';
import path from 'path';
import { textoDePdf } from './pdf.js';

interface Memorizado {
  mtimeMs: number;
  size: number;
  texto: string;
}

const memoria = new Map<string, Memorizado>();
let extracciones = 0;

export async function leerTextoLocal(ruta: string): Promise<string> {
  const info = fs.statSync(ruta);
  const previo = memoria.get(ruta);
  if (previo && previo.mtimeMs === info.mtimeMs && previo.size === info.size) return previo.texto;

  let texto: string;
  if (path.extname(ruta).toLowerCase() === '.pdf') {
    texto = await textoDePdf(fs.readFileSync(ruta));
    extracciones++;
  } else {
    texto = fs.readFileSync(ruta, 'utf8');
  }
  memoria.set(ruta, { mtimeMs: info.mtimeMs, size: info.size, texto });
  return texto;
}

/** Para tests: cuántos PDF se extrajeron de verdad, y vaciar la memoria. */
export function extraccionesDePdf(): number {
  return extracciones;
}
export function olvidarTextosLocales(): void {
  memoria.clear();
  extracciones = 0;
}
