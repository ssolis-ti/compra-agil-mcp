import { describe, it, expect } from 'vitest';
import { leerEstadoMonitor, podarEstado, serializarEstado } from '../src/utils/estado-monitor.js';

/** Fase 1.7: el estado de deduplicación del daemon crecía para siempre. */

const AHORA = Date.parse('2026-10-06T18:00:00Z');
const DIA = 24 * 60 * 60 * 1000;

describe('estado del daemon de monitoreo', () => {
  it('lee el formato anterior sin perder la deduplicación', () => {
    const estado = leerEstadoMonitor(JSON.stringify({ alerted: ['1-2-COT26', '3-4-COT26'] }), AHORA);
    expect([...estado.entries()]).toEqual([['1-2-COT26', AHORA], ['3-4-COT26', AHORA]]);
  });

  it('poda los códigos alertados hace más de 30 días y conserva los recientes', () => {
    const estado = new Map([['viejo-1-COT26', AHORA - 31 * DIA], ['reciente-1-COT26', AHORA - 2 * DIA]]);
    expect(podarEstado(estado, AHORA)).toBe(1);
    expect([...estado.keys()]).toEqual(['reciente-1-COT26']);
  });

  it('ida y vuelta con el formato nuevo', () => {
    const estado = new Map([['1-2-COT26', AHORA]]);
    expect(leerEstadoMonitor(serializarEstado(estado), AHORA + DIA)).toEqual(estado);
  });

  it('ignora entradas con fecha inválida', () => {
    const estado = leerEstadoMonitor(JSON.stringify({ alertados: { a: 'ayer', b: AHORA } }), AHORA);
    expect([...estado.keys()]).toEqual(['b']);
  });
});
