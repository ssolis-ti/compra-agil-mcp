/**
 * Shell del documento: envuelve el cuerpo de un template en un HTML
 * autocontenido y portable (CSS inline, sin recursos externos).
 *
 * Autocontenido a propósito: el informe debe poder moverse por correo o abrirse
 * sin red y verse idéntico. Nada de CDNs ni fuentes remotas.
 */

import { baseCSS, PAPEL, FORMATO_POR_DEFECTO, type FormatoPapel } from './theme.js';
import { esc } from './components.js';

export interface DocumentoOpts {
  titulo: string;
  cuerpo: string;
  /** Tamaño de papel. Por defecto Carta (estándar de oficina en Chile). */
  formato?: FormatoPapel;
  /** CSS adicional específico del template. */
  cssExtra?: string;
}

export function renderDocumento(o: DocumentoOpts): string {
  const formato = o.formato ?? FORMATO_POR_DEFECTO;
  return `<!DOCTYPE html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.titulo)}</title>
<meta name="generator" content="mcp-compra-agil">
<meta name="formato-papel" content="${esc(PAPEL[formato].glosa)}">
<style>
${baseCSS(formato)}
${o.cssExtra ?? ''}
</style>
</head>
<body>
${o.cuerpo}
</body>
</html>`;
}
