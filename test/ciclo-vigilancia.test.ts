import { describe, it, expect } from 'vitest';
import { ejecutarCiclo } from '../src/vigilancia/ciclo.js';
import { estadoVacio, type EstadoVigilancia } from '../src/vigilancia/estado.js';
import type { Criterios } from '../src/vigilancia/criterios.js';
import { aFormatoApi } from '../src/utils/fechas.js';
import { nuevoCatalogo, clienteFalso, type CatalogoCambios } from './ayudas/api-cambios.js';
import { relojFalso } from './ayudas/reloj-falso.js';

/**
 * El ciclo de vigilancia contra el catálogo de lotes (T2.4 de la 2.9.0;
 * R1.1–R1.9; ADR 0021). Cada caso es una forma en que la 2.8.0 perdía
 * procesos sin decirlo.
 */
const MIN = 60_000;
const LOTE = 5 * MIN;
const T0 = Date.parse('2026-10-07T15:00:00Z'); // 12:00 de Chile
const pared = (utc: number) => Date.parse(aFormatoApi(new Date(utc)));
const criterios: Criterios = { palabras: ['resmas'], excluidas: [], regiones: [], presupuestoMinimo: 0, soloSinOfertas: true };

/** Catálogo con `n` procesos por lote para los lotes UTC dados. */
function catalogoCon(lotes: number[], n: number, opciones: { region?: number } = {}): { c: CatalogoCambios; codigos: Map<number, string[]> } {
  const c = nuevoCatalogo();
  const codigos = new Map<number, string[]>();
  const regiones = [13, 5, 8, 2, 1, 15, 4, 7];
  for (const l of lotes) {
    const cods: string[] = [];
    for (let i = 0; i < n; i++) cods.push(...c.agregar(pared(l), 1, { region: opciones.region ?? regiones[i % regiones.length] }));
    codigos.set(l, cods);
  }
  return { c, codigos };
}

const lotesDesde = (inicio: number, cantidad: number) => Array.from({ length: cantidad }, (_, i) => inicio + i * LOTE);
const conMarca = (marcaUtc: number): EstadoVigilancia => ({ ...estadoVacio(), marca: new Date(marcaUtc).toISOString() });

describe('ejecutarCiclo', () => {
  it('(a) una hora de lotes de 35: los 420 se revisan y la marca llega al último lote', async () => {
    const lotes = lotesDesde(T0, 12);
    const { c } = catalogoCon(lotes, 35);
    const reloj = relojFalso(lotes.at(-1)! + 2 * MIN);
    const estado = conMarca(T0 - LOTE);
    const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    expect(r.alertas).toHaveLength(420);
    expect(new Set(r.alertas.map((a) => a.codigo)).size).toBe(420);
    expect(estado.marca).toBe(new Date(lotes.at(-1)!).toISOString());
    expect(r.lotesLeidos).toBe(12);
    expect(r.parcial).toBe(false);
    // 4 páginas por lote + la comprobación de la página 1.
    expect(r.consultas).toBe(12 * 5);
  });

  it('(b) un lote con 504 en 3 ciclos seguidos: la marca lo espera, los demás no se releen, y al 4.º se recupera', async () => {
    const lotes = lotesDesde(T0, 6);
    const { c, codigos } = catalogoCon(lotes, 3);
    const malo = lotes[2];
    c.fallarLote(pared(malo), 3);
    const reloj = relojFalso(lotes.at(-1)! + 2 * MIN);
    const estado = conMarca(T0 - LOTE);
    const alertados: string[] = [];
    for (let ciclo = 1; ciclo <= 3; ciclo++) {
      const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
      alertados.push(...r.alertas.map((a) => a.codigo));
      expect(estado.marca).toBe(new Date(lotes[1]).toISOString());
      expect(estado.pendientes.map((p) => p.lote)).toEqual([new Date(malo).toISOString()]);
      expect(estado.pendientes[0].intentos).toBe(ciclo);
      expect(r.lotesFallidos).toBe(1);
      if (ciclo > 1) expect(r.consultas).toBe(1); // solo el lote pendiente
    }
    const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    alertados.push(...r.alertas.map((a) => a.codigo));
    expect(estado.marca).toBe(new Date(lotes.at(-1)!).toISOString());
    expect(estado.pendientes).toEqual([]);
    expect(estado.leidos).toEqual([]);
    expect(alertados.sort()).toEqual([...codigos.values()].flat().sort());
    expect(estado.salud.fallosSeguidos).toBe(0);
  });

  it('(c) un proceso pasa al lote siguiente entre dos páginas: la comprobación lo detecta y no se pierde ninguno', async () => {
    const lotes = lotesDesde(T0, 2);
    const { c, codigos } = catalogoCon(lotes, 35);
    let movido = false;
    c.alBuscar((p) => {
      if (!movido && p.numero_pagina === 2 && Date.parse(String(p.cambio_desde)) === pared(lotes[0])) {
        movido = true;
        c.mover([...codigos.get(lotes[0])!].sort()[0], pared(lotes[1]));
      }
    });
    const reloj = relojFalso(lotes[1] + 2 * MIN);
    const estado = conMarca(T0 - LOTE);
    const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    expect(movido).toBe(true);
    expect(r.relecturas).toBe(1);
    expect(r.alertas.map((a) => a.codigo).sort()).toEqual([...codigos.values()].flat().sort());
    expect(estado.incompletos).toEqual([]);
  });

  it('(c2) si la relectura tampoco cuadra (otro proceso se mueve), se lee por región y no se pierde ninguno', async () => {
    const lotes = lotesDesde(T0, 2);
    const { c, codigos } = catalogoCon(lotes, 35);
    let movidos = 0;
    c.alBuscar((p) => {
      if (movidos < 2 && !p.region && p.numero_pagina === 2 && Date.parse(String(p.cambio_desde)) === pared(lotes[0])) {
        const enLote = c.procesos().map((x) => x.codigo).filter((cod) => codigos.get(lotes[0])!.includes(cod)).sort();
        c.mover(enLote[movidos], pared(lotes[1]));
        movidos++;
      }
    });
    const usadas = new Set<string>();
    const reloj = relojFalso(lotes[1] + 2 * MIN);
    const estado = conMarca(T0 - LOTE);
    const original = c.buscar.bind(c);
    c.buscar = (p) => { if (p.region) usadas.add(String(p.region)); return original(p); };
    const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    expect(movidos).toBe(2);
    expect(r.relecturas).toBe(1);
    expect(usadas.size).toBe(16);
    expect(r.alertas.map((a) => a.codigo).sort()).toEqual([...codigos.values()].flat().sort());
  });

  it('(d) un corte a mitad del ciclo no pierde ni duplica: el estado guardado es el anterior y el ciclo se repite', async () => {
    const lotes = lotesDesde(T0, 4);
    const { c, codigos } = catalogoCon(lotes, 12);
    const reloj = relojFalso(lotes.at(-1)! + 2 * MIN);
    const guardado = conMarca(T0 - LOTE);
    // Proceso que muere en la consulta 5: su estado en memoria se pierde.
    let n = 0;
    const api = clienteFalso(c);
    const cortada = { buscar: async (p: Parameters<typeof api.buscar>[0]) => { if (++n === 5) throw new Error('CORTE'); return api.buscar(p); } };
    await ejecutarCiclo({ api: cortada, ahora: reloj.ahora, criterios }, structuredClone(guardado)).catch(() => undefined);
    const r = await ejecutarCiclo({ api, ahora: reloj.ahora, criterios }, guardado);
    expect(r.alertas.map((a) => a.codigo).sort()).toEqual([...codigos.values()].flat().sort());
    expect(new Set(r.alertas.map((a) => a.codigo)).size).toBe(r.alertas.length);
  });

  it('(e) un lote de 150 (más de 10 páginas) se lee por región, completo', async () => {
    const lotes = [T0];
    const { c, codigos } = catalogoCon(lotes, 150);
    const usadas = new Set<string>();
    c.alBuscar((p) => { if (p.region) usadas.add(String(p.region)); });
    const reloj = relojFalso(T0 + 2 * MIN);
    const estado = conMarca(T0 - LOTE);
    const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    expect(r.alertas.map((a) => a.codigo).sort()).toEqual([...codigos.get(T0)!].sort());
    expect(usadas.size).toBe(16);
    expect(estado.incompletos).toEqual([]);
  });

  it('(f) un lote que no cuadra ni por región queda incompleto, con su total, y la marca sigue', async () => {
    const lotes = [T0, T0 + LOTE];
    const { c } = catalogoCon(lotes, 150, { region: 13 });
    const reloj = relojFalso(T0 + LOTE + 2 * MIN);
    const estado = conMarca(T0 - LOTE);
    const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    expect(estado.incompletos.map((i) => [i.lote, i.total, i.leidos])).toEqual([
      [new Date(T0).toISOString(), 150, 100],
      [new Date(T0 + LOTE).toISOString(), 150, 100],
    ]);
    expect(r.incompletosNuevos).toBe(2);
    expect(estado.marca).toBe(new Date(T0 + LOTE).toISOString());
  });

  it('(g) sin tiempo o sin cuota, avanza hasta donde llegó y lo dice (R9.2)', async () => {
    const lotes = lotesDesde(T0, 6);
    const { c } = catalogoCon(lotes, 3);
    const reloj = relojFalso(lotes.at(-1)! + 2 * MIN);
    const estado = conMarca(T0 - LOTE);
    const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado, { maxConsultas: 2 });
    expect(r.parcial).toBe(true);
    expect(r.lotesLeidos).toBe(2);
    expect(estado.marca).toBe(new Date(lotes[1]).toISOString());
    const sigue = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    expect(sigue.parcial).toBe(false);
    expect(estado.marca).toBe(new Date(lotes.at(-1)!).toISOString());
  });

  it('un 429 detiene el ciclo en vez de seguir gastando cuota', async () => {
    const lotes = lotesDesde(T0, 4);
    const { c } = catalogoCon(lotes, 2);
    const api = clienteFalso(c);
    let llamadas = 0;
    const cuota = { buscar: async (p: Parameters<typeof api.buscar>[0]) => {
      llamadas++;
      const { CompraAgilApiError } = await import('../src/utils/error-handler.js');
      throw new CompraAgilApiError(429, [], 'GET /v2/compra-agil');
      return api.buscar(p);
    } };
    const estado = conMarca(T0 - LOTE);
    const r = await ejecutarCiclo({ api: cuota, ahora: relojFalso(lotes.at(-1)! + 2 * MIN).ahora, criterios }, estado);
    expect(llamadas).toBe(1);
    expect(r.cuotaAgotada).toBe(true);
    expect(estado.marca).toBe(new Date(T0 - LOTE).toISOString());
  });

  it('no alerta dos veces el mismo proceso entre ciclos (R1.9) y suma las consultas del día', async () => {
    const lotes = [T0];
    const { c, codigos } = catalogoCon(lotes, 3);
    const estado = conMarca(T0 - LOTE);
    const reloj = relojFalso(T0 + 2 * MIN);
    await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    // El mismo proceso vuelve a cambiar y aparece en un lote nuevo.
    c.mover(codigos.get(T0)![0], pared(T0 + LOTE));
    reloj.avanzar(LOTE);
    const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: reloj.ahora, criterios }, estado);
    expect(r.alertas).toEqual([]);
    expect(r.revisados).toBe(1);
    expect(estado.salud.consultasPorDia['2026-10-07']).toBe(2);
  });
});
