import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
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
    // La primera espera es de minutos, no de horas: la cuota es un token
    // bucket que se recarga solo (medido: la API respondió 13 min tras un 429).
    expect(check.resetIn).toMatch(/minuto/);
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

/**
 * Regresión: el estado vivía solo en memoria, así que un reinicio del servidor
 * MCP (algo que ocurre cada vez que el usuario reinicia su cliente) olvidaba
 * que la cuota estaba agotada e informaba isLimited:false segundos después de
 * un 429 real. Detectado en auditoría.
 */
describe('RateLimiter — memoria de la cuota entre reinicios', () => {
  const tmp = path.join(os.tmpdir(), `rl-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  afterEach(() => {
    try { fs.unlinkSync(tmp); } catch { /* no existía */ }
  });

  it('sin ruta de estado no toca el disco (tests herméticos)', () => {
    const rl = new RateLimiter(40);
    rl.markLimited();
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it('un proceso nuevo recuerda que la cuota está agotada', () => {
    const antes = new RateLimiter(40, tmp);
    antes.markLimited();

    const despues = new RateLimiter(40, tmp);
    expect(despues.checkLimit().limited).toBe(true);
    expect(despues.getStats().isLimited).toBe(true);
  });

  it('un proceso nuevo hereda el contador del día', () => {
    const antes = new RateLimiter(40, tmp);
    antes.recordRequest();
    antes.recordRequest();
    antes.recordRequest();

    expect(new RateLimiter(40, tmp).getStats().requestsToday).toBe(3);
  });

  it('descarta un estado guardado en otro día UTC', () => {
    fs.writeFileSync(tmp, JSON.stringify({
      day: '2020-01-01', requestCount: 999, isLimited: true,
      limitResetTime: '2020-01-02T00:01:00.000Z',
    }), 'utf8');

    const rl = new RateLimiter(40, tmp);
    expect(rl.getStats().requestsToday).toBe(0);
    expect(rl.checkLimit().limited).toBe(false);
  });

  it('un archivo corrupto no impide arrancar', () => {
    fs.writeFileSync(tmp, 'esto no es json', 'utf8');
    expect(() => new RateLimiter(40, tmp)).not.toThrow();
    expect(new RateLimiter(40, tmp).getStats().requestsToday).toBe(0);
  });
});

/**
 * Regresión del bloqueo excesivo: un solo 429 fijaba el reset en las 00:01 UTC
 * del día siguiente y el cliente rechazaba localmente toda consulta durante
 * horas. Medido en auditoría: la API volvió a responder 13 minutos después.
 */
describe('RateLimiter — el 429 no debe inutilizar el día', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('la primera espera es de 15 minutos, no hasta mañana', () => {
    const rl = new RateLimiter();
    rl.markLimited();
    expect(rl.checkLimit().limited).toBe(true);

    vi.advanceTimersByTime(14 * 60_000);
    expect(rl.checkLimit().limited).toBe(true);

    vi.advanceTimersByTime(2 * 60_000); // 16 min en total
    expect(rl.checkLimit().limited).toBe(false);
  });

  it('honra el header Retry-After cuando la API lo envía', () => {
    const rl = new RateLimiter();
    rl.markLimited(60); // 60 segundos
    expect(rl.checkLimit().limited).toBe(true);

    vi.advanceTimersByTime(61_000);
    expect(rl.checkLimit().limited).toBe(false);
  });

  it('escala la espera ante 429 consecutivos', () => {
    const rl = new RateLimiter();
    rl.markLimited();                    // 15 min
    vi.advanceTimersByTime(16 * 60_000);
    rl.checkLimit();

    rl.markLimited();                    // 30 min
    vi.advanceTimersByTime(16 * 60_000);
    expect(rl.checkLimit().limited).toBe(true);

    vi.advanceTimersByTime(15 * 60_000); // 31 min desde el 2º
    expect(rl.checkLimit().limited).toBe(false);
  });

  it('una consulta exitosa reinicia la escalada', () => {
    const rl = new RateLimiter();
    rl.markLimited();
    rl.markLimited();
    rl.recordRequest();                  // éxito: el balde tiene fichas

    expect(rl.checkLimit().limited).toBe(false);

    rl.markLimited();                    // vuelve a partir en 15 min
    vi.advanceTimersByTime(16 * 60_000);
    expect(rl.checkLimit().limited).toBe(false);
  });

  it('nunca bloquea más de 2 horas seguidas', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 10; i++) rl.markLimited();
    vi.advanceTimersByTime(121 * 60_000);
    expect(rl.checkLimit().limited).toBe(false);
  });
});
