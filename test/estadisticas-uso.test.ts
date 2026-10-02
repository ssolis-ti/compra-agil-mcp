import { describe, it, expect } from 'vitest';
import { cuerpoEstadisticas } from '../src/tools/estadisticas-uso.js';

describe('cuerpoEstadisticas', () => {
  it('conserva el rótulo viejo y agrega el que no suena a saldo', () => {
    const cuerpo = cuerpoEstadisticas({ requestsToday: 3, isLimited: false, resetTime: null });
    expect(cuerpo.cuota_agotada).toBe(false);
    expect(cuerpo.vio_rechazo_temporal).toBe(false);
    expect(String(cuerpo._nota)).toMatch(/no es el saldo del ticket/i);
  });
});
