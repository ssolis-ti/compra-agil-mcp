/**
 * Prueba de la 2.9.0 contra la API real, con el servidor compilado (dist/)
 * por stdio y el cliente MCP oficial, como lo usa Claude Desktop.
 *
 * Uso: npm run build && node scripts/qa/prueba-real-2.9.mjs
 *
 * El ticket lo lee el servidor de su .env; este script no lo toca ni lo
 * muestra. Usa una carpeta de datos temporal: no deja estado en el proyecto.
 * Gasta unas 15–40 consultas (una revisión de la última hora, parcial si no
 * cabe en el tiempo de la herramienta).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'prueba-real-29-'));
const transporte = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(RAIZ, 'dist', 'index.js')],
  cwd: RAIZ,
  env: { ...process.env, COMPRA_AGIL_DATA_DIR: datos },
  stderr: 'ignore',
});
const cliente = new Client({ name: 'prueba-real-2.9', version: '1.0.0' });
const resultados = [];
const ok = (cond, texto) => { resultados.push(cond); console.log(`${cond ? '✔' : '✘'} ${texto}`); };
const llamar = async (name, args = {}) => {
  const t0 = Date.now();
  const r = await cliente.callTool({ name, arguments: args });
  const texto = r.content[0]?.text ?? '';
  let json = null;
  try { json = JSON.parse(texto); } catch { /* texto plano */ }
  return { r, texto, json, ms: Date.now() - t0 };
};

try {
  await cliente.connect(transporte);
  const herramientas = (await cliente.listTools()).tools.map((t) => t.name);
  ok(herramientas.length === 23, `23 herramientas (${herramientas.length})`);

  const hora = await llamar('verificar_hora_oficial');
  ok(hora.json?.sincronizado !== undefined, `hora oficial: ${hora.json?.diagnostico ?? hora.texto.slice(0, 80)}`);

  const e0 = await llamar('estado_vigilancia');
  ok(e0.json && e0.json.ultimo_lote_revisado === null, `estado_vigilancia inicial: sin revisar; criterios ${JSON.stringify(e0.json?.criterios?.palabras)}`);

  const lote = await llamar('obtener_alertas_nuevas', { max: 20 });
  const rev = lote.json?.revision;
  ok(!lote.r.isError && rev && !rev.error, `obtener_alertas_nuevas en ${Math.round(lote.ms / 1000)} s: ${JSON.stringify(rev)}`);
  // Si no leyó ningún lote, la revisión no sirvió aunque no haya error (fallo detectado el 8-oct).
  ok((rev?.lotes_leidos ?? 0) > 0 || rev?.hecha === false, `leyó al menos un lote (${rev?.lotes_leidos ?? 0})`);
  ok(Array.isArray(lote.json?.alertas), `alertas entregadas: ${lote.json?.alertas?.length} (quedan ${lote.json?.quedan_en_cola})`);
  for (const a of (lote.json?.alertas ?? []).slice(0, 3)) console.log(`   · ${a.codigo} | ${a.nombre?.slice(0, 60)} | cierra ${a.cierre_hora_chile} | «${a.coincidencia}»`);
  ok(lote.ms < 50_000, 'respetó el presupuesto de tiempo de la herramienta (< 50 s)');

  if (lote.json?.lote_id) {
    const c = await llamar('confirmar_alertas', { lote_id: lote.json.lote_id });
    ok(c.json?.confirmadas === lote.json.alertas.length, `confirmar_alertas: ${c.json?.confirmadas}`);
  }

  const e1 = await llamar('estado_vigilancia');
  ok(Boolean(e1.json?.ultimo_lote_revisado), `estado tras revisar: último lote ${e1.json?.ultimo_lote_revisado}; pendientes ${e1.json?.lotes_pendientes?.length}; consultas hoy ${e1.json?.cuota?.consultas_hoy_utc}`);

  const p = await llamar('probar_avisos');
  ok(Boolean(p.json), `probar_avisos: ${JSON.stringify(p.json?.canales)} ${p.json?._nota ?? ''}`);

  const malo = await llamar('confirmar_alertas', { lote_id: '../etc' });
  ok(malo.r.isError === true && /Error de validación/.test(malo.texto), 'confirmar_alertas rechaza un lote_id inválido');

  const uso = await llamar('obtener_estadisticas_uso');
  ok(Boolean(uso.json), `consultas a la API en esta prueba: ${JSON.stringify(uso.json?.metricas?.consultas_api?.por_resultado)}`);
} catch (e) {
  ok(false, `error: ${e?.message ?? e}`);
} finally {
  await cliente.close().catch(() => undefined);
  fs.rmSync(datos, { recursive: true, force: true });
}
const fallos = resultados.filter((r) => !r).length;
console.log(fallos === 0 ? 'Prueba real de la 2.9.0: OK' : `${fallos} verificación(es) fallaron`);
process.exit(fallos === 0 ? 0 : 1);
