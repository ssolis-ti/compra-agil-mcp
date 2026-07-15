/**
 * Resource: compra-agil://compras/{codigo}
 *
 * Recurso dinámico que permite consultar la ficha detallada de una Compra Ágil
 * directamente mediante lectura de URI del protocolo MCP.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { safeError } from '../utils/redact.js';

export function registerComprasTemplateResource(server: McpServer, client: CompraAgilClient): void {
  // Crear plantilla de URI para compra-agil://compras/{codigo}
  const template = new ResourceTemplate('compra-agil://compras/{codigo}', {
    list: undefined, // No implementamos listado dinámico masivo para evitar saturar la cuota de la API
  });

  server.registerResource(
    'detalle-compra-dinamica',
    template,
    {
      description: 'Obtiene el detalle completo de un proceso de Compra Ágil por su código único (formato XXXXXX-YYY-COTXX) en formato JSON estructurado.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      try {
        const codigo = variables.codigo as string;
        if (!codigo) {
          throw new Error('El parámetro "codigo" es requerido en la URI.');
        }

        const detalle = await client.detalle(codigo);
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(detalle, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : `Error al leer recurso de Compra Ágil: ${safeError(error)}`;
        throw new Error(message);
      }
    }
  );
}
