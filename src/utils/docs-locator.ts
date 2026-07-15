/**
 * Localizador compartido de documentos locales (manuales/guías de Compra Ágil).
 *
 * Centraliza la lógica antes duplicada e inconsistente entre
 * `tools/documentos.ts` y `resources/documentacion.ts`:
 * - Detección recursiva de la carpeta docs/ (empaquetada vs. cwd).
 * - Filtrado por extensión soportada (.pdf, .txt, .md), excluyendo readme.md.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDocsDir = path.resolve(__dirname, '../../docs');
const cwdDocsDir = path.resolve(process.cwd(), 'docs');

export const SUPPORTED_DOC_EXTENSIONS = ['.pdf', '.txt', '.md'] as const;

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

/** True si el archivo es un documento consultable (extensión soportada y no un README). */
export function isSupportedDoc(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file).toLowerCase();
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
