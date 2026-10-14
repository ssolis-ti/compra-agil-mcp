import { describe, it, expect } from 'vitest';
import { tramosConTermino } from '../src/utils/secciones.js';
import { buscarEnTexto, normalizar, pesosPorRareza, unirGuiones } from '../src/utils/doc-search.js';
import { diasEnTexto } from '../src/tools/generar-borrador.js';

/** Reportes de Hermes sobre la 2.9.2 (10 y 14-oct), arreglados en la 2.9.3. */

const TDR = [
  'III. Alcance',
  'Instalación de puntos de red.',
  'IV. Requisitos de',
  'Admisibilidad',
  '(mínimo técnico)',
  'El oferente deberá adjuntar:',
  '1. Oferta técnica detallada.',
  '2. Oferta económica con valor neto, IVA y total.',
  '3. Plazo de ejecución en días hábiles.',
  '4. Garantía del servicio.',
  'V. Multas',
  'Se aplicará una multa por atraso.',
].join('\n');

describe('MEJORA-001: query en adjuntos devuelve la sección', () => {
  it('«admisibilidad» trae los cuatro requisitos, hasta el siguiente numeral romano', () => {
    const [t] = tramosConTermino(TDR, 'admisibilidad', 5000);
    expect(t.texto).toMatch(/^IV\. Requisitos de/);
    expect(t.texto).toMatch(/4\. Garantía del servicio\.$/);
    expect(t.texto).not.toMatch(/Multas/);
  });

  it('sin tildes ni mayúsculas, y respeta el presupuesto', () => {
    expect(tramosConTermino(TDR, 'GARANTIA', 5000)).toHaveLength(1);
    const [corto] = tramosConTermino(TDR, 'admisibilidad', 60);
    expect(corto.texto.length).toBeLessThanOrEqual(60);
  });

  it('un término ausente no devuelve nada', () => {
    expect(tramosConTermino(TDR, 'formalización', 5000)).toEqual([]);
  });
});

describe('MEJORA-004: el orden de consultar_documentos_locales', () => {
  it('un término raro pesa más que uno común en todo el corpus', () => {
    const corpus = ['multas y servicio', 'servicio', 'servicio', 'servicio'].map(normalizar);
    const p = pesosPorRareza(['multas', 'servicio'], corpus);
    expect(p.multas).toBeGreaterThan(p.servicio);
  });

  it('con pesos, la línea con el término raro gana a la que tiene el común', () => {
    const r = buscarEnTexto('mejora de los servicios\notra cosa\nnada\naplicación de multas', 'multas servicio', 12, { multas: 3, servicio: 1 });
    expect(r.fragmentos[0].texto).toMatch(/\[COINCIDENCIA\] aplicación de multas/);
  });

  it('une las palabras que el PDF corta con guion al final de la línea', () => {
    expect(unirGuiones('con-\ntribuir a la mejora')).toBe('contribuir a la mejora');
    expect(unirGuiones('pro- \r\nductos')).toBe('productos');
    expect(unirGuiones('2024-\n2025')).toBe('2024-\n2025'); // números: no se tocan
  });
});

describe('MEJORA-005: plazo en la carta de cotización', () => {
  it('singular y unidad correctos', () => {
    expect(diasEnTexto(1, 'corridos')).toBe('1 día corrido');
    expect(diasEnTexto(5, 'corridos')).toBe('5 días corridos');
    expect(diasEnTexto(1, 'habiles')).toBe('1 día hábil');
    expect(diasEnTexto(10, 'habiles')).toBe('10 días hábiles');
  });
});
