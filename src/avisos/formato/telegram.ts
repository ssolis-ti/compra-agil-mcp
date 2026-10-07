/**
 * Mensajes de Telegram (2.9.0; R4.1, R4.3, R5.1).
 *
 * `parse_mode: HTML`: solo hay que escapar `&`, `<` y `>` del texto de
 * terceros (MarkdownV2 exige escapar 18 caracteres). Se usan únicamente las
 * etiquetas `<b>`, `<i>`, `<a href>` y `<code>`.
 */

import type { LoteDeAvisos } from '../canal.js';
import { fechaCorta, horasRestantes, pesos, type Alerta } from '../mensaje.js';

export const LIMITE_TELEGRAM = 4096;

export const escaparHtmlTelegram = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function bloque(a: Alerta, ahoraMs: number): string {
  const h = horasRestantes(a, ahoraMs);
  const plazo = h === null ? '' : h < 0 ? ' (ya cerró)' : ` (en ${h} h)`;
  return [
    `<b>${escaparHtmlTelegram(a.nombre)}</b>`,
    `<code>${escaparHtmlTelegram(a.codigo)}</code> · ${escaparHtmlTelegram(a.organismo)} · ${escaparHtmlTelegram(a.region)}`,
    `${pesos(a.presupuestoClp)} · cierra ${fechaCorta(a.cierreHoraChile)}${plazo} · «${escaparHtmlTelegram(a.coincidencia)}»`,
    `<a href="${escaparHtmlTelegram(a.ficha)}">Ver ficha</a>`,
  ].join('\n');
}

/** Uno o más mensajes, cada uno ≤ 4.096 caracteres, sin partir un proceso. */
export function formatearTelegram(lote: LoteDeAvisos, ahoraMs: number): string[] {
  const n = lote.avisos.length;
  const titulo = lote.resumenDeSilencio
    ? `<b>${n} proceso${n === 1 ? '' : 's'} publicado${n === 1 ? '' : 's'} durante el horario de silencio</b>`
    : `<b>${n} proceso${n === 1 ? ' nuevo calza' : 's nuevos calzan'} con tus criterios</b>`;
  const pie = '<i>Confirma plazo y requisitos en la ficha antes de cotizar.</i>';
  const mensajes: string[] = [];
  let actual = titulo;
  for (const aviso of lote.avisos) {
    const b = bloque(aviso.alerta, ahoraMs);
    if ((actual + '\n\n' + b + '\n\n' + pie).length > LIMITE_TELEGRAM) {
      mensajes.push(actual);
      actual = '<i>(continuación)</i>';
    }
    actual += '\n\n' + b;
  }
  mensajes.push(actual + '\n\n' + pie);
  return mensajes;
}
