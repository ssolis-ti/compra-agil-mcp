/**
 * Servidor SMTP mínimo en proceso para probar el canal de correo (fase 6 de
 * la 2.9.0), sin red ni cuenta real. Entiende EHLO, AUTH PLAIN/LOGIN, MAIL,
 * RCPT, DATA y QUIT. `programar` fija la respuesta de MAIL FROM (por ejemplo
 * 451 transitorio o 550 permanente) para los envíos siguientes.
 */
import net from 'net';

export interface CorreoRecibido { de: string; para: string[]; datos: string }

export async function iniciarSmtpFalso(credenciales: { usuario: string; clave: string }) {
  const recibidos: CorreoRecibido[] = [];
  const respuestasMail: string[] = [];
  const servidor = net.createServer((s) => {
    let buffer = '';
    let enDatos = false;
    let actual: CorreoRecibido = { de: '', para: [], datos: '' };
    let esperandoLogin: 'usuario' | 'clave' | null = null;
    let usuarioLogin = '';
    const responder = (l: string) => s.write(`${l}\r\n`);
    responder('220 smtp-falso listo');
    s.on('data', (d) => {
      buffer += d.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const linea = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (enDatos) {
          if (linea === '.') {
            enDatos = false;
            recibidos.push(actual);
            actual = { de: '', para: [], datos: '' };
            responder('250 encolado');
          } else actual.datos += `${linea}\n`;
          continue;
        }
        if (esperandoLogin === 'usuario') { usuarioLogin = Buffer.from(linea, 'base64').toString(); esperandoLogin = 'clave'; responder('334 UGFzc3dvcmQ6'); continue; }
        if (esperandoLogin === 'clave') {
          esperandoLogin = null;
          const ok = usuarioLogin === credenciales.usuario && Buffer.from(linea, 'base64').toString() === credenciales.clave;
          responder(ok ? '235 autenticado' : '535 credenciales rechazadas');
          continue;
        }
        const [cmd, ...resto] = linea.split(' ');
        switch (cmd.toUpperCase()) {
          case 'EHLO': case 'HELO':
            s.write('250-smtp-falso\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
            break;
          case 'AUTH': {
            if (resto[0]?.toUpperCase() === 'LOGIN') { esperandoLogin = 'usuario'; responder('334 VXNlcm5hbWU6'); break; }
            const [, u, c] = Buffer.from(resto[1] ?? '', 'base64').toString().split('\0');
            responder(u === credenciales.usuario && c === credenciales.clave ? '235 autenticado' : '535 credenciales rechazadas');
            break;
          }
          case 'MAIL': {
            const r = respuestasMail.shift();
            if (r) { responder(r); break; }
            actual.de = linea;
            responder('250 OK');
            break;
          }
          case 'RCPT': actual.para.push(linea); responder('250 OK'); break;
          case 'DATA': enDatos = true; responder('354 adelante'); break;
          case 'RSET': actual = { de: '', para: [], datos: '' }; responder('250 OK'); break;
          case 'QUIT': responder('221 adiós'); s.end(); break;
          default: responder('502 no implementado');
        }
      }
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  return {
    puerto: (servidor.address() as net.AddressInfo).port,
    recibidos,
    programar: (...respuestas: string[]) => { respuestasMail.push(...respuestas); },
    cerrar: () => new Promise<void>((r) => servidor.close(() => r())),
  };
}
