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
export function textoPagina(numeroPagina: number, totalPaginas: number, conVentana = false): string {
  // «en esta ventana» solo cuando la consulta tenía una ventana temporal (el
  // monitor). En una búsqueda sin ventana confundía al modelo (simulación 6-oct).
  if (!(totalPaginas > 0)) return conVentana ? 'sin resultados en esta ventana' : 'sin resultados para estos filtros';
  return `${numeroPagina} de ${totalPaginas}`;
}

/**
 * Números que ve el agente. La API manda 1 y 0 cuando no hay páginas;
 * ese par se lee como "1 de 0". Cero y cero no describen una página.
 */
export function numerosPaginaVisibles(numeroPagina: number, totalPaginas: number): { numero_pagina: number; total_paginas: number } {
  if (!(totalPaginas > 0)) return { numero_pagina: 0, total_paginas: 0 };
  return { numero_pagina: numeroPagina, total_paginas: totalPaginas };
}

/** Forma compartida por la búsqueda y el monitor. */
export function camposPagina(
  numeroPagina: number,
  totalPaginas: number,
  totalResultados: number,
  filtrados: number,
  conVentana = false,
): {
  total_resultados: number;
  total_filtrados_en_pagina: number;
  numero_pagina: number;
  total_paginas: number;
  pagina: string;
} {
  return {
    total_resultados: totalResultados,
    total_filtrados_en_pagina: filtrados,
    ...numerosPaginaVisibles(numeroPagina, totalPaginas),
    pagina: textoPagina(numeroPagina, totalPaginas, conVentana),
  };
}
