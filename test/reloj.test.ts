import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ahora, registrarMedicion, estadoReloj, avisoReloj, reiniciarRelojParaTests, INTERVALO_MEDICION_MS,
} from '../src/utils/reloj.js';
import { conNotaHoraria } from '../src/utils/fechas.js';
import { baseDeZonasAlDia, TZ_MINIMA } from '../src/tools/verificar-hora.js';
import type { ResultadoNtp } from '../src/utils/ntp.js';

/**
 * Los plazos (horas restantes, urgencia del radar, ventanas del monitoreo y del
 * daemon) restan "ahora". Hasta la 2.7.0 era `Date.now()` sin contrastar, y el
 * chequeo contra el SHOA vivía aislado en una herramienta. Ahora `ahora()` aplica
 * el desfase medido contra ntp.shoa.cl, sin depender de que la red lo permita.
 */

function medicion(desfaseMs: number): ResultadoNtp {
  return {
    ok: true, servidor: 'ntp.shoa.cl', desfaseMs, demoraMs: 40,
    horaOficial: new Date().toISOString(), horaLocal: new Date().toISOString(),
  };
}

afterEach(() => {
  reiniciarRelojParaTests();
  vi.useRealTimers();
});

describe('ahora() — corregido contra el SHOA', () => {
  it('sin medición usa el reloj local, y lo dice', () => {
    expect(Math.abs(ahora() - Date.now())).toBeLessThan(50);
    expect(estadoReloj()).toMatchObject({ fuente: 'local', desfaseMs: null });
    expect(estadoReloj().motivo).toMatch(/no se midió/i);
  });

  it('con una medición aplica el desfase: reloj local atrasado 2 min → ahora() suma 2 min', () => {
    registrarMedicion(medicion(120_000));
    expect(ahora() - Date.now()).toBeGreaterThan(119_900);
    expect(estadoReloj()).toMatchObject({ fuente: 'shoa', desfaseMs: 120_000 });
  });

  it('si el NTP falla (UDP 123 bloqueado), sigue con el reloj local y guarda el motivo', () => {
    registrarMedicion({ ok: false, servidor: 'ntp.shoa.cl', motivo: 'El servidor no respondió (UDP 123 bloqueado).' });
    expect(Math.abs(ahora() - Date.now())).toBeLessThan(50);
    expect(estadoReloj()).toMatchObject({ fuente: 'local', motivo: expect.stringMatching(/UDP 123/) });
  });

  it('una medición vieja deja de aplicarse', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    registrarMedicion(medicion(120_000));
    expect(estadoReloj().fuente).toBe('shoa');
    vi.setSystemTime(Date.now() + 3 * INTERVALO_MEDICION_MS + 1);
    expect(estadoReloj().fuente).toBe('local');
    expect(ahora()).toBe(Date.now());
  });
});

describe('avisoReloj — solo cuando importa', () => {
  it('bajo un minuto no avisa', () => {
    registrarMedicion(medicion(30_000));
    expect(avisoReloj()).toBeNull();
  });

  it('desde un minuto avisa, con el sentido correcto', () => {
    registrarMedicion(medicion(5 * 60_000));
    expect(avisoReloj()).toMatch(/atrasado ~5 min/);
    registrarMedicion(medicion(-5 * 60_000));
    expect(avisoReloj()).toMatch(/adelantado ~5 min/);
  });

  it('el aviso llega a toda respuesta con fechas, vía conNotaHoraria', () => {
    expect(conNotaHoraria({ x: 1 })).not.toHaveProperty('_aviso_reloj');
    registrarMedicion(medicion(5 * 60_000));
    expect(conNotaHoraria({ x: 1 })._aviso_reloj).toMatch(/SHOA/);
  });
});

describe('base de zonas horarias — el NTP no da la zona', () => {
  it(`exige al menos la ${TZ_MINIMA}`, () => {
    expect(baseDeZonasAlDia('2026a')).toBe(true);
    expect(baseDeZonasAlDia(TZ_MINIMA)).toBe(true);
    expect(baseDeZonasAlDia('2024b')).toBe(false);
  });

  it('sin versión reconocible no afirma nada', () => {
    expect(baseDeZonasAlDia('')).toBeNull();
    expect(baseDeZonasAlDia('rara')).toBeNull();
  });
});
