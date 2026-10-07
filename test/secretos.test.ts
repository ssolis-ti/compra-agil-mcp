import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { SECRETOS_DE_PRUEBA as S, secretosEn, textoDeCarpeta } from './ayudas/secretos.js';

/**
 * Ningún secreto sale por ningún camino (T1.3 de la 2.9.0; R4.2, R4.5).
 *
 * Arranca el servidor real en proceso contra la API simulada, con una carpeta
 * de datos temporal, y busca cada valor de prueba en:
 *   - las respuestas de las herramientas;
 *   - los logs del protocolo (`notifications/message`, llegan al modelo);
 *   - stderr (donde escribe el logger);
 *   - los archivos que el servidor deja en su carpeta de datos.
 *
 * Las fases siguientes agregan sus caminos: estado de la vigilancia (2),
 * avisos formateados (3), errores de cada canal (4–6), CLI (8).
 */

vi.mock('../src/utils/ntp.js', async (original) => ({
  ...(await original<typeof import('../src/utils/ntp.js')>()),
  consultarHoraOficial: async () => ({ ok: false, error: 'sin red en la prueba' }),
}));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'secretos-datos-'));
const salidas: string[] = [];
let cliente: Client;
const respaldoEntorno = { ...process.env };

async function puertoLibre(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const puerto = await puertoLibre();
  process.env.PORT = String(puerto);
  await import(pathToFileURL(path.join(RAIZ, 'scripts', 'qa', 'mock-api.mjs')).href);

  process.env.COMPRA_AGIL_DATA_DIR = datos;
  process.env.COMPRA_AGIL_TICKET = S.ticket;
  process.env.LOG_LEVEL = 'debug';

  const stderr = process.stderr.write.bind(process.stderr);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array, ...resto: unknown[]) => {
    salidas.push(String(chunk));
    return stderr(chunk as string, ...(resto as []));
  });

  const { registrarSecreto } = await import('../src/utils/redact.js');
  for (const v of Object.values(S)) registrarSecreto(v);

  const { CompraAgilClient } = await import('../src/api/compra-agil-client.js');
  const { crearServidor } = await import('../src/servidor.js');
  const api = new CompraAgilClient(S.ticket, `http://127.0.0.1:${puerto}`, { persistir: true });
  const { server } = crearServidor(api, '0.0.0-secretos');
  const [lado, otro] = InMemoryTransport.createLinkedPair();
  await server.connect(lado);
  cliente = new Client({ name: 'prueba-secretos', version: '1.0.0' });
  cliente.setNotificationHandler(LoggingMessageNotificationSchema, (n) => { salidas.push(JSON.stringify(n.params)); });
  await cliente.connect(otro);
  await cliente.setLoggingLevel('debug');
}, 60_000);

afterAll(async () => {
  await cliente?.close();
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (!(k in respaldoEntorno)) delete process.env[k];
  Object.assign(process.env, respaldoEntorno);
});

const llamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await cliente.callTool({ name, arguments: args });
  const texto = (r as { content: Array<{ text: string }> }).content.map((c) => c.text).join('\n');
  salidas.push(texto);
  return texto;
};

describe('ningún secreto sale del servidor', () => {
  it('por las respuestas, los logs del protocolo y stderr', async () => {
    await llamar('verificar_ticket');
    await llamar('buscar_compras_agiles', { q: 'resmas', estado: 'publicada' });
    await llamar('buscar_compras_agiles', { q: 'E504' });
    await llamar('obtener_detalle_compra', { codigo: 'NOEXISTE-1-COT26' });
    await llamar('monitorear_cambios_recientes', { minutos: 30 });
    await llamar('obtener_estadisticas_uso');
    // Error que trae los secretos dentro: la redacción es la última defensa.
    const { safeError } = await import('../src/utils/redact.js');
    salidas.push(safeError(new Error(`fallo en ${S.webhookUrl} con ${S.telegramToken} y ${S.smtpClave} ${S.webhookSecreto}`)));
    expect(salidas.length).toBeGreaterThan(5);
    expect(secretosEn(salidas.join('\n'))).toEqual([]);
  }, 60_000);

  it('por los archivos de la carpeta de datos (caché, cuota)', () => {
    const disco = textoDeCarpeta(datos);
    expect(disco.length).toBeGreaterThan(0);
    expect(secretosEn(disco)).toEqual([]);
  });

  it('control: la búsqueda encuentra un secreto cuando está', () => {
    expect(secretosEn(`x ${encodeURIComponent(S.webhookUrl)} y ${S.ticket}`)).toEqual(['ticket', 'webhookUrl']);
  });
});
