import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rondaDeVigilancia, type RutasVigilancia } from '../src/vigilancia/ronda.js';
import { cargarEstado } from '../src/vigilancia/estado.js';
import { aFormatoApi } from '../src/utils/fechas.js';
import type { Canal, LoteDeAvisos } from '../src/avisos/canal.js';
import { nuevoCatalogo, clienteFalso } from './ayudas/api-cambios.js';
import { relojFalso } from './ayudas/reloj-falso.js';

/**
 * T10.1 de la 2.9.0: un día completo a tiempo acelerado, con el volumen por
 * hora medido en la API real el lunes 6-oct-2026 (medicion-ventanas.md).
 * Encima del día normal, un día malo:
 *   - 504 en 6 lotes de las 11:00 (5 veces cada uno) y 2,5 h de API caída en la tarde;
 *   - un lote de 160 a las 16:00 (más de 10 páginas), leído por región;
 *   - procesos que cambian de lote mientras se paginan;
 *   - un proceso que muere a mitad de ronda;
 *   - Telegram caído 1 h y con 429 (retry_after) de vez en cuando.
 * Aceptación: 0 procesos sin alerta, 0 alertas repetidas, 0 avisos perdidos;
 * con la API sana, aviso en ≤ intervalo + asentamiento + 5 min desde la marca (NF2).
 */
const MIN = 60_000;
const LOTE = 5 * MIN;
const INICIO = Date.parse('2026-10-07T03:00:00Z'); // 00:00 de Chile
const PUBLICADAS_POR_HORA = [2, 2, 0, 0, 0, 0, 0, 6, 79, 228, 229, 296, 327, 195, 139, 309, 420, 250, 75, 39, 4, 6, 6, 2];
const pared = (utc: number) => Date.parse(aFormatoApi(new Date(utc)));
const criterios = { palabras: [], excluidas: [], regiones: [], presupuestoMinimo: 0, soloSinOfertas: true };

describe('simulación de 24 h con el volumen real', () => {
  it('un día malo no pierde procesos ni avisos, y con la API sana avisa a tiempo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim24h-'));
    const rutas: RutasVigilancia = { estado: path.join(dir, '.vigilancia.json'), estadoViejo: path.join(dir, '.monitor-state.json'), vigilante: path.join(dir, '.vigilante.lock') };
    const c = nuevoCatalogo();
    const reloj = relojFalso(INICIO);
    const regiones = [13, 13, 13, 5, 8, 2, 1, 15, 4, 7, 9, 10, 6, 3, 11, 12, 14, 16];

    // ── El día: lotes cada 5 min con el volumen medido por hora ─────────
    const marcaDe = new Map<string, number>(); // código → instante UTC del lote donde nació
    for (let h = 0; h < 24; h++) {
      for (let k = 0; k < 12; k++) {
        const lote = INICIO - 55 * MIN + (h * 12 + k) * LOTE + 60 * MIN;
        const base = Math.floor(PUBLICADAS_POR_HORA[h] / 12) + (k < PUBLICADAS_POR_HORA[h] % 12 ? 1 : 0);
        const n = h === 16 && k === 3 ? 160 : base;
        for (let i = 0; i < n; i++) for (const cod of c.agregar(pared(lote), 1, { region: regiones[i % regiones.length] })) marcaDe.set(cod, lote);
      }
    }
    const lotesDeLas = (hora: number) => Array.from({ length: 12 }, (_, k) => INICIO + hora * 60 * MIN + k * LOTE);
    for (const l of lotesDeLas(11).slice(0, 6)) c.fallarLote(pared(l), 5);
    // 2,5 h de API caída por la tarde (sobre el umbral de ceguera de 2 h): todo falla.
    const caida = { desde: INICIO + 14 * 60 * MIN, hasta: INICIO + 16.5 * 60 * MIN };

    let pedidas = 0;
    const movidos = new Set<string>(); // cambiaron de lote: llegan más tarde a propósito
    const con429 = new Set<string>(); // su primer envío recibió un 429: van en la ronda siguiente
    c.alBuscar((p) => {
      if (p.numero_pagina !== 2 || p.region || ++pedidas % 5 !== 0) return;
      const desde = Date.parse(String(p.cambio_desde));
      const enLote = c.procesos().filter((x) => Date.parse((x as unknown as { fechas: { fecha_ultimo_cambio: string } }).fechas.fecha_ultimo_cambio) - 380 === desde);
      if (enLote.length > 0) { movidos.add(enLote[0].codigo); c.mover(enLote[0].codigo, pared(reloj.ahora())); }
    });

    // ── Telegram: caído de 19 a 20 h, y un 429 cada 7 envíos ────────────
    const entregadoEn = new Map<string, number>();
    let envios = 0;
    const telegram: Canal = {
      nombre: 'telegram',
      async enviar(lote: LoteDeAvisos, ahoraMs: number) {
        if (ahoraMs >= INICIO + 19 * 60 * MIN && ahoraMs < INICIO + 20 * 60 * MIN) return { ok: false, tipo: 'transitorio', motivo: '502' };
        if (++envios % 7 === 0) {
          for (const a of lote.avisos) con429.add(a.alerta.codigo);
          return { ok: false, tipo: 'transitorio', motivo: '429', reintentarEnMs: 20_000 };
        }
        for (const a of lote.avisos) if (!entregadoEn.has(a.alerta.codigo)) entregadoEn.set(a.alerta.codigo, ahoraMs);
        return { ok: true };
      },
      probar: async () => ({ ok: true }),
      notificar: async () => ({ ok: true }),
    };

    // ── Rondas cada 15 min durante 24 h, más 2 h para vaciar ────────────
    const alertados: string[] = [];
    const notificaciones: string[] = [];
    let ronda = 0;
    for (let t = INICIO + 2 * MIN; t <= INICIO + 26 * 60 * MIN; t += 15 * MIN) {
      reloj.fijar(t);
      ronda++;
      const base = clienteFalso(c);
      const api = t >= caida.desde && t < caida.hasta
        ? { buscar: async () => { const { CompraAgilApiError } = await import('../src/utils/error-handler.js'); throw new CompraAgilApiError(504, [], 'GET'); } }
        : base;
      const deps = {
        api, ahora: reloj.ahora, criterios, rutas, pid: process.pid, intervaloMs: 15 * MIN,
        entregar: (a: Array<{ codigo: string }>) => { alertados.push(...a.map((x) => x.codigo)); },
        avisos: { canales: [telegram] },
      };
      if (ronda === 40) {
        let n = 0;
        void rondaDeVigilancia({ ...deps, api: { buscar: (p: Parameters<typeof base.buscar>[0]) => (++n === 3 ? new Promise<never>(() => undefined) : base.buscar(p)) } });
        await new Promise((r) => setTimeout(r, 20));
        fs.rmSync(rutas.vigilante, { force: true });
        continue;
      }
      const r = await rondaDeVigilancia(deps);
      notificaciones.push(...(r.notificaciones ?? []).map((x) => x.evento));
    }

    const todos = c.procesos().map((x) => x.codigo);
    const estado = cargarEstado(rutas.estado, rutas.estadoViejo, reloj.ahora()).estado;
    expect(todos.length).toBeGreaterThan(2700);
    expect(new Set(alertados)).toEqual(new Set(todos));
    expect(alertados.length).toBe(new Set(alertados).size);
    expect(new Set(entregadoEn.keys())).toEqual(new Set(todos));
    expect(estado.pendientes).toEqual([]);
    expect(estado.incompletos).toEqual([]);
    expect(Object.values(estado.bandeja).filter((a) => a.estado !== 'entregado')).toEqual([]);
    // Las 2,5 h de API caída dan un aviso de ceguera y uno de recuperación, no más.
    expect(notificaciones.filter((e) => e === 'ceguera')).toHaveLength(1);
    expect(notificaciones.filter((e) => e === 'recuperacion')).toHaveLength(1);
    // Con Telegram como único canal, su caída queda en el log una sola vez (no hay otro canal que la lleve).
    expect(notificaciones.filter((e) => e === 'canal_caido')).toHaveLength(1);

    // NF2: con la API y Telegram sanos, aviso en ≤ 15 + 2 + 5 min desde la marca del lote. Se mide
    // antes del corte de las 09:47 y sin los procesos que la simulación demora a propósito (429, cambio de lote).
    const latencias = [...entregadoEn]
      .filter(([cod]) => marcaDe.get(cod)! < INICIO + 9.5 * 60 * MIN && !movidos.has(cod) && !con429.has(cod))
      .map(([cod, t]) => (t - marcaDe.get(cod)!) / MIN);
    expect(latencias.length).toBeGreaterThan(150);
    expect(Math.max(...latencias)).toBeLessThanOrEqual(22);
  }, 300_000);
});
