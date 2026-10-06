/**
 * Texto que el servidor entrega en el initialize MCP.
 * Llega al agente aunque no abra el README.
 */
export const INSTRUCCIONES = [
  'Servidor de la API pública Compra Ágil v2 de Mercado Público (Chile).',
  'El ticket vive en la variable COMPRA_AGIL_TICKET. No lo muestres, no lo pegues en el chat y no lo escribas en archivos del repositorio.',
  'La API no publica qué oferta ganó. motivo_seleccion y proveedor_seleccionado no prueban una adjudicación. No declares un ganador.',
  'Una búsqueda necesita estado, región, texto, id o fechas de publicación. Sin eso no se llama a la API. El tamaño de página mínimo es 10. Pedir páginas grandes suele cortar la llamada con HTTP 504. Un detalle por código que corte con 504 no se reintenta en ráfaga.',
  'Las fechas de la API están en hora de Chile, aunque fecha_ultimo_cambio traiga "Z"; los campos *_hora_chile ya las muestran bien. El plazo se confirma en la ficha pública.',
  'Los adjuntos de Compra Ágil no se descargan por la API. Entrega la ficha pública.',
  'verificar_orden_compra no demuestra que no exista una orden de compra.',
  'obtener_estadisticas_uso es el conteo local de esta instalación, no el saldo del ticket.',
  'generar_informe escribe un HTML en disco y devuelve la ruta. No lo envía a Mercado Público.',
  'Si una respuesta indica 429, espera y reintenta. No insistas en ráfaga.',
].join('\n');
