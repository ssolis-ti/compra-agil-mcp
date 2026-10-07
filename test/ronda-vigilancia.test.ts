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

  it('con canales activos: un aviso por canal, enviado en la misma ronda y guardado en el estado (T3.5)', async () => {
    const r = rutas();
    const c = nuevoCatalogo();
    const [codigo] = c.agregar(pared(T0 - 10 * MIN), 1);
    const recibidos: Record<string, string[]> = { telegram: [], correo: [] };
    let telegramCaido = true;
    const canal = (nombre: 'telegram' | 'correo') => ({
      nombre,
      async enviar(lote: { avisos: Array<{ alerta: { codigo: string } }> }) {
        if (nombre === 'telegram' && telegramCaido) return { ok: false as const, tipo: 'transitorio' as const, motivo: '502' };
        recibidos[nombre].push(...lote.avisos.map((a) => a.alerta.codigo));
        return { ok: true as const };
      },
      async probar() { return { ok: true as const }; },
    });
    const reloj = relojFalso(T0 + 2 * MIN);
    const deps = {
      api: clienteFalso(c), ahora: reloj.ahora, criterios, rutas: r, pid: process.pid, intervaloMs: 15 * MIN,
      entregar: () => undefined, avisos: { canales: [canal('telegram'), canal('correo')] },
    };
    const primera = await rondaDeVigilancia(deps);
    expect(primera.envios).toMatchObject({ entregados: 1, reintentos: 1 });
    expect(recibidos).toEqual({ telegram: [], correo: [codigo] });
    const guardado = cargarEstado(r.estado, r.estadoViejo, T0).estado;
    expect(Object.values(guardado.bandeja).map((a) => [a.canal, a.estado]).sort()).toEqual([['correo', 'entregado'], ['telegram', 'pendiente']]);

    // Telegram vuelve: la ronda siguiente, sin alertas nuevas, entrega lo pendiente (R3.5).
    telegramCaido = false;
    reloj.avanzar(5 * MIN);
    const segunda = await rondaDeVigilancia(deps);
    expect(segunda.ciclo?.alertas).toEqual([]);
    expect(recibidos.telegram).toEqual([codigo]);
  });

  it('salud: 3 h de 504 dan un solo aviso de ceguera; al volver, uno de recuperación (fase 7)', async () => {
    const r = rutas();
    const c = nuevoCatalogo();
    let caida = false;
    const api = clienteFalso(c);
    const intermitente = { buscar: async (p: Parameters<typeof api.buscar>[0]) => {
      if (caida) { const { CompraAgilApiError } = await import('../src/utils/error-handler.js'); throw new CompraAgilApiError(504, [], 'GET'); }
      return api.buscar(p);
    } };
    const notificaciones: string[] = [];
    const canal = {
      nombre: 'telegram' as const,
      enviar: async () => ({ ok: true as const }),
      probar: async () => ({ ok: true as const }),
      notificar: async (n: { evento: string }) => { notificaciones.push(n.evento); return { ok: true as const }; },
    };
    const reloj = relojFalso(T0 + 2 * MIN);
    const deps = {
      api: intermitente, ahora: reloj.ahora, criterios, rutas: r, pid: process.pid, intervaloMs: 15 * MIN,
      entregar: () => undefined, avisos: { canales: [canal] },
      salud: { umbralCegueraMs: 120 * MIN, resumenHora: '08:00', presupuestoConsultasDia: 1500, canales: ['telegram' as const], intervaloMs: 15 * MIN },
    };
    await rondaDeVigilancia(deps); // ronda buena
    caida = true;
    for (let i = 0; i < 12; i++) { reloj.avanzar(15 * MIN); await rondaDeVigilancia(deps); }
    expect(notificaciones).toEqual(['ceguera']);
    caida = false;
    reloj.avanzar(15 * MIN);
    const vuelta = await rondaDeVigilancia(deps);
    expect(notificaciones).toEqual(['ceguera', 'recuperacion']);
    expect(vuelta.notificaciones?.map((n) => [n.evento, n.entregadaPor])).toEqual([['recuperacion', ['telegram']]]);
  });

  it('tras un 429, la ronda siguiente se salta sin consultar la API hasta la próxima ronda fijada', async () => {
    const r = rutas();
    const c = nuevoCatalogo();
    const { CompraAgilApiError } = await import('../src/utils/error-handler.js');
    let llamadas = 0;
    const api = { buscar: async () => { llamadas++; throw new CompraAgilApiError(429, [], 'GET'); } };
    const reloj = relojFalso(T0 + 2 * MIN);
    const deps = { api, ahora: reloj.ahora, criterios, rutas: r, pid: process.pid, intervaloMs: 15 * MIN, entregar: () => undefined };
    await rondaDeVigilancia(deps);
    expect(llamadas).toBe(1);
    reloj.avanzar(15 * MIN);
    const saltada = await rondaDeVigilancia(deps);
    expect(saltada.omitida).toBe(true);
    expect(llamadas).toBe(1);
    reloj.avanzar(15 * MIN);
    await rondaDeVigilancia({ ...deps, api: clienteFalso(c) });
    expect(c.llamadas()).toBeGreaterThan(0);
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
