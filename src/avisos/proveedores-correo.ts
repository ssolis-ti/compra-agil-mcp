/**
 * Proveedores de correo conocidos (2.9.0, pedido del dueño del 8-oct): que
 * activar los avisos por correo sea escribir la dirección y una contraseña de
 * aplicación, sin saber qué es SMTP.
 *
 * El servidor se deduce del dominio. Para un dominio propio (una empresa con
 * Google Workspace o Microsoft 365), los asistentes de configuración miran
 * los registros MX y escriben el servidor en el `.env`; en tiempo de
 * ejecución no se consulta el DNS.
 *
 * Medido el 9-oct-2026:
 * - Gmail, Yahoo e iCloud aceptan contraseñas de aplicación por SMTP.
 * - Outlook.com, Hotmail y Live (cuentas personales) ya no aceptan contraseña:
 *   exigen OAuth. No se ofrecen, y se dice por qué.
 * - Microsoft 365 de empresa depende de que el administrador permita SMTP AUTH.
 */

import { promises as dns } from 'dns';

/** Una dirección de correo, sin espacios ni comas (las comas separan destinatarios). */
export const CORREO_VALIDO = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export interface ProveedorCorreo {
  nombre: string;
  host: string;
  puerto: number;
  /** Dónde se crea la contraseña de aplicación, para los asistentes y los errores. */
  ayudaClave: string;
  /** Advertencia que se muestra al configurar (no impide usarlo). */
  advertencia?: string;
}

export interface ProveedorNoSoportado {
  nombre: string;
  noSoportado: string;
}

const GMAIL: ProveedorCorreo = {
  nombre: 'Gmail', host: 'smtp.gmail.com', puerto: 587,
  ayudaClave: 'En tu cuenta de Google: Seguridad → Verificación en dos pasos (actívala) → Contraseñas de aplicación (https://myaccount.google.com/apppasswords). Crea una y copia los 16 caracteres.',
};
const MICROSOFT_365: ProveedorCorreo = {
  nombre: 'Microsoft 365', host: 'smtp.office365.com', puerto: 587,
  ayudaClave: 'Usa la contraseña de tu cuenta o una contraseña de aplicación, según lo permita tu organización.',
  advertencia: 'Microsoft 365 solo permite enviar si el administrador de tu organización habilitó «SMTP AUTH». Si la prueba falla, pídeselo o usa una cuenta de Gmail.',
};
const OUTLOOK_PERSONAL: ProveedorNoSoportado = {
  nombre: 'Outlook / Hotmail',
  noSoportado: 'Outlook.com, Hotmail y Live ya no permiten enviar correos con contraseña desde otros programas (Microsoft exige OAuth). Usa una cuenta de Gmail, Yahoo o iCloud para los avisos; pueden llegar igual a tu Outlook poniéndolo como destinatario.',
};

const POR_DOMINIO: Record<string, ProveedorCorreo | ProveedorNoSoportado> = {
  'gmail.com': GMAIL,
  'googlemail.com': GMAIL,
  'yahoo.com': { nombre: 'Yahoo', host: 'smtp.mail.yahoo.com', puerto: 465, ayudaClave: 'En Yahoo: Información de la cuenta → Seguridad de la cuenta → Generar contraseña de aplicación.' },
  'yahoo.es': { nombre: 'Yahoo', host: 'smtp.mail.yahoo.com', puerto: 465, ayudaClave: 'En Yahoo: Información de la cuenta → Seguridad de la cuenta → Generar contraseña de aplicación.' },
  'icloud.com': { nombre: 'iCloud', host: 'smtp.mail.me.com', puerto: 587, ayudaClave: 'En https://account.apple.com: Inicio de sesión y seguridad → Contraseñas específicas de apps.' },
  'me.com': { nombre: 'iCloud', host: 'smtp.mail.me.com', puerto: 587, ayudaClave: 'En https://account.apple.com: Inicio de sesión y seguridad → Contraseñas específicas de apps.' },
  'zoho.com': { nombre: 'Zoho', host: 'smtp.zoho.com', puerto: 587, ayudaClave: 'En Zoho Mail: Configuración → Seguridad → Contraseñas específicas de la aplicación.' },
  'gmx.com': { nombre: 'GMX', host: 'mail.gmx.com', puerto: 587, ayudaClave: 'Activa POP3/IMAP en la configuración de GMX y usa tu contraseña.' },
  'outlook.com': OUTLOOK_PERSONAL,
  'outlook.es': OUTLOOK_PERSONAL,
  'hotmail.com': OUTLOOK_PERSONAL,
  'hotmail.es': OUTLOOK_PERSONAL,
  'live.com': OUTLOOK_PERSONAL,
  'live.cl': OUTLOOK_PERSONAL,
  'msn.com': OUTLOOK_PERSONAL,
};

export const esNoSoportado = (p: ProveedorCorreo | ProveedorNoSoportado | null): p is ProveedorNoSoportado =>
  p !== null && 'noSoportado' in p;

const dominioDe = (correo: string) => correo.trim().toLowerCase().split('@')[1] ?? '';

/** Por el dominio de la dirección, sin red. `null`: dominio propio o desconocido. */
export function proveedorPorDominio(correo: string): ProveedorCorreo | ProveedorNoSoportado | null {
  return POR_DOMINIO[dominioDe(correo)] ?? null;
}

/** Por los registros MX de un dominio propio: Google Workspace o Microsoft 365. */
export function proveedorPorMx(intercambios: string[]): ProveedorCorreo | null {
  const mx = intercambios.map((h) => h.toLowerCase());
  if (mx.some((h) => h.endsWith('google.com') || h.endsWith('googlemail.com'))) return { ...GMAIL, nombre: 'Google Workspace' };
  if (mx.some((h) => h.endsWith('.protection.outlook.com') || h.endsWith('.outlook.com'))) return MICROSOFT_365;
  return null;
}

/** Para los asistentes: dominio conocido, y si no, sus registros MX. */
export async function detectarProveedor(
  correo: string,
  resolverMx: (dominio: string) => Promise<Array<{ exchange: string }>> = (d) => dns.resolveMx(d),
): Promise<ProveedorCorreo | ProveedorNoSoportado | null> {
  const conocido = proveedorPorDominio(correo);
  if (conocido) return conocido;
  try {
    return proveedorPorMx((await resolverMx(dominioDe(correo))).map((r) => r.exchange));
  } catch {
    return null;
  }
}

/**
 * Las contraseñas de aplicación se muestran en grupos («abcd efgh ijkl
 * mnop»): quien las copia trae los espacios, que no son parte de la clave.
 */
export const limpiarClaveDeAplicacion = (clave: string) => clave.replace(/\s+/g, '');
