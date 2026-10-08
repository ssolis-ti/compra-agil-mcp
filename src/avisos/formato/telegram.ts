/**
 * Mensajes de Telegram (2.9.0; R4.1, R4.3, R5.1).
 *
 * `parse_mode: HTML`: solo hay que escapar `&`, `<` y `>` del texto de
 * terceros (MarkdownV2 exige escapar 18 caracteres). Se usan únicamente las
 * etiquetas `<b>`, `<i>`, `<a href>` y `<code>`.
 */

import type { LoteDeAvisos } from '../canal.js';
import { esDeLaRegion, fechaCorta, horasRestantes, pesos, rubroPrimero, type Alerta } from '../mensaje.js';

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

/** Una línea por proceso: la alerta total de la región puede traer decenas. */
function linea(a: Alerta, ahoraMs: number): string {
  const h = horasRestantes(a, ahoraMs);
  const plazo = h === null ? '' : h < 0 ? ' (ya cerró)' : ` (en ${h} h)`;
  return `• <a href="${escaparHtmlTelegram(a.ficha)}">${escaparHtmlTelegram(a.nombre)}</a> · ` +
    `${escaparHtmlTelegram(a.organismo)} · ${pesos(a.presupuestoClp)} · cierra ${fechaCorta(a.cierreHoraChile)}${plazo}`;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function titulo(lote: LoteDeAvisos, rubro: number, region: number): string {
  const n = rubro + region;
  if (lote.resumenDeSilencio) return `<b>${plural(n, 'proceso publicado', 'procesos publicados')} durante el horario de silencio</b>`;
  if (region === 0) return `<b>${n} proceso${n === 1 ? ' nuevo calza' : 's nuevos calzan'} con tus criterios</b>`;
  if (rubro === 0) return `<b>${plural(region, 'compra nueva', 'compras nuevas')} en tu región</b>`;
  return `<b>${plural(rubro, 'de tu rubro', 'de tu rubro')} y ${plural(region, 'compra más', 'compras más')} en tu región</b>`;
}

/**
 * Uno o más mensajes, cada uno ≤ 4.096 caracteres, sin partir un proceso.
 * Las del rubro van primero y completas; las que entraron solo por la alerta
 * total de la región, después y en una línea.
 */
export function formatearTelegram(lote: LoteDeAvisos, ahoraMs: number): string[] {
  const avisos = rubroPrimero(lote.avisos);
  const rubro = avisos.filter((a) => !esDeLaRegion(a.alerta)).length;
  const region = avisos.length - rubro;
  const pie = '<i>Confirma plazo y requisitos en la ficha antes de cotizar.</i>';
  const mensajes: string[] = [];
  let actual = titulo(lote, rubro, region);
  const agregar = (texto: string, separador: string) => {
    if ((actual + separador + texto + '\n\n' + pie).length > LIMITE_TELEGRAM) {
      mensajes.push(actual);
      actual = '<i>(continuación)</i>';
      separador = '\n\n';
    }
    actual += separador + texto;
  };
  avisos.forEach((aviso, i) => {
    if (!esDeLaRegion(aviso.alerta)) {
      agregar((rubro > 0 && region > 0 && i === 0 ? '🎯 <b>De tu rubro</b>\n\n' : '') + bloque(aviso.alerta, ahoraMs), '\n\n');
    } else if (i === rubro) {
      agregar((rubro > 0 ? '📍 <b>Otras en tu región</b>\n' : '') + linea(aviso.alerta, ahoraMs), '\n\n');
    } else {
      agregar(linea(aviso.alerta, ahoraMs), '\n');
    }
  });
  mensajes.push(actual + '\n\n' + pie);
  return mensajes;
}
