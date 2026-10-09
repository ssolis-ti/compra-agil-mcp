import { describe, it, expect } from 'vitest';
import { leerConfigAvisos } from '../src/avisos/config.js';
import { detectarProveedor, esNoSoportado, limpiarClaveDeAplicacion, proveedorPorDominio, proveedorPorMx } from '../src/avisos/proveedores-correo.js';
import { redact } from '../src/utils/redact.js';

/**
 * Correo simple (pedido del dueño, 8-oct): la dirección y una contraseña de
 * aplicación bastan; el servidor se deduce del dominio.
 */
const CLAVE = 'abcd efgh ijkl mnop';

describe('proveedores de correo', () => {
  it('Gmail, Yahoo e iCloud por el dominio', () => {
    expect(proveedorPorDominio('Ana@Gmail.com')).toMatchObject({ host: 'smtp.gmail.com', puerto: 587 });
    expect(proveedorPorDominio('ana@yahoo.com')).toMatchObject({ host: 'smtp.mail.yahoo.com', puerto: 465 });
    expect(proveedorPorDominio('ana@icloud.com')).toMatchObject({ host: 'smtp.mail.me.com' });
  });

  it('Outlook y Hotmail personales: no soportados, con el porqué', () => {
    const p = proveedorPorDominio('ana@hotmail.com');
    expect(esNoSoportado(p)).toBe(true);
    expect(esNoSoportado(p) && p.noSoportado).toMatch(/OAuth/);
  });

  it('un dominio propio se reconoce por sus MX (Google Workspace, Microsoft 365) o queda desconocido', async () => {
    expect(proveedorPorMx(['aspmx.l.google.com'])).toMatchObject({ nombre: 'Google Workspace', host: 'smtp.gmail.com' });
    expect(proveedorPorMx(['empresa-cl.mail.protection.outlook.com'])).toMatchObject({ host: 'smtp.office365.com' });
    expect(proveedorPorMx(['mx.hosting.cl'])).toBeNull();
    expect(await detectarProveedor('ventas@empresa.cl', async () => [{ exchange: 'ALT1.ASPMX.L.GOOGLE.COM' }])).toMatchObject({ host: 'smtp.gmail.com' });
    expect(await detectarProveedor('ventas@empresa.cl', async () => { throw new Error('sin DNS'); })).toBeNull();
  });

  it('la contraseña de aplicación pierde los espacios con que se muestra', () => {
    expect(limpiarClaveDeAplicacion(CLAVE)).toBe('abcdefghijklmnop');
  });
});

describe('configuración simple', () => {
  it('con Gmail, dirección y clave bastan: se activa solo, a la misma dirección', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_CORREO: 'ana@gmail.com', COMPRA_AGIL_CORREO_CLAVE: CLAVE });
    expect(c.errores).toEqual([]);
    expect(c.canales).toEqual(['correo']);
    expect(c.correo).toEqual({ host: 'smtp.gmail.com', puerto: 587, usuario: 'ana@gmail.com', clave: 'abcdefghijklmnop', de: 'ana@gmail.com', para: ['ana@gmail.com'] });
  });

  it('la clave, con o sin espacios, no aparece en ningún texto', () => {
    leerConfigAvisos({ COMPRA_AGIL_CORREO: 'ana@gmail.com', COMPRA_AGIL_CORREO_CLAVE: CLAVE });
    expect(redact(`clave ${CLAVE} y ${limpiarClaveDeAplicacion(CLAVE)}`)).not.toMatch(/abcd/);
  });

  it('destinatarios distintos con COMPRA_AGIL_CORREO_PARA', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_CORREO: 'ana@gmail.com', COMPRA_AGIL_CORREO_CLAVE: CLAVE, COMPRA_AGIL_CORREO_PARA: 'jefa@oficina.cl, ana@gmail.com' });
    expect(c.correo?.para).toEqual(['jefa@oficina.cl', 'ana@gmail.com']);
  });

  it('Hotmail: no se activa y dice por qué y qué usar', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_CORREO: 'ana@hotmail.com', COMPRA_AGIL_CORREO_CLAVE: CLAVE });
    expect(c.canales).toEqual([]);
    expect(c.errores.join(' ')).toMatch(/OAuth.*Gmail/);
  });

  it('dominio propio sin servidor: pide COMPRA_AGIL_SMTP_HOST o --configurar', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_CORREO: 'ventas@empresa.cl', COMPRA_AGIL_CORREO_CLAVE: CLAVE });
    expect(c.canales).toEqual([]);
    expect(c.errores.join(' ')).toMatch(/empresa\.cl.*COMPRA_AGIL_SMTP_HOST.*--configurar/);
  });

  it('sin clave: dice dónde crear la contraseña de aplicación', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_AVISOS: 'correo', COMPRA_AGIL_CORREO: 'ana@gmail.com' });
    expect(c.errores.join(' ')).toMatch(/COMPRA_AGIL_CORREO_CLAVE.*apppasswords/);
  });

  it('campos vacíos de la extensión («${user_config.x}» sin reemplazar) cuentan como vacíos', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_CORREO: '${user_config.correo}', COMPRA_AGIL_CORREO_CLAVE: '${user_config.correo_clave}' });
    expect(c.canales).toEqual([]);
    expect(c.errores).toEqual([]);
  });

  it('las variables SMTP_* siguen mandando', () => {
    const c = leerConfigAvisos({
      COMPRA_AGIL_AVISOS: 'correo', COMPRA_AGIL_SMTP_HOST: 'smtp.oficina.test', COMPRA_AGIL_SMTP_PUERTO: '2525',
      COMPRA_AGIL_SMTP_USUARIO: 'avisos', COMPRA_AGIL_SMTP_CLAVE: 'x'.repeat(20), COMPRA_AGIL_SMTP_DE: 'avisos@oficina.test', COMPRA_AGIL_CORREO_PARA: 'jefa@oficina.test',
    });
    expect(c.errores).toEqual([]);
    expect(c.correo).toMatchObject({ host: 'smtp.oficina.test', puerto: 2525, usuario: 'avisos', para: ['jefa@oficina.test'] });
  });
});
