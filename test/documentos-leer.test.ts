import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { zipSync, strToU8 } from 'fflate';
import { detectarFormato } from '../src/documentos/formato.js';
import { leerDocumento, leerCsv } from '../src/documentos/leer.js';
import { LIMITES } from '../src/documentos/limites.js';

/**
 * Lectura multiformato (2.10.0, fase 1; L1–L6, S2, S3). Los .docx, .xlsx y
 * .zip se arman aquí mismo con fflate; el .doc es una plantilla real de la
 * medición del 16-oct (sin el nombre de su autora en los metadatos).
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = fs.readFileSync(path.join(RAIZ, 'test', 'fixtures', 'adjuntos', 'declaracion-jurada-plantilla.doc'));
const PDF = fs.readFileSync(path.join(RAIZ, 'docs', 'guias', 'multas-sanciones-procedimientos.pdf'));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (t: string) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const celda = (t: string) => `<w:tc><w:tcPr/>${p(t)}</w:tc>`;
function docx(cuerpo: string) {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${cuerpo}</w:body></w:document>`),
  });
}
function xlsx(hojas: Record<string, string>, compartidos: string[]) {
  const nombres = Object.keys(hojas);
  const archivos: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(`<workbook><sheets>${nombres.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships>${nombres.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
    'xl/sharedStrings.xml': strToU8(`<sst>${compartidos.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`),
  };
  nombres.forEach((n, i) => { archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<worksheet><sheetData>${hojas[n]}</sheetData></worksheet>`); });
  return zipSync(archivos);
}

const limitesOriginales = { ...LIMITES };
afterEach(() => { Object.assign(LIMITES, limitesOriginales); });

describe('detectarFormato (L6): el contenido manda, no la extensión', () => {
  it('reconoce cada formato por su firma', () => {
    expect(detectarFormato(PDF, 'x.pdf')).toBe('pdf');
    expect(detectarFormato(docx(p('hola')), 'x.docx')).toBe('docx');
    expect(detectarFormato(xlsx({ H: '' }, []), 'x.xlsx')).toBe('xlsx');
    expect(detectarFormato(zipSync({ 'a.txt': strToU8('a') }), 'x.zip')).toBe('zip');
    expect(detectarFormato(DOC, 'x.doc')).toBe('doc');
    expect(detectarFormato(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'x.png')).toBe('imagen');
    expect(detectarFormato(strToU8('producto;precio\nresma;3000\n'), 'x.txt')).toBe('csv');
  });

  it('un Word con extensión .pdf se lee como Word', () => {
    expect(detectarFormato(docx(p('hola')), 'engaño.pdf')).toBe('docx');
  });
});

describe('Word (L1, L2)', () => {
  it('.docx: párrafos en orden, y las tablas una fila por línea con «|»', async () => {
    const tabla = `<w:tbl><w:tr>${celda('N°')}${celda('Producto')}${celda('Cantidad')}</w:tr><w:tr>${celda('1')}${celda('Resma carta &amp; oficio')}${celda('20')}</w:tr></w:tbl>`;
    const r = await leerDocumento(docx(`${p('ANEXO 1')}${tabla}${p('Plazo: 5 días hábiles')}`), 'anexo.docx');
    expect(r.ok && r.texto).toBe('ANEXO 1\nN° | Producto | Cantidad\n1 | Resma carta & oficio | 20\nPlazo: 5 días hábiles');
  });

  it('.docx: una tabla dentro de una celda no rompe la lectura', async () => {
    const interna = `<w:tbl><w:tr>${celda('a')}${celda('b')}</w:tr></w:tbl>`;
    const r = await leerDocumento(docx(`<w:tbl><w:tr><w:tc>${p('externa')}${interna}</w:tc>${celda('otra')}</w:tr></w:tbl>${p('fin')}`), 'x.docx');
    expect(r.ok && r.texto).toMatch(/externa.*a \| b.*\| otra\nfin$/s);
  });

  it('.doc (Word 97-2003): una plantilla real', async () => {
    const r = await leerDocumento(DOC, 'Anexo Inhabilidades.doc');
    expect(r.ok && r.formato).toBe('doc');
    expect(r.ok && r.texto).toMatch(/DECLARACIÓN JURADA SIMPLE/);
    expect(r.ok && r.texto).toMatch(/artículo 35 quáter de la Ley N°19\.886/);
  });
});

describe('Excel y CSV (L3, S2)', () => {
  it('.xlsx: cada hoja con su nombre; textos compartidos, en línea y números', async () => {
    const hoja1 = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>Resma</t></is></c><c r="B2"><v>3000</v></c></row>';
    const r = await leerDocumento(xlsx({ 'DETALLE ECONÓMICO': hoja1, Notas: '<row r="1"><c r="C1" t="s"><v>2</v></c></row>' }, ['Producto', 'Precio', 'Ver bases']), 'x.xlsx');
    expect(r.ok && r.texto).toBe('## Hoja: DETALLE ECONÓMICO\nProducto | Precio\nResma | 3000\n\n## Hoja: Notas\n |  | Ver bases');
  });

  it('una fórmula entrega su último valor guardado: nunca se evalúa', async () => {
    const hoja = '<row r="1"><c r="A1"><f>WEBSERVICE("http://atacante")</f><v>42</v></c></row>';
    const r = await leerDocumento(xlsx({ H: hoja }, []), 'x.xlsx');
    expect(r.ok && r.texto).toBe('## Hoja: H\n42');
  });

  it('CSV con «;», comillas, saltos dentro de comillas y Latin-1', async () => {
    expect(leerCsv('a;"b ""c""";"d\ne"\n1;2;3')).toEqual([['a', 'b "c"', 'd\ne'], ['1', '2', '3']]);
    const latin1 = Buffer.from('producto;precio\ncañería;5000\n', 'latin1');
    const r = await leerDocumento(latin1, 'precios.csv');
    expect(r.ok && r.texto).toMatch(/cañería \| 5000/);
  });
});

describe('ZIP (L4, S3)', () => {
  it('lee cada archivo legible del .zip, con su nombre', async () => {
    const z = zipSync({ 'bases/anexo.docx': docx(p('Requisito único')), 'precios.csv': strToU8('a;b\n1;2\n'), 'foto.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]) });
    const r = await leerDocumento(z, 'adjuntos.zip');
    expect(r.ok && r.texto).toMatch(/### bases\/anexo\.docx\nRequisito único/);
    expect(r.ok && r.texto).toMatch(/### precios\.csv\n## Hoja: precios\.csv\na \| b/);
    expect(r.ok && r.texto).toMatch(/### foto\.png\n\(es una imagen/);
  });

  it('un .zip dentro del .zip no se abre', async () => {
    const r = await leerDocumento(zipSync({ 'otro.zip': zipSync({ 'a.txt': strToU8('a') }) }), 'x.zip');
    expect(r.ok && r.texto).toMatch(/un \.zip dentro del \.zip: no se abre/);
  });

  it('bomba ZIP: si lo descomprimido pasa el límite, no se lee', async () => {
    LIMITES.descomprimidoMaxBytes = 1000;
    const r = await leerDocumento(zipSync({ 'grande.txt': new Uint8Array(5000).fill(65) }), 'bomba.zip');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/descomprimido pasa de/);
  });

  it('con más archivos que el máximo, lee los primeros y lo dice', async () => {
    LIMITES.archivosEnZip = 2;
    const r = await leerDocumento(zipSync({ 'a.txt': strToU8('a'), 'b.txt': strToU8('b'), 'c.txt': strToU8('c') }), 'x.zip');
    expect(r.ok && r.texto).toMatch(/1 archivo\(s\) más en el \.zip no se leyeron/);
  });
});

describe('no soportados (L5)', () => {
  it('imagen y .xls antiguo: lo dicen, sin lanzar', async () => {
    expect(await leerDocumento(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'f.jpg')).toMatchObject({ ok: false, formato: 'imagen' });
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(await leerDocumento(xls, 'viejo.xls')).toMatchObject({ ok: false, formato: 'xls' });
  });

  it('un archivo dañado se informa como «no se pudo leer»', async () => {
    const r = await leerDocumento(strToU8('PK\u0003\u0004basura'), 'roto.docx');
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.motivo).toMatch(/no se pudo leer/);
  });
});
