/**
 * Localizador compartido de documentos locales (manuales/guías de Compra Ágil).
 *
 * Centraliza la lógica antes duplicada e inconsistente entre
 * `tools/documentos.ts` y `resources/documentacion.ts`:
 * - Detección recursiva de la carpeta docs/ (empaquetada vs. cwd).
 * - Filtrado por extensión soportada (.pdf, .txt, .md), excluyendo readme.md.
 * - Exclusión de subcarpetas internas del proyecto (ver EXCLUDED_DIRS).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDocsDir = path.resolve(__dirname, '../../docs');
const cwdDocsDir = path.resolve(process.cwd(), 'docs');

export const SUPPORTED_DOC_EXTENSIONS = ['.pdf', '.txt', '.md'] as const;

/**
 * Subcarpetas de docs/ que NO son documentación de Compra Ágil y por tanto no
 * deben ofrecerse al LLM como tal.
 *
 * `internals/` contiene documentación de ingeniería del propio servidor
 * (pendientes, decisiones de arquitectura, hallazgos de la API). Sin esta
 * exclusión aparecería en `consultar_documentos_locales` y en el recurso
 * `compra-agil://documentacion/{filename}`, que existen para consultar
 * normativa y guías del mecanismo — no las notas internas del proyecto.
 */
export const EXCLUDED_DIRS = ['internals'] as const;

/**
 * Obtiene de forma recursiva todas las rutas relativas de archivos dentro de un directorio,
 * normalizadas con barras diagonales (/).
 */
export function getRelativeFilesRecursively(dir: string, baseDir: string = dir): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getRelativeFilesRecursively(filePath, baseDir));
    } else {
      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
      results.push(relativePath);
    }
  }
  return results;
}

/**
 * True si el archivo es documentación consultable de Compra Ágil.
 * Excluye READMEs y todo lo que viva en una carpeta interna del proyecto.
 *
 * @param file Ruta RELATIVA al directorio docs/, con separadores "/".
 */
export function isSupportedDoc(file: string): boolean {
  const normalizado = file.replace(/\\/g, '/');

  // Cualquier archivo bajo una carpeta interna queda fuera, a cualquier profundidad.
  const primerSegmento = normalizado.split('/')[0].toLowerCase();
  if ((EXCLUDED_DIRS as readonly string[]).includes(primerSegmento)) return false;

  const ext = path.extname(normalizado).toLowerCase();
  const name = path.basename(normalizado).toLowerCase();
  return (SUPPORTED_DOC_EXTENSIONS as readonly string[]).includes(ext) && name !== 'readme.md';
}

/**
 * Resuelve el directorio de documentación efectivo: prefiere la carpeta empaquetada
 * (docs/ junto al build) si contiene documentos soportados; si no, usa docs/ del cwd.
 */
export function resolveDocsDir(): string {
  if (fs.existsSync(packageDocsDir)) {
    const hasLocalDocs = getRelativeFilesRecursively(packageDocsDir).some(isSupportedDoc);
    if (hasLocalDocs) return packageDocsDir;
  }
  return cwdDocsDir;
}

/** Lista las rutas relativas de documentos consultables dentro del docs dir resuelto. */
export function listSupportedDocs(docsDir: string): string[] {
  return getRelativeFilesRecursively(docsDir).filter(isSupportedDoc);
}
