/**
 * Tool: buscar_compras_agiles
 *
 * Busca y filtra procesos de Compra Ágil en Mercado Público
 * usando palabras clave, fechas, estados y regiones.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';

const TOOL_NAME = 'buscar_compras_agiles';

const TOOL_DESCRIPTION = `Busca procesos de Compra Ágil en Mercado Público de Chile.
Permite filtrar por palabras clave, estado del proceso, región geográfica y rango de fechas de publicación.
Retorna un listado resumido con código, nombre, estado, presupuesto e institución compradora.
Nota: los parámetros 'q' (búsqueda por texto) e 'id' (código exacto) son mutuamente excluyentes.
Estados válidos: publicada, cerrada, desierta, cancelada, proveedor_seleccionado.
Regiones: códigos del 1 al 16 (ej: 13 = Metropolitana, 5 = Valparaíso).`;

const inputSchema = {
  q: z.string().optional().describe(
    'Palabras clave para buscar en el nombre/descripción del proceso. Ej: "materiales electricos". No usar junto con "id".'
  ),
  id: z.string().optional().describe(
    'Código exacto de una Compra Ágil. Ej: "1057539-228-COT26". No usar junto con "q".'
  ),
  estado: z.string().optional().describe(
    'Estado(s) del proceso, separados por coma. Valores: publicada, cerrada, desierta, cancelada, proveedor_seleccionado. Ej: "publicada,proveedor_seleccionado".'
  ),
  region: z.string().optional().describe(
    'Código(s) de región del organismo comprador, separados por coma (1-16). Ej: "13" para Metropolitana, "13,5" para Metropolitana y Valparaíso.'
  ),
  publicado_desde: z.string().optional().describe(
    'Fecha mínima de publicación en formato ISO-8601. Ej: "2026-01-01T00:00:00Z".'
  ),
  publicado_hasta: z.string().optional().describe(
    'Fecha máxima de publicación en formato ISO-8601. Ej: "2026-01-31T23:59:59Z".'
  ),
  ordenar_por: z.enum(['FechaUltimaModificacion', 'FechaPublicacion']).optional().describe(
    'Criterio de ordenamiento. "FechaPublicacion" para las más recientes primero, "FechaUltimaModificacion" (default) para las últimas modificadas.'
  ),
  tamano_pagina: z.number().min(10).max(50).optional().describe(
    'Resultados por página (10-50, default 15).'
  ),
  numero_pagina: z.number().min(1).optional().describe(
    'Número de página a consultar (comienza en 1).'
  ),
};

export function registerBuscarCompras(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        // Validar exclusión mutua de q e id
        if (args.q && args.id) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error de validación: Los parámetros "q" (búsqueda por texto) e "id" (código exacto) no pueden usarse juntos. Usa solo uno de los dos.',
            }],
            isError: true,
          };
        }

        const response = await client.buscar({
          q: args.q,
          id: args.id,
          estado: args.estado,
          region: args.region,
          publicado_desde: args.publicado_desde,
          publicado_hasta: args.publicado_hasta,
          ordenar_por: args.ordenar_por,
          tamano_pagina: args.tamano_pagina,
          numero_pagina: args.numero_pagina,
        });

        // Formatear resultado compacto para el LLM
        const summary = response.items.map((item) => ({
          codigo: item.codigo,
          nombre: item.nombre,
          estado: item.estado.glosa,
          convocatoria: item.convocatoria.descripcion,
          presupuesto_clp: item.montos.monto_disponible_clp,
          moneda: item.montos.moneda,
          institucion: item.institucion.organismo_comprador,
          region: item.institucion.nombre_region,
          fecha_publicacion: item.fechas.fecha_publicacion,
          fecha_cierre: item.fechas.fecha_cierre,
          ofertas_recibidas: item.resumen.total_ofertas_recibidas,
        }));

        const result = {
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
