import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';

/**
 * Sin ticket el servidor arranca igual (9-oct): Glama y otros catálogos de MCP
 * lo lanzan sin credenciales para listar sus herramientas, y antes terminaba
 * con código 1 al arrancar. Cada consulta responde «falta el ticket» sin salir
 * a la red.
 */
afterEach(() => { vi.restoreAllMocks(); });

describe('cliente sin ticket', () => {
  it('no envía nada y explica cómo conseguir el ticket', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const c = new CompraAgilClient('', undefined, { persistir: false });
    const e = await c.buscarFresco({ estado: 'publicada', tamano_pagina: 10 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CompraAgilApiError);
    expect((e as CompraAgilApiError).causa).toBe('sin_ticket');
    expect((e as Error).message).toMatch(/chilecompra\.cl\/api.*Nunca lo escribas en el chat/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('servidor sin ticket (como lo lanza Glama)', () => {
  it('arranca y lista las herramientas', async () => {
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const entrada = path.join(raiz, 'dist', 'index.js');
    if (!fs.existsSync(entrada)) return; // la CI compila antes de los tests
    // Un cwd y una carpeta de datos vacíos; COMPRA_AGIL_TICKET vacío para que
    // el .env del proyecto (si hay uno en el equipo) no lo complete.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sin-ticket-'));
    const env = { ...process.env, COMPRA_AGIL_TICKET: '', COMPRA_AGIL_DATA_DIR: dir, COMPRA_AGIL_NTP: 'off' };
    const p = spawn(process.execPath, [entrada], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let salida = '';
    p.stdout.on('data', (d) => (salida += d));
    let codigo: number | null = null;
    p.on('exit', (c) => { codigo = c; });
    const enviar = (m: unknown) => p.stdin.write(`${JSON.stringify(m)}\n`);
    enviar({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } } });
    enviar({ jsonrpc: '2.0', method: 'notifications/initialized' });
    enviar({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const lista = await new Promise<{ result: { tools: unknown[] } } | null>((resolve) => {
      const t = setInterval(() => {
        const m = salida.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((x) => x?.id === 1);
        if (m || codigo !== null) { clearInterval(t); resolve(m ?? null); }
      }, 100);
    });
    p.kill();
    expect(codigo).toBeNull();
    expect(lista?.result.tools.length).toBeGreaterThan(20);
  }, 30_000);
});
