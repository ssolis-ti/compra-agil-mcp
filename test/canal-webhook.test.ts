import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { CanalWebhook, firmar } from '../src/avisos/canales/webhook.js';
import { cuerpoWebhook } from '../src/avisos/formato/webhook.js';
import { leerConfigAvisos } from '../src/avisos/config.js';
import { redact } from '../src/utils/redact.js';
import type { LoteDeAvisos } from '../src/avisos/canal.js';
import type { Alerta } from '../src/avisos/mensaje.js';

/**
 * Webhook firmado (T5.1–T5.3 de la 2.9.0; R6.1–R6.4, ADR 0024). El test
 * ejecuta los ejemplos de verificación de docs/api/webhook-alertas.md: si la
 * documentación y el código se separan, falla.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// En CI (Windows) git entrega el .md con CRLF: sin normalizar, los bloques no se encuentran.
const DOC = fs.readFileSync(path.join(RAIZ, 'docs', 'api', 'webhook-alertas.md'), 'utf8').replace(/\r\n/g, '\n');
const bloque = (lenguaje: string) => DOC.match(new RegExp('```' + lenguaje + '\\n([\\s\\S]*?)```'))![1];
const SECRETO = 'secreto-webhook-de-prueba-no-real-de-32+caracteres';
const AHORA = Date.parse('2026-10-07T22:00:00Z');

type Recibido = { cabeceras: http.IncomingHttpHeaders; cuerpo: string };
const recibidos: Recibido[] = [];
const respuestas: Array<{ status: number; retryAfter?: string }> = [];
let url = '';
let servidor: http.Server;

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; });
    req.on('end', () => {
      recibidos.push({ cabeceras: req.headers, cuerpo });
      const r = respuestas.shift() ?? { status: 204 };
      res.writeHead(r.status, r.retryAfter ? { 'retry-after': r.retryAfter } : {});
      res.end();
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(servidor.address() as { port: number }).port}/compra-agil`;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));
beforeEach(() => { recibidos.length = 0; respuestas.length = 0; });

const alerta = (codigo: string): Alerta => ({
  codigo, nombre: 'COMPRA DE RESMAS', organismo: 'Juzgado', region: 'Metropolitana', presupuestoClp: 300_000,
  cierreHoraChile: '2026-10-09 12:00', publicadaHoraChile: '2026-10-08 11:46', cierreUtc: '2026-10-09T15:00:00.000Z', coincidencia: 'resma',
  ficha: `https://buscador.mercadopublico.cl/ficha?code=${codigo}`, creada: AHORA,
});
const lote = (codigos: string[]): LoteDeAvisos => ({
  id: 'lote-abc', canal: 'webhook', resumenDeSilencio: false,
  avisos: codigos.map((c, i) => ({ id: `a${i}`, canal: 'webhook', alerta: alerta(c), estado: 'pendiente', intentos: 0, proximoIntento: AHORA, creado: AHORA })),
});
const canal = () => new CanalWebhook({ url, secreto: SECRETO });

/** El ejemplo en Node de la documentación, ejecutado tal cual. */
function verificadorDeLaDoc(): (cuerpo: string, cabecera: string, secreto: string, ahoraSeg?: number) => boolean {
  // Los globales que tiene un script de Node; el contexto de vm parte vacío.
  const contexto = { require: createRequire(import.meta.url), Buffer, Date, Math, Number, Object, String, firmaValida: undefined as unknown };
  vm.runInNewContext(`${bloque('js')}\nthis.firmaValida = firmaValida;`, contexto);
  return contexto.firmaValida as never;
}

describe('documentación del esquema (T5.1)', () => {
  it('el ejemplo del cuerpo tiene exactamente los campos y tipos que genera el código', () => {
    const ejemplo = JSON.parse(bloque('json'));
    const generado = JSON.parse(JSON.stringify(cuerpoWebhook(lote(['765973-8-COT26']), AHORA)));
    const forma = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? 'array' : typeof v]));
    expect(forma(generado)).toEqual(forma(ejemplo));
    expect(forma(generado.alertas[0])).toEqual(forma(ejemplo.alertas[0]));
  });
});

describe('CanalWebhook (T5.2)', () => {
  it('envía el cuerpo con firma, Idempotency-Key y User-Agent; la firma valida con el ejemplo de la documentación', async () => {
    expect(await canal().enviar(lote(['A-1-COT26']), AHORA)).toEqual({ ok: true });
    const [r] = recibidos;
    expect(r.cabeceras['idempotency-key']).toBe('lote-abc');
    expect(r.cabeceras['user-agent']).toMatch(/mcp-compra-agil/);
    expect(JSON.parse(r.cuerpo).alertas[0].codigo).toBe('A-1-COT26');
    const valida = verificadorDeLaDoc();
    const cabecera = String(r.cabeceras['x-compra-agil-firma']);
    const t = Number(cabecera.match(/t=(\d+)/)![1]);
    expect(valida(r.cuerpo, cabecera, SECRETO, t)).toBe(true);
    expect(valida(r.cuerpo, cabecera, 'otro-secreto', t)).toBe(false);
    expect(valida(r.cuerpo.replace('A-1-COT26', 'B-2-COT26'), cabecera, SECRETO, t)).toBe(false);
    expect(valida(r.cuerpo, cabecera, SECRETO, t + 301)).toBe(false); // repetición fuera de la ventana
  });

  it('503 transitorio (con Retry-After), 400 permanente, red caída transitoria', async () => {
    respuestas.push({ status: 503, retryAfter: '12' }, { status: 400 });
    expect(await canal().enviar(lote(['A']), AHORA)).toMatchObject({ ok: false, tipo: 'transitorio', reintentarEnMs: 12_000 });
    expect(await canal().enviar(lote(['A']), AHORA)).toMatchObject({ ok: false, tipo: 'permanente' });
    const caido = new CanalWebhook({ url: 'http://127.0.0.1:9/x', secreto: SECRETO });
    expect(await caido.enviar(lote(['A']), AHORA)).toMatchObject({ ok: false, tipo: 'transitorio' });
  });

  it('probar envía un cuerpo compra_agil.prueba, firmado', async () => {
    expect(await canal().probar(AHORA)).toEqual({ ok: true });
    expect(JSON.parse(recibidos[0].cuerpo)).toMatchObject({ tipo: 'compra_agil.prueba', alertas: [] });
  });

  it('firmar es HMAC-SHA256 de «t.cuerpo»', () => {
    const esperado = crypto.createHmac('sha256', SECRETO).update('1700000000.{}').digest('hex');
    expect(firmar('{}', SECRETO, 1700000000)).toBe(`t=1700000000,v1=${esperado}`);
  });
});

describe('configuración del webhook', () => {
  const base = { COMPRA_AGIL_AVISOS: 'webhook', COMPRA_AGIL_WEBHOOK_SECRETO: SECRETO };

  it('https y localhost se aceptan; http externo no (R6.3)', () => {
    expect(leerConfigAvisos({ ...base, COMPRA_AGIL_WEBHOOK_URL: 'https://hooks.ejemplo.test/x' }).canales).toEqual(['webhook']);
    expect(leerConfigAvisos({ ...base, COMPRA_AGIL_WEBHOOK_URL: 'http://localhost:5678/x' }).canales).toEqual(['webhook']);
    const malo = leerConfigAvisos({ ...base, COMPRA_AGIL_WEBHOOK_URL: 'http://hooks.ejemplo.test/x' });
    expect(malo.canales).toEqual([]);
    expect(malo.errores.join(' ')).toMatch(/https/);
  });

  it('un secreto corto no activa el canal; el error no lo muestra', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_AVISOS: 'webhook', COMPRA_AGIL_WEBHOOK_URL: 'https://h.test/x', COMPRA_AGIL_WEBHOOK_SECRETO: 'corto-123' });
    expect(c.canales).toEqual([]);
    expect(c.errores.join(' ')).toMatch(/32 caracteres/);
    expect(c.errores.join(' ')).not.toContain('corto-123');
  });

  it('la URL completa y el secreto quedan registrados para la redacción (pueden llevar tokens)', () => {
    leerConfigAvisos({ ...base, COMPRA_AGIL_WEBHOOK_URL: 'https://hooks.ejemplo.test/tok-en-la-ruta-no-real' });
    expect(redact('fallo en https://hooks.ejemplo.test/tok-en-la-ruta-no-real')).not.toContain('tok-en-la-ruta');
    expect(redact(`firma con ${SECRETO}`)).not.toContain(SECRETO);
  });
});

describe('ejemplo en Python de la documentación (T5.3)', () => {
  const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
  it.skipIf(!python)('verifica una firma generada por el canal', () => {
    const cuerpo = JSON.stringify(cuerpoWebhook(lote(['A-1-COT26']), AHORA));
    const t = 1_791_500_000;
    const cabecera = firmar(cuerpo, SECRETO, t);
    const programa = `${bloque('python')}\nimport sys\nok = firma_valida(sys.stdin.buffer.read(), ${JSON.stringify(cabecera)}, ${JSON.stringify(SECRETO)}, ${t})\nmalo = firma_valida(b"x", ${JSON.stringify(cabecera)}, ${JSON.stringify(SECRETO)}, ${t})\nprint(ok, malo)`;
    const r = spawnSync(python!, ['-c', programa], { input: cuerpo, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('True False');
  });
});

describe('notificar (fase 7)', () => {
  it('envía un cuerpo compra_agil.estado firmado', async () => {
    expect(await canal().notificar({ clave: 'ceguera', evento: 'ceguera', titulo: 'Ciega', lineas: ['x'] }, AHORA)).toEqual({ ok: true });
    const r = recibidos.at(-1)!;
    expect(JSON.parse(r.cuerpo)).toMatchObject({ tipo: 'compra_agil.estado', evento: 'ceguera' });
    expect(String(r.cabeceras['x-compra-agil-firma'])).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });
});
