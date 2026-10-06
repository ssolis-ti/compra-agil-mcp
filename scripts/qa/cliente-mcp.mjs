/**
 * Cliente MCP de QA: arranca el servidor compilado (dist/index.js) por stdio,
 * como lo haría Claude Desktop, y ejecuta una lista de escenarios.
 *
 * Uso:
 *   npm run build
 *   node scripts/qa/mock-api.mjs            # en otra terminal
 *   node scripts/qa/cliente-mcp.mjs [escenarios.mjs]
 *
 * Por defecto apunta a la API simulada con un ticket falso. Contra la API
 * REAL: QA_API_REAL=1 node scripts/qa/cliente-mcp.mjs escenarios-reales.mjs
 * (usa COMPRA_AGIL_TICKET de tu .env y gasta cuota; ver
 * docs/internals/qa/validacion-api-real.md).
 *
 * Variables: SNIP (caracteres de cada respuesta a mostrar, def. 400),
 * COMPRA_AGIL_TIMEOUT_MS (se pasa al servidor).
 * Cada escenario: [etiqueta, herramienta, argumentos, timeoutMs?].
 * Marca TICKETLEAK=true si el ticket aparece en una respuesta o en stderr.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const archivo = path.resolve(process.argv[2] ?? path.join(AQUI, 'escenarios.mjs'));
const escenarios = (await import(pathToFileURL(archivo).href)).default;
const real = process.env.QA_API_REAL === '1';

// Con la API real el ticket sale del .env del proyecto (lo carga el servidor).
// Se lee aquí solo para poder detectar si se filtra, nunca se imprime.
let ticket = 'TICKET-SECRETO-QA-123456';
if (real) {
  const env = fs.existsSync(path.join(RAIZ, '.env')) ? fs.readFileSync(path.join(RAIZ, '.env'), 'utf8') : '';
  ticket = process.env.COMPRA_AGIL_TICKET || /^COMPRA_AGIL_TICKET=(.+)$/m.exec(env)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
  if (!ticket) { console.error('Falta COMPRA_AGIL_TICKET en el entorno o en .env'); process.exit(1); }
}

// Con la API simulada se corre en una carpeta temporal para no tocar la caché
// ni el estado de cuota del proyecto. Con la real, en la raíz: comparte la
// caché y el estado de cuota con tu uso normal.
const cwd = real ? RAIZ : fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-qa-'));
const env = { ...process.env, LOG_LEVEL: 'debug', COMPRA_AGIL_TICKET: ticket };
if (!real) env.COMPRA_AGIL_BASE_URL = `http://127.0.0.1:${process.env.PORT || 8765}`;

const transporte = new StdioClientTransport({
  command: process.execPath, args: [path.join(RAIZ, 'dist', 'index.js')], cwd, env, stderr: 'pipe',
});
let stderr = '';
transporte.stderr?.on('data', (d) => { stderr += d; });
const c = new Client({ name: 'qa', version: '1' });
const t0 = Date.now();
await c.connect(transporte);
const tools = (await c.listTools()).tools;
console.log(`Servidor ${c.getServerVersion()?.name} ${c.getServerVersion()?.version} listo en ${Date.now() - t0} ms · ${tools.length} herramientas · ${real ? 'API REAL' : 'API simulada'} · cwd ${cwd}`);

const resumen = [];
for (const [etiqueta, nombre, args, timeout] of escenarios) {
  const s = Date.now();
  let estado;
  try {
    const r = await c.callTool({ name: nombre, arguments: args }, undefined, { timeout: timeout ?? 60_000 });
    const txt = (r.content ?? []).map((x) => x.text).join('\n');
    const fuga = Boolean(ticket) && txt.includes(ticket);
    estado = `${r.isError ? 'ERROR' : 'ok'}${fuga ? ' TICKETLEAK=true' : ''}`;
    console.log(`\n### ${etiqueta} [${nombre}] ${Date.now() - s} ms · ${estado} · ${txt.length} car.\n${txt.slice(0, Number(process.env.SNIP || 400))}`);
  } catch (e) {
    estado = 'EXCEPCIÓN';
    console.log(`\n### ${etiqueta} [${nombre}] ${Date.now() - s} ms · ${estado}: ${String(e.message).slice(0, 300)}`);
  }
  resumen.push(`${String(Date.now() - s).padStart(7)} ms  ${estado.padEnd(9)} ${etiqueta}`);
}

console.log(`\n=== Resumen\n${resumen.join('\n')}`);
console.log(`\n=== Ticket en stderr: ${Boolean(ticket) && stderr.includes(ticket)} (${stderr.length} bytes de log)`);
await c.close();
if (!real) fs.rmSync(cwd, { recursive: true, force: true });
