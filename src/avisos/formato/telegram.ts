/**
 * Mensajes de Telegram (2.9.0; R4.1, R4.3, R5.1).
 *
 * `parse_mode: HTML`: solo hay que escapar `&`, `<` y `>` del texto de
 * terceros (MarkdownV2 exige escapar 18 caracteres). Se usan únicamente las
 * etiquetas `<b>`, `<i>`, `<a href>` y `<code>`.
 */

import type { LoteDeAvisos } from '../canal.js';
import { esDeLaRegion, fechaConDia, horasRestantes, palabraMostrable, pesos, porCierre, type Alerta } from '../mensaje.js';

export const LIMITE_TELEGRAM = 4096;

export const escaparHtmlTelegram = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plazo(a: Alerta, ahoraMs: number): string {
  const h = horasRestantes(a, ahoraMs);
  if (h === null) return '';
  if (h < 0) return ' (ya cerró)';
  return h < 24 ? ` (en ${h} h)` : ` (en ${Math.floor(h / 24)} d ${h % 24} h)`;
}

/**
 * Un proceso completo, una etiqueta por línea (pedido del dueño, 8-oct): en
 * el teléfono se lee de un vistazo qué es, de quién, cuánto y hasta cuándo.
 */
function bloque(a: Alerta, n: number, ahoraMs: number): string {
  const palabra = palabraMostrable(a);
  return [
    `<b>${n}. ${escaparHtmlTelegram(a.nombre)}</b>`,
    `🔖 Código: <code>${escaparHtmlTelegram(a.codigo)}</code>`,
    `🏛 Organismo: ${escaparHtmlTelegram(a.organismo)}`,
    `📍 Región: ${escaparHtmlTelegram(a.region)}`,
    `💰 Presupuesto: ${pesos(a.presupuestoClp)}`,
    ...(a.publicadaHoraChile ? [`🗓 Publicada: ${fechaConDia(a.publicadaHoraChile)}`] : []),
    `⏰ <b>Cierra: ${fechaConDia(a.cierreHoraChile)}</b>${plazo(a, ahoraMs)}`,
    ...(palabra ? [`🔎 Calza con: «${escaparHtmlTelegram(palabra)}»`] : []),
    `🔗 <a href="${escaparHtmlTelegram(a.ficha)}">Ver ficha</a>`,
  ].join('\n');
}

/** Dos líneas por proceso: la alerta total de la región puede traer decenas. */
function linea(a: Alerta, n: number, ahoraMs: number): string {
  return `${n}. <a href="${escaparHtmlTelegram(a.ficha)}">${escaparHtmlTelegram(a.nombre)}</a>\n` +
    `    🔖 <code>${escaparHtmlTelegram(a.codigo)}</code> · ⏰ ${fechaConDia(a.cierreHoraChile)}${plazo(a, ahoraMs)} · 💰 ${pesos(a.presupuestoClp)}`;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function titulo(lote: LoteDeAvisos, rubro: number, region: number): string {
  const n = rubro + region;
  if (lote.resumenDeSilencio) return `🌙 <b>${plural(n, 'compra publicada', 'compras publicadas')} durante el horario de silencio</b>`;
  if (region === 0) return `🆕 <b>${plural(n, 'compra nueva', 'compras nuevas')} que calza${n === 1 ? '' : 'n'} con tus criterios</b>`;
  if (rubro === 0) return `🆕 <b>${plural(region, 'compra nueva', 'compras nuevas')} en tu región</b>`;
  return `🆕 <b>${rubro} de tu rubro y ${plural(region, 'compra más', 'compras más')} en tu región</b>`;
}

export const SUBTITULO_TELEGRAM = '<i>Ordenadas por cierre, la más urgente primero. Horas de Chile.</i>';

/**
 * Uno o más mensajes, cada uno ≤ 4.096 caracteres, sin partir un proceso.
 * Las del rubro van primero y completas; las que entraron solo por la alerta
 * total de la región, después y en dos líneas. Dentro de cada grupo, por
 * cierre: lo que vence antes es lo primero que hay que mirar. La numeración
 * sigue de un grupo al otro y entre mensajes.
 */
export function formatearTelegram(lote: LoteDeAvisos, ahoraMs: number): string[] {
  const deRubro = porCierre(lote.avisos.filter((a) => !esDeLaRegion(a.alerta)));
  const deRegion = porCierre(lote.avisos.filter((a) => esDeLaRegion(a.alerta)));
  const pie = '<i>Confirma plazo y requisitos en la ficha antes de cotizar.</i>';
  const mensajes: string[] = [];
  let actual = `${titulo(lote, deRubro.length, deRegion.length)}\n${SUBTITULO_TELEGRAM}`;
  const agregar = (texto: string) => {
    if ((actual + '\n\n' + texto + '\n\n' + pie).length > LIMITE_TELEGRAM) {
      mensajes.push(actual);
      actual = '<i>(continuación)</i>';
    }
    actual += '\n\n' + texto;
  };
  const ambos = deRubro.length > 0 && deRegion.length > 0;
  deRubro.forEach((aviso, i) => {
    agregar((ambos && i === 0 ? '🎯 <b>De tu rubro</b>\n\n' : '') + bloque(aviso.alerta, i + 1, ahoraMs));
  });
  deRegion.forEach((aviso, i) => {
    agregar((ambos && i === 0 ? '📍 <b>Otras en tu región</b>\n\n' : '') + linea(aviso.alerta, deRubro.length + i + 1, ahoraMs));
  });
  mensajes.push(actual + '\n\n' + pie);
  return mensajes;
}
