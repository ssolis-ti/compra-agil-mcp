import { describe, it, expect } from 'vitest';
import {
  inicioDeLote, ultimoLoteAsentado, ventanaDeLote, planificarLotes, lecturaConsistente,
  PERIODO_LOTE_MS, RECUPERACION_MS,
} from '../src/vigilancia/lotes.js';

/**
 * Lotes de la API (T2.2 de la 2.9.0; R1.2–R1.4, R1.10; ADR 0021). Las
 * marcas son instantes UTC reales; la consulta se escribe en hora de Chile
 * con «Z», que es como la API compara.
 */
const MIN = 60_000;
const L = Date.parse('2026-10-07T21:05:00Z'); // lote de las 18:05 de Chile (UTC-3)

describe('lotes', () => {
  it('el lote de un instante es el múltiplo de 5 min anterior', () => {
    expect(inicioDeLote(L + 4 * MIN + 59_999)).toBe(L);
    expect(inicioDeLote(L + 5 * MIN)).toBe(L + PERIODO_LOTE_MS);
  });

  it('un lote se lee 2 minutos después de su marca (asentamiento medido)', () => {
    expect(ultimoLoteAsentado(L + 2 * MIN)).toBe(L);
    expect(ultimoLoteAsentado(L + 2 * MIN - 1)).toBe(L - PERIODO_LOTE_MS);
  });

  it('la consulta de un lote va en hora de Chile con «Z» y cubre un solo lote (los bordes se incluyen)', () => {
    expect(ventanaDeLote(L)).toEqual({ cambio_desde: '2026-10-07T18:05:00Z', cambio_hasta: '2026-10-07T18:09:59Z' });
  });

  it('en el cambio de horario de abril la hora de pared se repite, pero cada lote UTC es distinto', () => {
    // 5-abr-2026: a las 00:00 de Chile (03:00Z) se vuelve a las 23:00 del sábado.
    const antes = Date.parse('2026-04-05T02:05:00Z'); // 23:05 de Chile, UTC-3
    const despues = Date.parse('2026-04-05T03:05:00Z'); // 23:05 de Chile, UTC-4
    expect(ventanaDeLote(antes).cambio_desde).toBe(ventanaDeLote(despues).cambio_desde);
    expect(antes).not.toBe(despues);
  });
});

describe('planificarLotes', () => {
  const ahora = L + 2 * MIN;

  it('primer ciclo (sin marca): la última hora, 12 lotes, en orden', () => {
    const p = planificarLotes({ marca: null, leidos: [] }, ahora);
    expect(p.lotes).toHaveLength(12);
    expect(p.lotes[0]).toBe(L - 55 * MIN);
    expect(p.lotes.at(-1)).toBe(L);
    expect(p.hueco).toBeNull();
  });

  it('desde el lote siguiente a la marca, saltando los ya leídos tras ella', () => {
    const p = planificarLotes({ marca: L - 20 * MIN, leidos: [L - 10 * MIN] }, ahora);
    expect(p.lotes).toEqual([L - 15 * MIN, L - 5 * MIN, L]);
  });

  it('marca al día: nada que leer', () => {
    expect(planificarLotes({ marca: L, leidos: [] }, ahora).lotes).toEqual([]);
  });

  it('más allá de 48 h, lo no leído es un hueco informado y no se lee (R1.3)', () => {
    const marca = L - 72 * 60 * MIN;
    const p = planificarLotes({ marca, leidos: [] }, ahora);
    expect(p.lotes).toHaveLength(RECUPERACION_MS / PERIODO_LOTE_MS);
    expect(p.hueco).toEqual({ desde: marca + PERIODO_LOTE_MS, hasta: p.lotes[0] - PERIODO_LOTE_MS });
  });

  it('la unión de lotes leídos y planificados cubre todo sin saltos ni repetidos', () => {
    const marca = L - 60 * MIN;
    const leidos = [L - 40 * MIN, L - 25 * MIN];
    const p = planificarLotes({ marca, leidos }, ahora);
    const todos = [...leidos, ...p.lotes].sort((a, b) => a - b);
    expect(todos).toEqual(Array.from({ length: 12 }, (_, i) => marca + (i + 1) * PERIODO_LOTE_MS));
  });
});

describe('lecturaConsistente', () => {
  it('solo si el total no cambió y se leyeron tantos códigos distintos como el total', () => {
    expect(lecturaConsistente(35, 35, 35)).toBe(true);
    expect(lecturaConsistente(35, 34, 34)).toBe(false); // un proceso salió del lote a mitad de la lectura
    expect(lecturaConsistente(35, 35, 34)).toBe(false); // páginas corridas: falta uno
  });
});
