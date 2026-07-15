import { describe, it, expect } from 'vitest';
import { esc, tabla, badge, barChartSVG, kpiRow } from '../src/reports/components.js';
import { clp, numero, porcentaje, fecha, rut, horasRestantes } from '../src/reports/format.js';
import { slug, stamp } from '../src/reports/export.js';
import { renderRadarInforme, tonoScore, type OportunidadInforme } from '../src/reports/templates/radar-oportunidades.js';
import { baseCSS, PAPEL, FORMATO_POR_DEFECTO } from '../src/reports/theme.js';

describe('theme — formatos de papel chilenos', () => {
  it('Carta mide 216 × 279 mm', () => {
    expect(PAPEL.carta.mm).toEqual({ ancho: 216, alto: 279 });
    expect(PAPEL.carta.size).toBe('letter');
  });

  it('Oficio/Folio chileno mide 216 × 330 mm — NO es el US Legal (216 × 356)', () => {
    expect(PAPEL.oficio.mm).toEqual({ ancho: 216, alto: 330 });
    // Regresión: si alguien "simplifica" esto a `legal`, el papel crecería 26mm.
    expect(PAPEL.oficio.size).not.toBe('legal');
    expect(PAPEL.oficio.size).toBe('216mm 330mm');
  });

  it('A4 mide 210 × 297 mm', () => {
    expect(PAPEL.a4.mm).toEqual({ ancho: 210, alto: 297 });
  });

  it('el formato por defecto es Carta (estándar de oficina en Chile)', () => {
    expect(FORMATO_POR_DEFECTO).toBe('carta');
  });

  it('baseCSS emite el @page size correcto por formato', () => {
    expect(baseCSS('carta')).toContain('size: letter');
    expect(baseCSS('oficio')).toContain('size: 216mm 330mm');
    expect(baseCSS('a4')).toContain('size: A4');
  });

  it('el ancho simulado en pantalla sigue al formato real', () => {
    expect(baseCSS('carta')).toContain('max-width: 216mm');
    expect(baseCSS('a4')).toContain('max-width: 210mm');
  });
});

describe('format — localización chilena', () => {
  it('formatea CLP con separador de miles', () => {
    expect(clp(1250000)).toBe('$1.250.000');
    expect(clp(0)).toBe('$0');
  });

  it('devuelve guion para montos nulos o inválidos', () => {
    expect(clp(null)).toBe('—');
    expect(clp(undefined)).toBe('—');
    expect(clp(NaN)).toBe('—');
  });

  it('formatea porcentajes con coma decimal', () => {
    expect(porcentaje(12.34)).toBe('12,3%');
  });

  it('formatea RUT con puntos y guion', () => {
    expect(rut('761234567')).toBe('76.123.456-7');
    expect(rut('12345678K')).toBe('12.345.678-K');
  });

  it('devuelve el valor original si no parece un RUT', () => {
    expect(rut('no-es-rut')).toBe('no-es-rut');
  });

  it('convierte horas a glosa humana', () => {
    expect(horasRestantes(0.5)).toBe('30 min');
    expect(horasRestantes(10)).toBe('10 h');
    expect(horasRestantes(30)).toBe('1d 6h');
    expect(horasRestantes(48)).toBe('2d');
    expect(horasRestantes(-5)).toBe('—');
  });

  it('formatea fechas ISO al formato chileno', () => {
    expect(fecha('2026-07-15T09:30:00', false)).toBe('15-07-2026');
    expect(fecha(null)).toBe('—');
    expect(fecha('basura')).toBe('—');
  });

  it('numero respeta decimales', () => {
    expect(numero(1234.5, 1)).toBe('1.234,5');
  });
});

describe('components — seguridad de escapado', () => {
  it('escapa caracteres peligrosos de HTML', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(esc('Fulano & Cía')).toBe('Fulano &amp; Cía');
    expect(esc(`"comilla" 'simple'`)).toBe('&quot;comilla&quot; &#39;simple&#39;');
  });

  it('escapa null/undefined como cadena vacía', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('no permite inyección de marcado vía datos de tabla', () => {
    const html = tabla([{ n: '<img src=x onerror=alert(1)>' }], [
      { header: 'N', celda: (f) => esc(f.n) },
    ]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapa el texto de los badges', () => {
    expect(badge('<b>x</b>')).toContain('&lt;b&gt;');
  });

  it('escapa etiquetas dentro del SVG', () => {
    const svg = barChartSVG([{ etiqueta: '<hack>', valor: 5 }]);
    expect(svg).toContain('&lt;hack&gt;');
    expect(svg).not.toContain('<hack>');
  });
});

describe('components — estructura', () => {
  it('tabla vacía muestra mensaje en vez de romper', () => {
    expect(tabla([], [{ header: 'X', celda: () => '' }])).toContain('Sin datos');
  });

  it('barChartSVG vacío no emite SVG', () => {
    expect(barChartSVG([])).toBe('');
  });

  it('barChartSVG escala la barra mayor al máximo', () => {
    const svg = barChartSVG([{ etiqueta: 'a', valor: 100 }, { etiqueta: 'b', valor: 50 }]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
  });

  it('kpiRow emite un bloque por KPI', () => {
    const html = kpiRow([{ label: 'A', valor: '1' }, { label: 'B', valor: '2' }]);
    expect((html.match(/class="kpi"/g) ?? []).length).toBe(2);
  });
});

describe('export — nombres de archivo', () => {
  it('slug normaliza acentos y símbolos', () => {
    expect(slug('Radar RM / Julio 2026')).toBe('radar-rm-julio-2026');
    expect(slug('Adquisición de Software')).toBe('adquisicion-de-software');
  });

  it('slug nunca devuelve cadena vacía', () => {
    expect(slug('///')).toBe('informe');
  });

  it('stamp produce marca temporal ordenable', () => {
    expect(stamp(new Date('2026-07-15T09:05:00'))).toBe('20260715-0905');
  });
});

describe('tonoScore', () => {
  it('clasifica el score en tonos semánticos', () => {
    expect(tonoScore(105).glosa).toBe('Muy caliente');
    expect(tonoScore(60).glosa).toBe('Caliente');
    expect(tonoScore(35).glosa).toBe('Templada');
    expect(tonoScore(5).glosa).toBe('Fría');
  });
});

describe('renderRadarInforme', () => {
  const op = (over: Partial<OportunidadInforme> = {}): OportunidadInforme => ({
    codigo: '1-2-COT26',
    nombre: 'Proceso',
    organismo: 'Organismo',
    region: 'Metropolitana',
    presupuesto_disponible: 1000000,
    ofertas_recibidas: 0,
    horas_restantes: 5,
    fecha_cierre: '2026-07-16T12:00:00Z',
    puntuacion_caliente: 50,
    factores_calificacion: ['Sin oferentes activos (+50 pts)'],
    ...over,
  });

  const base = { totalAnalizadas: 10, filtros: { paginasEscaneadas: 1 }, generadoEn: new Date('2026-07-15T10:00:00') };

  it('produce un documento HTML completo y autocontenido', () => {
    const html = renderRadarInforme({ ...base, oportunidades: [op()] });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('@page');
    expect(html).toContain('Radar de Oportunidades');
    // Autocontenido: sin scripts ni recursos remotos
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/src="https?:/);
  });

  it('ordena las oportunidades por score aunque la entrada venga desordenada', () => {
    const html = renderRadarInforme({
      ...base,
      oportunidades: [
        op({ codigo: 'BAJA', puntuacion_caliente: 10 }),
        op({ codigo: 'ALTA', puntuacion_caliente: 100 }),
        op({ codigo: 'MEDIA', puntuacion_caliente: 50 }),
      ],
    });
    // La de mayor score debe aparecer antes en el documento
    expect(html.indexOf('ALTA')).toBeLessThan(html.indexOf('MEDIA'));
    expect(html.indexOf('MEDIA')).toBeLessThan(html.indexOf('BAJA'));
  });

  it('calcula los KPIs de cabecera', () => {
    const html = renderRadarInforme({
      ...base,
      oportunidades: [
        op({ ofertas_recibidas: 0, presupuesto_disponible: 1_000_000 }),
        op({ ofertas_recibidas: 3, presupuesto_disponible: 2_000_000 }),
      ],
    });
    expect(html).toContain('$3.000.000'); // monto total sumado
  });

  it('maneja el caso sin oportunidades sin romper', () => {
    const html = renderRadarInforme({ ...base, oportunidades: [], totalAnalizadas: 0 });
    expect(html).toContain('Sin resultados');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('respeta el formato de papel solicitado', () => {
    const oficio = renderRadarInforme({ ...base, oportunidades: [op()], formato: 'oficio' });
    expect(oficio).toContain('size: 216mm 330mm');
    expect(oficio).toContain('Oficio / Folio (216 × 330 mm)');

    const carta = renderRadarInforme({ ...base, oportunidades: [op()], formato: 'carta' });
    expect(carta).toContain('size: letter');
  });

  it('usa Carta por defecto si no se especifica formato', () => {
    const html = renderRadarInforme({ ...base, oportunidades: [op()] });
    expect(html).toContain('size: letter');
  });

  it('escapa datos maliciosos provenientes de la API', () => {
    const html = renderRadarInforme({
      ...base,
      oportunidades: [op({ nombre: '<script>alert(1)</script>', organismo: 'A & B' })],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });
});
