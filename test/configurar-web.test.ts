import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { iniciarFormulario } from '../src/cli/configurar-web.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';

/**
 * Formulario local de secretos (anexo RA6): el agente lo abre, el usuario
 * pega el ticket y el token en su navegador, y nada de eso pasa por el chat.
 */
const TICKET = 'TICKET-DE-PRUEBA-NO-REAL-0000';
const TOKEN = '123456789:AAprueba-no-real-TOKEN-formulario';

async function formulario() {
  const rutaEnv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'form-')), '.env');
  fs.writeFileSync(rutaEnv, 'LOG_LEVEL=info\n');
  const f = await iniciarFormulario({
    rutaEnv,
    abrir: () => undefined,
    correo: {
      resolverMx: async () => [{ exchange: 'aspmx.l.google.com' }],
      verificar: async (_p, _u, clave) => { if (clave !== 'abcdefghijklmnop') throw new Error('535 Invalid login: Username and Password not accepted'); },
    },
    crearApi: (t) => ({ buscarFresco: async () => { if (t !== TICKET) throw new CompraAgilApiError(401, [], 'GET'); return { items: [], paginacion: { total_resultados: 1, total_paginas: 1, numero_pagina: 1, tamano_pagina: 10 } } as never; } }),
  });
  const u = new URL(f.url);
  const enviar = (campos: Record<string, string>, extra: { token?: string; origin?: string } = {}) => fetch(`${u.origin}/guardar?t=${extra.token ?? u.searchParams.get('t')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(extra.origin ? { origin: extra.origin } : {}) },
    body: new URLSearchParams(campos).toString(),
  });
  return { f, u, rutaEnv, enviar };
}

describe('--configurar-web', () => {
  it('escucha solo en 127.0.0.1 y sin el token de un solo uso no responde el formulario', async () => {
    const { f, u } = await formulario();
    expect(u.hostname).toBe('127.0.0.1');
    expect((await fetch(`${u.origin}/`)).status).toBe(403);
    expect((await fetch(`${u.origin}/?t=otro`)).status).toBe(403);
    const pagina = await fetch(f.url);
    expect(pagina.status).toBe(200);
    expect(await pagina.text()).toMatch(/type="password"/);
    f.cerrar();
  });

  it('rechaza una petición desde otra página (Origin ajeno)', async () => {
    const { f, enviar, rutaEnv } = await formulario();
    expect((await enviar({ ticket: TICKET }, { origin: 'https://sitio-malicioso.test' })).status).toBe(403);
    expect(fs.readFileSync(rutaEnv, 'utf8')).toBe('LOG_LEVEL=info\n');
    f.cerrar();
  });

  it('un ticket que no funciona no se guarda, y la respuesta no lo repite', async () => {
    const { f, enviar, rutaEnv } = await formulario();
    const r = await enviar({ ticket: 'TICKET-EQUIVOCADO-NO-REAL-9999' });
    expect(r.status).toBe(400);
    const html = await r.text();
    expect(html).toMatch(/no funcionó/);
    expect(html).not.toContain('TICKET-EQUIVOCADO-NO-REAL-9999');
    expect(fs.readFileSync(rutaEnv, 'utf8')).toBe('LOG_LEVEL=info\n');
    f.cerrar();
  });

  it('con datos válidos guarda el .env (con respaldo), no devuelve los secretos y se cierra', async () => {
    const { f, enviar, rutaEnv } = await formulario();
    const r = await enviar({ ticket: TICKET, telegram: TOKEN });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toMatch(/Guardado/);
    expect(html).not.toContain(TICKET);
    expect(html).not.toContain(TOKEN);
    expect(await f.listo).toBe(true);
    const env = fs.readFileSync(rutaEnv, 'utf8');
    expect(env).toContain(`COMPRA_AGIL_TICKET=${TICKET}`);
    expect(env).toContain(`COMPRA_AGIL_TELEGRAM_TOKEN=${TOKEN}`);
    expect(env).toContain('LOG_LEVEL=info');
    expect(fs.readFileSync(`${rutaEnv}.respaldo`, 'utf8')).toBe('LOG_LEVEL=info\n');
  });

  it('un token de bot con forma inválida se rechaza', async () => {
    const { f, enviar } = await formulario();
    expect((await enviar({ ticket: TICKET, telegram: 'no-es-un-token' })).status).toBe(400);
    f.cerrar();
  });

  it('vence sin guardar', async () => {
    const rutaEnv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'form-')), '.env');
    const f = await iniciarFormulario({ rutaEnv, abrir: () => undefined, vigenciaMs: 50 });
    expect(await f.listo).toBe(false);
    expect(fs.existsSync(rutaEnv)).toBe(false);
  });
});

describe('--configurar-web: correo con dos datos', () => {
  it('Gmail con contraseña de aplicación (con espacios): queda en el .env, sin espacios, y la página no la repite', async () => {
    const { f, enviar, rutaEnv } = await formulario();
    const r = await enviar({ ticket: TICKET, correo: 'ana@gmail.com', correo_clave: 'abcd efgh ijkl mnop' });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toMatch(/correo \(Gmail\) entró bien/);
    expect(html).not.toMatch(/abcd/);
    const env = fs.readFileSync(rutaEnv, 'utf8');
    expect(env).toMatch(/^COMPRA_AGIL_CORREO=ana@gmail\.com$/m);
    expect(env).toMatch(/^COMPRA_AGIL_CORREO_CLAVE=abcdefghijklmnop$/m);
    expect(env).not.toMatch(/SMTP_HOST/);
    f.cerrar();
  });

  it('la contraseña de siempre (rechazada) no guarda nada y explica qué crear', async () => {
    const { f, enviar, rutaEnv } = await formulario();
    const r = await enviar({ ticket: TICKET, correo: 'ana@gmail.com', correo_clave: 'MiClaveDeSiempre' });
    expect(r.status).toBe(400);
    const html = await r.text();
    expect(html).toMatch(/contraseña de aplicación/);
    expect(html).not.toContain('MiClaveDeSiempre');
    expect(fs.readFileSync(rutaEnv, 'utf8')).toBe('LOG_LEVEL=info\n');
    f.cerrar();
  });

  it('dominio propio con Google Workspace: escribe el servidor encontrado por MX', async () => {
    const { f, enviar, rutaEnv } = await formulario();
    expect((await enviar({ ticket: TICKET, correo: 'ventas@empresa.cl', correo_clave: 'abcdefghijklmnop' })).status).toBe(200);
    expect(fs.readFileSync(rutaEnv, 'utf8')).toMatch(/^COMPRA_AGIL_SMTP_HOST=smtp\.gmail\.com$/m);
    f.cerrar();
  });

  it('Hotmail: lo rechaza explicando por qué', async () => {
    const { f, enviar } = await formulario();
    const r = await enviar({ ticket: TICKET, correo: 'ana@hotmail.com', correo_clave: 'x' });
    expect(r.status).toBe(400);
    expect(await r.text()).toMatch(/OAuth/);
    f.cerrar();
  });
});
