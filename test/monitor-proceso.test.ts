import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * El daemon como proceso real (T2.6 de la 2.9.0): arranca contra la API
 * simulada en modo de lotes (CATALOGO=cambios), lee la última hora, escribe
 * alertas en `alerts.log` y deja el estado v2 en la carpeta de datos.
 * Con 3 procesos por lote, la primera ronda son 12 consultas: caben en el
 * freno de 15 por minuto sin esperar.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX = path.join(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-proceso-'));
const procesos: ChildProcess[] = [];

async function puertoLibre(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

afterAll(() => { for (const p of procesos) p.kill(); });

describe('daemon de vigilancia', () => {
  it('lee los lotes, escribe alertas y guarda el estado v2', async () => {
    const puerto = await puertoLibre();
    const api = spawn(process.execPath, [path.join(RAIZ, 'scripts', 'qa', 'mock-api.mjs')], {
      env: { ...process.env, PORT: String(puerto), CATALOGO: 'cambios', CAMBIOS_POR_LOTE: '3' },
    });
    procesos.push(api);
    await new Promise<void>((r) => api.stderr!.once('data', () => r()));

    let salida = '';
    const daemon = spawn(process.execPath, [TSX, path.join(RAIZ, 'src', 'services', 'monitor.ts')], {
      cwd: datos,
      env: {
        ...process.env,
        COMPRA_AGIL_TICKET: 'TICKET-DE-PRUEBA-NO-REAL-0000',
        COMPRA_AGIL_BASE_URL: `http://127.0.0.1:${puerto}`,
        COMPRA_AGIL_DATA_DIR: datos,
        COMPRA_AGIL_NTP: 'off',
        // Todos los criterios fijados: el daemon también carga el .env del
        // proyecto, y el de un equipo de desarrollo puede traer otros.
        MONITOR_KEYWORDS: 'resmas',
        MONITOR_EXCLUIR: '',
        MONITOR_REGIONES: '',
        MONITOR_MIN_BUDGET_CLP: '0',
        MONITOR_SOLO_SIN_OFERTAS: 'true',
        MONITOR_INTERVAL_MINUTES: '15',
      },
    });
    procesos.push(daemon);
    daemon.stdout!.on('data', (d) => { salida += String(d); });
    daemon.stderr!.on('data', (d) => { salida += String(d); });

    const estado = path.join(datos, '.vigilancia.json');
    const limite = Date.now() + 60_000;
    while (!fs.existsSync(estado) && Date.now() < limite) await new Promise((r) => setTimeout(r, 200));
    expect(fs.existsSync(estado), salida).toBe(true);

    const e = JSON.parse(fs.readFileSync(estado, 'utf8'));
    expect(e.version).toBe(2);
    expect(e.marca, salida).not.toBeNull();
    expect(fs.existsSync(path.join(datos, 'alerts.log')), salida).toBe(true);
    const alertas = fs.readFileSync(path.join(datos, 'alerts.log'), 'utf8').trim().split('\n');
    expect(alertas.length).toBe(Object.keys(e.alertados).length);
    expect(alertas.length).toBeGreaterThanOrEqual(30);
    expect(salida).toMatch(/Lotes leídos: 1[23], fallidos: 0/);
    expect(salida).not.toContain('TICKET-DE-PRUEBA-NO-REAL-0000');
  }, 90_000);
});
