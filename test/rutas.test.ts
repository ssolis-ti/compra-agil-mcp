import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { carpetaDatos, carpetaDeUsuario } from '../src/utils/rutas.js';

/**
 * Fase 1.0: un cliente MCP lanza el servidor desde SU directorio. Con la
 * configuración del README el servidor no encontraba el `.env` y repartía
 * caché, estado de cuota e informes por la carpeta del cliente (medido al
 * registrarlo en Claude Desktop el 5 de octubre).
 */

describe('carpetaDatos', () => {
  const siempre = () => true;
  const nunca = () => false;

  it('COMPRA_AGIL_DATA_DIR manda', () => {
    expect(carpetaDatos({ env: { COMPRA_AGIL_DATA_DIR: '/datos/mcp' }, raiz: '/repo', escribible: siempre }))
      .toBe(path.resolve('/datos/mcp'));
  });

  it('un clon del repositorio escribible guarda junto al proyecto', () => {
    expect(carpetaDatos({ env: {}, raiz: '/home/ana/mcp-compra-agil', escribible: siempre })).toBe('/home/ana/mcp-compra-agil');
  });

  it('un paquete instalado (npx, npm -g) usa la carpeta del usuario, aunque sea escribible', () => {
    const r = carpetaDatos({
      env: {}, raiz: '/home/ana/.npm/_npx/abc/node_modules/@ssolis-ti/mcp-compra-agil',
      plataforma: 'linux', home: '/home/ana', escribible: siempre,
    });
    expect(r).toBe('/home/ana/.local/state/mcp-compra-agil');
  });

  it('un clon sin permiso de escritura también va a la carpeta del usuario', () => {
    expect(carpetaDatos({ env: {}, raiz: '/opt/mcp', plataforma: 'linux', home: '/home/ana', escribible: nunca }))
      .toBe('/home/ana/.local/state/mcp-compra-agil');
  });
});

describe('carpetaDeUsuario', () => {
  it('Windows: %LOCALAPPDATA%\\mcp-compra-agil', () => {
    expect(carpetaDeUsuario({ plataforma: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\P0zcl\\AppData\\Local' }, home: 'C:\\Users\\P0zcl' }))
      .toBe('C:\\Users\\P0zcl\\AppData\\Local\\mcp-compra-agil');
    expect(carpetaDeUsuario({ plataforma: 'win32', env: {}, home: 'C:\\Users\\P0zcl' }))
      .toBe('C:\\Users\\P0zcl\\AppData\\Local\\mcp-compra-agil');
  });

  it('el resto: $XDG_STATE_HOME o ~/.local/state', () => {
    expect(carpetaDeUsuario({ plataforma: 'darwin', env: {}, home: '/Users/ana' })).toBe('/Users/ana/.local/state/mcp-compra-agil');
    expect(carpetaDeUsuario({ plataforma: 'linux', env: { XDG_STATE_HOME: '/x/state' }, home: '/h' })).toBe('/x/state/mcp-compra-agil');
  });
});

/**
 * El criterio de aceptación del roadmap: el servidor real, lanzado con el cwd
 * en una carpeta ajena y SIN el ticket en el entorno, lee el `.env` de la
 * carpeta de datos, responde y escribe su caché ahí, no en el cwd.
 */
describe('servidor lanzado desde otra carpeta (como lo hace un cliente MCP)', () => {
  const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const TICKET = 'TICKET-DESDE-ENV-DE-DATOS-1010';
  let base: string;
  let cwdAjeno: string;
  let datos: string;
  let api: http.Server;
  let cliente: Client;
  let ticketRecibido = '';

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-rutas-'));
    cwdAjeno = path.join(base, 'carpeta-del-cliente');
    datos = path.join(base, 'datos');
    fs.mkdirSync(cwdAjeno);
    fs.mkdirSync(datos);

    // El servidor corre desde una copia del paquete SIN `.env`: el servidor
    // también lee el `.env` de la raíz del paquete, y con el del desarrollador
    // (ticket real y COMPRA_AGIL_BASE_URL de la API real, como trae
    // .env.example) este test consultaba la API real con el ticket real y se
    // cortaba a los 5 s. Pasó al publicar la 2.7.0 en Windows.
    const paquete = path.join(base, 'paquete');
    fs.mkdirSync(paquete);
    fs.cpSync(path.join(RAIZ, 'src'), path.join(paquete, 'src'), { recursive: true });
    fs.copyFileSync(path.join(RAIZ, 'package.json'), path.join(paquete, 'package.json'));
    fs.symlinkSync(path.join(RAIZ, 'node_modules'), path.join(paquete, 'node_modules'), 'junction');

    api = http.createServer((req, res) => {
      ticketRecibido = String(req.headers.ticket ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: 'OK', payload: { items: [], paginacion: { total_paginas: 0, numero_pagina: 1, tamano_pagina: 10, total_resultados: 0 } } }));
    });
    await new Promise<void>((ok) => api.listen(0, '127.0.0.1', () => ok()));
    const puerto = (api.address() as { port: number }).port;

    // El ticket y la URL viven SOLO en el .env de la carpeta de datos.
    fs.writeFileSync(path.join(datos, '.env'), `COMPRA_AGIL_TICKET=${TICKET}\nCOMPRA_AGIL_BASE_URL=http://127.0.0.1:${puerto}\n`);

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith('COMPRA_AGIL_')) env[k] = v;
    }
    env.COMPRA_AGIL_DATA_DIR = datos;

    const transporte = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(paquete, 'src', 'index.ts')],
      cwd: cwdAjeno,
      env,
      stderr: 'pipe',
    });
    cliente = new Client({ name: 'prueba-rutas', version: '1.0.0' });
    await cliente.connect(transporte);
  }, 60_000);

  afterAll(async () => {
    await cliente?.close();
    await new Promise<void>((ok) => api.close(() => ok()));
    // Primero el enlace a node_modules, para que el borrado recursivo nunca
    // pueda entrar en el del proyecto.
    try { fs.unlinkSync(path.join(base, 'paquete', 'node_modules')); } catch { /* no se creó */ }
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('arranca y responde tools/list sin el ticket en el entorno', async () => {
    expect((await cliente.listTools()).tools).toHaveLength(16);
  }, 30_000);

  it('usa el ticket del .env de la carpeta de datos y guarda la caché ahí, no en el cwd', async () => {
    const r = await cliente.callTool({ name: 'buscar_compras_agiles', arguments: { q: 'resmas' } });
    expect(r.isError).toBeFalsy();
    expect(ticketRecibido).toBe(TICKET);
    // La caché se escribe diferida, ~1 s después de la última respuesta (fase 1.2).
    await vi.waitFor(() => expect(fs.existsSync(path.join(datos, '.api-cache.json'))).toBe(true), { timeout: 5_000 });
    expect(fs.existsSync(path.join(datos, '.rate-limit-state.json'))).toBe(true);
    expect(fs.readdirSync(cwdAjeno)).toEqual([]);
  }, 30_000);
});
