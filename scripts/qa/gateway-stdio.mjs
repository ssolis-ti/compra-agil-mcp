/**
 * Ciclo completo del modo gateway por stdio, como lo haría OpenClaw o Hermes
 * (puerta de la fase 8 de la 2.9.0): arranca la API simulada en modo de lotes
 * y el servidor real como proceso, y con el cliente MCP oficial llama
 * estado_vigilancia → obtener_alertas_nuevas → confirmar_alertas →
 * obtener_alertas_nuevas (no debe repetir lo confirmado).
 *
 * Uso: node scripts/qa/gateway-stdio.mjs   (no usa el ticket real ni la red)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const puerto = await new Promise((r) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => r(port)); }); });
const api = spawn(process.execPath, [path.join(RAIZ, 'scripts', 'qa', 'mock-api.mjs')], {
  env: { ...process.env, PORT: String(puerto), CATALOGO: 'cambios', CAMBIOS_POR_LOTE: '3' },
});
await new Promise((r) => api.stderr.once('data', r));

const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-stdio-'));
const transporte = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(RAIZ, 'src', 'index.ts')],
  cwd: datos,
  env: {
    ...process.env,
    COMPRA_AGIL_TICKET: 'TICKET-DE-PRUEBA-NO-REAL-0000',
    COMPRA_AGIL_BASE_URL: `http://127.0.0.1:${puerto}`,
    COMPRA_AGIL_DATA_DIR: datos,
    COMPRA_AGIL_NTP: 'off',
    COMPRA_AGIL_AVISOS: '',
    MONITOR_KEYWORDS: 'resmas', MONITOR_EXCLUIR: '', MONITOR_REGIONES: '', MONITOR_MIN_BUDGET_CLP: '0', MONITOR_SOLO_SIN_OFERTAS: 'true',
  },
  stderr: 'ignore',
});
const cliente = new Client({ name: 'gateway-simulado', version: '1.0.0' });
const fallos = [];
const verificar = (cond, texto) => { console.log(`${cond ? '✔' : '✘'} ${texto}`); if (!cond) fallos.push(texto); };
const llamar = async (name, args = {}) => JSON.parse((await cliente.callTool({ name, arguments: args })).content[0].text);

try {
  await cliente.connect(transporte);
  const herramientas = (await cliente.listTools()).tools.map((t) => t.name);
  verificar(herramientas.length === 23, `23 herramientas registradas (${herramientas.length})`);
  const estado = await llamar('estado_vigilancia');
  verificar(estado.ultimo_lote_revisado === null, 'estado_vigilancia: todavía no se ha revisado nada');
  const lote = await llamar('obtener_alertas_nuevas', { max: 50 });
  verificar(lote.revision?.hecha === true, `obtener_alertas_nuevas revisó lotes (${lote.revision?.lotes_leidos})`);
  verificar(lote.alertas.length >= 30 && /^[0-9a-f]{16}$/.test(lote.lote_id ?? ''), `entregó ${lote.alertas.length} alertas con lote_id`);
  const conf = await llamar('confirmar_alertas', { lote_id: lote.lote_id });
  verificar(conf.confirmadas === lote.alertas.length, `confirmar_alertas confirmó ${conf.confirmadas}`);
  const otra = await llamar('obtener_alertas_nuevas', { max: 50 });
  verificar(!otra.alertas.some((a) => lote.alertas.some((b) => b.codigo === a.codigo)), 'lo confirmado no se vuelve a ofrecer');
  const despues = await llamar('estado_vigilancia');
  verificar(/hora de Chile/.test(despues.ultimo_lote_revisado ?? ''), `estado_vigilancia: último lote ${despues.ultimo_lote_revisado}`);
} finally {
  await cliente.close().catch(() => undefined);
  api.kill();
}
console.log(fallos.length === 0 ? 'Ciclo gateway completo por stdio: OK' : `${fallos.length} verificación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
