import { describe, it, expect } from 'vitest';
import { resolverVentanaCambios } from '../src/tools/monitorear-cambios.js';

/**
 * La API ofrece dos formas de acotar la ventana de cambios (Guía API Compra
 * Ágil v2 §5.1, Grupo 1): `ttl_cambio_ms` o el par `cambio_desde`/`cambio_hasta`.
 *
 * ⚠ La API marca los cambios con la hora de pared de Chile y una "Z", y su
 *   filtro las compara contra la hora UTC real. Con `ttl_cambio_ms` de 60 min
 *   devolvía 0 en pleno horario hábil (medido el 6-oct-2026). Por eso las dos
 *   ventanas se mandan como rango absoluto escrito como la API compara: la hora
 *   de Chile del instante pedido, con "Z".
 */

// 15:42:39 de Chile del 6 de octubre de 2026 (verano, UTC-3): el instante de la
// medición contra la API real que fijó este comportamiento.
const AHORA = Date.parse('2026-10-06T18:42:39Z');

describe('resolverVentanaCambios — modo relativo', () => {
  it('60 minutos por defecto, como rango en hora de Chile con "Z"', () => {
    const v = resolverVentanaCambios({}, AHORA);
    expect(v).toEqual({
      // Medido: este rango trajo 1.517 cambios, el más reciente "15:40:00.903Z".
      params: { cambio_desde: '2026-10-06T14:42:39Z', cambio_hasta: '2026-10-06T15:44:39Z' },
      descripcion: 'Últimos 60 minutos (desde 2026-10-06 14:42, hora de Chile)',
    });
  });

  it('nunca usa ttl_cambio_ms: la API lo compara contra la hora UTC real y deja fuera las últimas 3 h', () => {
    for (const minutos of [1, 60, 170, 1440]) {
      const v = resolverVentanaCambios({ minutos }, AHORA);
      if ('error' in v) throw new Error(v.error);
      expect(v.params).not.toHaveProperty('ttl_cambio_ms');
    }
  });

  it('el fin de la ventana queda unos minutos en el futuro para no perder el último ciclo de la API', () => {
    const v = resolverVentanaCambios({ minutos: 10 }, AHORA);
    if ('error' in v) throw new Error(v.error);
    expect(v.params.cambio_hasta).toBe('2026-10-06T15:44:39Z');
  });

  it('24 horas cruzan el día en hora de Chile', () => {
    const v = resolverVentanaCambios({ minutos: 1440 }, AHORA);
    if ('error' in v) throw new Error(v.error);
    expect(v.params.cambio_desde).toBe('2026-10-05T15:42:39Z');
  });

  it('en invierno el desfase es de 4 horas, y la ventana sigue en hora de Chile', () => {
    // 12:00 de Chile del 15 de julio (UTC-4).
    const v = resolverVentanaCambios({ minutos: 60 }, Date.parse('2026-07-15T16:00:00Z'));
    if ('error' in v) throw new Error(v.error);
    expect(v.params.cambio_desde).toBe('2026-07-15T11:00:00Z');
  });
});

describe('resolverVentanaCambios — modo absoluto', () => {
  it('traduce el rango del usuario a hora de Chile con "Z", como la API compara', () => {
    const v = resolverVentanaCambios({
      cambio_desde: '2026-10-06T09:00:00-03:00',
      cambio_hasta: '2026-10-06T12:00:00-03:00',
    }, AHORA);
    expect(v).toEqual({
      params: { cambio_desde: '2026-10-06T09:00:00Z', cambio_hasta: '2026-10-06T12:00:00Z' },
      descripcion: 'Cambios entre 2026-10-06 09:00 y 2026-10-06 12:00 (hora de Chile)',
    });
  });

  it('un instante en UTC se convierte a su hora de Chile', () => {
    const v = resolverVentanaCambios({ cambio_desde: '2026-10-06T12:00:00Z' }, AHORA);
    expect(v).toMatchObject({
      params: { cambio_desde: '2026-10-06T09:00:00Z' },
      descripcion: 'Cambios desde 2026-10-06 09:00 (hora de Chile)',
    });
  });

  it('regresión: antes se mandaba tal cual y la ventana quedaba corrida 3 horas', () => {
    // La auditora pidió 09:00–12:00 -03:00 y recibió cambios de 12:00 a 15:00.
    const v = resolverVentanaCambios({ cambio_desde: '2026-10-06T09:00:00-03:00' }, AHORA);
    if ('error' in v) throw new Error(v.error);
    expect(v.params.cambio_desde).not.toBe('2026-10-06T09:00:00-03:00');
    expect(v.params.cambio_desde).not.toBe('2026-10-06T12:00:00Z');
  });

  it('supera el techo de 24h del modo relativo', () => {
    const v = resolverVentanaCambios({
      cambio_desde: '2026-01-01T00:00:00Z',
      cambio_hasta: '2026-09-01T00:00:00Z',
    }, AHORA);
    expect('error' in v).toBe(false);
  });
});

describe('resolverVentanaCambios — validación local (ahorra cuota)', () => {
  it('rechaza combinar ambos modos', () => {
    const v = resolverVentanaCambios({ minutos: 60, cambio_desde: '2026-09-01T00:00:00Z' }, AHORA);
    expect((v as { error: string }).error).toMatch(/mutuamente excluyentes/);
  });

  it('rechaza cambio_hasta sin cambio_desde', () => {
    const v = resolverVentanaCambios({ cambio_hasta: '2026-09-02T00:00:00Z' }, AHORA);
    expect((v as { error: string }).error).toMatch(/requiere también "cambio_desde"/);
  });

  it('rechaza fechas que no son ISO-8601', () => {
    const v = resolverVentanaCambios({ cambio_desde: '01-09-2026' }, AHORA);
    expect((v as { error: string }).error).toMatch(/ISO-8601/);
  });

  it('rechaza ISO-8601 sin zona horaria, y el ejemplo del error usa el desfase de Chile', () => {
    const v = resolverVentanaCambios({ cambio_desde: '2026-09-01T00:00:00' }, AHORA);
    const error = (v as { error: string }).error;
    expect(error).toMatch(/ISO-8601/);
    expect(error).toMatch(/-03:00/);
  });

  it('rechaza un rango invertido', () => {
    const v = resolverVentanaCambios({
      cambio_desde: '2026-09-02T00:00:00Z',
      cambio_hasta: '2026-09-01T00:00:00Z',
    }, AHORA);
    expect((v as { error: string }).error).toMatch(/rango quedaría vacío/);
  });

  it('compara instantes, no textos: 10:00-03:00 es posterior a 12:00Z', () => {
    // Como texto "…T10:00:00-03:00" < "…T12:00:00Z", pero el instante es 13:00Z.
    const invertido = resolverVentanaCambios({
      cambio_desde: '2026-09-01T10:00:00-03:00',
      cambio_hasta: '2026-09-01T12:00:00Z',
    }, AHORA);
    expect((invertido as { error: string }).error).toMatch(/rango quedaría vacío/);

    // Y al revés: como texto parece invertido, pero es un rango válido.
    const valido = resolverVentanaCambios({
      cambio_desde: '2026-09-01T12:00:00Z',
      cambio_hasta: '2026-09-01T10:00:00-03:00',
    }, AHORA);
    expect('error' in valido).toBe(false);
  });
});
