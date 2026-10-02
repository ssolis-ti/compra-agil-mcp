import { describe, it, expect } from 'vitest';
import { textoPromptOportunidades } from '../src/prompts/buscar-oportunidades.js';

describe('textoPromptOportunidades', () => {
  it('un código del 1 al 16 no se trata como nombre', () => {
    const texto = textoPromptOportunidades('resmas', '13');
    expect(texto).toContain('Región ya resuelta');
    expect(texto).toContain('No busques el nombre "13"');
    expect(texto).not.toContain('código numérico de la región "13"');
  });

  it('un nombre sigue yendo al catálogo', () => {
    const texto = textoPromptOportunidades('resmas', 'Metropolitana');
    expect(texto).toContain('compra-agil://regiones');
    expect(texto).toContain('Metropolitana');
  });
});
