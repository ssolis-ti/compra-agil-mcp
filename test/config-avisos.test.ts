import { describe, it, expect } from 'vitest';
import { leerConfigAvisos } from '../src/avisos/config.js';
import { redact } from '../src/utils/redact.js';

/**
 * Configuración de los canales, solo desde el entorno (T4.1 de la 2.9.0;
 * R4.4, R4.5, ADR 0023). Los errores nombran la variable que falta, nunca su
 * valor, y cada secreto queda registrado para la redacción antes de cualquier log.
 */
const TOKEN = '987654321:AAotro-token-de-prueba-no-real';

describe('leerConfigAvisos', () => {
  it('sin COMPRA_AGIL_AVISOS no hay canales ni errores', () => {
    expect(leerConfigAvisos({})).toMatchObject({ canales: [], errores: [] });
  });

  it('Telegram completo: activo, y el token queda registrado para la redacción', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_AVISOS: 'telegram', COMPRA_AGIL_TELEGRAM_TOKEN: TOKEN, COMPRA_AGIL_TELEGRAM_CHAT_ID: '-100123' });
    expect(c.canales).toEqual(['telegram']);
    expect(c.telegram).toEqual({ token: TOKEN, chatId: '-100123' });
    expect(redact(`https://api.telegram.org/bot${TOKEN}/sendMessage`)).not.toContain(TOKEN);
  });

  it('un canal listado sin sus variables no se activa, y el error nombra la variable sin valores', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_AVISOS: 'telegram', COMPRA_AGIL_TELEGRAM_TOKEN: TOKEN });
    expect(c.canales).toEqual([]);
    expect(c.errores).toEqual([expect.stringMatching(/COMPRA_AGIL_TELEGRAM_CHAT_ID/)]);
    expect(c.errores.join(' ')).not.toContain(TOKEN);
  });

  it('un canal desconocido es un error; mayúsculas y espacios no importan', () => {
    const c = leerConfigAvisos({ COMPRA_AGIL_AVISOS: ' Telegram , whatsapp', COMPRA_AGIL_TELEGRAM_TOKEN: TOKEN, COMPRA_AGIL_TELEGRAM_CHAT_ID: '1' });
    expect(c.canales).toEqual(['telegram']);
    expect(c.errores).toEqual([expect.stringMatching(/whatsapp/)]);
  });

  it('horario de silencio y hora del resumen; un formato inválido es un error, no se adivina', () => {
    expect(leerConfigAvisos({ COMPRA_AGIL_AVISOS_SILENCIO: '22:00-07:00' }).bandeja.silencio).toEqual({ desde: '22:00', hasta: '07:00' });
    expect(leerConfigAvisos({}).resumen).toBe('08:00');
    const malo = leerConfigAvisos({ COMPRA_AGIL_AVISOS_SILENCIO: '22h a 7h', COMPRA_AGIL_AVISOS_RESUMEN: '25:00' });
    expect(malo.bandeja.silencio).toBeUndefined();
    expect(malo.errores).toHaveLength(2);
  });
});
