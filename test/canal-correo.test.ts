import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CanalCorreo } from '../src/avisos/canales/correo.js';
import { leerConfigAvisos } from '../src/avisos/config.js';
import { redact } from '../src/utils/redact.js';
import type { LoteDeAvisos } from '../src/avisos/canal.js';
import type { Alerta } from '../src/avisos/mensaje.js';
import { iniciarSmtpFalso } from './ayudas/smtp-falso.js';

/**
 * Canal de correo por SMTP con nodemailer (T6.2 de la 2.9.0; R7, ADR 0025),
 * contra un servidor SMTP en proceso. TLS es obligatorio salvo hacia la propia
 * máquina, como el webhook.
 */
const CLAVE = 'clave-smtp-de-prueba-no-real';
const AHORA = Date.parse('2026-10-07T22:00:00Z');
let smtp: Awaited<ReturnType<typeof iniciarSmtpFalso>>;

beforeAll(async () => { smtp = await iniciarSmtpFalso({ usuario: 'avisos@oficina.test', clave: CLAVE }); });
afterAll(async () => { await smtp.cerrar(); });
beforeEach(() => { smtp.recibidos.length = 0; });

const alerta = (codigo: string): Alerta => ({
  codigo, nombre: '<b>Resmas</b> tamaño oficio', organismo: 'Juzgado', region: 'Metropolitana', presupuestoClp: 300_000,
  cierreHoraChile: '2026-10-09 12:00', cierreUtc: '2026-10-09T15:00:00.000Z', coincidencia: 'resma',
  ficha: `https://buscador.mercadopublico.cl/ficha?code=${codigo}`, creada: AHORA,
});
const lote = (codigos: string[]): LoteDeAvisos => ({
  id: 'l1', canal: 'correo', resumenDeSilencio: false,
  avisos: codigos.map((c, i) => ({ id: `a${i}`, canal: 'correo', alerta: alerta(c), estado: 'pendiente', intentos: 0, proximoIntento: AHORA, creado: AHORA })),
});
const canal = (clave = CLAVE) => new CanalCorreo({
  host: '127.0.0.1', puerto: smtp.puerto, usuario: 'avisos@oficina.test', clave, de: 'avisos@oficina.test', para: ['jefa@oficina.test', 'compras@oficina.test'],
});

describe('CanalCorreo', () => {
  it('entrega a todos los destinatarios, con asunto, texto y HTML', async () => {
    expect(await canal().enviar(lote(['765973-8-COT26']), AHORA)).toEqual({ ok: true });
    const [m] = smtp.recibidos;
    expect(m.para.join(' ')).toMatch(/jefa@oficina\.test[\s\S]*compras@oficina\.test/);
    expect(m.datos).toMatch(/Subject: =\?UTF-8\?|Subject: 1 oportunidad/);
    expect(m.datos).toContain('765973-8-COT26');
    expect(m.datos).toMatch(/text\/html/);
  });

  it('credenciales rechazadas: permanente, sin la clave en el motivo (R7.3)', async () => {
    const r = await canal('clave-equivocada-no-real-xx').enviar(lote(['A']), AHORA);
    expect(r).toMatchObject({ ok: false, tipo: 'permanente' });
    expect(JSON.stringify(r)).not.toContain('clave-equivocada');
  });

  it('4xx de SMTP transitorio, 5xx permanente', async () => {
    smtp.programar('451 4.3.0 intente más tarde');
    expect(await canal().enviar(lote(['A']), AHORA)).toMatchObject({ ok: false, tipo: 'transitorio' });
    smtp.programar('550 5.7.1 rechazado por política');
    expect(await canal().enviar(lote(['A']), AHORA)).toMatchObject({ ok: false, tipo: 'permanente' });
  });

  it('servidor caído: transitorio', async () => {
    const caido = new CanalCorreo({ host: '127.0.0.1', puerto: 9, usuario: 'u@o.test', clave: CLAVE, de: 'u@o.test', para: ['x@o.test'] });
    expect(await caido.enviar(lote(['A']), AHORA)).toMatchObject({ ok: false, tipo: 'transitorio' });
  });

  it('probar envía un correo de prueba', async () => {
    expect(await canal().probar(AHORA)).toEqual({ ok: true });
    expect(smtp.recibidos[0].datos).toMatch(/[Pp]rueba/);
  });
});

describe('configuración del correo', () => {
  const base = {
    COMPRA_AGIL_AVISOS: 'correo', COMPRA_AGIL_SMTP_HOST: 'smtp.gmail.com', COMPRA_AGIL_SMTP_USUARIO: 'avisos@oficina.test',
    COMPRA_AGIL_SMTP_CLAVE: CLAVE, COMPRA_AGIL_CORREO_PARA: 'jefa@oficina.test, compras@oficina.test',
  };

  it('completo: activo, puerto 587 por defecto y remitente = usuario', () => {
    const c = leerConfigAvisos(base);
    expect(c.canales).toEqual(['correo']);
    expect(c.correo).toMatchObject({ host: 'smtp.gmail.com', puerto: 587, de: 'avisos@oficina.test', para: ['jefa@oficina.test', 'compras@oficina.test'] });
  });

  it('faltan variables o un destinatario no es un correo: no se activa y se dice cuál', () => {
    const c = leerConfigAvisos({ ...base, COMPRA_AGIL_SMTP_CLAVE: '', COMPRA_AGIL_CORREO_PARA: 'jefa@oficina.test, no-es-correo' });
    expect(c.canales).toEqual([]);
    expect(c.errores.join(' ')).toMatch(/COMPRA_AGIL_SMTP_CLAVE/);
    expect(c.errores.join(' ')).toMatch(/no-es-correo/);
  });

  it('la clave queda registrada para la redacción', () => {
    leerConfigAvisos(base);
    expect(redact(`login con ${CLAVE}`)).not.toContain(CLAVE);
  });
});
