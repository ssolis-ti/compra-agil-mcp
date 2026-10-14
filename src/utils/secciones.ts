/**
 * Tramos de un documento alrededor de un término (2.9.3, MEJORA-001).
 *
 * Antes se devolvía la línea que coincidía, más una antes y una después: en un
 * TDR, buscar «admisibilidad» traía el encabezado de la tabla y no los
 * requisitos. Ahora cada coincidencia trae lo que sigue hasta el próximo
 * encabezado numerado (I., II., 3.…), dentro de un presupuesto de caracteres.
 */

/** Sin tildes ni mayúsculas, conservando el largo: las posiciones sirven en el texto original. */
const plano = (s: string) => Array.from(s, (c) => c.normalize('NFD')[0]?.toLowerCase() ?? c).join('');

/**
 * Línea que abre una sección: «IV. Requisitos», «II) Objetivo». Solo numerales
 * romanos: los «1.», «2.» suelen ser los ítems de la misma sección (la lista de
 * requisitos de admisibilidad, en el TDR medido).
 */
const ENCABEZADO = /^[ \t]*[IVXL]{1,6}[.)][ \t]+\S/m;

export interface Tramo { desde: number; hasta: number; texto: string }

export function tramosConTermino(texto: string, termino: string, presupuesto: number): Tramo[] {
  const buscado = plano(termino.trim());
  if (!buscado) return [];
  const base = plano(texto);
  const posiciones: number[] = [];
  for (let i = base.indexOf(buscado); i >= 0; i = base.indexOf(buscado, i + buscado.length)) posiciones.push(i);
  if (posiciones.length === 0) return [];

  // Cada tramo empieza en la línea anterior a la coincidencia y sigue hasta el
  // próximo encabezado. En orden y hasta agotar el presupuesto: mejor una
  // sección entera que varias cortadas a la mitad.
  const crudos = posiciones.map((p) => {
    const inicioLinea = texto.lastIndexOf('\n', p - 1) + 1;
    const desde = Math.max(0, texto.lastIndexOf('\n', inicioLinea - 2) + 1);
    const finLinea = texto.indexOf('\n', p);
    const resto = finLinea < 0 ? '' : texto.slice(finLinea + 1);
    const siguiente = resto.search(ENCABEZADO);
    const finSeccion = siguiente < 0 ? texto.length : finLinea + 1 + siguiente;
    return { desde, hasta: Math.min(finSeccion, texto.length) };
  });

  // Los que se pisan se juntan; después, el presupuesto total.
  const tramos: Tramo[] = [];
  let usados = 0;
  for (const t of crudos.sort((a, b) => a.desde - b.desde)) {
    const ultimo = tramos.at(-1);
    if (ultimo && t.desde <= ultimo.hasta) {
      ultimo.hasta = Math.max(ultimo.hasta, t.hasta);
      continue;
    }
    tramos.push({ ...t, texto: '' });
  }
  const salida: Tramo[] = [];
  for (const t of tramos) {
    if (usados >= presupuesto) break;
    const hasta = Math.min(t.hasta, t.desde + (presupuesto - usados));
    salida.push({ desde: t.desde, hasta, texto: texto.slice(t.desde, hasta).trim() });
    usados += hasta - t.desde;
  }
  return salida;
}
