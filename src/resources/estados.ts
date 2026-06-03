/**
 * Resource: compra-agil://estados
 *
 * Catálogo de estados válidos de una Compra Ágil con descripciones
 * y notas sobre comportamiento real de la API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const ESTADOS = [
  {
    codigo: 'publicada',
    descripcion: 'La Compra Ágil está abierta y recibiendo cotizaciones de proveedores.',
    nota: null,
  },
  {
    codigo: 'cerrada',
    descripcion: 'El plazo de cotización finalizó. El organismo está evaluando las ofertas.',
    nota: null,
  },
  {
    codigo: 'desierta',
    descripcion: 'No se recibieron ofertas válidas para este proceso.',
    nota: null,
  },
  {
    codigo: 'cancelada',
    descripcion: 'El proceso fue cancelado por el organismo comprador.',
    nota: 'El motivo de cancelación está disponible en el campo motivos.motivo_cancelacion del detalle.',
  },
  {
    codigo: 'proveedor_seleccionado',
    descripcion: 'Se seleccionó al proveedor ganador. INCLUYE también las Compras Ágiles que ya tienen OC emitida.',
    nota: 'Este estado agrupa tanto los procesos con proveedor elegido como los que ya tienen Orden de Compra. Para distinguirlos, usa la herramienta "verificar_orden_compra".',
  },
  {
    codigo: 'oc_emitida',
    descripcion: 'Se emitió una Orden de Compra (definido en el modelo de la API).',
    nota: '⚠ LIMITACIÓN CONOCIDA: Este estado NO aparece en la práctica en las respuestas de la API. Los procesos con OC emitida se listan bajo "proveedor_seleccionado". Usa la herramienta "verificar_orden_compra" para detectar si un proceso tiene OC real.',
  },
];

export function registerEstadosResource(server: McpServer): void {
  server.registerResource(
    'estados',
    'compra-agil://estados',
    {
      description: 'Catálogo de estados válidos de una Compra Ágil con descripciones y notas sobre limitaciones conocidas de la API. Consulta este recurso antes de filtrar por estado para entender qué significa cada valor.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'compra-agil://estados',
        mimeType: 'application/json',
        text: JSON.stringify(ESTADOS, null, 2),
      }],
    })
  );
}
