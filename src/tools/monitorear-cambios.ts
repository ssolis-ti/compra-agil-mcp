/**
 * Tool: monitorear_cambios_recientes
 *
 * Detecta procesos de Compra Ágil creados o modificados dentro de una ventana
 * de cambios: relativa (últimos N minutos) o absoluta (rango de fechas
 * arbitrario). Ideal para alertas, monitoreo de oportunidades y sincronización
 * incremental de un período pasado.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'monitorear_cambios_recientes';

const TOOL_DESCRIPTION = `Busca Compras Ágiles que hayan sido creadas o modificadas dentro de una ventana de cambios.
Ideal para monitoreo de nuevas oportunidades de negocio, alertas en tiempo real y sincronización incremental.
La ventana se define de UNA de dos formas, mutuamente excluyentes:
  • Relativa: 'minutos' (últimos N minutos, máx 1440 = 24h). Es el modo por defecto (60 min).
  • Absoluta: 'cambio_desde' + 'cambio_hasta' (rango ISO-8601 arbitrario), para resincronizar un período pasado
    o retomar desde el último timestamp procesado, sin el techo de 24 horas.
Puede combinarse con filtros de estado y región para acotar los resultados.`;

/** Acepta ISO-8601 con 'Z' o con offset (±HH:MM). Los segundos son opcionales. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const inputSchema = {
  minutos: z.number().min(1).max(1440).optional().describe(
    'Ventana RELATIVA: buscar cambios en los últimos N minutos. Ej: 60 = última hora, 1440 = últimas 24 horas. Máximo 1440 (24h). Se usa 60 por defecto si no se indica ni "minutos" ni un rango. No combinar con "cambio_desde"/"cambio_hasta".'
  ),
  cambio_desde: z.string().optional().describe(
    'Ventana ABSOLUTA: fecha/hora ISO-8601 de inicio del rango de cambios. Ej: "2026-09-01T00:00:00Z". Úsala para sincronización incremental de un período arbitrario (sin el límite de 24h de "minutos"). No combinar con "minutos".'
  ),
  cambio_hasta: z.string().optional().describe(
    'Ventana ABSOLUTA: fecha/hora ISO-8601 de fin del rango de cambios. Ej: "2026-09-02T00:00:00Z". Requiere "cambio_desde". No combinar con "minutos".'
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

/** Ventana de cambios ya resuelta y lista para enviar a la API. */
export interface VentanaCambios {
  /** Parámetros de la API que definen la ventana (uno u otro grupo, nunca ambos). */
  params: { ttl_cambio_ms?: number; cambio_desde?: string; cambio_hasta?: string };
  /** Glosa legible para el reporte de salida. */
  descripcion: string;
}

/**
 * Resuelve la ventana de cambios a partir de los argumentos de la herramienta.
 *
 * La API expone dos formas mutuamente excluyentes de acotar los cambios
 * (Guía API Compra Ágil v2 §5.1, Grupo 1): `ttl_cambio_ms` (opción A) o el par
 * `cambio_desde`/`cambio_hasta` (opción B). Enviar ambas a la vez es un 400,
 * así que se decide aquí y se falla localmente para no gastar cuota.
 *
 * Retorna un string con el error de validación, o la ventana resuelta.
 */
export function resolverVentanaCambios(args: {
  minutos?: number;
  cambio_desde?: string;
  cambio_hasta?: string;
}): VentanaCambios | { error: string } {
  const usaRango = Boolean(args.cambio_desde || args.cambio_hasta);

  if (usaRango && args.minutos !== undefined) {
    return {
      error:
        'Error de validación: "minutos" (ventana relativa) y "cambio_desde"/"cambio_hasta" (ventana absoluta) son mutuamente excluyentes. Usa solo uno de los dos modos.',
    };
  }

  if (usaRango) {
    if (!args.cambio_desde) {
      return {
        error:
          'Error de validación: "cambio_hasta" requiere también "cambio_desde" para delimitar el rango.',
      };
    }
    for (const [nombre, valor] of [
      ['cambio_desde', args.cambio_desde],
      ['cambio_hasta', args.cambio_hasta],
    ] as const) {
      if (valor && !ISO_8601.test(valor)) {
        return {
          error: `Error de validación: "${nombre}" debe estar en formato ISO-8601 con zona horaria. Ej: "2026-09-01T00:00:00Z". Recibido: "${valor}".`,
        };
      }
    }
    if (args.cambio_hasta && args.cambio_desde > args.cambio_hasta) {
      return {
        error: `Error de validación: "cambio_desde" (${args.cambio_desde}) es posterior a "cambio_hasta" (${args.cambio_hasta}). El rango quedaría vacío.`,
      };
    }

    return {
      params: { cambio_desde: args.cambio_desde, cambio_hasta: args.cambio_hasta },
      descripcion: args.cambio_hasta
        ? `Cambios entre ${args.cambio_desde} y ${args.cambio_hasta}`
        : `Cambios desde ${args.cambio_desde}`,
    };
  }

  // Modo relativo (por defecto): 60 minutos si no se indicó nada.
  const minutos = args.minutos ?? 60;
  return {
    params: { ttl_cambio_ms: minutos * 60 * 1000 },
    descripcion: `Últimos ${minutos} minutos`,
  };
}

export function registerMonitorearCambios(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Monitorear cambios recientes",

      description: TOOL_DESCRIPTION,

      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const ventana = resolverVentanaCambios(args);
        if ('error' in ventana) {
          return {
            content: [{ type: 'text' as const, text: ventana.error }],
            isError: true,
          };
        }

        const response = await client.buscar({
          ...ventana.params,
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
          ventana_temporal: ventana.descripcion,
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
          : `Error inesperado: ${safeError(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
