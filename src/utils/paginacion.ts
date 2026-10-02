/**
 * Tamaño de página que no agota la pasarela. Es también el mínimo de la API.
 * Medido el 1 de octubre de 2026: publicada + región con 50 responde HTTP 504
 * a los ~30 s; con 10, la misma búsqueda respondió en unos 8 s.
 */
export const TAMANO_PAGINA_SEGURO = 10;

/**
 * Texto de página para el modelo.
 *
 * Con cero resultados la API responde numero_pagina=1 y total_paginas=0.
 * Copiar eso como "1 de 0" parece una página que existe.
 */
export function textoPagina(numeroPagina: number, totalPaginas: number): string {
  if (!(totalPaginas > 0)) return 'sin resultados en esta ventana';
  return `${numeroPagina} de ${totalPaginas}`;
}
