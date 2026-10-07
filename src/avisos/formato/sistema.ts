/**
 * Formato de las notificaciones del sistema para cada canal (2.9.0, fase 7).
 * El texto lo escribe el servidor, pero se escapa igual: puede citar un error
 * de la API o los criterios del dueño.
 */

import type { Notificacion } from '../notificacion.js';
import { escaparHtmlTelegram } from './telegram.js';

const ICONO: Record<Notificacion['evento'], string> = {
  ceguera: '⚠️', recuperacion: '✅', resumen: '📋', canal_caido: '⚠️', cuota: '⚠️', criterios: '🔧',
};

export function sistemaTelegram(n: Notificacion): string {
  return [`${ICONO[n.evento]} <b>${escaparHtmlTelegram(n.titulo)}</b>`, '', ...n.lineas.map(escaparHtmlTelegram)].join('\n');
}

export function sistemaCorreo(n: Notificacion): { asunto: string; texto: string; html: string } {
  const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return {
    asunto: `[mcp-compra-agil] ${n.titulo}`.replace(/[\r\n]+/g, ' '),
    texto: [n.titulo, '', ...n.lineas].join('\n'),
    html: [`<p><b>${escapar(n.titulo)}</b></p>`, ...n.lineas.map((l) => `<p>${escapar(l)}</p>`)].join('\n'),
  };
}

/** Cuerpo `compra_agil.estado` v1 del webhook (documentado en docs/api/webhook-alertas.md). */
export function sistemaWebhook(n: Notificacion, ahoraMs: number) {
  return {
    tipo: 'compra_agil.estado' as const,
    version: 1 as const,
    id: `${n.clave}@${new Date(ahoraMs).toISOString()}`,
    enviado_en: new Date(ahoraMs).toISOString(),
    evento: n.evento,
    titulo: n.titulo,
    lineas: n.lineas,
  };
}
