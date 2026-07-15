/**
 * Escritura de informes a disco.
 *
 * DECISIÓN CLAVE DE DISEÑO: el HTML NUNCA se devuelve al LLM.
 * Un informe pesa decenas de KB; retornarlo como texto consumiría miles de
 * tokens de contexto por cada llamada. La tool escribe el archivo y devuelve
 * solo la ruta más un resumen breve.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

/** Directorio de salida por defecto: ./informes en el cwd del servidor. */
export function defaultOutputDir(): string {
  return path.resolve(process.cwd(), 'informes');
}

/**
 * Convierte un texto en un fragmento seguro para nombre de archivo.
 * Ej: "Radar RM / julio" → "radar-rm-julio"
 */
export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar diacríticos combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'informe';
}

/** Marca temporal compacta para nombres de archivo: 20260715-0930 */
export function stamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export interface EscrituraResultado {
  ruta: string;
  bytes: number;
}

/**
 * Escribe el HTML en disco creando el directorio si no existe.
 * Retorna la ruta absoluta y el tamaño resultante.
 */
export function escribirInforme(html: string, nombreArchivo: string, dir?: string): EscrituraResultado {
  const destinoDir = dir ? path.resolve(dir) : defaultOutputDir();
  fs.mkdirSync(destinoDir, { recursive: true });

  const ruta = path.join(destinoDir, nombreArchivo);
  fs.writeFileSync(ruta, html, 'utf8');

  const bytes = Buffer.byteLength(html, 'utf8');
  logger.info(`Informe generado: ${ruta} (${(bytes / 1024).toFixed(1)} KB)`);
  return { ruta, bytes };
}
