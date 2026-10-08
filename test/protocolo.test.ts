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
      // Desde la fase 1.0 la caché va a la carpeta de datos, no al cwd.
      COMPRA_AGIL_DATA_DIR: cwd,
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

  it('registra las 23 herramientas y solo escriben las que deben', async () => {
    const { tools } = await cliente.listTools();
    expect(tools).toHaveLength(23);
    const escriben = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    // generar_informe escribe en disco; las de vigilancia (2.9.0) cambian el estado o envían avisos.
    expect(escriben.sort()).toEqual(['activar_vigilancia', 'conectar_telegram', 'configurar_criterios', 'confirmar_alertas', 'generar_informe', 'obtener_alertas_nuevas', 'probar_avisos']);
  });

  it('registra los recursos y los cuatro prompts', async () => {
    const plantillas = (await cliente.listResourceTemplates()).resourceTemplates.map((r) => r.uriTemplate);
    expect(plantillas).toEqual(expect.arrayContaining(['compra-agil://compras/{codigo}', 'compra-agil://documentacion/{filename}']));
    const prompts = (await cliente.listPrompts()).prompts.map((p) => p.name).sort();
    expect(prompts).toEqual(['analizar_competencia', 'buscar_oportunidades_proveedor', 'configurar_vigilancia', 'empezar']);
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
    expect((await cliente.listTools()).tools.length).toBe(23);
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

  // E5 (enjambre, 6-oct): cuatro formatos de error distintos. Este test fija el
  // formato que de verdad recibe un cliente: si una versión del SDK cambia
  // cómo rechaza argumentos, falla aquí.
  it('todo rechazo de una entrada llega en el mismo formato y dice que no se consultó la API', async () => {
    const casos: Array<[string, Record<string, unknown>]> = [
      ['obtener_detalle_compra', { codigo: 'ABC' }],                               // E4: esquema del código
      ['obtener_enlace_documento', { id_documento: '1855508' }],                  // falta un obligatorio
      ['buscar_compras_agiles', { region: '17' }],                                 // región inexistente
      ['buscar_compras_agiles', {}],                                               // sin filtros (handler)
      ['monitorear_cambios_recientes', { cambio_desde: '2026-10-06T09:00:00' }],   // fecha sin zona (handler)
      ['buscar_compras_agiles', { tamano_pagina: 500 }],                           // rango
    ];
    for (const [nombre, args] of casos) {
      const r = await cliente.callTool({ name: nombre, arguments: args });
      const texto = (r.content as Array<{ text: string }>)[0].text;
      expect(r.isError, nombre).toBe(true);
      expect(texto, `${nombre} ${JSON.stringify(args)}`).toMatch(/^Error de validación: .+ No se consultó la API\.$/s);
      expect(texto, nombre).not.toMatch(/MCP error|Input validation error|Invalid input|expected string/);
    }
  });

  it('E4: un código con formato imposible no sale a la API', async () => {
    // La API apunta a un puerto cerrado: si la llamada saliera, el error sería de red.
    const r = await cliente.callTool({ name: 'obtener_detalle_compra', arguments: { codigo: 'ABC' } });
    const texto = (r.content as Array<{ text: string }>)[0].text;
    expect(texto).toMatch(/"ABC" no tiene el formato de un código de Compra Ágil/);
    expect(texto).not.toMatch(/conectar|red/i);
  });

  // Ítem 34 del plan 2.8.0: lo que puede desincronizarse no es el log de
  // arranque (ya se deriva del servidor) sino la documentación. Si se agrega o
  // renombra una herramienta sin documentarla, esto falla.
  it('el README y el manual documentan exactamente las herramientas registradas', async () => {
    const registradas = (await cliente.listTools()).tools.map((t) => t.name).sort();
    for (const doc of ['README.md', path.join('docs', 'api', 'manual_servidor_mcp.md')]) {
      const texto = fs.readFileSync(path.join(RAIZ, doc), 'utf8');
      const documentadas = [...new Set([...texto.matchAll(/^\| `([a-z]+(?:_[a-z]+)+)` \|/gm)].map((m) => m[1]))].sort();
      expect(documentadas, doc).toEqual(registradas);
    }
  });

  it('el log de arranque cuenta lo que de verdad se registró', () => {
    expect(stderr).toMatch(/23 herramientas registradas: buscar_compras_agiles,/);
    expect(stderr).toMatch(/4 prompts registrados: buscar_oportunidades_proveedor, analizar_competencia, empezar, configurar_vigilancia/);
  });

  it('el ticket no aparece en los logs del proceso', () => {
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).not.toContain(TICKET);
  });
});
