import { describe, it, expect } from 'vitest';
import {
  consultarHoraOficial, interpretarDesfase, SERVIDOR_NTP_CHILE, DESFASE_PREOCUPANTE_MS,
} from '../src/utils/ntp.js';

/**
 * Los plazos de este servidor se calculan restando la hora local, así que un
 * reloj desviado falsea `horas_restantes` y el puntaje de urgencia del radar
 * aunque la fecha de la API se interprete perfectamente. Se contrasta contra el
 * SHOA, que es quien fija legalmente la hora en Chile.
 *
 * Los tests de red van con un servidor inexistente: dependen de que falle, no
 * de que responda, así que no requieren conexión ni ponen la suite a merced de
 * ntp.shoa.cl.
 */

describe('interpretarDesfase — traduce milisegundos a consecuencias', () => {
  it('bajo un segundo, informa que está sincronizado', () => {
    expect(interpretarDesfase(50)).toMatch(/sincronizado/i);
    expect(interpretarDesfase(-300)).toMatch(/sincronizado/i);
  });

  it('unos segundos son irrelevantes para un plazo de cierre, y lo dice', () => {
    const t = interpretarDesfase(5_000);
    expect(t).toMatch(/5\.0 s/);
    expect(t).toMatch(/irrelevante/i);
  });

  it('un reloj ATRASADO advierte que el plazo puede vencer antes de lo que parece', () => {
    const t = interpretarDesfase(5 * 60_000);
    expect(t).toMatch(/atrasado/);
    expect(t).toMatch(/vencer antes/i);
    expect(t).toMatch(/⚠/);
  });

  it('un reloj ADELANTADO advierte en el sentido contrario', () => {
    const t = interpretarDesfase(-5 * 60_000);
    expect(t).toMatch(/adelantado/);
    expect(t).toMatch(/MENORES/);
  });

  it('el umbral de preocupación es un minuto', () => {
    expect(interpretarDesfase(DESFASE_PREOCUPANTE_MS - 1)).not.toMatch(/⚠/);
    expect(interpretarDesfase(DESFASE_PREOCUPANTE_MS)).toMatch(/⚠/);
  });
});

describe('consultarHoraOficial — degrada sin romper', () => {
  it('un servidor inexistente devuelve un fallo, no una excepción', async () => {
    const r = await consultarHoraOficial('ntp-que-no-existe.invalid', 1500);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.servidor).toBe('ntp-que-no-existe.invalid');
      expect(typeof r.motivo).toBe('string');
      expect(r.motivo.length).toBeGreaterThan(0);
    }
  }, 10_000);

  it('el mensaje de timeout menciona el bloqueo de UDP 123, que es la causa habitual', async () => {
    // 203.0.113.0/24 está reservado para documentación (RFC 5737): nunca responde.
    const r = await consultarHoraOficial('203.0.113.1', 800);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/UDP 123|no respondió/i);
  }, 10_000);

  it('respeta el timeout en vez de colgarse', async () => {
    const t0 = Date.now();
    await consultarHoraOficial('203.0.113.1', 700);
    // Margen amplio para no volverlo inestable en máquinas lentas.
    expect(Date.now() - t0).toBeLessThan(6_000);
  }, 10_000);

  it('el servidor por defecto es el oficial de Chile', () => {
    expect(SERVIDOR_NTP_CHILE).toBe('ntp.shoa.cl');
  });
});
