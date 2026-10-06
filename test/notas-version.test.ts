import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — script .mjs sin tipos
import { seccionDeVersion } from '../scripts/notas-version.mjs';

describe('notas de la release desde el CHANGELOG', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

  it('la versión del package.json tiene su sección en el CHANGELOG', () => {
    const s = seccionDeVersion(changelog, version) as string | null;
    expect(s).not.toBeNull();
    expect(s!.length).toBeGreaterThan(100);
    // Termina antes de la versión siguiente, sin incluirla.
    expect(s).not.toMatch(/^## \[/m);
  });

  it('una versión inexistente no tiene sección', () => {
    expect(seccionDeVersion(changelog, '99.0.0')).toBeNull();
  });

  it('corta en la siguiente sección', () => {
    const md = '## [Unreleased]\n\n## [1.1.0] - x\nA\nB\n\n## [1.0.0] - y\nC\n';
    expect(seccionDeVersion(md, '1.1.0')).toBe('A\nB');
    expect(seccionDeVersion(md, '1.0.0')).toBe('C');
  });
});
