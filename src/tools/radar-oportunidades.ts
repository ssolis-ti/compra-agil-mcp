import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

const TOOL_NAME = 'radar_oportunidades_calientes';

const TOOL_DESCRIPTION = `Escanea, califica y clasifica de forma priorizada los procesos de Compra Ágil activos (publicados).
Utiliza una fórmula ponderada (Hot Score) basada en la falta de oferentes, el presupuesto disponible y las horas restantes de cierre para destacar los llamados más convenientes y fáciles de ganar.`;

const inputSchema = {
  region: z.string().optional().describe('Código de la región para filtrar (1-16). Ej: "13" para Metropolitana.'),
  q: z.string().optional().describe('Término de búsqueda opcional para acotar a un rubro o producto específico (ej: "licencias").'),
  presupuesto_minimo: z.number().optional().describe('Filtrar solo procesos con presupuesto disponible mayor o igual a este monto en CLP.'),
  limite_resultados: z.number().min(1).max(20).default(10).optional().describe('Cantidad máxima de oportunidades destacadas a retornar (1-20, default 10).'),
};

interface OportunidadRadar {
  codigo: string;
  nombre: string;
  organismo: string;
  region: string;
  presupuesto_disponible: number;
  ofertas_recibidas: number;
  horas_restantes: number;
  fecha_cierre: string;
  puntuacion_caliente: number;
  factores_calificacion: string[];
}

export function registerRadarOportunidades(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const queryParams = {
          estado: 'publicada',
          region: args.region || undefined,
          q: args.q || undefined,
          tamano_pagina: 50, // Obtener un lote amplio de 50 para poder rankear
          numero_pagina: 1,
        };

        logger.info(`radar_oportunidades_calientes: Escaneando procesos activos para region="${args.region || 'Todas'}" q="${args.q || 'Todos'}"`);
        const searchResponse = await client.buscar(queryParams);

        if (!searchResponse.items || searchResponse.items.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No se encontraron Compras Ágiles activas que coincidan con los filtros de búsqueda.',
            }],
          };
        }

        const now = Date.now();
        const opportunities: OportunidadRadar[] = [];
        const minBudget = args.presupuesto_minimo || 0;

        for (const item of searchResponse.items) {
          const budget = item.montos?.monto_disponible_clp || item.montos?.monto_disponible || 0;
          
          // Filtrar por presupuesto mínimo si corresponde
          if (budget < minBudget) {
            continue;
          }

          // Calcular tiempo restante en horas
          let hoursLeft = 0;
          if (item.fechas?.fecha_cierre) {
            const cierreTime = new Date(item.fechas.fecha_cierre).getTime();
            hoursLeft = (cierreTime - now) / (1000 * 60 * 60);
          }

          // Omitir procesos que ya cerraron o están en negativo por zona horaria
          if (hoursLeft <= 0) {
            continue;
          }

          let score = 0;
          const factors: string[] = [];

          // Factor 1: Baja Competencia (total_ofertas_recibidas) - Máx 50 pts
          const bids = item.resumen?.total_ofertas_recibidas ?? 0;
          if (bids === 0) {
            score += 50;
            factors.push('Sin oferentes activos (+50 pts)');
          } else if (bids === 1) {
            score += 30;
            factors.push('Baja competencia: solo 1 oferente (+30 pts)');
          } else if (bids === 2) {
            score += 15;
            factors.push('Competencia moderada: 2 oferentes (+15 pts)');
          }

          // Factor 2: Urgencia del Cierre (horas restantes) - Máx 30 pts
          if (hoursLeft <= 4) {
            score += 30;
            factors.push('Urgencia crítica: cierra en menos de 4 horas (+30 pts)');
          } else if (hoursLeft <= 12) {
            score += 20;
            factors.push('Cierre inminente: cierra en menos de 12 horas (+20 pts)');
          } else if (hoursLeft <= 24) {
            score += 10;
            factors.push('Cierre cercano: cierra en menos de 24 horas (+10 pts)');
          }

          // Factor 3: Tamaño de Presupuesto - Máx 20 pts
          if (budget >= 5000000) {
            score += 20;
            factors.push('Presupuesto de alto valor (>= $5.000.000 CLP) (+20 pts)');
          } else if (budget >= 2000000) {
            score += 15;
            factors.push('Presupuesto medio-alto (>= $2.000.000 CLP) (+15 pts)');
          } else if (budget >= 500000) {
            score += 10;
            factors.push('Presupuesto medio (>= $500.000 CLP) (+10 pts)');
          } else {
            score += 5;
            factors.push('Presupuesto bajo (< $500.000 CLP) (+5 pts)');
          }

          // Factor 4: Facilidad de Postulación - Máx 5 pts
          const docsCount = item.documentos?.length || 0;
          if (docsCount === 0) {
            score += 5;
            factors.push('Sin documentos adjuntos (postulación rápida sin leer bases) (+5 pts)');
          }

          opportunities.push({
            codigo: item.codigo,
            nombre: item.nombre,
            organismo: item.institucion?.organismo_comprador || 'No especificado',
            region: item.institucion?.nombre_region || 'No especificada',
            presupuesto_disponible: budget,
            ofertas_recibidas: bids,
            horas_restantes: Math.round(hoursLeft * 10) / 10,
            fecha_cierre: item.fechas?.fecha_cierre,
            puntuacion_caliente: score,
            factores_calificacion: factors,
          });
        }

        // Ordenar descendentemente por puntuación caliente
        opportunities.sort((a, b) => b.puntuacion_caliente - a.puntuacion_caliente);

        // Aplicar límite
        const limit = args.limite_resultados || 10;
        const rankedOpportunities = opportunities.slice(0, limit);

        const result = {
          total_oportunidades_analizadas: opportunities.length,
          radar_limite_resultados: limit,
          oportunidades_calientes: rankedOpportunities,
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
          : `Error inesperado en radar de oportunidades: ${String(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
