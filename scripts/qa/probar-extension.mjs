/**
 * Prueba el .mcpb como lo arranca Claude Desktop (anexo RA1/RA2): lo
 * descomprime en una carpeta temporal, inicia su servidor solo con las
 * variables que pone la extensión (ticket de prueba, sin .env) y verifica por
 * stdio que arranca completo y que sus datos van a la carpeta del usuario.
 *
 * Uso: node scripts/qa/probar-extension.mjs extension/compra-agil-<v>-win32.mcpb
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const paquete = path.resolve(process.argv[2] ?? '');
if (!fs.existsSync(paquete)) { console.error('Indica el .mcpb a probar.'); process.exit(1); }
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'prueba-mcpb-'));
const extension = path.join(base, 'extension');
const usuario = path.join(base, 'LocalAppData');
fs.mkdirSync(extension); fs.mkdirSync(usuario);
execSync(`npx --yes @anthropic-ai/mcpb unpack "${paquete}" "${extension}"`, { stdio: 'ignore' });
const manifiesto = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));

// Lo que hace Claude Desktop: el comando del manifiesto, con ${__dirname} y user_config sustituidos.
const sustituir = (v) => v.replace('${__dirname}', extension).replace('${user_config.ticket}', 'TICKET-DE-PRUEBA-NO-REAL-0000').replace('${user_config.telegram_token}', '');
const cfg = manifiesto.server.mcp_config;
const env = Object.fromEntries(Object.entries(cfg.env).map(([k, v]) => [k, sustituir(v)]));
const limpio = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('COMPRA_AGIL_') && !k.startsWith('MONITOR_')));
const transporte = new StdioClientTransport({
  command: process.execPath,
  args: cfg.args.map(sustituir),
  cwd: base, // Claude Desktop no lanza desde la carpeta del proyecto
  env: { ...limpio, ...env, LOCALAPPDATA: usuario, COMPRA_AGIL_BASE_URL: 'http://127.0.0.1:9', COMPRA_AGIL_NTP: 'off' },
  stderr: 'ignore',
});
const cliente = new Client({ name: 'claude-desktop-simulado', version: '1.0.0' });
const fallos = [];
const ok = (c, t) => { console.log(`${c ? '✔' : '✘'} ${t}`); if (!c) fallos.push(t); };
try {
  await cliente.connect(transporte);
  const herramientas = (await cliente.listTools()).tools.map((t) => t.name);
  ok(herramientas.length === 23, `${herramientas.length} herramientas`);
  const prompts = (await cliente.listPrompts()).prompts.map((p) => p.name);
  ok(prompts.includes('configurar_vigilancia'), `prompts: ${prompts.join(', ')}`);
  const docs = (await cliente.listResources()).resources.filter((r) => r.uri.includes('documentacion')).length;
  ok(docs >= 12, `${docs} documentos incluidos`);
  const estado = JSON.parse((await cliente.callTool({ name: 'estado_vigilancia', arguments: {} })).content[0].text);
  ok(estado.ultimo_lote_revisado === null, 'estado_vigilancia responde');
  const tg = JSON.parse((await cliente.callTool({ name: 'conectar_telegram', arguments: {} })).content[0].text);
  ok(tg.estado === 'sin_token', `conectar_telegram sin token: ${tg._siguiente_paso?.slice(0, 60)}…`);
  await cliente.callTool({ name: 'configurar_criterios', arguments: { palabras: ['resma'] } });
  const datos = path.join(usuario, 'mcp-compra-agil');
  ok(fs.existsSync(path.join(datos, '.vigilancia.json')), `los datos van a la carpeta del usuario (${datos})`);
  ok(!fs.existsSync(path.join(extension, '.vigilancia.json')), 'nada se escribe en la carpeta de la extensión');
} catch (e) {
  ok(false, `error: ${e?.message ?? e}`);
} finally {
  await cliente.close().catch(() => undefined);
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(fallos.length === 0 ? 'Extensión: OK' : `${fallos.length} verificación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
