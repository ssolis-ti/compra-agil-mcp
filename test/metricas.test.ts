import { describe, it, expect, beforeEach } from 'vitest';
import {
  registrarLlamadaHerramienta, registrarConsultaApi, registrarAciertoCache, registrarOmitidaPorTiempo,
  resumenMetricas, reiniciarMetricas,
} from '../src/utils/metricas.js';

/** Fase 2.2: las latencias se miden dentro del servidor, no desde fuera. */

beforeEach(() => reiniciarMetricas());

describe('métricas por herramienta', () => {
  it('cuenta llamadas y errores, y calcula media, mediana, p95 y máxima', () => {
    for (const ms of [100, 200, 300, 400, 10_000]) registrarLlamadaHerramienta('analizar_precios_mercado', ms, ms === 10_000);
    const m = resumenMetricas().herramientas.analizar_precios_mercado as { llamadas: number; errores: number; latencia_ms: Record<string, number> };
    expect(m.llamadas).toBe(5);
    expect(m.errores).toBe(1);
    expect(m.latencia_ms).toEqual({ media: 2200, mediana: 300, p95: 10_000, maxima: 10_000 });
  });

  it('los percentiles usan solo las últimas 100 llamadas; el máximo, todas', () => {
    registrarLlamadaHerramienta('x', 99_999, false);
    for (let i = 0; i < 100; i++) registrarLlamadaHerramienta('x', 10, false);
    const m = resumenMetricas().herramientas.x as { llamadas: number; latencia_ms: Record<string, number> };
    expect(m.llamadas).toBe(101);
    expect(m.latencia_ms.p95).toBe(10);
    expect(m.latencia_ms.maxima).toBe(99_999);
  });
});

describe('métricas de consultas a la API', () => {
  it('separa enviadas, caché, omitidas y resultado', () => {
    registrarConsultaApi(200);
    registrarConsultaApi(504);
    registrarConsultaApi(504);
    registrarConsultaApi('timeout');
    registrarAciertoCache();
    registrarAciertoCache();
    registrarOmitidaPorTiempo();
    expect(resumenMetricas().consultas_api).toEqual({
      enviadas: 4, desde_cache: 2, porcentaje_desde_cache: 33, omitidas_por_tiempo: 1,
      por_resultado: { '200': 1, '504': 2, timeout: 1 },
    });
  });

  it('no guarda parámetros ni respuestas: solo nombres, tiempos y códigos', () => {
    registrarLlamadaHerramienta('buscar_compras_agiles', 10, false);
    const texto = JSON.stringify(resumenMetricas());
    expect(texto).not.toMatch(/ticket|q=|cambio_desde/i);
  });
});
