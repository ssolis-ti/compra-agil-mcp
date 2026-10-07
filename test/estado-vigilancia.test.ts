import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { estadoVacio, parsearEstado, cargarEstado, guardarEstado, podarEstado } from '../src/vigilancia/estado.js';

/**
 * Estado de la vigilancia, versión 2 (T2.1 de la 2.9.0; R1.8, R1.9, NF6).
 * Reemplaza a `.monitor-state.json`, que solo guardaba los códigos alertados.
 */
const AHORA = Date.parse('2026-10-07T22:00:00Z');
const DIA = 24 * 3600_000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estado-vig-'));
const ruta = path.join(dir, '.vigilancia.json');
const vieja = path.join(dir, '.monitor-state.json');

afterEach(() => { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); });

describe('migración desde la 2.8.0 (NF6)', () => {
  it('copia los códigos alertados, deja la marca vacía y renombra el archivo viejo', () => {
    fs.writeFileSync(vieja, JSON.stringify({ alertados: { 'A-1-COT26': AHORA - DIA } }));
    const { estado, avisos } = cargarEstado(ruta, vieja, AHORA);
    expect(estado.alertados).toEqual({ 'A-1-COT26': AHORA - DIA });
    expect(estado.marca).toBeNull();
    expect(fs.existsSync(vieja)).toBe(false);
    expect(fs.existsSync(`${vieja}.migrado`)).toBe(true);
    expect(avisos.join(' ')).toMatch(/migr/i);
  });

  it('también el formato más antiguo, una lista de códigos (toman la fecha de hoy)', () => {
    fs.writeFileSync(vieja, JSON.stringify({ alerted: ['B-2-COT26'] }));
    expect(cargarEstado(ruta, vieja, AHORA).estado.alertados).toEqual({ 'B-2-COT26': AHORA });
  });

  it('si ya existe el estado nuevo, no toca el viejo', () => {
    guardarEstado(ruta, { ...estadoVacio(), marca: '2026-10-07T21:00:00.000Z' }, AHORA);
    fs.writeFileSync(vieja, JSON.stringify({ alertados: { 'X-1-COT26': AHORA } }));
    const { estado } = cargarEstado(ruta, vieja, AHORA);
    expect(estado.marca).toBe('2026-10-07T21:00:00.000Z');
    expect(estado.alertados).toEqual({});
    expect(fs.existsSync(vieja)).toBe(true);
  });
});

describe('lectura tolerante', () => {
  it('un archivo corrupto da un estado vacío con aviso, sin lanzar', () => {
    fs.writeFileSync(ruta, '{"version":2, "marca": ');
    const { estado, avisos } = cargarEstado(ruta, vieja, AHORA);
    expect(estado).toEqual(estadoVacio());
    expect(avisos.join(' ')).toMatch(/no se pudo leer/i);
  });

  it('descarta campos con tipos inválidos sin perder los válidos', () => {
    const e = parsearEstado({ version: 2, marca: 42, alertados: { 'A-1-COT26': 5, malo: 'x' }, leidos: ['2026-10-07T21:00:00.000Z', 3] });
    expect(e.marca).toBeNull();
    expect(e.alertados).toEqual({ 'A-1-COT26': 5 });
    expect(e.leidos).toEqual(['2026-10-07T21:00:00.000Z']);
  });
});

describe('guardar y podar', () => {
  it('ida y vuelta por disco, de forma atómica y sin dejar candado', () => {
    const e = { ...estadoVacio(), marca: '2026-10-07T21:55:00.000Z', alertados: { 'A-1-COT26': AHORA } };
    guardarEstado(ruta, e, AHORA);
    expect(cargarEstado(ruta, vieja, AHORA).estado).toEqual(e);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp'))).toEqual([]);
  });

  it('poda alertados de más de 30 días, consultas de más de 14 y huecos e incompletos de más de 7', () => {
    const e = estadoVacio();
    e.alertados = { viejo: AHORA - 31 * DIA, nuevo: AHORA - DIA };
    e.salud.consultasPorDia = { '2026-09-01': 10, '2026-10-07': 5 };
    e.huecos = [{ desde: '2026-09-20T00:00:00.000Z', hasta: '2026-09-21T00:00:00.000Z', registrado: AHORA - 8 * DIA }];
    e.incompletos = [{ lote: '2026-10-06T21:00:00.000Z', total: 150, leidos: 148, registrado: AHORA - DIA }];
    podarEstado(e, AHORA);
    expect(Object.keys(e.alertados)).toEqual(['nuevo']);
    expect(Object.keys(e.salud.consultasPorDia)).toEqual(['2026-10-07']);
    expect(e.huecos).toEqual([]);
    expect(e.incompletos).toHaveLength(1);
  });
});
