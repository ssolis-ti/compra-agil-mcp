import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { esGanador, extraerPrecioUnitario, extraerMontoNeto } from '../utils/quotation.js';

const TOOL_NAME = 'generar_borrador_cotizacion';

const TOOL_DESCRIPTION = `Genera un borrador estructurado en formato JSON para presentar una cotización formal a un llamado de Compra Ágil activa.
Calcula automáticamente los valores netos, impuestos (19% IVA de Chile) y montos brutos, sugiriendo un precio unitario de mercado si no se ingresa uno personalizado.`;

const inputSchema = {
  codigo_compra: z.string().describe('Código de la Compra Ágil activa a cotizar (ej: "1057539-228-COT26").'),
  rut_proveedor: z.string().optional().describe('RUT del proveedor que realiza la cotización (ej: "76.123.456-7").'),
  razon_social: z.string().optional().describe('Razón social/Nombre de fantasía de la empresa (ej: "Mi Pyme SpA").'),
  precio_unitario_personalizado: z.number().optional().describe('Precio unitario neto personalizado para aplicar a los ítems. Si se omite, se buscará un precio estimado de mercado.'),
  plazo_entrega_dias: z.number().optional().describe('Plazo de entrega en días corridos/hábiles. Si se omite, se adopta el sugerido por el comprador o 5 días.'),
  descripcion_propuesta: z.string().optional().describe('Mensaje comercial o aclaraciones técnicas del proveedor para adjuntar a la propuesta.'),
};

export function registerGenerarBorrador(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        logger.info(`generar_borrador_cotizacion: Obteniendo detalle de la compra activa ${args.codigo_compra}`);
        const targetDetail = await client.detalle(args.codigo_compra);

        // Detectar qué campos son placeholders (no aportados por el usuario) para advertir en la salida.
        const advertencias: string[] = [];
        const rutProv = args.rut_proveedor || '76.000.000-0';
        const razonSocial = args.razon_social || 'Proveedor Demo SpA';
        if (!args.rut_proveedor) advertencias.push('rut_proveedor es un valor PLACEHOLDER; reemplázalo por el RUT real del proveedor antes de presentar.');
        if (!args.razon_social) advertencias.push('razon_social es un valor PLACEHOLDER; reemplázalo por la razón social real.');
        const customPrice = args.precio_unitario_personalizado;
        
        let plazoEntrega = args.plazo_entrega_dias;
        if (plazoEntrega === undefined) {
          plazoEntrega = targetDetail.entrega?.plazo_entrega_dias || 5;
        }

        // Estimar o adoptar precio unitario
        let suggestedPrice = 1000;
        let isPriceSuggested = false;
        let priceSource = 'Valor por defecto (placeholder de $1.000)';

        if (customPrice !== undefined && customPrice > 0) {
          suggestedPrice = customPrice;
          priceSource = 'Precio neto ingresado por el usuario';
          isPriceSuggested = true;
        } else {
          // Intentar obtener palabras clave del primer producto solicitado
          let keyword = '';
          if (targetDetail.productos_solicitados && targetDetail.productos_solicitados.length > 0) {
            keyword = targetDetail.productos_solicitados[0].nombre;
          } else {
            keyword = targetDetail.nombre;
          }

          if (keyword) {
            try {
              logger.info(`generar_borrador_cotizacion: Consultando precios de referencia históricos para "${keyword}"`);
              const searchResponse = await client.buscar({
                q: keyword,
                estado: 'proveedor_seleccionado',
                tamano_pagina: 10, // API v2 requiere mínimo 10
                numero_pagina: 1,
              });

              const prices: number[] = [];
              const itemsToProcess = (searchResponse.items || []).slice(0, 3);
              if (itemsToProcess.length > 0) {
                for (const item of itemsToProcess) {
                  try {
                    const detail = await client.detalle(item.codigo);
                    const winner = detail.proveedores_cotizando?.find(esGanador);

                    if (winner) {
                      // Preferir precio unitario (comparable); si no hay, no mezclar con el total:
                      // el total solo se usa como referencia si no existe ningún unitario en el lote.
                      const unitPrice = extraerPrecioUnitario(winner, keyword);
                      if (unitPrice !== null) {
                        prices.push(unitPrice);
                      }
                    }
                  } catch (e) {
                    // ignore errors for individual historical lookups
                  }
                }
              }

              if (prices.length > 0) {
                prices.sort((a, b) => a - b);
                const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
                // Sugerir un precio competitivo (5% menor al promedio adjudicado)
                suggestedPrice = Math.round(avg * 0.95);
                if (suggestedPrice < prices[0]) {
                  suggestedPrice = prices[0];
                }
                priceSource = 'Sugerencia automática: Percentil de mercado (5% bajo promedio histórico)';
                isPriceSuggested = true;
              } else {
                // Fallback: usar presupuesto estimado del comprador si existe
                const totalCantidad = targetDetail.productos_solicitados?.reduce((acc, p) => acc + p.cantidad, 0) || 1;
                const budget = targetDetail.presupuesto?.monto_disponible_clp || targetDetail.presupuesto?.monto_disponible || 0;
                if (budget > 0) {
                  suggestedPrice = Math.round((budget * 0.9) / totalCantidad);
                  priceSource = 'Sugerencia automática: Presupuesto estimado del comprador (descontado 10%)';
                  isPriceSuggested = true;
                }
              }
            } catch (err) {
              logger.warn(`generar_borrador_cotizacion: No se pudo estimar precio sugerido: ${String(err)}`);
            }
          }
        }

        // Construir productos cotizados
        const productosCotizados = (targetDetail.productos_solicitados || []).map(prod => {
          const uPrice = suggestedPrice;
          const totalProd = prod.cantidad * uPrice;
          return {
            codigo_producto: prod.codigo_producto,
            nombre_producto: prod.nombre,
            descripcion: prod.descripcion || `Suministro de ${prod.nombre}`,
            cantidad: prod.cantidad,
            precio_unitario: uPrice,
            monto_total_producto: totalProd,
          };
        });

        // Totales de cotización
        const valorNeto = productosCotizados.reduce((acc, p) => acc + p.monto_total_producto, 0);
        const totalImpuesto = Math.round(valorNeto * 0.19); // 19% IVA en Chile
        const montoTotal = valorNeto + totalImpuesto;

        // Cover letter/carta de presentación comercial
        const userDesc = args.descripcion_propuesta || '';
        const coverLetter = `Estimados ${targetDetail.institucion?.organismo_comprador || 'Sres. Compradores'},\n\n` +
          `Junto con saludar, a través del presente documento presentamos nuestra cotización formal para el proceso de Compra Ágil "${targetDetail.nombre}" (Código: ${targetDetail.codigo}).\n\n` +
          `Detalles de nuestra propuesta:\n` +
          (userDesc ? `- ${userDesc}\n` : '') +
          `- Cumplimiento garantizado con todas las especificaciones y características solicitadas.\n` +
          `- Plazo de entrega: ${plazoEntrega} días corridos contados desde la recepción de la Orden de Compra.\n` +
          `- Validez de la oferta: 30 días corridos.\n\n` +
          `Agradecemos de antemano su consideración y nos mantenemos a su disposición para aclarar cualquier duda técnica o comercial.\n\n` +
          `Atentamente,\n` +
          `${razonSocial}\nRUT: ${rutProv}`;

        if (!isPriceSuggested) {
          advertencias.push(`precio_unitario es un valor por defecto ($${suggestedPrice.toLocaleString('es-CL')}); no se pudo estimar de mercado. Ingresa "precio_unitario_personalizado".`);
        }

        const borradorCotizacion = {
          _advertencia: '⚠ BORRADOR AUTOGENERADO. Revisa y reemplaza los campos marcados como placeholder antes de presentar la cotización real. Este documento no ha sido enviado a Mercado Público.',
          _campos_a_revisar: advertencias,
          codigo_compra: targetDetail.codigo,
          nombre_compra: targetDetail.nombre,
          organismo_comprador: targetDetail.institucion?.organismo_comprador || 'No especificado',
          rut_proveedor: rutProv,
          razon_social: razonSocial,
          es_emt: null, // Desconocido: depende del Registro de Proveedores del RUT real, no se asume.
          activo: true,
          plazo_entrega_dias: plazoEntrega,
          valor_neto: valorNeto,
          porcentaje_impuesto: 19,
          nombre_impuesto: 'IVA',
          total_impuesto: totalImpuesto,
          monto_total: montoTotal,
          descripcion_cotizacion: coverLetter,
          productos_cotizados: productosCotizados,
          metadata_estimacion: {
            precio_unitario_utilizado: suggestedPrice,
            fuente_precio_unitario: priceSource,
            precio_unitario_sugerido_automatico: isPriceSuggested,
          }
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(borradorCotizacion, null, 2),
          }],
        };

      } catch (error) {
        const message = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : `Error inesperado al generar borrador de cotización: ${String(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
