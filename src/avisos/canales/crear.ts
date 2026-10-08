/**
 * Canales activos a partir de la configuración del entorno. Lo usan el daemon,
 * las herramientas del servidor y el CLI, para que los tres armen lo mismo.
 */

import type { Canal } from '../canal.js';
import type { ConfigAvisos } from '../config.js';
import { CanalTelegram } from './telegram.js';
import { CanalWebhook } from './webhook.js';
import { CanalCorreo } from './correo.js';

export function crearCanales(c: ConfigAvisos): Canal[] {
  const canales: Canal[] = [];
  if (c.telegram) canales.push(new CanalTelegram(c.telegram));
  if (c.webhook) canales.push(new CanalWebhook(c.webhook));
  if (c.correo) canales.push(new CanalCorreo(c.correo));
  return canales;
}
