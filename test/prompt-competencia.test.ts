import { describe, expect, it } from 'vitest';
import { textoPromptCompetencia } from '../src/prompts/analizar-competencia.js';

describe('prompt analizar_competencia', () => {
  const texto = textoPromptCompetencia('355-311-COT26');

  it('nombra el código y no pide declarar un adjudicado', () => {
    expect(texto).toContain('355-311-COT26');
    expect(texto).toContain('No declares un ganador');
    expect(texto).toContain('no publica qué oferta ganó');
    expect(texto).not.toMatch(/fue el más barato/);
    expect(texto).not.toMatch(/Si se seleccionó un proveedor/);
  });

  it('no manda a la API legada de OC sin un id real', () => {
    expect(texto).toContain('obtener_detalle_orden_compra');
    expect(texto).toContain('si no tienes un id real');
    expect(texto).toContain('no prueba que no exista una orden');
  });
});
