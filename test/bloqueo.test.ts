import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { conBloqueo } from '../src/utils/bloqueo.js';

/**
 * T1.1 de la 2.9.0: el candado del estado de cuota pasa a un módulo propio.
 * Lo usarán también el estado de la vigilancia, que tocan a la vez el daemon y
 * el proceso del servidor MCP.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloqueo-'));
const ruta = path.join(dir, 'estado.json');
const candado = `${ruta}.lock`;

afterEach(() => { fs.rmSync(candado, { force: true }); });

describe('conBloqueo', () => {
  it('ejecuta la función, devuelve su valor y suelta el candado', () => {
    expect(conBloqueo(ruta, () => 42)).toBe(42);
    expect(fs.existsSync(candado)).toBe(false);
  });

  it('suelta el candado aunque la función lance', () => {
    expect(() => conBloqueo(ruta, () => { throw new Error('x'); })).toThrow('x');
    expect(fs.existsSync(candado)).toBe(false);
  });

  it('un candado abandonado (más viejo que la caducidad) se libera y se toma', () => {
    fs.writeFileSync(candado, '');
    const viejo = new Date(Date.now() - 60_000);
    fs.utimesSync(candado, viejo, viejo);
    const inicio = Date.now();
    expect(conBloqueo(ruta, () => 'ok', { caducidadMs: 5000 })).toBe('ok');
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(fs.existsSync(candado)).toBe(false);
  });

  it('con un candado vigente espera; al vencer la espera corre igual y no borra el candado ajeno', () => {
    fs.writeFileSync(candado, '');
    const inicio = Date.now();
    expect(conBloqueo(ruta, () => 'sin candado', { esperaMaxMs: 200 })).toBe('sin candado');
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(190);
    expect(fs.existsSync(candado)).toBe(true);
  });

  it('dos procesos no están dentro a la vez', async () => {
    // Otro proceso toma el candado y lo retiene 400 ms; este espera su turno.
    const hijo = spawn(process.execPath, ['-e', `
      const fs = require('fs');
      const fd = fs.openSync(${JSON.stringify(candado)}, 'wx');
      process.stdout.write('dentro');
      setTimeout(() => { fs.closeSync(fd); fs.unlinkSync(${JSON.stringify(candado)}); }, 400);
    `]);
    await new Promise<void>((r) => hijo.stdout.once('data', () => r()));
    const inicio = Date.now();
    conBloqueo(ruta, () => undefined, { esperaMaxMs: 3000 });
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(250);
    await new Promise((r) => hijo.once('exit', r));
  });
});
