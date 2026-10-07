import { describe, it, expect } from 'vitest';
import { clasificarHttp, clasificarErrorDeRed } from '../src/avisos/canal.js';

/**
 * Qué se reintenta y qué no (T3.2 de la 2.9.0; R3.2). Un error permanente
 * reintentado solo gasta y llena los logs; uno transitorio no reintentado
 * pierde el aviso.
 */
describe('clasificarHttp', () => {
  it.each([
    [200, 'ok'], [204, 'ok'],
    [408, 'transitorio'], [429, 'transitorio'], [500, 'transitorio'], [502, 'transitorio'], [503, 'transitorio'], [504, 'transitorio'],
    [400, 'permanente'], [401, 'permanente'], [403, 'permanente'], [404, 'permanente'], [410, 'permanente'],
  ])('%i → %s', (status, tipo) => {
    expect(clasificarHttp(status).tipo).toBe(tipo);
  });

  it('honra Retry-After en segundos y en fecha HTTP', () => {
    expect(clasificarHttp(429, '30').reintentarEnMs).toBe(30_000);
    const ahora = Date.parse('2026-10-07T22:00:00Z');
    expect(clasificarHttp(503, 'Wed, 07 Oct 2026 22:01:00 GMT', ahora).reintentarEnMs).toBe(60_000);
    expect(clasificarHttp(503, 'basura').reintentarEnMs).toBeUndefined();
  });
});

describe('clasificarErrorDeRed', () => {
  it('timeout, conexión rechazada y DNS son transitorios', () => {
    for (const e of [Object.assign(new Error('x'), { name: 'TimeoutError' }), Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } }), new TypeError('fetch failed')]) {
      expect(clasificarErrorDeRed(e).tipo).toBe('transitorio');
    }
  });
});
