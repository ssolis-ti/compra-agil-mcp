import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Prueba de humo por el protocolo MCP: arranca el servidor real por stdio,
 * como lo haría Claude Desktop, y conversa con él. Los demás tests llaman
 * funciones sueltas; este es el único que comprueba que el servidor arranca,
 * declara sus capacidades y registra lo que el README promete.
 *
 * No sale a la red: la URL de la API apunta a un puerto cerrado y solo se
 * llaman herramientas que no la consultan.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICKET = 'TICKET-HUMO-NO-REAL-424242';

let cliente: Client;
let stderr = '';
let cwd: string;

beforeAll(async () => {
  // Directorio vacío: el servidor escribe su caché y su estado en el cwd, y no
  // debe tocar los del proyecto ni leer un .env real.
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-humo-'));
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(RAIZ, 'src', 'index.ts')],
    cwd,
    env: {
      ...process.env as Record<string, string>,
      COMPRA_AGIL_TICKET: TICKET,
      COMPRA_AGIL_BASE_URL: 'http://127.0.0.1:9',
      LOG_LEVEL: 'debug',
    },
    stderr: 'pipe',
  });
  transporte.stderr?.on('data', (d) => { stderr += String(d); });
  cliente = new Client({ name: 'prueba-humo', version: '1.0.0' });
  await cliente.connect(transporte);
}, 60_000);

afterAll(async () => {
  await cliente?.close();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('servidor MCP por stdio', () => {
  it('se identifica con la versión del package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
    expect(cliente.getServerVersion()).toEqual({ name: 'mcp-compra-agil', version: pkg.version });
  });

  it('declara logging, sin lo cual los logs del protocolo nunca llegan', () => {
    expect(cliente.getServerCapabilities()).toMatchObject({ logging: {}, tools: {}, resources: {}, prompts: {} });
  });

  it('entrega instrucciones de uso al conectar', () => {
    expect((cliente.getInstructions() ?? '').length).toBeGreaterThan(100);
  });

  it('registra las 16 herramientas y solo generar_informe escribe', async () => {
    const { tools } = await cliente.listTools();
    expect(tools).toHaveLength(16);
    const escriben = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(escriben).toEqual(['generar_informe']);
  });

  it('registra los recursos y los dos prompts', async () => {
    const plantillas = (await cliente.listResourceTemplates()).resourceTemplates.map((r) => r.uriTemplate);
    expect(plantillas).toEqual(expect.arrayContaining(['compra-agil://compras/{codigo}', 'compra-agil://documentacion/{filename}']));
    const prompts = (await cliente.listPrompts()).prompts.map((p) => p.name).sort();
    expect(prompts).toEqual(['analizar_competencia', 'buscar_oportunidades_proveedor']);
  });

  it('responde una herramienta que no consulta la API', async () => {
    const r = await cliente.callTool({
      name: 'obtener_enlace_documento',
      arguments: { id_documento: '123', codigo_compra: '1-2-COT26' },
    });
    expect(r.isError).toBeFalsy();
    expect(JSON.stringify(r.content)).toContain('buscador.mercadopublico.cl/ficha?code=1-2-COT26');
  });

  it('rechaza argumentos inválidos sin caerse', async () => {
    const r = await cliente.callTool({ name: 'buscar_compras_agiles', arguments: { tamano_pagina: 500 } });
    expect(r.isError).toBe(true);
    // Sigue vivo después del rechazo.
    expect((await cliente.listTools()).tools.length).toBe(16);
  });

  it('una región inexistente se rechaza en el servidor, no en la API', async () => {
    // La URL de la API apunta a un puerto cerrado: si la llamada saliera, el
    // error sería de conexión. Debe ser la validación local.
    for (const herramienta of ['radar_oportunidades_calientes', 'analizar_precios_mercado']) {
      const r = await cliente.callTool({ name: herramienta, arguments: { region: '17', q: 'resmas' } });
      expect(r.isError, herramienta).toBe(true);
      expect(JSON.stringify(r.content)).toContain('Región inválida');
    }
  });

  it('el ticket no aparece en los logs del proceso', () => {
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).not.toContain(TICKET);
  });
});
