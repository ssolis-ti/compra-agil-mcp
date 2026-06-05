/**
 * Tool: monitorear_cambios_recientes
 *
 * Detecta procesos de Compra Ágil que hayan sido creados o modificados
 * recientemente. Ideal para alertas y monitoreo de oportunidades.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';

const TOOL_NAME = 'monitorear_cambios_recientes';

const TOOL_DESCRIPTION = `Busca Compras Ágiles que hayan sido creadas o modificadas en los últimos N minutos.
Ideal para monitoreo de nuevas oportunidades de negocio y alertas en tiempo real.
Internamente convierte los minutos a milisegundos para el parámetro ttl_cambio_ms de la API.
Puede combinarse con filtros de estado y región para acotar los resultados.`;

const inputSchema = {
  minutos: z.number().min(1).max(1440).default(60).describe(
    'Buscar cambios en los últimos N minutos. Ej: 60 = última hora, 1440 = últimas 24 horas. Máximo 1440 (24h).'
  ),
  estado: z.string().optional().describe(
    'Filtrar por estado(s), separados por coma. Ej: "publicada" para solo oportunidades abiertas.'
  ),
  region: z.string().optional().describe(
    'Código(s) de región, separados por coma. Ej: "13" para Metropolitana.'
  ),
  tamano_pagina: z.number().min(10).max(50).default(50).describe(
    'Resultados por página (10-50, default 50).'
  ),
  numero_pagina: z.number().min(1).optional().describe(
    'Número de página a consultar (comienza en 1).'
  ),
};

export function registerMonitorearCambios(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const ttlMs = args.minutos * 60 * 1000;

        const response = await client.cambiosRecientes(ttlMs, {
          estado: args.estado,
          region: args.region,
          tamano_pagina: args.tamano_pagina,
          numero_pagina: args.numero_pagina,
        });

        const summary = response.items.map((item) => ({
          codigo: item.codigo,
          nombre: item.nombre,
          estado: item.estado.glosa,
          presupuesto_clp: item.montos.monto_disponible_clp,
          institucion: item.institucion.organismo_comprador,
          region: item.institucion.nombre_region,
          fecha_cierre: item.fechas.fecha_cierre,
          ultimo_cambio: item.fechas.fecha_ultimo_cambio,
        }));

        const result = {
          ventana_temporal: `Últimos ${args.minutos} minutos`,
          total_resultados: response.paginacion.total_resultados,
          pagina: `${response.paginacion.numero_pagina} de ${response.paginacion.total_paginas}`,
          resultados: summary,
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : `Error inesperado: ${String(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
