import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { tomarVigilante, latir, soltarVigilante, vigilanteActivo } from '../src/vigilancia/vigilante.js';

/**
 * Un solo vigilante a la vez (T2.5 de la 2.9.0; R1.7). El daemon y una
 * herramienta llamada por un gateway no deben leer los mismos lotes ni gastar
 * la cuota dos veces.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigilante-'));
const ruta = path.join(dir, '.vigilante.lock');
const T = Date.parse('2026-10-07T22:00:00Z');
const LATIDO_MAX = 45 * 60_000; // 3 intervalos de 15 min
const vivos = new Set<number>([111, 222]);
const vivo = (pid: number) => vivos.has(pid);

afterEach(() => fs.rmSync(ruta, { force: true }));

describe('vigilante', () => {
  it('el primero lo toma; un segundo proceso vivo no', () => {
    expect(tomarVigilante(ruta, { pid: 111, ahoraMs: T, latidoMaxMs: LATIDO_MAX, vivo })).toBe(true);
    expect(tomarVigilante(ruta, { pid: 222, ahoraMs: T + 60_000, latidoMaxMs: LATIDO_MAX, vivo })).toBe(false);
    expect(vigilanteActivo(ruta, T + 60_000, LATIDO_MAX, vivo)?.pid).toBe(111);
  });

  it('el mismo proceso lo vuelve a tomar (siguiente ciclo) y su latido lo mantiene', () => {
    tomarVigilante(ruta, { pid: 111, ahoraMs: T, latidoMaxMs: LATIDO_MAX, vivo });
    expect(latir(ruta, 111, T + 40 * 60_000)).toBe(true);
    expect(tomarVigilante(ruta, { pid: 222, ahoraMs: T + 80 * 60_000, latidoMaxMs: LATIDO_MAX, vivo })).toBe(false);
    expect(tomarVigilante(ruta, { pid: 111, ahoraMs: T + 80 * 60_000, latidoMaxMs: LATIDO_MAX, vivo })).toBe(true);
  });

  it('un latido de otro proceso no cuenta', () => {
    tomarVigilante(ruta, { pid: 111, ahoraMs: T, latidoMaxMs: LATIDO_MAX, vivo });
    expect(latir(ruta, 222, T + 1)).toBe(false);
  });

  it('un vigilante cuyo proceso ya no existe se reemplaza', () => {
    tomarVigilante(ruta, { pid: 999, ahoraMs: T, latidoMaxMs: LATIDO_MAX, vivo });
    expect(tomarVigilante(ruta, { pid: 222, ahoraMs: T + 1000, latidoMaxMs: LATIDO_MAX, vivo })).toBe(true);
  });

  it('un vigilante sin latido por más de 3 intervalos se reemplaza aunque el PID exista', () => {
    tomarVigilante(ruta, { pid: 111, ahoraMs: T, latidoMaxMs: LATIDO_MAX, vivo });
    expect(tomarVigilante(ruta, { pid: 222, ahoraMs: T + LATIDO_MAX + 1, latidoMaxMs: LATIDO_MAX, vivo })).toBe(true);
  });

  it('soltar solo borra el propio; un archivo corrupto cuenta como libre', () => {
    tomarVigilante(ruta, { pid: 111, ahoraMs: T, latidoMaxMs: LATIDO_MAX, vivo });
    soltarVigilante(ruta, 222);
    expect(fs.existsSync(ruta)).toBe(true);
    soltarVigilante(ruta, 111);
    expect(fs.existsSync(ruta)).toBe(false);
    fs.writeFileSync(ruta, 'basura');
    expect(tomarVigilante(ruta, { pid: 222, ahoraMs: T, latidoMaxMs: LATIDO_MAX, vivo })).toBe(true);
  });

  it('con la comprobación real de procesos, el propio PID está vivo', () => {
    expect(tomarVigilante(ruta, { pid: process.pid, ahoraMs: T, latidoMaxMs: LATIDO_MAX })).toBe(true);
    expect(vigilanteActivo(ruta, T, LATIDO_MAX)?.pid).toBe(process.pid);
  });
});
