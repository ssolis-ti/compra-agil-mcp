/**
 * `mcp-compra-agil --configurar-web` (anexo de instalación por agente, RA6).
 *
 * Para el perfil intermedio (Claude Code, Cursor): el agente puede correr
 * comandos pero no escribir en una entrada oculta, y los secretos no deben
 * pasar por el chat. Este comando abre en el navegador un formulario servido
 * solo en la propia máquina (127.0.0.1) donde el usuario pega el ticket y el
 * token del bot. El agente solo ve «guardado» o «error».
 *
 * Defensas:
 * - escucha solo en 127.0.0.1;
 * - exige un token de un solo uso en la URL;
 * - rechaza Host u Origin ajenos, para que otra página abierta en el navegador
 *   no pueda escribirle;
 * - valida el ticket contra la API antes de guardar;
 * - nunca devuelve los valores;
 * - se cierra al guardar o a los 10 minutos.
 */

import http from 'http';
import fs from 'fs';
import { randomBytes, timingSafeEqual } from 'crypto';
import { spawn } from 'child_process';
import type { AddressInfo } from 'net';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { registrarSecreto, safeError } from '../utils/redact.js';
import { actualizarEnv } from './archivo-env.js';
import { prepararCorreo, type DependenciasCorreo } from './correo-simple.js';

export interface OpcionesFormulario {
  rutaEnv: string;
  crearApi?: (ticket: string) => Pick<CompraAgilClient, 'buscarFresco'>;
  /** Por defecto, 10 minutos. */
  vigenciaMs?: number;
  /** Abre el navegador; en las pruebas no se abre. */
  abrir?: (url: string) => void;
  /** Para las pruebas: DNS y verificación SMTP simulados. */
  correo?: DependenciasCorreo;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const PAGINA = (token: string, mensaje = '', ok = false) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configurar Compra Ágil</title>
<style>
body{font-family:system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;color:#1d1d1f;background:#fafafa}
h1{font-size:1.4rem}label{display:block;margin-top:1.2rem;font-weight:600}
input{width:100%;padding:.6rem;margin-top:.3rem;font-size:1rem;border:1px solid #bbb;border-radius:6px;box-sizing:border-box}
small{color:#555;display:block;margin-top:.3rem}button{margin-top:1.5rem;padding:.7rem 1.4rem;font-size:1rem;border:0;border-radius:6px;background:#0b6bcb;color:#fff;cursor:pointer}
.msg{padding:.8rem;border-radius:6px;margin-top:1rem}.ok{background:#e3f6e8}.error{background:#fde8e8}
</style></head><body>
<h1>Configurar los avisos de Compra Ágil</h1>
<p>Esta página está solo en tu computador. Lo que escribas aquí se guarda en tu equipo y no pasa por el chat con tu asistente.</p>
${mensaje ? `<div class="msg ${ok ? 'ok' : 'error'}">${esc(mensaje)}</div>` : ''}
${ok ? '<p>Ya puedes cerrar esta pestaña y volver a la conversación con tu asistente.</p>' : `
<form method="post" action="/guardar?t=${token}">
<label for="ticket">Ticket de Mercado Público</label>
<input id="ticket" name="ticket" type="password" autocomplete="off" required>
<small>Gratis en <a href="https://www.chilecompra.cl/api/" target="_blank" rel="noopener">chilecompra.cl/api</a> («Pide tu ticket», con Clave Única). Llega por correo.</small>
<label for="telegram">Token del bot de Telegram (opcional)</label>
<input id="telegram" name="telegram" type="password" autocomplete="off">
<small>En Telegram abre @BotFather, escribe /newbot y pega aquí el token que te da.</small>
<label for="correo">Tu correo para recibir avisos (opcional)</label>
<input id="correo" name="correo" type="email" autocomplete="email">
<small>Gmail, Yahoo, iCloud o el correo de tu empresa si usa Google o Microsoft 365. Outlook y Hotmail personales no sirven para enviar.</small>
<label for="correo_clave">Contraseña de aplicación del correo</label>
<input id="correo_clave" name="correo_clave" type="password" autocomplete="off">
<small>No es tu contraseña de siempre. En Gmail: activa la verificación en dos pasos y crea una en <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>; pega los 16 caracteres.</small>
<button type="submit">Guardar</button>
</form>`}
</body></html>`;

function abrirNavegador(url: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

/** Inicia el formulario. `listo` se resuelve con true al guardar, o false al vencer. */
export async function iniciarFormulario(o: OpcionesFormulario): Promise<{ url: string; listo: Promise<boolean>; cerrar(): void }> {
  const token = randomBytes(24).toString('hex');
  const tokenOk = (t: string | null) => {
    const a = Buffer.from(t ?? ''); const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const crearApi = o.crearApi ?? ((t: string) => new CompraAgilClient(t, process.env.COMPRA_AGIL_BASE_URL || undefined, { persistir: false }));
  let terminar: (ok: boolean) => void = () => undefined;
  const listo = new Promise<boolean>((r) => { terminar = r; });
  let puerto = 0;

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const responder = (codigo: number, html: string) => {
      res.writeHead(codigo, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
      res.end(html);
    };
    const hostOk = req.headers.host === `127.0.0.1:${puerto}`;
    const origen = req.headers.origin;
    if (!hostOk || !tokenOk(url.searchParams.get('t')) || (origen && origen !== `http://127.0.0.1:${puerto}`)) {
      return responder(403, '<p>Acceso no permitido.</p>');
    }
    if (req.method === 'GET' && url.pathname === '/') return responder(200, PAGINA(token));
    if (req.method !== 'POST' || url.pathname !== '/guardar') return responder(404, '<p>No encontrado.</p>');
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; if (cuerpo.length > 10_000) req.destroy(); });
    req.on('end', () => {
      void (async () => {
        const datos = new URLSearchParams(cuerpo);
        const ticket = datos.get('ticket')?.trim() ?? '';
        const telegram = datos.get('telegram')?.trim() ?? '';
        const correo = datos.get('correo')?.trim() ?? '';
        const correoClave = datos.get('correo_clave') ?? '';
        registrarSecreto(ticket); registrarSecreto(telegram); registrarSecreto(correoClave.trim());
        if (!ticket) return responder(400, PAGINA(token, 'Falta el ticket.'));
        if (telegram && !/^\d+:[\w-]{20,}$/.test(telegram)) return responder(400, PAGINA(token, 'El token del bot no tiene la forma que da @BotFather (números, dos puntos y letras).'));
        try {
          await crearApi(ticket).buscarFresco({ estado: 'publicada', tamano_pagina: 10, numero_pagina: 1 });
        } catch (e) {
          return responder(400, PAGINA(token, `El ticket no funcionó: ${safeError(e).slice(0, 160)}`));
        }
        let deCorreo: Record<string, string> = {};
        let notaCorreo = '';
        if (correo || correoClave.trim()) {
          const r = await prepararCorreo(correo, correoClave, o.correo);
          if (!r.ok) return responder(400, PAGINA(token, `Correo: ${r.mensaje}`));
          deCorreo = r.cambios;
          notaCorreo = `, el correo (${r.proveedor}) entró bien${r.advertencia ? ` (${r.advertencia})` : ''}`;
        }
        const anterior = fs.existsSync(o.rutaEnv) ? fs.readFileSync(o.rutaEnv, 'utf8') : '';
        if (anterior) fs.writeFileSync(`${o.rutaEnv}.respaldo`, anterior, 'utf8');
        const cambios: Record<string, string> = { COMPRA_AGIL_TICKET: ticket };
        if (telegram) cambios.COMPRA_AGIL_TELEGRAM_TOKEN = telegram;
        Object.assign(cambios, deCorreo);
        fs.writeFileSync(o.rutaEnv, actualizarEnv(anterior, cambios), { encoding: 'utf8', mode: 0o600 });
        responder(200, PAGINA(token, `Guardado. El ticket funciona${telegram ? ', el token del bot quedó registrado' : ''}${notaCorreo}.`, true));
        setTimeout(() => { servidor.close(); terminar(true); }, 300);
      })();
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  puerto = (servidor.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${puerto}/?t=${token}`;
  const vence = setTimeout(() => { servidor.close(); terminar(false); }, o.vigenciaMs ?? 10 * 60_000);
  vence.unref();
  void listo.then(() => clearTimeout(vence));
  (o.abrir ?? abrirNavegador)(url);
  return { url, listo, cerrar: () => { servidor.close(); terminar(false); } };
}

export async function comandoConfigurarWeb(rutaEnv: string, escribir: (l: string) => void): Promise<number> {
  const f = await iniciarFormulario({ rutaEnv });
  escribir('Abrí en tu navegador un formulario para el ticket y el token del bot (solo en este computador).');
  escribir(`Si no se abrió, copia esta dirección en el navegador: ${f.url}`);
  escribir('Esperando a que lo completes (hasta 10 minutos)…');
  const ok = await f.listo;
  escribir(ok ? '✔ Guardado. Vuelve a la conversación con tu asistente.' : '✘ El formulario venció sin guardar. Vuelve a correr --configurar-web.');
  return ok ? 0 : 1;
}
