import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { esAdmisible, extraerMontoNeto } from '../utils/quotation.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'auditar_compras_desiertas';

const TOOL_DESCRIPTION = `Audita un proceso de Compra Ágil que haya quedado "desierto" para identificar por qué falló (plazo ajustado, presupuesto bajo, requisitos restrictivos), comparándolo con los precios que el mercado cotizó en procesos similares.
Admite el código de la compra o un término de búsqueda para encontrar un proceso desierto reciente.
NOTA: la comparación se hace contra precios COTIZADOS por proveedores en procesos del mismo rubro, no contra precios adjudicados: la API de Mercado Público no expone qué oferta ganó (verificado empíricamente).
También reporta el motivo oficial de deserción y las cotizaciones declaradas inadmisibles, que suelen explicar el fracaso mejor que el precio.`;

const inputSchema = {
  codigo_compra: z.string().optional().describe('Código de la Compra Ágil desierta para auditar (ej: "1057539-228-COT26"). Opcional si se especifica "q".'),
  q: z.string().optional().describe('Término de búsqueda de producto/servicio para encontrar y auditar un proceso desierto reciente (ej: "resmas papel"). Opcional.'),
  limite_analisis: z.number().min(1).max(8).default(5).optional().describe('Cantidad de procesos históricos exitosos con los que comparar (1-8, default 5) para no agotar la cuota de la API.'),
};

export function registerAuditarDesiertas(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        let targetCode = args.codigo_compra || '';
        let keyword = args.q || '';
        let region = '';

        // 1. Si no hay código pero hay keyword q, buscar un proceso desierto reciente
        if (!targetCode && keyword) {
          logger.info(`auditar_compras_desiertas: Buscando proceso desierto reciente para "${keyword}"`);
          const desiertasSearch = await client.buscar({
            q: keyword,
            estado: 'desierta',
            tamano_pagina: 10, // API v2 requiere mínimo 10
            numero_pagina: 1,
          });

          if (!desiertasSearch.items || desiertasSearch.items.length === 0) {
            return {
              content: [{
                type: 'text' as const,
                text: `No se encontraron procesos recientes en estado "desierta" para la búsqueda "${keyword}". Por favor intenta con otra palabra clave o ingresa un "codigo_compra" específico.`,
              }],
            };
          }
          targetCode = desiertasSearch.items[0].codigo;
        }

        if (!targetCode) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error de validación: Debes proporcionar "codigo_compra" o un término de búsqueda "q" para encontrar un proceso a auditar.',
            }],
            isError: true,
          };
        }

        // 2. Obtener el detalle del proceso desierto a auditar
        logger.info(`auditar_compras_desiertas: Consultando detalle del proceso objetivo ${targetCode}`);
        const targetDetail = await client.detalle(targetCode);

        // Extraer metadatos clave del proceso objetivo
        const targetName = targetDetail.nombre || 'Sin nombre';
        const targetBudget = targetDetail.presupuesto?.monto_disponible_clp || targetDetail.presupuesto?.monto_disponible || 0;
        
        let targetDuration = 0;
        if (targetDetail.fechas?.fecha_cierre && targetDetail.fechas?.fecha_publicacion) {
          const start = new Date(targetDetail.fechas.fecha_publicacion).getTime();
          const end = new Date(targetDetail.fechas.fecha_cierre).getTime();
          targetDuration = Math.round(((end - start) / (1000 * 60 * 60 * 24)) * 10) / 10;
        }

        if (targetDetail.institucion?.region !== null) {
          region = String(targetDetail.institucion.region);
        }

        // Determinar la palabra clave para la comparativa histórica
        if (!keyword) {
          if (targetDetail.productos_solicitados && targetDetail.productos_solicitados.length > 0) {
            keyword = targetDetail.productos_solicitados[0].nombre;
          } else {
            keyword = targetDetail.nombre;
          }
        }

        // 3. Buscar procesos comparables del mismo rubro que publiquen cotizaciones.
        //    Solo `desierta`: medido contra la API real, es el único estado que las
        //    expone (desierta 5/8 procesos con precios; cerrada 0/8).
        //    `proveedor_seleccionado` devuelve 0 resultados.
        logger.info(`auditar_compras_desiertas: Buscando procesos comparables para "${keyword}"`);
        const limit = args.limite_analisis || 5;
        const searchResponse = await client.buscar({
          q: keyword,
          estado: 'desierta',
          tamano_pagina: 50, // el mínimo de la API es 10; 50 maximiza el material por consulta
          numero_pagina: 1,
        });

        const successDurations: number[] = [];
        const successPrices: number[] = [];
        const processedCases: any[] = [];
        const itemsToProcess = (searchResponse.items || []).slice(0, limit);

        if (itemsToProcess.length > 0) {
          logger.info(`auditar_compras_desiertas: Analizando detalles de ${itemsToProcess.length} procesos comparables`);
          for (const item of itemsToProcess) {
            try {
              const detail = await client.detalle(item.codigo);

              // Se recolectan TODAS las cotizaciones del proceso, incluidas las
              // declaradas inadmisibles: en los procesos desiertos casi todas lo son
              // (por eso quedaron desiertos) y filtrarlas dejaba la muestra vacía.
              // El precio ofertado sigue siendo señal de mercado.
              // Antes se buscaba solo al adjudicado, pero la API nunca marca un
              // ganador (verificado), así que ese camino no encontraba nada.
              const cotizaciones = detail.proveedores_cotizando ?? [];
              if (cotizaciones.length === 0) continue;
              const inadmisibles = cotizaciones.filter((c) => !esAdmisible(c)).length;

              const netos = cotizaciones
                .map((c) => extraerMontoNeto(c))
                .filter((n): n is number => n !== null);
              if (netos.length === 0) continue;

              // Referencia por proceso: la cotización más económica — es el precio
              // al que ese mercado estuvo dispuesto a atender la necesidad.
              const menorNeto = Math.min(...netos);
              successPrices.push(menorNeto);

              let successDuration = 0;
              if (detail.fechas?.fecha_cierre && detail.fechas?.fecha_publicacion) {
                const start = new Date(detail.fechas.fecha_publicacion).getTime();
                const end = new Date(detail.fechas.fecha_cierre).getTime();
                successDuration = Math.round(((end - start) / (1000 * 60 * 60 * 24)) * 10) / 10;
                successDurations.push(successDuration);
              }

              processedCases.push({
                codigo: item.codigo,
                estado: detail.estado?.glosa,
                institucion: item.institucion?.organismo_comprador || 'Desconocido',
                cotizaciones_recibidas: cotizaciones.length,
                cotizaciones_inadmisibles: inadmisibles,
                menor_monto_cotizado: menorNeto,
                mayor_monto_cotizado: Math.max(...netos),
                duracion_dias: successDuration,
                fecha_cierre: item.fechas?.fecha_cierre,
                motivo_desierta: detail.motivos?.motivo_desierta ?? null,
              });
            } catch (detailError) {
              logger.warn(`auditar_compras_desiertas: Error al consultar detalle de ${item.codigo}: ${safeError(detailError)}`);
            }
          }
        }

        // 4. Calcular métricas estadísticas para el análisis comparativo
        let avgPrice = 0, minPrice = 0, maxPrice = 0;
        if (successPrices.length > 0) {
          successPrices.sort((a, b) => a - b);
          minPrice = successPrices[0];
          maxPrice = successPrices[successPrices.length - 1];
          avgPrice = Math.round(successPrices.reduce((a, b) => a + b, 0) / successPrices.length);
        }

        let avgDuration = 0, minDuration = 0, maxDuration = 0;
        if (successDurations.length > 0) {
          successDurations.sort((a, b) => a - b);
          minDuration = successDurations[0];
          maxDuration = successDurations[successDurations.length - 1];
          avgDuration = Math.round((successDurations.reduce((a, b) => a + b, 0) / successDurations.length) * 10) / 10;
        }

        // 5. Análisis crítico de brechas
        const analisis_critico = {
          presupuesto_insuficiente: false,
          plazo_insuficiente: false,
          requisitos_complejos: false,
          diferencia_presupuesto_porcentaje: 0,
          diferencia_plazo_dias: 0,
        };

        if (targetBudget > 0 && avgPrice > 0) {
          analisis_critico.diferencia_presupuesto_porcentaje = Math.round(((targetBudget - avgPrice) / avgPrice) * 100);
          if (targetBudget < minPrice || targetBudget < avgPrice * 0.8) {
            analisis_critico.presupuesto_insuficiente = true;
          }
        } else if (targetBudget === 0 && avgPrice > 0) {
          // Si el presupuesto objetivo es $0 o no especificado, se marca como potencial brecha si el histórico requiere fondos
          analisis_critico.presupuesto_insuficiente = true;
        }

        if (targetDuration > 0 && avgDuration > 0) {
          analisis_critico.diferencia_plazo_dias = Math.round((targetDuration - avgDuration) * 10) / 10;
          if (targetDuration < 2 || targetDuration < avgDuration * 0.6) {
            analisis_critico.plazo_insuficiente = true;
          }
        } else if (targetDuration > 0 && targetDuration < 2) {
          // Plazo menor a 2 días siempre se marca como potencialmente insuficiente en Compra Ágil
          analisis_critico.plazo_insuficiente = true;
        }

        if (
          targetDetail.flags?.considera_requisitos_medioambientales ||
          targetDetail.flags?.considera_requisitos_impacto_social_economico
        ) {
          analisis_critico.requisitos_complejos = true;
        }

        // 6. Generación de recomendaciones accionables
        const recomendaciones: string[] = [];
        if (analisis_critico.presupuesto_insuficiente) {
          if (targetBudget > 0) {
            recomendaciones.push(
              `Aumentar el presupuesto disponible. El presupuesto actual de $${targetBudget.toLocaleString('es-CL')} es un ${Math.abs(analisis_critico.diferencia_presupuesto_porcentaje)}% inferior al promedio de lo que el mercado cotizó en procesos similares ($${avgPrice.toLocaleString('es-CL')}). Se sugiere incrementarlo a al menos $${Math.round(avgPrice * 1.05).toLocaleString('es-CL')}.`
            );
          } else {
            recomendaciones.push(
              `Especificar o incrementar el presupuesto estimado. El promedio de lo cotizado por el mercado para productos similares es de $${avgPrice.toLocaleString('es-CL')}.`
            );
          }
        }

        if (analisis_critico.plazo_insuficiente) {
          recomendaciones.push(
            `Extender el plazo de postulación. El proceso actual ofreció ${targetDuration} días entre publicación y cierre, mientras que los procesos comparables promedian ${avgDuration} días. Se recomienda extender el plazo a un mínimo de 3 a 5 días hábiles.`
          );
        }

        if (analisis_critico.requisitos_complejos) {
          recomendaciones.push(
            `Flexibilizar los requisitos ambientales/sociales exigidos. Aunque promueven buenas prácticas, en procesos rápidos de bajo monto pueden asustar o inhabilitar a microempresas locales si implican adjuntar certificados complejos.`
          );
        }

        if (recomendaciones.length === 0) {
          recomendaciones.push(
            `No se detectaron discrepancias obvias de presupuesto o plazo respecto al mercado. Se sugiere revisar la redacción de las especificaciones técnicas o los ítems requeridos en "productos_solicitados" para asegurarse de que no estén amarrados a una única marca o sean demasiado específicos.`
          );
        }

        const result = {
          proceso_auditado: {
            codigo: targetCode,
            nombre: targetName,
            region: region ? `Región ${region}` : 'No especificada',
            estado: targetDetail.estado?.glosa || 'Desconocido',
            presupuesto_disponible: targetBudget,
            duracion_dias: targetDuration,
            items_solicitados: targetDetail.productos_solicitados?.map(p => ({
              nombre: p.nombre,
              cantidad: p.cantidad,
              unidad: p.unidad_medida,
            })) || [],
            motivo_desierta: targetDetail.motivos?.motivo_desierta || 'No especificado en el sistema',
          },
          busqueda_comparativa: {
            termino_clave: keyword,
            procesos_comparables_con_cotizaciones: successPrices.length,
            estadisticas_montos_cotizados: successPrices.length > 0 ? {
              minimo_cotizado: minPrice,
              maximo_cotizado: maxPrice,
              promedio_cotizado: avgPrice,
            } : null,
            estadisticas_duracion: successDurations.length > 0 ? {
              minimo_dias: minDuration,
              maximo_dias: maxDuration,
              promedio_dias: avgDuration,
            } : null,
          },
          analisis_de_brechas: analisis_critico,
          recomendaciones_de_optimizacion: recomendaciones,
          procesos_comparables_analizados: processedCases,
          _nota_metodologica: 'La comparación usa el MENOR monto cotizado de cada proceso similar (cerrado o desierto), no montos adjudicados: la API de Mercado Público no expone qué oferta ganó. Revisa también "motivo_desierta": muchas deserciones se explican por incumplimientos formales (garantías, certificados) y no por precio.',
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
          : `Error inesperado al auditar compra desierta: ${safeError(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
