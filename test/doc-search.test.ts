import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizar, tokenizar, buscarEnTexto, anteponerManualServidor } from '../src/utils/doc-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Regresión del fallo original: la búsqueda comparaba la consulta completa
 * como subcadena literal, así que una pregunta en lenguaje natural —lo que
 * envía un LLM— devolvía "no hay coincidencias" aunque el documento tratara
 * exactamente de eso.
 */

const DOC = [
  'Guía de multas y sanciones a proveedores',
  '',
  'El organismo comprador puede aplicar multas cuando el proveedor incumple',
  'los plazos de entrega comprometidos en la orden de compra.',
  'La garantía de fiel cumplimiento se cobra en casos graves.',
  'Requisitos para participar: estar inscrito en el Registro de Proveedores.',
].join('\n');

describe('normalizar — español sin acentos', () => {
  it('baja a minúsculas y quita tildes', () => {
    expect(normalizar('Sanción')).toBe('sancion');
    expect(normalizar('GARANTÍA')).toBe('garantia');
  });

  it('hace equivalentes la forma con y sin tilde', () => {
    expect(normalizar('sanción')).toBe(normalizar('sancion'));
  });
});

describe('tokenizar — descomposición de la consulta', () => {
  it('descarta palabras vacías y deja los términos con contenido', () => {
    expect(tokenizar('qué multas me pueden aplicar')).toEqual(['multas', 'aplicar']);
  });

  it('descarta tokens de menos de 3 caracteres', () => {
    expect(tokenizar('la oc de un proveedor')).toEqual(['proveedor']);
  });

  it('no devuelve duplicados', () => {
    expect(tokenizar('multas y más multas')).toEqual(['multas']);
  });

  it('si todo son palabras vacías, no se queda sin términos', () => {
    const t = tokenizar('qué es esto');
    expect(t.length).toBeGreaterThan(0);
  });
});

describe('buscarEnTexto — el fallo que motivó el módulo', () => {
  it('una pregunta en lenguaje natural SÍ encuentra el contenido', () => {
    const r = buscarEnTexto(DOC, '¿qué multas me pueden aplicar?');
    expect(r.fragmentos.length).toBeGreaterThan(0);
    expect(r.fragmentos[0].texto.toLowerCase()).toContain('multas');
  });

  it('sigue funcionando con un término suelto', () => {
    const r = buscarEnTexto(DOC, 'multas');
    expect(r.fragmentos.length).toBeGreaterThan(0);
  });

  it('encuentra pese a la tilde ausente en la consulta', () => {
    const r = buscarEnTexto(DOC, 'garantia');
    expect(r.fragmentos.length).toBeGreaterThan(0);
    expect(r.fragmentos[0].texto).toContain('garantía');
  });

  it('prioriza la línea que concentra más términos de la consulta', () => {
    const r = buscarEnTexto(DOC, 'multas proveedor incumple');
    expect(r.fragmentos[0].terminos.length).toBeGreaterThanOrEqual(2);
  });

  it('incluye contexto anterior y siguiente de la coincidencia', () => {
    const r = buscarEnTexto(DOC, 'incumple');
    expect(r.fragmentos[0].texto).toContain('[COINCIDENCIA]');
    expect(r.fragmentos[0].texto).toContain('[Siguiente]');
  });

  it('informa qué términos no aparecen en ninguna parte', () => {
    const r = buscarEnTexto(DOC, 'multas criptomonedas');
    expect(r.ausentes).toContain('criptomonedas');
    expect(r.ausentes).not.toContain('multas');
  });

  it('no devuelve nada cuando ningún término aparece', () => {
    const r = buscarEnTexto(DOC, 'blockchain satelital');
    expect(r.fragmentos).toEqual([]);
  });

  it('respeta el máximo de fragmentos', () => {
    const largo = Array(50).fill('el proveedor incumple el plazo').join('\n');
    const r = buscarEnTexto(largo, 'proveedor', 5);
    expect(r.fragmentos.length).toBe(5);
  });
});

describe('anteponerManualServidor', () => {
  it('pone el manual delante y conserva el orden del resto', () => {
    const r = anteponerManualServidor([
      { archivo: 'api/Documentacion_API_Compra_Agil.md', mejorPuntaje: 6 },
      { archivo: 'api/manual_servidor_mcp.md', mejorPuntaje: 3 },
      { archivo: 'guias/multas.pdf', mejorPuntaje: 4 },
    ], 4);
    expect(r.manualPrimero).toBe(true);
    expect(r.resultados.map((x) => x.archivo)).toEqual([
      'api/manual_servidor_mcp.md',
      'api/Documentacion_API_Compra_Agil.md',
      'guias/multas.pdf',
    ]);
  });

  it('una coincidencia de un solo término no adelanta el manual si la consulta tiene varios', () => {
    const r = anteponerManualServidor([
      { archivo: 'guias/multas.pdf', mejorPuntaje: 2 },
      { archivo: 'api/manual_servidor_mcp.md', mejorPuntaje: 1 },
    ], 2);
    expect(r.manualPrimero).toBe(false);
    expect(r.resultados[0].archivo).toBe('guias/multas.pdf');
  });

  it('reconoce el manual con separadores de Windows', () => {
    const r = anteponerManualServidor([
      { archivo: 'api/guia.md', mejorPuntaje: 3 },
      { archivo: 'api\\manual_servidor_mcp.md', mejorPuntaje: 2 },
    ], 3);
    expect(r.manualPrimero).toBe(true);
    expect(r.resultados[0].archivo).toMatch(/manual_servidor_mcp\.md$/);
  });

  it('la pregunta de OC y adjunto abre con el manual, no con la guía oficial', () => {
    const dir = path.join(__dirname, '../docs/api');
    const manual = fs.readFileSync(path.join(dir, 'manual_servidor_mcp.md'), 'utf8');
    const guia = fs.readFileSync(path.join(dir, 'Documentacion_API_Compra_Agil.md'), 'utf8');
    const consulta = 'como verifico si hay orden de compra y si puedo descargar el adjunto';
    const hallazgoManual = buscarEnTexto(manual, consulta);
    const hallazgoGuia = buscarEnTexto(guia, consulta);

    expect(hallazgoManual.fragmentos.length).toBeGreaterThan(0);
    expect(hallazgoManual.fragmentos[0].puntaje).toBeGreaterThanOrEqual(2);

    const r = anteponerManualServidor([
      {
        archivo: 'api/Documentacion_API_Compra_Agil.md',
        mejorPuntaje: hallazgoGuia.fragmentos[0]?.puntaje ?? 0,
      },
      {
        archivo: 'api/manual_servidor_mcp.md',
        mejorPuntaje: hallazgoManual.fragmentos[0]?.puntaje ?? 0,
      },
    ], hallazgoManual.terminos.length);

    expect(r.manualPrimero).toBe(true);
    expect(r.resultados[0].archivo).toBe('api/manual_servidor_mcp.md');
  });
});
