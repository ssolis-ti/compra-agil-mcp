/**
 * Tool: obtener_estadisticas_uso
 *
 * Obtiene las estadísticas de uso diarias y el estado actual de rate limit
 * para la API de Compra Ágil de Mercado Público.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';

const TOOL_NAME = 'obtener_estadisticas_uso';
const TOOL_DESCRIPTION = `Informa cuántas consultas a la API lleva hecha esta instalación en el día UTC en curso, y si ya se recibió un 429 por cuota agotada.
IMPORTANTE: es un conteo LOCAL, no el saldo oficial del ticket. La API no publica cuánta cuota queda, y el ticket puede estar siendo consumido también por otras herramientas o equipos. Sirve para moderar el gasto, no para afirmar cuántas consultas quedan.`;

export function registerEstadisticasUso(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Estado de la cuota de la API",
      description: TOOL_DESCRIPTION,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const stats = client.getRateLimitStats();
      const salida = {
        _alcance: 'Conteo local de esta instalación para el día UTC en curso. La API no expone el saldo real del ticket; si otras herramientas usan el mismo ticket, el consumo real es mayor que este número.',
        requests_hechos_hoy: stats.requestsToday,
        cuota_agotada: stats.isLimited,
        reset_estimado: stats.resetTime,
        _nota: stats.isLimited
          ? 'Se recibió un 429: la cuota diaria del ticket está agotada hasta el reset indicado. Evita nuevas consultas hasta entonces.'
          : 'No se ha recibido ningún 429 en esta jornada. Eso NO garantiza que quede cuota: solo que esta instalación aún no ha chocado con el límite.',
      };
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(salida, null, 2),
        }],
      };
    }
  );
}
