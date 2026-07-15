import { describe, it, expect } from 'vitest';
import { isSupportedDoc, EXCLUDED_DIRS, SUPPORTED_DOC_EXTENSIONS } from '../src/utils/docs-locator.js';

describe('isSupportedDoc — documentación de Compra Ágil', () => {
  it('acepta PDF, TXT y MD', () => {
    expect(isSupportedDoc('guias/manual.pdf')).toBe(true);
    expect(isSupportedDoc('api/notas.txt')).toBe(true);
    expect(isSupportedDoc('api/sintesis.md')).toBe(true);
  });

  it('rechaza extensiones no soportadas', () => {
    expect(isSupportedDoc('guias/hoja.xlsx')).toBe(false);
    expect(isSupportedDoc('script.ts')).toBe(false);
  });

  it('excluye los README', () => {
    expect(isSupportedDoc('README.md')).toBe(false);
    expect(isSupportedDoc('guias/readme.md')).toBe(false);
  });

  it('acepta rutas con separadores de Windows', () => {
    expect(isSupportedDoc('guias\\manual.pdf')).toBe(true);
  });
});

describe('isSupportedDoc — exclusión de docs internos (regresión)', () => {
  it('docs/internals/ NO se ofrece como documentación de Compra Ágil', () => {
    // Si esto falla, las notas de ingeniería del proyecto aparecerían en
    // consultar_documentos_locales y en compra-agil://documentacion/{filename},
    // como si fueran normativa de Compra Ágil.
    expect(isSupportedDoc('internals/PENDIENTES.md')).toBe(false);
    expect(isSupportedDoc('internals/hallazgos-api.md')).toBe(false);
    expect(isSupportedDoc('internals/decisiones.md')).toBe(false);
  });

  it('excluye a cualquier profundidad dentro de la carpeta interna', () => {
    expect(isSupportedDoc('internals/sub/carpeta/nota.md')).toBe(false);
    expect(isSupportedDoc('internals/adjunto.pdf')).toBe(false);
  });

  it('la exclusión es insensible a mayúsculas', () => {
    expect(isSupportedDoc('Internals/nota.md')).toBe(false);
    expect(isSupportedDoc('INTERNALS/nota.md')).toBe(false);
  });

  it('excluye también con separadores de Windows', () => {
    expect(isSupportedDoc('internals\\PENDIENTES.md')).toBe(false);
  });

  it('NO excluye carpetas cuyo nombre solo contiene la palabra', () => {
    // "internals" debe coincidir con el segmento completo, no como substring.
    expect(isSupportedDoc('internals-publicos/guia.md')).toBe(true);
    expect(isSupportedDoc('guias/internals.md')).toBe(true); // archivo, no carpeta
  });

  it('mantiene visible la documentación legítima junto a la interna', () => {
    expect(isSupportedDoc('api/Documentacion_API_Compra_Agil.md')).toBe(true);
    expect(isSupportedDoc('guias/masterclass-compra-agil-proveedor.pdf')).toBe(true);
  });
});

describe('constantes exportadas', () => {
  it('internals está en la lista de exclusión', () => {
    expect(EXCLUDED_DIRS).toContain('internals');
  });

  it('las extensiones soportadas son las esperadas', () => {
    expect(SUPPORTED_DOC_EXTENSIONS).toEqual(['.pdf', '.txt', '.md']);
  });
});
