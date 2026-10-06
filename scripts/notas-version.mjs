/**
 * Extrae del CHANGELOG la sección de una versión, para las notas de la
 * release de GitHub. La usa .github/workflows/publicar.yml.
 *
 * Uso: node scripts/notas-version.mjs 2.7.0 > notas.md
 * Termina con error si la versión no tiene sección: una release sin notas
 * casi siempre es un CHANGELOG que no se actualizó.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function seccionDeVersion(changelog, version) {
  const lineas = changelog.split('\n');
  const inicio = lineas.findIndex((l) => l.startsWith(`## [${version}]`));
  if (inicio < 0) return null;
  let fin = lineas.findIndex((l, i) => i > inicio && l.startsWith('## ['));
  if (fin < 0) fin = lineas.length;
  return lineas.slice(inicio + 1, fin).join('\n').trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const seccion = seccionDeVersion(fs.readFileSync(path.join(raiz, 'CHANGELOG.md'), 'utf8'), version);
  if (!seccion) {
    console.error(`CHANGELOG.md no tiene una sección "## [${version}]".`);
    process.exit(1);
  }
  process.stdout.write(`${seccion}\n`);
}
