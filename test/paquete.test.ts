import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Antes de publicar la 2.7.0: `files` solo incluía `dist/`, así que con npx
 * no existía `docs/` y `consultar_documentos_locales` quedaba vacío.
 */
describe('contenido del paquete de npm', () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const salida = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: raiz, encoding: 'utf8', shell: process.platform === 'win32',
  });
  const archivos: string[] = JSON.parse(salida)[0].files.map((f: { path: string }) => f.path.replace(/\\/g, '/'));

  it('incluye las guías y los manuales que consulta el servidor', () => {
    expect(archivos.some((f) => f.startsWith('docs/guias/') && f.endsWith('.pdf'))).toBe(true);
    expect(archivos).toContain('docs/api/manual_servidor_mcp.md');
  });

  it('deja fuera las notas de ingeniería, los tests y los scripts de QA', () => {
    expect(archivos.filter((f) => /^(docs\/internals|test|scripts|src)\//.test(f))).toEqual([]);
    expect(archivos).not.toContain('CLAUDE.md');
    expect(archivos).not.toContain('.env.example');
  });
}, 60_000);
