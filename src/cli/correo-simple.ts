/**
 * Configurar el correo con dos datos (pedido del dueño, 8-oct): la dirección
 * y una contraseña de aplicación. Lo usan `--configurar` y `--configurar-web`.
 *
 * Detecta el proveedor (dominio conocido, o los MX de un dominio propio),
 * comprueba que la contraseña entra al servidor, y devuelve las variables que
 * hay que escribir en el `.env`. Nunca devuelve ni muestra la contraseña.
 */

import nodemailer from 'nodemailer';
import { CORREO_VALIDO as CORREO, detectarProveedor, esNoSoportado, limpiarClaveDeAplicacion, proveedorPorDominio, type ProveedorCorreo } from '../avisos/proveedores-correo.js';
import { registrarSecreto, safeError } from '../utils/redact.js';


export interface DependenciasCorreo {
  resolverMx?: (dominio: string) => Promise<Array<{ exchange: string }>>;
  /** Entra al servidor SMTP con esos datos y sale. Lanza si no se puede. */
  verificar?: (p: ProveedorCorreo, usuario: string, clave: string) => Promise<void>;
}

async function verificarSmtp(p: ProveedorCorreo, usuario: string, clave: string): Promise<void> {
  const t = nodemailer.createTransport({
    host: p.host, port: p.puerto, secure: p.puerto === 465, requireTLS: p.puerto !== 465,
    auth: { user: usuario, pass: clave }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
  });
  try {
    await t.verify();
  } finally {
    t.close();
  }
}

export type ResultadoCorreo =
  | { ok: true; cambios: Record<string, string>; proveedor: string; advertencia?: string }
  | { ok: false; mensaje: string };

export async function prepararCorreo(direccion: string, claveEscrita: string, d: DependenciasCorreo = {}): Promise<ResultadoCorreo> {
  const correo = direccion.trim();
  const clave = limpiarClaveDeAplicacion(claveEscrita);
  registrarSecreto(claveEscrita.trim());
  registrarSecreto(clave);
  if (!CORREO.test(correo)) return { ok: false, mensaje: 'La dirección de correo no es válida.' };
  if (!clave) return { ok: false, mensaje: 'Falta la contraseña de aplicación del correo.' };
  const p = await detectarProveedor(correo, d.resolverMx);
  if (esNoSoportado(p)) return { ok: false, mensaje: p.noSoportado };
  if (!p) {
    return { ok: false, mensaje: `No reconozco el servidor de correo de «${correo.split('@')[1]}». Usa una cuenta de Gmail, Yahoo o iCloud, o pídele a quien administra ese correo el servidor SMTP y agrégalo en el .env (COMPRA_AGIL_SMTP_HOST y COMPRA_AGIL_SMTP_PUERTO).` };
  }
  try {
    await (d.verificar ?? verificarSmtp)(p, correo, clave);
  } catch (e) {
    const texto = safeError(e);
    const auth = /EAUTH|535|534|Invalid login|Username and Password not accepted|authentication/i.test(texto);
    return {
      ok: false,
      mensaje: auth
        ? `${p.nombre} no aceptó la contraseña. Tiene que ser una contraseña de aplicación, no la de siempre. ${p.ayudaClave}`
        : `No pude conectarme a ${p.nombre} (${texto.slice(0, 120)}). Revisa tu conexión e inténtalo de nuevo.`,
    };
  }
  const cambios: Record<string, string> = { COMPRA_AGIL_CORREO: correo, COMPRA_AGIL_CORREO_CLAVE: clave };
  // Un dominio propio se reconoció por sus MX: el servidor queda escrito, porque
  // en tiempo de ejecución no se consulta el DNS.
  if (!proveedorPorDominio(correo)) {
    cambios.COMPRA_AGIL_SMTP_HOST = p.host;
    cambios.COMPRA_AGIL_SMTP_PUERTO = String(p.puerto);
  }
  return { ok: true, cambios, proveedor: p.nombre, ...(p.advertencia ? { advertencia: p.advertencia } : {}) };
}
