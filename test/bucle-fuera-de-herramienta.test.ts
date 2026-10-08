import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { conPresupuesto, fueraDeLaHerramienta, tiempoRestante } from '../src/utils/presupuesto.js';
import { crearBucleVigilancia } from '../src/services/bucle-vigilancia.js';

/**
 * Regresión de la prueba real del 8-oct: la vigilancia encendida con
 * activar_vigilancia corría dentro del presupuesto de 45 s de esa herramienta.
 * Vencido, cada consulta de las rondas siguientes se cancelaba (timeout de
 * 5 s) o ni se enviaba, y los lotes quedaban pendientes.
 */

const datoViejo = process.env.COMPRA_AGIL_DATA_DIR;
afterEach(() => {
  if (datoViejo === undefined) delete process.env.COMPRA_AGIL_DATA_DIR;
  else process.env.COMPRA_AGIL_DATA_DIR = datoViejo;
});

describe('fueraDeLaHerramienta', () => {
  it('lo programado adentro no hereda el presupuesto', async () => {
    const visto = await conPresupuesto(() => new Promise<number | undefined>((ok) => {
      fueraDeLaHerramienta(() => setTimeout(() => ok(tiempoRestante()), 5));
    }), 1);
    expect(visto).toBeUndefined();
  });
});

describe('bucle de vigilancia encendido desde una herramienta', () => {
  it('sus consultas corren sin el presupuesto de la herramienta', async () => {
    process.env.COMPRA_AGIL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bucle-'));
    const restantes: Array<number | undefined> = [];
    const client = {
      buscarFresco: async () => {
        restantes.push(tiempoRestante());
        throw new Error('sin API en la prueba');
      },
    } as unknown as CompraAgilClient;
    const bucle = crearBucleVigilancia({ client, env: { COMPRA_AGIL_AVISOS: '' }, registrar: () => {} });
    // Como activar_vigilancia: se enciende dentro de una herramienta con
    // presupuesto, y la herramienta termina enseguida.
    await conPresupuesto(async () => bucle.iniciar(), 1);
    for (let i = 0; i < 200 && restantes.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    bucle.detener();
    expect(restantes.length).toBeGreaterThan(0);
    expect(restantes.every((r) => r === undefined)).toBe(true);
  });
});
