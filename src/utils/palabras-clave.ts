/**
 * Filtro local por palabras clave sobre el nombre de los procesos.
 *
 * Lo comparten `buscar_compras_agiles` (donde nació) y las herramientas que
 * buscan procesos comparables: análisis de precios, auditoría y borrador.
 *
 * ⚠ E7 (enjambre contra la API real, 6-oct): la búsqueda de texto de la API es
 *   amplia. «guantes nitrilo» trajo «Actividad de futbol recreativo y bienestar
 *   funcionario» y guantes térmicos de panadería, y el análisis de precios no
 *   tenía cómo excluirlos: la muestra mezclaba productos. El filtro se aplica
 *   sobre el listado ANTES de pedir los detalles, así que no gasta cuota extra.
 *
 * Semántica (la misma que tenía la búsqueda): requeridas = todas deben estar
 * (Y lógico); excluidas = basta una para descartar (O lógico). Insensible a
 * mayúsculas y a tildes: «camion» encuentra «camión».
 */

import { z } from 'zod';
import { normalizar } from './doc-search.js';

export interface FiltroPalabras {
  palabras_clave_requeridas?: string;
  palabras_clave_excluidas?: string;
}

const lista = (texto?: string) =>
  (texto ?? '').split(',').map((t) => normalizar(t.trim())).filter(Boolean);

export function hayFiltroDePalabras(f: FiltroPalabras = {}): boolean {
  return lista(f.palabras_clave_requeridas).length > 0 || lista(f.palabras_clave_excluidas).length > 0;
}

export function filtrarPorPalabras<T extends { nombre?: string | null }>(
  items: T[],
  f: FiltroPalabras = {},
): { items: T[]; descartados: number } {
  const requeridas = lista(f.palabras_clave_requeridas);
  const excluidas = lista(f.palabras_clave_excluidas);
  if (requeridas.length === 0 && excluidas.length === 0) return { items, descartados: 0 };
  const quedan = items.filter((item) => {
    const nombre = normalizar(item.nombre ?? '');
    return requeridas.every((p) => nombre.includes(p)) && !excluidas.some((p) => nombre.includes(p));
  });
  return { items: quedan, descartados: items.length - quedan.length };
}

/** Parámetros para las herramientas que buscan procesos comparables. */
export function esquemaPalabrasComparables() {
  return {
    palabras_clave_requeridas: z.string().optional().describe(
      'Palabras separadas por coma que DEBEN estar en el nombre de cada proceso comparable (ej: "nitrilo"). Se aplican sobre el listado antes de pedir los detalles: no gastan cuota extra y evitan mezclar productos distintos.',
    ),
    palabras_clave_excluidas: z.string().optional().describe(
      'Palabras separadas por coma que NO deben estar en el nombre de los comparables (ej: "termico,panaderia"). Mismo funcionamiento que las requeridas.',
    ),
  };
}

/** Texto para cuando el filtro deja la muestra vacía: no es escasez del rubro. */
export function textoSinCoincidencias(total: number, f: FiltroPalabras): string {
  const partes = [
    f.palabras_clave_requeridas ? `requeridas «${f.palabras_clave_requeridas}»` : '',
    f.palabras_clave_excluidas ? `excluidas «${f.palabras_clave_excluidas}»` : '',
  ].filter(Boolean).join(' y ');
  return `La API devolvió ${total} proceso(s), pero ninguno pasa el filtro de palabras clave (${partes}). No se pidió ningún detalle. Afloja el filtro o cambia el término de búsqueda.`;
}
