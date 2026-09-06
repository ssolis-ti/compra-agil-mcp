import { describe, it, expect } from 'vitest';
import { resolverVentanaCambios } from '../src/tools/monitorear-cambios.js';

/**
 * La API expone dos formas mutuamente excluyentes de acotar la ventana de
 * cambios (Guía API Compra Ágil v2 §5.1, Grupo 1): `ttl_cambio_ms` (opción A)
 * o el par `cambio_desde`/`cambio_hasta` (opción B). La opción B estaba
 * soportada por el cliente pero no era alcanzable desde ninguna herramienta.
 */

describe('resolverVentanaCambios — modo relativo (opción A)', () => {
  it('usa 60 minutos por defecto cuando no se indica nada', () => {
    const v = resolverVentanaCambios({});
    expect(v).toEqual({
      params: { ttl_cambio_ms: 3_600_000 },
      descripcion: 'Últimos 60 minutos',
    });
  });

  it('convierte minutos a milisegundos', () => {
    const v = resolverVentanaCambios({ minutos: 1440 });
    expect(v).toMatchObject({ params: { ttl_cambio_ms: 86_400_000 } });
  });

  it('no emite parámetros de rango en modo relativo', () => {
    const v = resolverVentanaCambios({ minutos: 30 });
    expect('error' in v).toBe(false);
    if ('error' in v) return;
    expect(v.params.cambio_desde).toBeUndefined();
    expect(v.params.cambio_hasta).toBeUndefined();
  });
});

describe('resolverVentanaCambios — modo absoluto (opción B)', () => {
  it('acepta un rango completo y no emite ttl_cambio_ms', () => {
    const v = resolverVentanaCambios({
      cambio_desde: '2026-09-01T00:00:00Z',
      cambio_hasta: '2026-09-02T00:00:00Z',
    });
    expect(v).toEqual({
      params: {
        cambio_desde: '2026-09-01T00:00:00Z',
        cambio_hasta: '2026-09-02T00:00:00Z',
      },
      descripcion: 'Cambios entre 2026-09-01T00:00:00Z y 2026-09-02T00:00:00Z',
    });
  });

  it('permite un rango abierto (solo cambio_desde)', () => {
    const v = resolverVentanaCambios({ cambio_desde: '2026-09-01T00:00:00Z' });
    expect(v).toMatchObject({
      params: { cambio_desde: '2026-09-01T00:00:00Z' },
      descripcion: 'Cambios desde 2026-09-01T00:00:00Z',
    });
  });

  it('acepta offset horario además de Z', () => {
    const v = resolverVentanaCambios({ cambio_desde: '2026-09-01T00:00:00-03:00' });
    expect('error' in v).toBe(false);
  });

  it('supera el techo de 24h del modo relativo', () => {
    const v = resolverVentanaCambios({
      cambio_desde: '2026-01-01T00:00:00Z',
      cambio_hasta: '2026-09-01T00:00:00Z',
    });
    expect('error' in v).toBe(false);
  });
});

describe('resolverVentanaCambios — validación local (ahorra cuota)', () => {
  it('rechaza combinar ambos modos', () => {
    const v = resolverVentanaCambios({
      minutos: 60,
      cambio_desde: '2026-09-01T00:00:00Z',
    });
    expect(v).toHaveProperty('error');
    expect((v as { error: string }).error).toMatch(/mutuamente excluyentes/);
  });

  it('rechaza cambio_hasta sin cambio_desde', () => {
    const v = resolverVentanaCambios({ cambio_hasta: '2026-09-02T00:00:00Z' });
    expect((v as { error: string }).error).toMatch(/requiere también "cambio_desde"/);
  });

  it('rechaza fechas que no son ISO-8601', () => {
    const v = resolverVentanaCambios({ cambio_desde: '01-09-2026' });
    expect((v as { error: string }).error).toMatch(/ISO-8601/);
  });

  it('rechaza ISO-8601 sin zona horaria', () => {
    const v = resolverVentanaCambios({ cambio_desde: '2026-09-01T00:00:00' });
    expect((v as { error: string }).error).toMatch(/ISO-8601/);
  });

  it('rechaza un rango invertido', () => {
    const v = resolverVentanaCambios({
      cambio_desde: '2026-09-02T00:00:00Z',
      cambio_hasta: '2026-09-01T00:00:00Z',
    });
    expect((v as { error: string }).error).toMatch(/rango quedaría vacío/);
  });
});
