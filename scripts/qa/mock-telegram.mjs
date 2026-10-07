/**
 * Bot API de Telegram simulada (fase 4 de la 2.9.0), para probar el canal sin
 * bot real ni red.
 *
 * Como módulo:  const t = await iniciarMockTelegram();  t.url, t.recibidos,
 *               t.programar([{ status: 429, retry_after: 3 }, ...]), t.cerrar()
 * Como script:  node scripts/qa/mock-telegram.mjs   (puerto 8766 o PORT)
 *
 * Rutas: POST /bot<token>/sendMessage y GET /bot<token>/getUpdates. Un token
 * distinto de `token` responde 401, como la API real. Las respuestas
 * programadas se consumen en orden; después, todo responde ok.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export async function iniciarMockTelegram({ puerto = 0, token = '123456789:AAprueba-no-real-TOKEN-telegram' } = {}) {
  const recibidos = [];
  const programadas = [];
  const actualizaciones = [];
  const responder = (res, status, cuerpo) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  };
  const servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; });
    req.on('end', () => {
      const m = req.url.match(/^\/bot([^/]+)\/(\w+)/);
      if (!m) return responder(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
      if (m[1] !== token) return responder(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
      if (m[2] === 'getUpdates') return responder(res, 200, { ok: true, result: actualizaciones });
      if (m[2] !== 'sendMessage') return responder(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
      const mensaje = JSON.parse(cuerpo || '{}');
      const p = programadas.shift();
      if (p && p.status !== 200) {
        return responder(res, p.status, {
          ok: false, error_code: p.status, description: p.description ?? `Error ${p.status}`,
          ...(p.retry_after ? { parameters: { retry_after: p.retry_after } } : {}),
        });
      }
      recibidos.push({ ...mensaje, recibido: Date.now() });
      responder(res, 200, { ok: true, result: { message_id: recibidos.length, chat: { id: mensaje.chat_id }, text: mensaje.text } });
    });
  });
  await new Promise((r) => servidor.listen(puerto, '127.0.0.1', r));
  const { port } = servidor.address();
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    recibidos,
    programar: (lista) => { programadas.push(...lista); },
    /** Simula que alguien le escribió al bot desde un chat. */
    mensajeAlBot: (chat) => { actualizaciones.push({ update_id: actualizaciones.length + 1, message: { message_id: 1, chat, text: 'hola' } }); },
    cerrar: () => new Promise((r) => servidor.close(r)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = await iniciarMockTelegram({ puerto: Number(process.env.PORT || 8766) });
  console.error(`Bot API simulada en ${t.url} (token de prueba: ${t.token})`);
}
