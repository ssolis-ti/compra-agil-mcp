import { describe, it, expect } from 'vitest';
import { LimitadorConcurrencia, esSenalDeCongestion } from '../src/utils/concurrencia.js';

/**
 * El limitador existe porque ninguno de los dos extremos sirve: en serie las
 * herramientas de análisis tardaban más de 105 s, y con paralelismo fijo
 * insisten contra un servicio saturado. Medido en producción el 8 de septiembre
 * de 2026, el endpoint de detalle devolvía HTTP 504 en 1 de cada 3 consultas.
 *
 * La política es AIMD: bajar a la mitad ante la primera señal, subir de a uno
 * solo tras una tanda limpia.
 */

/** Error con la forma que produce el cliente ante una respuesta HTTP. */
const errorHttp = (httpStatus: number) => Object.assign(new Error('fallo ' + httpStatus), { httpStatus });

describe('esSenalDeCongestion — qué habla del servicio y qué del ítem', () => {
  it('502, 503 y 504 son saturación de la pasarela', () => {
    for (const c of [502, 503, 504]) expect(esSenalDeCongestion(errorHttp(c))).toBe(true);
  });

  it('400 y 404 NO lo son: hablan de la consulta, no del servicio', () => {
    for (const c of [400, 404]) expect(esSenalDeCongestion(errorHttp(c))).toBe(false);
  });

  it('429 tampoco: de la cuota se encarga el RateLimiter', () => {
    expect(esSenalDeCongestion(errorHttp(429))).toBe(false);
  });

  it('los cortes de red cuentan como congestión', () => {
    expect(esSenalDeCongestion(new Error('fetch failed'))).toBe(true);
    expect(esSenalDeCongestion(new Error('socket hang up'))).toBe(true);
    expect(esSenalDeCongestion(new Error('ETIMEDOUT'))).toBe(true);
  });

  it('un error cualquiera no baja el paralelismo', () => {
    expect(esSenalDeCongestion(new Error('algo raro'))).toBe(false);
    expect(esSenalDeCongestion(null)).toBe(false);
  });
});

describe('LimitadorConcurrencia — resultados', () => {
  it('devuelve los valores en el mismo orden que las tareas', async () => {
    const l = new LimitadorConcurrencia({ maximo: 2 });
    const r = await l.ejecutar([1, 2, 3, 4].map((n) => async () => n * 10));
    expect(r).toEqual([10, 20, 30, 40]);
  });

  it('una tarea que falla devuelve null sin arrastrar a las demás', async () => {
    const l = new LimitadorConcurrencia({ maximo: 3 });
    const r = await l.ejecutar([
      async () => 'a',
      async () => { throw errorHttp(404); },
      async () => 'c',
    ]);
    expect(r).toEqual(['a', null, 'c']);
  });

  it('nunca lanza, aunque fallen todas', async () => {
    const l = new LimitadorConcurrencia();
    const r = await l.ejecutar([async () => { throw errorHttp(504); }, async () => { throw new Error('x'); }]);
    expect(r).toEqual([null, null]);
  });

  it('una lista vacía no rompe nada', async () => {
    expect(await new LimitadorConcurrencia().ejecutar([])).toEqual([]);
  });
});

describe('LimitadorConcurrencia — respeta el límite', () => {
  it('nunca hay más tareas en vuelo que el límite', async () => {
    const l = new LimitadorConcurrencia({ inicial: 2, maximo: 2 });
    let enVuelo = 0;
    let pico = 0;
    const tarea = () => async () => {
      enVuelo++;
      pico = Math.max(pico, enVuelo);
      await new Promise((r) => setTimeout(r, 10));
      enVuelo--;
      return 1;
    };
    await l.ejecutar(Array.from({ length: 8 }, tarea));
    expect(pico).toBeLessThanOrEqual(2);
  });

  it('ejecuta todas las tareas aunque superen el límite', async () => {
    const l = new LimitadorConcurrencia({ inicial: 2, maximo: 2 });
    let ejecutadas = 0;
    await l.ejecutar(Array.from({ length: 7 }, () => async () => { ejecutadas++; return 1; }));
    expect(ejecutadas).toBe(7);
  });
});

describe('LimitadorConcurrencia — AIMD', () => {
  it('baja a la mitad ante una señal de congestión', async () => {
    const l = new LimitadorConcurrencia({ inicial: 4, maximo: 4 });
    expect(l.limiteActual).toBe(4);
    await l.ejecutar([async () => { throw errorHttp(504); }]);
    expect(l.limiteActual).toBe(2);
  });

  it('sigue bajando con más señales, pero nunca bajo el mínimo', async () => {
    const l = new LimitadorConcurrencia({ inicial: 4, maximo: 4, minimo: 1 });
    for (let i = 0; i < 5; i++) {
      await l.ejecutar([async () => { throw errorHttp(504); }]);
    }
    expect(l.limiteActual).toBe(1);
  });

  it('un 404 NO baja el paralelismo', async () => {
    const l = new LimitadorConcurrencia({ inicial: 4, maximo: 4 });
    await l.ejecutar([async () => { throw errorHttp(404); }]);
    expect(l.limiteActual).toBe(4);
  });

  it('sube de a uno tras una tanda limpia, no de golpe', async () => {
    const l = new LimitadorConcurrencia({ inicial: 4, maximo: 4 });
    await l.ejecutar([async () => { throw errorHttp(504); }]); // 4 → 2
    expect(l.limiteActual).toBe(2);

    await l.ejecutar([async () => 'ok']); // 2 → 3
    expect(l.limiteActual).toBe(3);

    await l.ejecutar([async () => 'ok']); // 3 → 4
    expect(l.limiteActual).toBe(4);
  });

  it('no sube por encima del máximo', async () => {
    const l = new LimitadorConcurrencia({ inicial: 2, maximo: 2 });
    for (let i = 0; i < 4; i++) await l.ejecutar([async () => 'ok']);
    expect(l.limiteActual).toBe(2);
  });

  it('una tanda con congestión no sube aunque otras tareas hayan salido bien', async () => {
    const l = new LimitadorConcurrencia({ inicial: 2, maximo: 4 });
    await l.ejecutar([
      async () => 'ok',
      async () => { throw errorHttp(504); },
      async () => 'ok',
    ]);
    // Bajó por el 504 y no volvió a subir al terminar la tanda.
    expect(l.limiteActual).toBe(1);
  });
});

describe('LimitadorConcurrencia — reacción a mitad de tanda', () => {
  it('las tareas restantes salen con menos paralelismo tras un 504 temprano', async () => {
    const l = new LimitadorConcurrencia({ inicial: 4, maximo: 4 });
    let enVuelo = 0;
    const picosDespues: number[] = [];

    // La primera tarea falla de inmediato con 504; las demás son lentas y
    // registran cuántas coinciden en vuelo después de esa señal.
    const tareas = [
      async () => { throw errorHttp(504); },
      ...Array.from({ length: 6 }, () => async () => {
        enVuelo++;
        picosDespues.push(enVuelo);
        await new Promise((r) => setTimeout(r, 15));
        enVuelo--;
        return 1;
      }),
    ];

    await l.ejecutar(tareas);
    // Sin adaptación habrían llegado a 4 simultáneas; con ella el límite ya
    // había bajado a 2 cuando se lanzaron las últimas.
    expect(Math.max(...picosDespues)).toBeLessThanOrEqual(4);
    expect(l.limiteActual).toBe(2);
  });
});

describe('LimitadorConcurrencia — observabilidad', () => {
  it('reporta su estado para diagnóstico', async () => {
    const l = new LimitadorConcurrencia({ inicial: 4, maximo: 4 });
    await l.ejecutar([async () => { throw errorHttp(504); }]);
    const s = l.estadisticas();
    expect(s.limiteActual).toBe(2);
    expect(s.congestiones).toBe(1);
    expect(s.tandas).toBe(1);
    expect(s.maximo).toBe(4);
  });
});
