import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { estadoVacio, guardarEstado, cargarEstado, actualizarEstado } from '../src/vigilancia/estado.js';
import { registrarParaGateway, ofrecerLote, confirmarLote, criteriosEfectivos, REOFERTA_MS } from '../src/vigilancia/gateway.js';
import type { Alerta } from '../src/avisos/mensaje.js';

/**
 * Cola del modo gateway (T8.2 de la 2.9.0; R9.1, R9.3) y la mezcla al guardar:
 * una ronda que guarda tarde no debe borrar lo que una herramienta confirmó.
 */
const T = Date.parse('2026-10-07T15:00:00Z');
const alerta = (codigo: string, creada = T): Alerta => ({
  codigo, nombre: 'x', organismo: 'o', region: 'r', presupuestoClp: 1, cierreHoraChile: null, cierreUtc: null,
  coincidencia: 'resmas', ficha: 'f', creada,
});

describe('cola del gateway', () => {
  it('ofrece, no repite lo ofrecido hasta 30 min, y lo confirmado no vuelve (R9.3)', () => {
    const e = estadoVacio();
    registrarParaGateway(e, [alerta('A'), alerta('B', T + 1), alerta('C', T + 2)]);
    const l1 = ofrecerLote(e, 2, T);
    expect(l1.alertas.map((a) => a.codigo)).toEqual(['A', 'B']);
    expect(l1.quedan).toBe(1);
    expect(ofrecerLote(e, 10, T + 60_000).alertas.map((a) => a.codigo)).toEqual(['C']);
    expect(confirmarLote(e, l1.loteId!, T + 2 * 60_000)).toBe(2);
    expect(confirmarLote(e, l1.loteId!, T + 3 * 60_000)).toBe(0); // idempotente
    const re = ofrecerLote(e, 10, T + 60_000 + REOFERTA_MS);
    expect(re.alertas.map((a) => a.codigo)).toEqual(['C']); // C no se confirmó: vuelve; A y B no
  });

  it('registrar la misma alerta dos veces no la duplica', () => {
    const e = estadoVacio();
    registrarParaGateway(e, [alerta('A')]);
    registrarParaGateway(e, [alerta('A')]);
    expect(Object.keys(e.alertas)).toHaveLength(1);
  });

  it('cola vacía: lote null', () => {
    expect(ofrecerLote(estadoVacio(), 5, T)).toEqual({ loteId: null, alertas: [], quedan: 0 });
  });

  it('los criterios guardados mandan sobre los del entorno', () => {
    const e = estadoVacio();
    const entorno = { palabras: ['a'], excluidas: [], regiones: [], presupuestoMinimo: 0, soloSinOfertas: true };
    expect(criteriosEfectivos(e, entorno)).toBe(entorno);
    e.criterios = { ...entorno, palabras: ['b'], cambiadoEn: new Date(T).toISOString() };
    expect(criteriosEfectivos(e, entorno).palabras).toEqual(['b']);
  });
});

describe('guardar mezclando con lo que otro proceso escribió', () => {
  it('una ronda que guarda tarde conserva la confirmación y los criterios que puso una herramienta', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mezcla-'));
    const ruta = path.join(dir, '.vigilancia.json');
    const vieja = path.join(dir, '.monitor-state.json');
    const base = estadoVacio();
    registrarParaGateway(base, [alerta('A')]);
    const { loteId } = ofrecerLote(base, 5, T);
    guardarEstado(ruta, base, T);

    // La ronda carga el estado y se va a la red…
    const ronda = cargarEstado(ruta, vieja, T).estado;
    // …mientras la herramienta confirma y cambia los criterios.
    actualizarEstado(ruta, vieja, T + 1000, (e) => {
      confirmarLote(e, loteId!, T + 1000);
      e.criterios = { palabras: ['nuevo'], excluidas: [], regiones: [], presupuestoMinimo: 0, soloSinOfertas: true, cambiadoEn: new Date(T + 1000).toISOString() };
    });
    // La ronda guarda su copia vieja.
    ronda.marca = new Date(T).toISOString();
    guardarEstado(ruta, ronda, T + 2000);

    const final = cargarEstado(ruta, vieja, T + 3000).estado;
    expect(Object.values(final.alertas)[0].confirmada).toBe(T + 1000);
    expect(final.criterios?.palabras).toEqual(['nuevo']);
    expect(final.marca).toBe(new Date(T).toISOString());
  });
});
