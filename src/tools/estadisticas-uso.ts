/**
 * Tool: obtener_estadisticas_uso
 *
 * Obtiene las estadísticas de uso diarias y el estado actual de rate limit
 * para la API de Compra Ágil de Mercado Público.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { resumenMetricas } from '../utils/metricas.js';

const TOOL_NAME = 'obtener_estadisticas_uso';
const TOOL_DESCRIPTION = `Informa cuántas consultas a la API lleva hecha esta instalación en el día UTC en curso, y si ya se recibió un 429 por cuota agotada.
IMPORTANTE: es un conteo LOCAL, no el saldo oficial del ticket. La API no publica cuánta cuota queda, y el ticket puede estar siendo consumido también por otras herramientas o equipos. Sirve para moderar el gasto, no para afirmar cuántas consultas quedan.
También informa, desde que arrancó este proceso, la latencia y los errores de cada herramienta y el resultado de las consultas a la API (caché, 504, 429, timeouts): úsalo para saber si la API está lenta o caída antes de lanzar un análisis largo.`;

export function cuerpoEstadisticas(stats: { requestsToday: number; isLimited: boolean; resetTime: string | null }): Record<string, unknown> {
  return {
    _alcance: 'Conteo local de esta instalación para el día UTC en curso, compartido por todos los procesos que usan el mismo archivo de estado. La API no expone el saldo real del ticket.',
    dia_utc: new Date().toISOString().slice(0, 10),
    requests_hechos_hoy: stats.requestsToday,
    cuota_agotada: stats.isLimited,
    vio_rechazo_temporal: stats.isLimited,
    reset_estimado: stats.resetTime,
    reset_estimado_nota: stats.resetTime
      ? 'Hora en que esta instalación volverá a intentar después de un 429. No es la medianoche ni el saldo oficial.'
      : 'null porque esta instalación no ha visto un 429 en el día UTC en curso.',
    _nota: stats.isLimited
      ? 'Se recibió un 429. Es un token bucket que se recarga solo, no un bloqueo hasta el día siguiente, salvo que el 429 dure horas. Espera hasta reset_estimado. vio_rechazo_temporal dice lo mismo que cuota_agotada: esta instalación lo vio, no es el saldo del ticket.'
      : 'No se ha recibido ningún 429 en este día UTC. El número lo mueven todos los procesos de esta instalación. No es el saldo del ticket. vio_rechazo_temporal es false por eso, no porque el ticket tenga saldo.',
  };
}

export function registerEstadisticasUso(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Conteo local del día UTC",
      description: TOOL_DESCRIPTION,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const stats = client.getRateLimitStats();
      const salida = { ...cuerpoEstadisticas(stats), metricas: resumenMetricas() };
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(salida, null, 2),
        }],
      };
    }
  );
}
