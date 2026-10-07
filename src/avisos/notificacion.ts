/**
 * Notificaciones del sistema (2.9.0, fase 7): avisos sobre la vigilancia
 * misma, no sobre procesos. Ceguera, recuperación, resumen diario, un canal
 * caído, la cuota y los cambios de criterios (R2.2, R8).
 *
 * Las arma `vigilancia/salud.ts`; cada canal las formatea a su manera
 * (`formato/sistema.ts`). Su texto lo escribe el servidor, no un tercero.
 */

import type { NombreCanal } from './canal.js';

export type EventoSistema = 'ceguera' | 'recuperacion' | 'resumen' | 'canal_caido' | 'cuota' | 'criterios';

export interface Notificacion {
  /** Identifica la notificación para marcarla como hecha (ej. `resumen:2026-10-08`). */
  clave: string;
  evento: EventoSistema;
  titulo: string;
  lineas: string[];
  /** No se envía por este canal (el aviso de que ese canal está caído). */
  excluirCanal?: NombreCanal;
}
