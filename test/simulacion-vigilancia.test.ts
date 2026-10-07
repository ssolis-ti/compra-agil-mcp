import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rondaDeVigilancia, type RutasVigilancia } from '../src/vigilancia/ronda.js';
import { cargarEstado } from '../src/vigilancia/estado.js';
import { aFormatoApi } from '../src/utils/fechas.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';
import type { Canal, LoteDeAvisos } from '../src/avisos/canal.js';
import { nuevoCatalogo, clienteFalso } from './ayudas/api-cambios.js';
import { relojFalso } from './ayudas/reloj-falso.js';

/**
 * Simulación de 6 horas a tiempo acelerado (puerta de la fase 7 de la 2.9.0,
 * adelanto de T10.1). Todo junto, como en un día malo de la API:
 *
 *   - lotes de 0 a 60 procesos, y uno de 140 repartido en regiones;
 *   - una hora con 504 en 6 lotes (3 veces cada uno);
 *   - procesos que vuelven a cambiar mientras se pagina su lote;
 *   - un proceso que muere a mitad de una ronda (su estado no se guarda);
 *   - Telegram caído durante una hora.
 *
 * Cada ronda carga el estado desde disco, como un proceso que arranca de nuevo.
 * Aceptación: 0 procesos sin alerta, 0 alertas repetidas, 0 avisos perdidos.
 */
const MIN = 60_000;
const LOTE = 5 * MIN;
const T0 = Date.parse('2026-10-07T12:00:00Z'); // 09:00 de Chile
const pared = (utc: number) => Date.parse(aFormatoApi(new Date(utc)));
const criterios = { palabras: ['resmas'], excluidas: [], regiones: [], presupuestoMinimo: 0, soloSinOfertas: true };

describe('simulación de 6 horas', () => {
  it('no pierde procesos ni avisos con 504, lotes grandes, corrimientos, un corte y un canal caído', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim6h-'));
    const rutas: RutasVigilancia = { estado: path.join(dir, '.vigilancia.json'), estadoViejo: path.join(dir, '.monitor-state.json'), vigilante: path.join(dir, '.vigilante.lock') };
    const c = nuevoCatalogo();
    const reloj = relojFalso(T0);
    const regiones = [13, 5, 8, 2, 1, 15, 4, 7, 9, 10, 6, 3, 11, 12, 14, 16];

    // ── Catálogo: 6 h de lotes ───────────────────────────────────────
    const lotes = Array.from({ length: 72 }, (_, i) => T0 - 55 * MIN + i * LOTE);
    lotes.forEach((l, i) => {
      const n = i === 30 ? 140 : (i * 37) % 61; // 0–60, y uno de 140
      for (let k = 0; k < n; k++) c.agregar(pared(l), 1, { region: regiones[k % regiones.length] });
    });
    for (let i = 12; i < 18; i++) c.fallarLote(pared(lotes[i]), 3);

    // Corrimientos: cada tanto, al pedir la página 2 de un lote, un proceso de
    // ese lote vuelve a cambiar y pasa al lote más nuevo (el que se escribe ahora).
    let pedidas = 0;
    c.alBuscar((p) => {
      if (p.numero_pagina !== 2 || p.region || ++pedidas % 7 !== 0) return;
      const desde = Date.parse(String(p.cambio_desde));
      const enLote = c.procesos().filter((x) => Date.parse((x as unknown as { fechas: { fecha_ultimo_cambio: string } }).fechas.fecha_ultimo_cambio) - 380 === desde);
      if (enLote.length > 0) c.mover(enLote[0].codigo, pared(reloj.ahora()));
    });

    // ── Canal que se cae una hora ────────────────────────────────────
    const entregados = new Map<string, number>();
    const canal: Canal = {
      nombre: 'telegram',
      async enviar(lote: LoteDeAvisos, ahoraMs: number) {
        if (ahoraMs >= T0 + 2 * 60 * MIN && ahoraMs < T0 + 3 * 60 * MIN) return { ok: false, tipo: 'transitorio', motivo: '502' };
        for (const a of lote.avisos) entregados.set(a.alerta.codigo, (entregados.get(a.alerta.codigo) ?? 0) + 1);
        return { ok: true };
      },
      probar: async () => ({ ok: true }),
      notificar: async () => ({ ok: true }),
    };

    // ── Rondas cada 15 min durante 6 h, y 2 h más para vaciar pendientes ──
    const alertados: string[] = [];
    let rondas = 0;
    const visto = { relecturas: 0, lotesFallidos: 0, reintentosDeAviso: 0 };
    for (let t = T0 + 2 * MIN; t <= T0 + 8 * 60 * MIN; t += 15 * MIN) {
      reloj.fijar(t);
      rondas++;
      const api = clienteFalso(c);
      const deps = {
        api, ahora: reloj.ahora, criterios, rutas, pid: process.pid, intervaloMs: 15 * MIN,
        entregar: (a: Array<{ codigo: string }>) => { alertados.push(...a.map((x) => x.codigo)); },
        avisos: { canales: [canal] },
      };
      if (rondas === 10) {
        // Un proceso que muere a mitad de la ronda. Un error de la API no sirve
        // para simularlo: el ciclo lo toma como un lote fallido y la ronda
        // termina y guarda. Aquí la cuarta consulta no vuelve nunca y la ronda
        // se abandona: ni entrega ni guarda nada, como un proceso muerto.
        let n = 0;
        const muere = { buscar: (p: Parameters<typeof api.buscar>[0]) => (++n === 4 ? new Promise<never>(() => undefined) : api.buscar(p)) };
        void rondaDeVigilancia({ ...deps, api: muere });
        await new Promise((r) => setTimeout(r, 20));
        // El proceso muerto deja su candado de vigilante; el siguiente arranca con otro PID.
        fs.rmSync(rutas.vigilante, { force: true });
        continue;
      }
      const r = await rondaDeVigilancia(deps);
      visto.relecturas += r.ciclo?.relecturas ?? 0;
      visto.lotesFallidos += r.ciclo?.lotesFallidos ?? 0;
      visto.reintentosDeAviso += r.envios?.reintentos ?? 0;
    }

    const todos = c.procesos().map((x) => x.codigo);
    const estado = cargarEstado(rutas.estado, rutas.estadoViejo, reloj.ahora()).estado;
    // La simulación ejerció los casos difíciles, no solo el camino feliz.
    expect(visto.relecturas).toBeGreaterThan(0);
    expect(visto.lotesFallidos).toBeGreaterThanOrEqual(6);
    expect(visto.reintentosDeAviso).toBeGreaterThan(0);
    expect(todos.length).toBeGreaterThan(1800);
    expect(new Set(alertados)).toEqual(new Set(todos)); // 0 procesos sin alerta
    expect(alertados.length).toBe(new Set(alertados).size); // 0 alertas repetidas
    expect(new Set(entregados.keys())).toEqual(new Set(todos)); // 0 avisos perdidos
    expect(estado.pendientes).toEqual([]);
    expect(estado.incompletos).toEqual([]);
    expect(Object.values(estado.bandeja).filter((a) => a.estado !== 'entregado')).toEqual([]);
  }, 120_000);
});
