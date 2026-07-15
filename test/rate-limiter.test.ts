import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('RateLimiter — cuota diaria reactiva', () => {
  it('no está limitado por defecto', () => {
    const rl = new RateLimiter();
    expect(rl.checkLimit().limited).toBe(false);
  });

  it('marca limitado tras markLimited y expone un tiempo de reset', () => {
    const rl = new RateLimiter();
    rl.markLimited();
    const check = rl.checkLimit();
    expect(check.limited).toBe(true);
    expect(check.resetIn).toMatch(/hora/);
  });

  it('cuenta requests en getStats', () => {
    const rl = new RateLimiter();
    rl.recordRequest();
    rl.recordRequest();
    expect(rl.getStats().requestsToday).toBe(2);
  });
});

describe('RateLimiter — throttle proactivo por minuto', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no espera mientras haya cupo dentro de la ventana', async () => {
    const rl = new RateLimiter(3);
    // 3 llamadas seguidas no deberían bloquear
    await rl.throttle();
    await rl.throttle();
    await rl.throttle();
    // Si llegamos aquí sin timers pendientes, no hubo espera
    expect(vi.getTimerCount()).toBe(0);
  });

  it('espacia la 4ª solicitud cuando se supera el máximo por minuto', async () => {
    const rl = new RateLimiter(2);
    await rl.throttle();
    await rl.throttle();

    // La 3ª debe esperar (~60s). Lanzamos sin await y avanzamos el reloj.
    let resolved = false;
    const p = rl.throttle().then(() => { resolved = true; });

    // Aún no resuelto inmediatamente
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Avanzar el tiempo simulado más allá de la ventana
    await vi.advanceTimersByTimeAsync(60_100);
    await p;
    expect(resolved).toBe(true);
  });
});
