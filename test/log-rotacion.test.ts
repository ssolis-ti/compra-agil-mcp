import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { crearLogRotativo } from '../src/utils/log-rotativo.js';
import { registrarSecreto } from '../src/utils/redact.js';

/**
 * Log del daemon con rotación por tamaño (T9.3 de la 2.9.0; R10.4): un daemon
 * que corre meses sin supervisión no debe llenar el disco. Cada línea pasa por
 * la redacción antes de tocar el disco.
 */
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'logrot-'));

describe('crearLogRotativo', () => {
  it('escribe con fecha y rota al pasar el tamaño, conservando N archivos', () => {
    const d = dir();
    const ruta = path.join(d, 'vigilancia.log');
    const log = crearLogRotativo(ruta, { maxBytes: 200, archivos: 3, ahora: () => Date.parse('2026-10-07T22:00:00Z') });
    for (let i = 0; i < 40; i++) log(`linea ${i} ${'x'.repeat(30)}`);
    const archivos = fs.readdirSync(d).sort();
    expect(archivos).toEqual(['vigilancia.log', 'vigilancia.log.1', 'vigilancia.log.2', 'vigilancia.log.3']);
    for (const f of archivos) expect(fs.statSync(path.join(d, f)).size).toBeLessThanOrEqual(260);
    expect(fs.readFileSync(ruta, 'utf8')).toMatch(/^\[2026-10-07T22:00:00\.000Z\] linea 39/m);
    // Lo más viejo se descartó.
    expect(fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('')).not.toMatch(/linea 0 /);
  });

  it('redacta los secretos antes de escribir', () => {
    const d = dir();
    registrarSecreto('secreto-de-log-no-real-123456');
    const log = crearLogRotativo(path.join(d, 'v.log'));
    log('error con secreto-de-log-no-real-123456 en la URL');
    expect(fs.readFileSync(path.join(d, 'v.log'), 'utf8')).not.toContain('secreto-de-log');
  });

  it('si el disco no deja escribir, no lanza', () => {
    const log = crearLogRotativo(path.join(dir(), 'no', 'existe', 'v.log'));
    expect(() => log('hola')).not.toThrow();
  });
});
