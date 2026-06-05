import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

const TOOL_NAME = 'recomendar_precio_ganador';

const TOOL_DESCRIPTION = `Analiza procesos históricos similares de Compra Ágil que ya fueron cerrados y adjudicados para estimar y sugerir un precio unitario o total óptimo y competitivo para postular.
Admite ingresar el código de una compra activa para extraer automáticamente las palabras clave o un término de búsqueda genérico.
Nota: Realiza consultas en paralelo acotadas por el rate limiter.`;

const inputSchema = {
  codigo_compra: z.string().optional().describe('Código de la Compra Ágil activa para analizar (ej: "1057539-228-COT26"). Opcional si se especifica "q".'),
  q: z.string().optional().describe('Término de búsqueda de producto/servicio a cotizar (ej: "resmas papel", "soporte computadores"). Opcional si se especifica "codigo_compra".'),
  region: z.string().optional().describe('Código de la región para acotar el análisis histórico (1-16). Ej: "13" para Metropolitana.'),
  limite_analisis: z.number().min(1).max(8).default(5).optional().describe('Cantidad máxima de procesos históricos a auditar (1-8, default 5) para no agotar la cuota de la API.'),
};

export function registerRecomendarPrecio(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        let keyword = args.q || '';
        let region = args.region || '';
        let targetProductDetail = '';

        // 1. Si hay un código de compra activa, obtener su detalle para sacar las palabras clave
        if (args.codigo_compra) {
          logger.info(`recomendar_precio_ganador: Obteniendo detalle de compra activa ${args.codigo_compra}`);
          const activeDetail = await client.detalle(args.codigo_compra);
          
          if (activeDetail.productos_solicitados && activeDetail.productos_solicitados.length > 0) {
            const firstProd = activeDetail.productos_solicitados[0];
            keyword = firstProd.nombre;
            targetProductDetail = `Producto solicitado en la compra activa: "${firstProd.nombre}" (Cantidad: ${firstProd.cantidad} ${firstProd.unidad_medida})`;
          } else {
            keyword = activeDetail.nombre;
            targetProductDetail = `Proceso activo: "${activeDetail.nombre}"`;
          }

          // Si no se especificó región en los argumentos, usar la región de la compra activa
          if (!region && activeDetail.institucion.region !== null) {
            region = String(activeDetail.institucion.region);
          }
        }

        if (!keyword) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error de validación: Debes proporcionar "codigo_compra" (para buscar palabras clave automáticamente) o un término de búsqueda "q".',
            }],
            isError: true,
          };
        }

        // 2. Buscar procesos históricos cerrados que ya tengan proveedor seleccionado
        logger.info(`recomendar_precio_ganador: Buscando procesos cerrados adjudicados para "${keyword}" en región "${region || 'Todas'}"`);
        
        const limit = args.limite_analisis || 5;
        const searchResponse = await client.buscar({
          q: keyword,
          estado: 'proveedor_seleccionado',
          region: region || undefined,
          tamano_pagina: 10, // API v2 requiere mínimo 10
          numero_pagina: 1,
        });

        if (!searchResponse.items || searchResponse.items.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No se encontraron procesos históricos cerrados en estado "proveedor_seleccionado" que coincidan con la búsqueda "${keyword}" en la región ${region || 'todas'}. No hay datos históricos suficientes para realizar una recomendación de precios.`,
            }],
          };
        }

        // 3. Consultar en paralelo (acotado por el limitador interno de la clase client) los detalles para obtener el ganador
        const prices: number[] = [];
        const processedItems: any[] = [];
        const itemsToProcess = searchResponse.items.slice(0, limit);

        logger.info(`recomendar_precio_ganador: Analizando detalles de ${itemsToProcess.length} procesos adjudicados`);

        for (const item of itemsToProcess) {
          try {
            const detail = await client.detalle(item.codigo);
            
            // Buscar al adjudicado/ganador
            const winner = detail.proveedores_cotizando?.find(prov => {
              if (prov.proveedor_seleccionado === true || prov.proveedor_seleccionado === 1) return true;
              if (prov.seleccion && prov.seleccion.proveedor_seleccionado === true) return true;
              return false;
            });

            if (winner) {
              const totalNeto = winner.valor_neto || winner.monto_total || 0;
              let unitPrice = null;

              // Intentar extraer el precio unitario del producto cotizado
              if (winner.productos_cotizados && winner.productos_cotizados.length === 1) {
                unitPrice = winner.productos_cotizados[0].precio_unitario;
              } else if (winner.productos_cotizados && winner.productos_cotizados.length > 1) {
                // Buscar el producto cotizado que más coincida con la keyword original
                const matchedProd = winner.productos_cotizados.find(p => 
                  p.nombre_producto.toLowerCase().includes(keyword.toLowerCase())
                );
                if (matchedProd) {
                  unitPrice = matchedProd.precio_unitario;
                } else {
                  // Fallback: usar el precio del primer item
                  unitPrice = winner.productos_cotizados[0].precio_unitario;
                }
              }

              const priceValue = unitPrice || totalNeto;
              if (priceValue > 0) {
                prices.push(priceValue);
              }

              processedItems.push({
                codigo: item.codigo,
                institucion: item.institucion.organismo_comprador,
                fecha_cierre: item.fechas.fecha_cierre,
                ganador: winner.razon_social,
                es_emt: winner.es_emt,
                monto_total_adjudicado: winner.monto_total,
                precio_unitario_adjudicado: unitPrice,
                criterio_seleccion: winner.seleccion?.criterio_seleccion || 'No especificado',
              });
            }
          } catch (detailError) {
            logger.warn(`recomendar_precio_ganador: Error al consultar detalle de ${item.codigo}: ${String(detailError)}`);
          }
        }

        if (prices.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `Se encontraron ${searchResponse.items.length} procesos históricos que coinciden con "${keyword}", pero no se pudo extraer información económica de los ganadores debido a datos incompletos en la API.`,
            }],
          };
        }

        // 4. Calcular estadísticas
        prices.sort((a, b) => a - b);
        const min = prices[0];
        const max = prices[prices.length - 1];
        const sum = prices.reduce((acc, val) => acc + val, 0);
        const avg = Math.round(sum / prices.length);
        
        // Mediana
        const mid = Math.floor(prices.length / 2);
        const median = prices.length % 2 !== 0 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);

        // 5. Sugerir precio competitivo (5% por debajo del promedio como referencia competitiva, acotada por el mínimo)
        let recommended = Math.round(avg * 0.95);
        if (recommended < min) {
          recommended = min;
        }

        const result = {
          proceso_activo: targetProductDetail || undefined,
          termino_clave_utilizado: keyword,
          region_analisis: region ? `Región ${region}` : 'Todas las regiones',
          procesos_analizados_exitosamente: prices.length,
          estadisticas_precios: {
            minimo_historico: min,
            maximo_historico: max,
            promedio_historico: avg,
            mediana_historica: median,
          },
          sugerencia_de_precio_competitivo: recommended,
          rango_sugerido: {
            min: Math.round(recommended * 0.95),
            max: Math.round(recommended * 1.05),
          },
          detalle_de_casos_historicos: processedItems,
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
          : `Error inesperado al recomendar precio: ${String(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
