import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INSTRUCCIONES } from '../src/instrucciones.js';

describe('instrucciones que recibe el agente al conectar', () => {
  it('prohíbe mostrar el ticket y declarar un ganador', () => {
    expect(INSTRUCCIONES).toContain('No lo muestres');
    expect(INSTRUCCIONES).toContain('No declares un ganador');
    expect(INSTRUCCIONES).not.toMatch(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  });

  it('nombran los formatos de adjuntos y cómo seguir una exportación (2.10.1)', () => {
    expect(INSTRUCCIONES).toContain('PDF, Word, Excel, CSV o ZIP');
    expect(INSTRUCCIONES).toMatch(/exportar_procesos.*en_curso.*mismos filtros/);
  });

  it('el servidor las publica en el initialize', () => {
    const src = readFileSync(new URL('../src/servidor.ts', import.meta.url), 'utf8');
    expect(src).toContain('instructions: INSTRUCCIONES');
  });
});
