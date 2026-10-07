import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rondaDeVigilancia, type RutasVigilancia } from '../src/vigilancia/ronda.js';
import { cargarEstado } from '../src/vigilancia/estado.js';
import { tomarVigilante } from '../src/vigilancia/vigilante.js';
import { aFormatoApi } from '../src/utils/fechas.js';
import { nuevoCatalogo, clienteFalso } from './ayudas/api-cambios.js';
import { relojFalso } from './ayudas/reloj-falso.js';

/**
 * Una ronda del daemon (T2.6 de la 2.9.0): tomar el vigilante, cargar el
 * estado (migrando el de la 2.8.0), leer los lotes, entregar las alertas y
 * guardar. Las alertas se entregan antes de guardar: si el proceso muere entre
 * las dos cosas, una alerta puede repetirse, pero nunca perderse (ADR 0022).
 */
const MIN = 60_000;
const T0 = Date.parse('2026-10-07T15:00:00Z');
const pared = (utc: number) => Date.parse(aFormatoApi(new Date(utc)));
const criterios = { palabras: ['resmas'], excluidas: [], regiones: [], presupuestoMinimo: 0, soloSinOfertas: true };

function rutas(): RutasVigilancia {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ronda-'));
  return { estado: path.join(dir, '.vigilancia.json'), estadoViejo: path.join(dir, '.monitor-state.json'), vigilante: path.join(dir, '.vigilante.lock') };
}

describe('rondaDeVigilancia', () => {
  it('migra el estado de la 2.8.0, no re-alerta lo ya alertado, entrega lo nuevo y guarda la versión 2', async () => {
    const r = rutas();
    const c = nuevoCatalogo();
    const [yaAlertado, nuevo] = c.agregar(pared(T0 - 30 * MIN), 2);
    fs.writeFileSync(r.estadoViejo, JSON.stringify({ alertados: { [yaAlertado]: T0 - 3600_000 } }));
    const entregadas: string[] = [];
    const res = await rondaDeVigilancia({
      api: clienteFalso(c), ahora: relojFalso(T0 + 2 * MIN).ahora, criterios, rutas: r, pid: process.pid, intervaloMs: 15 * MIN,
      entregar: (alertas) => { entregadas.push(...alertas.map((a) => a.codigo)); },
    });
    expect(res.tomada).toBe(true);
    expect(res.avisos.join(' ')).toMatch(/migr/i);
    expect(entregadas).toEqual([nuevo]);
    const { estado } = cargarEstado(r.estado, r.estadoViejo, T0);
    expect(estado.version).toBe(2);
    expect(Object.keys(estado.alertados).sort()).toEqual([yaAlertado, nuevo].sort());
    expect(estado.marca).toBe(new Date(T0).toISOString());
  });

  it('si otro proceso vigila, no lee nada ni gasta cuota', async () => {
    const r = rutas();
    tomarVigilante(r.vigilante, { pid: process.pid, ahoraMs: T0, latidoMaxMs: 45 * MIN });
    const c = nuevoCatalogo();
    const res = await rondaDeVigilancia({
      api: clienteFalso(c), ahora: relojFalso(T0 + MIN).ahora, criterios, rutas: r, pid: process.pid + 1, intervaloMs: 15 * MIN, entregar: () => undefined,
    });
    expect(res.tomada).toBe(false);
    expect(res.otroVigilante).toBe(process.pid);
    expect(c.llamadas()).toBe(0);
  });

  it('si entregar falla, el estado no se guarda: las alertas vuelven en la ronda siguiente', async () => {
    const r = rutas();
    const c = nuevoCatalogo();
    const [codigo] = c.agregar(pared(T0 - 10 * MIN), 1);
    const deps = { api: clienteFalso(c), ahora: relojFalso(T0 + 2 * MIN).ahora, criterios, rutas: r, pid: process.pid, intervaloMs: 15 * MIN };
    await expect(rondaDeVigilancia({ ...deps, entregar: () => { throw new Error('disco lleno'); } })).rejects.toThrow('disco lleno');
    const entregadas: string[] = [];
    await rondaDeVigilancia({ ...deps, entregar: (a) => { entregadas.push(...a.map((x) => x.codigo)); } });
    expect(entregadas).toEqual([codigo]);
  });
});
