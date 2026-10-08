/**
 * Preferencias guardadas en la carpeta de datos (`.preferencias.json`; anexo de
 * instalación por agente, RA3–RA5): el chat de Telegram confirmado con código,
 * la verificación en curso y el modo de vigilancia elegido conversando.
 *
 * Existe porque una extensión de Claude Desktop no puede escribir en su propia
 * configuración: lo que el usuario decide en el chat tiene que quedar aquí. No
 * guarda secretos: el chat id no lo es, y el código de verificación se guarda
 * como hash.
 */

import { conBloqueo } from '../utils/bloqueo.js';
import { escribirAtomico, leerJsonSeguro } from '../utils/archivo-atomico.js';
import { leerConfigAvisos, type ConfigAvisos } from './config.js';

export type ModoVigilancia = 'con_claude' | 'siempre' | 'apagada';

export interface Preferencias {
  telegramChatId?: string;
  telegramChatNombre?: string;
  /** Verificación de un chat en curso: el código va solo como hash. */
  verificacion?: { hash: string; chatId: string; chatNombre: string; expira: number; intentos: number };
  vigilancia?: ModoVigilancia;
}

export function leerPreferencias(ruta: string): Preferencias {
  const p = leerJsonSeguro(ruta);
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Preferencias) : {};
}

export function actualizarPreferencias<T>(ruta: string, fn: (p: Preferencias) => T): T {
  return conBloqueo(ruta, () => {
    const p = leerPreferencias(ruta);
    const r = fn(p);
    escribirAtomico(ruta, JSON.stringify(p, null, 2));
    return r;
  });
}

/** La configuración de avisos del entorno, completada con el chat confirmado en el chat. */
export function configAvisosDelEquipo(env: Record<string, string | undefined>, rutaPreferencias: string): ConfigAvisos {
  return leerConfigAvisos(env, { telegramChatId: leerPreferencias(rutaPreferencias).telegramChatId });
}
