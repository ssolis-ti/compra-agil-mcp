/**
 * Canal de correo por SMTP, con nodemailer (2.9.0; R7, ADR 0025).
 *
 * TLS obligatorio: implícito en el puerto 465, STARTTLS exigido en los demás.
 * Solo hacia la propia máquina (pruebas) se permite sin TLS, como el webhook.
 * Pensado para el resumen diario y los avisos de fallo; también puede llevar
 * cada alerta.
 *
 * Errores: credenciales rechazadas (EAUTH) y respuestas 5xx del servidor son
 * permanentes; 4xx y la red, transitorios. La clave se registra para la
 * redacción y ningún motivo la incluye.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { registrarSecreto, safeError } from '../../utils/redact.js';
import type { Canal, LoteDeAvisos, ResultadoEnvio } from '../canal.js';
import { formatearCorreo } from '../formato/correo.js';

export interface OpcionesCorreo {
  host: string;
  puerto: number;
  usuario: string;
  clave: string;
  de: string;
  para: string[];
}

const LOCALES = ['localhost', '127.0.0.1', '::1'];

/** Lo que trae un error de nodemailer: `code` (EAUTH, ECONNECTION…) y el código SMTP de la respuesta. */
function clasificar(e: unknown): ResultadoEnvio {
  const err = e as { code?: string; responseCode?: number };
  const motivo = safeError(e).slice(0, 200);
  if (err.code === 'EAUTH') return { ok: false, tipo: 'permanente', motivo: `Credenciales SMTP rechazadas: ${motivo}` };
  if (typeof err.responseCode === 'number') {
    return { ok: false, tipo: err.responseCode >= 500 ? 'permanente' : 'transitorio', motivo };
  }
  return { ok: false, tipo: 'transitorio', motivo };
}

export class CanalCorreo implements Canal {
  readonly nombre = 'correo' as const;
  private readonly transporte: Transporter;

  constructor(private readonly o: OpcionesCorreo) {
    registrarSecreto(o.clave);
    const local = LOCALES.includes(o.host);
    this.transporte = nodemailer.createTransport({
      host: o.host,
      port: o.puerto,
      secure: o.puerto === 465,
      requireTLS: !local && o.puerto !== 465,
      ignoreTLS: local,
      auth: { user: o.usuario, pass: o.clave },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  private async mandar(asunto: string, texto: string, html: string): Promise<ResultadoEnvio> {
    try {
      await this.transporte.sendMail({ from: this.o.de, to: this.o.para, subject: asunto, text: texto, html });
      return { ok: true };
    } catch (e) {
      return clasificar(e);
    }
  }

  enviar(lote: LoteDeAvisos, ahoraMs: number): Promise<ResultadoEnvio> {
    const c = formatearCorreo(lote, ahoraMs);
    return this.mandar(c.asunto, c.texto, c.html);
  }

  probar(): Promise<ResultadoEnvio> {
    const texto = 'Prueba de mcp-compra-agil: esta casilla recibirá los avisos de la vigilancia de Compra Ágil.';
    return this.mandar('Prueba de avisos de mcp-compra-agil', texto, `<p>${texto}</p>`);
  }
}
