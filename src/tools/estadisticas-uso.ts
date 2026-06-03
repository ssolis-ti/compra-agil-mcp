/**
 * Tool: obtener_estadisticas_uso
 *
 * Obtiene las estadísticas de uso diarias y el estado actual de rate limit
 * para la API de Compra Ágil de Mercado Público.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';

const TOOL_NAME = 'obtener_estadisticas_uso';
const TOOL_DESCRIPTION = 'Obtiene las estadísticas de uso de la API y el estado actual de la cuota diaria (Rate Limiting). Útil para que el agente supervise cuántos requests quedan disponibles.';

export function registerEstadisticasUso(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
    },
    async () => {
      const stats = client.getRateLimitStats();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(stats, null, 2),
        }],
      };
    }
  );
}
