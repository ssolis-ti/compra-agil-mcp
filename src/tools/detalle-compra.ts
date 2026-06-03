/**
 * Tool: obtener_detalle_compra
 *
 * Obtiene el detalle completo de una Compra Ágil específica,
 * incluyendo productos, proveedores, cotizaciones y estado de OC.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';

const TOOL_NAME = 'obtener_detalle_compra';

const TOOL_DESCRIPTION = `Obtiene el detalle completo de una Compra Ágil específica por su código único.
Incluye: descripción del proceso, productos solicitados con cantidades, proveedores que cotizaron con sus montos,
presupuesto disponible, dirección y plazo de entrega, estado de la Orden de Compra (si fue emitida),
y flags de sostenibilidad (requisitos medioambientales y de impacto social).
NOTA: Las cotizaciones detalladas de los proveedores solo se muestran desde el estado "Cerrada" en segundo llamado en adelante.`;

const inputSchema = {
  codigo: z.string().describe(
    'Código único de la Compra Ágil. Formato: XXXXXX-YYY-COTXX. Ej: "1057539-228-COT26".'
  ),
};

export function registerDetalleCompra(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const detalle = await client.detalle(args.codigo);

        // Formatear para LLM — estructura limpia y legible
        const result = {
          codigo: detalle.codigo,
          nombre: detalle.nombre,
          descripcion: detalle.descripcion,
          estado: detalle.estado.glosa,
          convocatoria: detalle.convocatoria.descripcion,
          institucion: {
            organismo: detalle.institucion.organismo_comprador,
            rut: detalle.institucion.rut,
            unidad: detalle.institucion.unidad_compra,
            region: detalle.institucion.nombre_region,
          },
          fechas: {
            publicacion: detalle.fechas.fecha_publicacion,
            cierre: detalle.fechas.fecha_cierre,
            cierre_primer_llamado: detalle.convocatoria.fecha_cierre_primer_llamado,
            cierre_segundo_llamado: detalle.convocatoria.fecha_cierre_segundo_llamado,
            cancelacion: detalle.fechas.fecha_cancelacion,
          },
          presupuesto: {
            tipo: detalle.presupuesto.tipo_presupuesto,
            monto_disponible_clp: detalle.presupuesto.monto_disponible_clp,
            moneda: detalle.presupuesto.moneda,
            presupuesto_estimado: detalle.presupuesto.presupuesto_estimado,
          },
          entrega: {
            direccion: detalle.entrega.direccion_entrega,
            plazo_dias: detalle.entrega.plazo_entrega_dias,
          },
          productos_solicitados: detalle.productos_solicitados.map((p) => ({
            codigo: p.codigo_producto,
            nombre: p.nombre,
            descripcion: p.descripcion,
            cantidad: p.cantidad,
            unidad: p.unidad_medida,
          })),
          proveedores_cotizando: detalle.proveedores_cotizando.map((prov) => ({
            rut: prov.rut_proveedor,
            razon_social: prov.razon_social,
            es_empresa_menor_tamano: prov.es_emt,
            monto_total: prov.monto_total,
            valor_neto: prov.valor_neto,
            impuesto: prov.total_impuesto,
            despacho: prov.monto_despacho,
            descripcion: prov.descripcion_cotizacion || prov.descripcion,
            estado_por_comprador: prov.estado_por_comprador,
            productos_cotizados: prov.productos_cotizados?.map((pc) => ({
              nombre: pc.nombre_producto,
              cantidad: pc.cantidad,
              precio_unitario: pc.precio_unitario,
              total: pc.monto_total_producto,
            })),
          })),
          orden_compra: {
            tiene_oc: (detalle.id_orden_compra ?? detalle.orden_compra?.id_orden_compra ?? null) !== null,
            id_orden_compra: detalle.id_orden_compra ?? detalle.orden_compra?.id_orden_compra ?? null,
            id_oc: detalle.orden_compra?.id_oc ?? null,
            codigo_oc: detalle.orden_compra?.codigo_orden_compra ?? null,
            estado_oc: detalle.orden_compra?.estado_orden_compra ?? null,
          },
          resumen: {
            total_ofertas: detalle.resumen.total_ofertas_recibidas,
            total_demandas: detalle.resumen.total_demandas,
            multa_sancion: detalle.resumen.multa_sancion,
          },
          motivos: detalle.motivos,
          sostenibilidad: {
            medioambientales: detalle.flags.considera_requisitos_medioambientales,
            impacto_social_economico: detalle.flags.considera_requisitos_impacto_social_economico,
          },
          documentos_adjuntos: detalle.documentos.map((d) => ({
            id: d.id,
            nombre: d.nombre,
          })),
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
