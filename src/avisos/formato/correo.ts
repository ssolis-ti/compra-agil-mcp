/**
 * Correo de aviso (2.9.0; R4.3, R7.1, R7.2).
 *
 * El asunto no lleva texto de terceros: solo la cantidad, la palabra clave del
 * dueño y el cierre más próximo, en una línea (evita la inyección de
 * cabeceras). El cuerpo va en texto plano y en HTML simple, escapado.
 */

import type { LoteDeAvisos } from '../canal.js';
import { esDeLaRegion, fechaCorta, horasRestantes, pesos, rubroPrimero, type Alerta } from '../mensaje.js';

export interface Correo { asunto: string; texto: string; html: string }

const escaparHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const unaLinea = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function formatearCorreo(lote: LoteDeAvisos, ahoraMs: number): Correo {
  // Las del rubro primero: la alerta total de la región va después, con su título.
  const alertas = rubroPrimero(lote.avisos).map((a) => a.alerta);
  const primeraDeRegion = alertas.findIndex(esDeLaRegion);
  const titulo = (i: number) => (i === primeraDeRegion && i > 0 ? 'Otras compras en tu región:' : null);
  const n = alertas.length;
  const proximo = [...alertas].filter((a) => a.cierreUtc).sort((x, y) => Date.parse(x.cierreUtc!) - Date.parse(y.cierreUtc!))[0];
  const asunto = unaLinea(`${n} oportunidad${n === 1 ? '' : 'es'}: ${alertas[0]?.coincidencia ?? ''}` +
    (proximo ? ` — cierra ${fechaCorta(proximo.cierreHoraChile)}` : ''));
  const intro = lote.resumenDeSilencio
    ? `Procesos publicados durante el horario de silencio (${n}):`
    : `${n} proceso${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} calza${n === 1 ? '' : 'n'} con tus criterios:`;
  const linea = (a: Alerta) => {
    const h = horasRestantes(a, ahoraMs);
    return `${a.codigo} · ${a.organismo} · ${a.region} · ${pesos(a.presupuestoClp)} · cierra ${fechaCorta(a.cierreHoraChile)}` +
      `${h === null ? '' : h < 0 ? ' (ya cerró)' : ` (en ${h} h)`} · «${a.coincidencia}»`;
  };
  const texto = [
    intro, '',
    ...alertas.flatMap((a, i) => [...(titulo(i) ? [titulo(i)!, ''] : []), a.nombre, linea(a), a.ficha, '']),
    'Confirma plazo y requisitos en la ficha antes de cotizar.',
    'Avisos de mcp-compra-agil: para dejar de recibirlos, quita «correo» de COMPRA_AGIL_AVISOS en el .env.',
  ].join('\n');
  const html = [
    `<p>${escaparHtml(intro)}</p>`,
    ...alertas.map((a, i) => (titulo(i) ? `<h3>${escaparHtml(titulo(i)!)}</h3>\n` : '') +
      `<p><b>${escaparHtml(a.nombre)}</b><br>${escaparHtml(linea(a))}<br>` +
      `<a href="${escaparHtml(a.ficha)}">Ver ficha</a></p>`),
    '<p><i>Confirma plazo y requisitos en la ficha antes de cotizar.</i></p>',
  ].join('\n');
  return { asunto, texto, html };
}
