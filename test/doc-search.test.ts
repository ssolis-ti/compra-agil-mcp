import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizar, tokenizar, buscarEnTexto, anteponerManualServidor, anteponerSanciones, consultaSensible, deduplicarDocumentos, recortarArchivos, recortarEnPalabra, agruparCatalogo, consultaTecnica, relegarDocumentosTecnicos, esDocumentoTecnico, marcarSiEsGuiaOficial, MARCA_DESCRIPCION_PROMETIDA } from '../src/utils/doc-search.js';
import { textoEnlaceAdjunto } from '../src/tools/documentos.js';

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
    const largo = Array.from({ length: 50 }, (_, i) => `el proveedor ${i} incumple el plazo`).join('\n');
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

describe('deduplicarDocumentos', () => {
  it('deja un solo archivo cuando la guía está en MD y en PDF', () => {
    const r = deduplicarDocumentos([
      { archivo: 'api/Documentacion_API_Compra_Agil.md', mejorPuntaje: 4 },
      { archivo: 'api/Documentacion_API_Compra_Agil.pdf', mejorPuntaje: 4 },
      { archivo: 'api/manual_servidor_mcp.md', mejorPuntaje: 2 },
    ]);
    expect(r.map((x) => x.archivo)).toEqual([
      'api/Documentacion_API_Compra_Agil.md',
      'api/manual_servidor_mcp.md',
    ]);
  });

  it('una consulta de adjudicación fuerza el manual al frente', () => {
    expect(consultaSensible('adjudicación proveedor seleccionado')).toBe(true);
    const r = anteponerManualServidor([
      { archivo: 'api/Documentacion_API_Compra_Agil.md', mejorPuntaje: 9 },
      { archivo: 'api/manual_servidor_mcp.md', mejorPuntaje: 1 },
    ], 4, true);
    expect(r.manualPrimero).toBe(true);
    expect(r.resultados[0].archivo).toBe('api/manual_servidor_mcp.md');
  });
});

describe('recortarArchivos — tope de 3', () => {
  const corpus = [
    { archivo: 'api/manual_servidor_mcp.md', mejorPuntaje: 2 },
    { archivo: 'api/Documentacion_API_Compra_Agil.md', mejorPuntaje: 1 },
    { archivo: 'guias/multas.pdf', mejorPuntaje: 9 },
    { archivo: 'guias/actualizaciones.pdf', mejorPuntaje: 8 },
    { archivo: 'guias/bajo.pdf', mejorPuntaje: 3 },
  ];

  it('reserva el manual y completa con los dos puntajes más altos', () => {
    const r = recortarArchivos(corpus, true);
    expect(r.resultados.map((x) => x.archivo)).toEqual([
      'api/manual_servidor_mcp.md',
      'guias/multas.pdf',
      'guias/actualizaciones.pdf',
    ]);
    expect(r.omitidos.map((x) => x.archivo)).toEqual([
      'guias/bajo.pdf',
      'api/Documentacion_API_Compra_Agil.md',
    ]);
  });

  it('sin manual adelantado, se queda con los tres mayores puntajes', () => {
    const r = recortarArchivos(corpus, false);
    expect(r.resultados.map((x) => x.archivo)).toEqual([
      'guias/multas.pdf',
      'guias/actualizaciones.pdf',
      'guias/bajo.pdf',
    ]);
    expect(r.omitidos.map((x) => x.archivo)).toEqual([
      'api/manual_servidor_mcp.md',
      'api/Documentacion_API_Compra_Agil.md',
    ]);
  });

  it('no anuncia omisiones cuando ya caben en el tope', () => {
    const r = recortarArchivos(corpus.slice(0, 3), true);
    expect(r.omitidos).toEqual([]);
    expect(r.resultados.map((x) => x.archivo)).toEqual([
      'api/manual_servidor_mcp.md',
      'guias/multas.pdf',
      'api/Documentacion_API_Compra_Agil.md',
    ]);
  });

  it('rompe el empate por el orden en que llegaron', () => {
    const r = recortarArchivos([
      { archivo: 'a.pdf', mejorPuntaje: 5 },
      { archivo: 'b.pdf', mejorPuntaje: 5 },
      { archivo: 'c.pdf', mejorPuntaje: 5 },
      { archivo: 'd.pdf', mejorPuntaje: 5 },
      { archivo: 'e.pdf', mejorPuntaje: 4 },
    ], false);
    expect(r.resultados.map((x) => x.archivo)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(r.omitidos.map((x) => x.archivo)).toEqual(['d.pdf', 'e.pdf']);
  });
});

describe('multas, guía prometida, recorte y catálogo', () => {
  it('pone el PDF de sanciones delante de la guía municipal', () => {
    const r = anteponerSanciones([
      { archivo: 'guias/guia-de-buenas-practicas-en-compras-municipales.pdf', mejorPuntaje: 9 },
      { archivo: 'guias/multas-sanciones-procedimientos.pdf', mejorPuntaje: 2 },
    ], 'qué multas me pueden aplicar', false);
    expect(r[0].archivo).toBe('guias/multas-sanciones-procedimientos.pdf');
  });

  it('no le quita el primer lugar al manual en una consulta sensible', () => {
    const r = anteponerSanciones([
      { archivo: 'api/manual_servidor_mcp.md', mejorPuntaje: 1 },
      { archivo: 'guias/multas-sanciones-procedimientos.pdf', mejorPuntaje: 4 },
    ], 'multas y orden de compra', true);
    expect(r[0].archivo).toBe('api/manual_servidor_mcp.md');
  });

  it('marca la guía oficial y no parte la palabra', () => {
    expect(marcarSiEsGuiaOficial('api/Documentacion_API_Compra_Agil.md', 'cuerpo')).toContain(MARCA_DESCRIPCION_PROMETIDA);
    expect(recortarEnPalabra('correspondientes al plazo', 8)).toBe('correspondientes... [TRUNCADO]');
    expect(recortarEnPalabra('uno dos tres', 7)).toBe('uno dos... [TRUNCADO]');
  });

  it('agrupa el markdown y el pdf de la misma guía', () => {
    const grupos = agruparCatalogo([
      'api/Documentacion_API_Compra_Agil.md',
      'api/Documentacion_API_Compra_Agil.pdf',
      'api/manual_servidor_mcp.md',
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].archivos).toHaveLength(2);
  });

  it('el enlace de adjunto no invita a abrir la descarga heredada', () => {
    const texto = textoEnlaceAdjunto('123', '1-2-COT26');
    expect(texto).toContain('ficha?code=1-2-COT26');
    expect(texto).toContain('404');
    expect(texto).not.toContain('probablemente');
    expect(texto).not.toContain('RetornaDocumento');
  });
});

describe('E6 (enjambre, 6-oct) — búsqueda en documentos para preguntas de negocio', () => {
  it('no repite una línea que ya salió como contexto de otro fragmento', () => {
    const texto = ['Introducción', 'Participar en una cotización', 'Participar en una cotización', 'Participar en una cotización', 'Fin'].join('\n');
    const r = buscarEnTexto(texto, 'participar cotización');
    expect(r.fragmentos).toHaveLength(1);
  });

  it('no elige dos fragmentos de líneas vecinas, que se incluyen una a la otra', () => {
    const texto = ['a', 'multa por atraso', 'multa por incumplimiento', 'b', 'c', 'd', 'otra multa'].join('\n');
    const lineas = buscarEnTexto(texto, 'multa').fragmentos.map((f) => f.linea);
    for (const x of lineas) for (const y of lineas) if (x !== y) expect(Math.abs((x ?? 0) - (y ?? 0))).toBeGreaterThan(1);
  });

  it('el relleno de una pregunta no cuenta como término', () => {
    expect(tokenizar('¿Cuántos días tengo para enviar una cotización?')).toEqual(['dias', 'enviar', 'cotizacion']);
  });

  it('consultaTecnica distingue preguntas del servidor de preguntas de negocio', () => {
    expect(consultaTecnica('¿Qué es un segundo llamado?')).toBe(false);
    expect(consultaTecnica('¿Puedo cotizar sin estar en el Registro de Proveedores?')).toBe(false);
    expect(consultaTecnica('¿qué multas me pueden aplicar?')).toBe(false);
    expect(consultaTecnica('¿por qué la API devuelve 504?')).toBe(true);
    expect(consultaTecnica('¿cómo funciona el radar?')).toBe(true);
    expect(consultaTecnica('¿se puede saber la orden de compra?')).toBe(true);
  });

  it('a igual puntaje, las guías van antes que el manual y la guía oficial de la API', () => {
    const r = relegarDocumentosTecnicos([
      { archivo: 'api/manual_servidor_mcp.md', mejorPuntaje: 2 },
      { archivo: 'api/Documentacion_API_Compra_Agil.md', mejorPuntaje: 2 },
      { archivo: 'guias/masterclass-compra-agil-proveedor.pdf', mejorPuntaje: 2 },
    ]);
    expect(recortarArchivos(r, false).resultados[0].archivo).toBe('guias/masterclass-compra-agil-proveedor.pdf');
  });

  it('pero la relevancia manda: un manual con más coincidencias sigue arriba', () => {
    const r = relegarDocumentosTecnicos([
      { archivo: 'api/manual_servidor_mcp.md', mejorPuntaje: 3 },
      { archivo: 'guias/masterclass-compra-agil-proveedor.pdf', mejorPuntaje: 2 },
    ]);
    expect(recortarArchivos(r, false).resultados[0].archivo).toBe('api/manual_servidor_mcp.md');
  });
});

describe('E6 — toda la carpeta api/ es documentación técnica', () => {
  it('la síntesis de la API también se relega en preguntas de negocio (probado con los documentos reales)', () => {
    expect(esDocumentoTecnico('api/sintesis_e_indice.md')).toBe(true);
    expect(esDocumentoTecnico('api\manual_servidor_mcp.md')).toBe(true);
    expect(esDocumentoTecnico('guias/actualizaciones-a-compra-agil.pdf')).toBe(false);
    const r = relegarDocumentosTecnicos([
      { archivo: 'api/sintesis_e_indice.md', mejorPuntaje: 2 },
      { archivo: 'guias/actualizaciones-a-compra-agil.pdf', mejorPuntaje: 2 },
    ]);
    expect(recortarArchivos(r, false).resultados[0].archivo).toBe('guias/actualizaciones-a-compra-agil.pdf');
  });
});
