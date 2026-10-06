import { describe, it, expect, afterEach } from 'vitest';
import { fecha, fechaLarga } from '../src/reports/format.js';
import { enHoraDeChile } from '../src/utils/fechas.js';

/**
 * Los informes imprimen el plazo de cierre. Antes dependía de la zona horaria
 * del servidor: el mismo cierre salía 12:00, 15:00 o 17:00 según dónde corría
 * el proceso (auditoría QA, octubre 2026). Y hasta la 2.7.0 se leía como UTC,
 * con lo que el informe imprimía cada cierre 3 h antes: la API entrega hora de
 * Chile (medido el 6-oct-2026; ver utils/fechas.ts).
 */

const TZ_ORIGINAL = process.env.TZ;

afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

describe('fecha() de los informes', () => {
  it('el valor de la API es hora de Chile: se imprime tal cual, en invierno y en verano', () => {
    expect(fecha('2026-07-15 13:30')).toBe('15-07-2026 13:30');
    expect(fecha('2026-01-15 13:30')).toBe('15-01-2026 13:30');
  });

  it('la "Z" de la API no cambia la hora: también es hora de Chile', () => {
    expect(fecha('2026-07-15T13:30:00Z')).toBe('15-07-2026 13:30');
  });

  it('un offset numérico explícito sí se respeta', () => {
    expect(fecha('2026-07-15T13:30:00-04:00')).toBe('15-07-2026 13:30');
    expect(fecha('2026-07-15T13:30:00+00:00')).toBe('15-07-2026 09:30');
  });

  it('el día impreso es el del valor, sin correrse por la zona', () => {
    expect(fecha('2026-07-16 02:00', false)).toBe('16-07-2026');
  });

  it('da lo mismo en cualquier zona horaria del servidor', () => {
    const resultados = ['America/Santiago', 'UTC', 'Europe/Madrid', 'Asia/Tokyo'].map((tz) => {
      process.env.TZ = tz;
      return fecha('2026-09-11 12:00');
    });
    expect(new Set(resultados).size).toBe(1);
  });

  it('coincide con fecha_cierre_hora_chile de las herramientas JSON', () => {
    for (const valor of ['2026-09-11 12:00', '2026-07-15 13:30', '2026-01-15T23:59:00Z']) {
      const json = enHoraDeChile(valor)!; // "YYYY-MM-DD HH:MM"
      const [dia, hora] = json.split(' ');
      const [a, m, d] = dia.split('-');
      expect(fecha(valor)).toBe(`${d}-${m}-${a} ${hora}`);
    }
  });

  it('sigue devolviendo — ante un valor ausente o ilegible', () => {
    expect(fecha(null)).toBe('—');
    expect(fecha(undefined)).toBe('—');
    expect(fecha('basura')).toBe('—');
  });
});

describe('fechaLarga()', () => {
  it('usa el calendario de Chile aunque el servidor ya esté en el día siguiente', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 02:00 UTC del 16 de julio: en Tokio ya es 16, en Chile todavía es 15.
    expect(fechaLarga(new Date('2026-07-16T02:00:00Z'))).toBe('15 de julio de 2026');
  });
});
