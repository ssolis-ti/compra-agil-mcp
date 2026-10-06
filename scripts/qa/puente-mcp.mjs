/**
 * Puente HTTP hacia UNA instancia del servidor MCP, para simulaciones de uso
 * con varios agentes que comparten caché, freno de cuota y concurrencia, como
 * en uso real. Los agentes llaman herramientas con curl.
 *
 * Uso:
 *   npm run build
 *   FALLA_DETALLE=0.5 LATENCIA_MS=300 node scripts/qa/mock-api.mjs   # o la API real, ver abajo
 *   node scripts/qa/puente-mcp.mjs                                    # puerto 8770 (PUENTE_PORT)
 *
 *   GET  /contexto            instrucciones del servidor + herramientas con descripción y esquema
 *   POST /llamar              {"agente":"pyme","herramienta":"buscar_compras_agiles","argumentos":{...}}
 *   GET  /registro            todas las llamadas: agente, herramienta, ms, isError
 *
 * Con QA_API_REAL=1 apunta a la API real con el .env del proyecto (gasta cuota).
 */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const real = process.env.QA_API_REAL === '1';
const cwd = real ? RAIZ : fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-puente-'));
const env = { ...process.env };
if (!real) {
  env.COMPRA_AGIL_TICKET = 'TICKET-SECRETO-SIMULACION-7788';
  env.COMPRA_AGIL_BASE_URL = `http://127.0.0.1:${process.env.PORT || 8765}`;
}
const ticket = env.COMPRA_AGIL_TICKET ?? '';

const transporte = new StdioClientTransport({
  command: process.execPath, args: [path.join(RAIZ, 'dist', 'index.js')], cwd, env, stderr: 'pipe',
});
let stderr = '';
transporte.stderr?.on('data', (d) => { stderr += d; });
const cliente = new Client({ name: 'puente-qa', version: '1' });
await cliente.connect(transporte);
const { tools } = await cliente.listTools();
const contexto = {
  instrucciones: cliente.getInstructions(),
  herramientas: tools.map((t) => ({ nombre: t.name, titulo: t.title, descripcion: t.description, esquema: t.inputSchema })),
};
const registro = [];

const leerCuerpo = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b)); });
const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v, null, 2)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/contexto') return json(res, 200, contexto);
    if (req.method === 'GET' && req.url === '/registro') {
      return json(res, 200, { llamadas: registro, ticket_en_stderr: Boolean(ticket) && stderr.includes(ticket) });
    }
    if (req.method === 'POST' && req.url === '/llamar') {
      const { agente = '?', herramienta, argumentos = {} } = JSON.parse(await leerCuerpo(req));
      const t0 = Date.now();
      let salida;
      try {
        // 60 s: lo que espera Claude Desktop antes de cortar una herramienta.
        const r = await cliente.callTool({ name: herramienta, arguments: argumentos }, undefined, { timeout: 60_000 });
        const texto = (r.content ?? []).map((c) => c.text).join('\n');
        salida = { isError: Boolean(r.isError), texto };
      } catch (e) {
        salida = { isError: true, texto: `[El cliente MCP abortó la llamada] ${e.message}` };
      }
      const ms = Date.now() - t0;
      const fuga = Boolean(ticket) && salida.texto.includes(ticket);
      registro.push({ agente, herramienta, argumentos, ms, isError: salida.isError, fuga_ticket: fuga });
      return json(res, 200, { ms, ...salida });
    }
    json(res, 404, { error: 'GET /contexto, POST /llamar, GET /registro' });
  } catch (e) {
    json(res, 400, { error: String(e.message) });
  }
}).listen(Number(process.env.PUENTE_PORT || 8770), () => {
  console.error(`Puente MCP en http://127.0.0.1:${process.env.PUENTE_PORT || 8770} · ${tools.length} herramientas · ${real ? 'API REAL' : 'API simulada'}`);
});
