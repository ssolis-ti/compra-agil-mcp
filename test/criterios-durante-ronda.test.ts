import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rondaDeVigilancia } from '../src/vigilancia/ronda.js';
import { cargarEstado, leerCriteriosGuardados } from '../src/vigilancia/estado.js';
import { aFormatoApi } from '../src/utils/fechas.js';
import { nuevoCatalogo, clienteFalso } from './ayudas/api-cambios.js';
import { relojFalso } from './ayudas/reloj-falso.js';

/**
 * Prueba real del 8-oct: la ronda empezó con los criterios a medio configurar
 * (sin región) y, aunque a los segundos ya decían «solo Aysén», avisó 169
 * compras de 16 regiones. Los criterios se releen antes de cada lote y antes
 * de avisar.
 */
const MIN = 60_000;
const T0 = Date.parse('2026-10-08T18:25:00Z');
const pared = (utc: number) => Date.parse(aFormatoApi(new Date(utc)));
const base = { palabras: [], excluidas: [], presupuestoMinimo: 0, soloSinOfertas: false, todasEnRegion: false, soloNuevas: true };

function rutas() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ronda-criterios-'));
  return { estado: path.join(dir, '.vigilancia.json'), estadoViejo: path.join(dir, '.monitor-state.json'), vigilante: path.join(dir, '.vigilante.lock') };
}

describe('criterios que cambian durante la ronda', () => {
  it('cambian en el primer lote: no sale ningún aviso fuera de la región elegida', async () => {
    const r = rutas();
    fs.writeFileSync(r.estado, JSON.stringify({ criterios: { ...base, regiones: [], cambiadoEn: new Date(T0 - 2 * MIN).toISOString() } }));
    const c = nuevoCatalogo();
    const aysen: string[] = [];
    for (const lote of [T0 - 20 * MIN, T0 - 15 * MIN, T0 - 10 * MIN]) {
      c.agregar(pared(lote), 3, { region: 13 });
      aysen.push(...c.agregar(pared(lote), 1, { region: 11 }));
    }
    // El dueño termina de configurar mientras la ronda lee el primer lote.
    c.alBuscar((_p, llamada) => {
      if (llamada !== 1) return;
      const e = JSON.parse(fs.readFileSync(r.estado, 'utf8'));
      e.criterios = { ...base, regiones: [11], cambiadoEn: new Date(T0 - MIN).toISOString() };
      fs.writeFileSync(r.estado, JSON.stringify(e));
    });
    const entregadas: string[] = [];
    await rondaDeVigilancia({
      api: clienteFalso(c), ahora: relojFalso(T0).ahora, criterios: { ...base, regiones: [] }, rutas: r, pid: process.pid, intervaloMs: 15 * MIN,
      entregar: (alertas) => { entregadas.push(...alertas.map((a) => a.codigo)); },
    });
    expect(entregadas.sort()).toEqual([...aysen].sort());
    // Lo descartado no queda como «alertado»: si el dueño amplía los criterios, puede avisarse.
    const { estado } = cargarEstado(r.estado, r.estadoViejo, T0);
    expect(Object.keys(estado.alertados).sort()).toEqual([...aysen].sort());
    expect(leerCriteriosGuardados(r.estado)?.regiones).toEqual([11]);
  });

  it('leerCriteriosGuardados: sin archivo o ilegible, null', () => {
    const r = rutas();
    expect(leerCriteriosGuardados(r.estado)).toBeNull();
    fs.writeFileSync(r.estado, '{roto');
    expect(leerCriteriosGuardados(r.estado)).toBeNull();
  });
});
