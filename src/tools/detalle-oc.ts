/**
 * Tool: obtener_detalle_orden_compra
 *
 * Obtiene el detalle completo de una Orden de Compra (OC) en Mercado Público.
 * Admite tanto el ID numérico interno como el código alfanumérico (ej. "1057532-156-AG26").
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';

const TOOL_NAME = 'obtener_detalle_orden_compra';

const TOOL_DESCRIPTION = `Obtiene el detalle completo de una Orden de Compra (OC) emitida en Mercado Público de Chile.
Admite tanto el ID numérico (id_orden_compra) como el código alfanumérico externo.
Retorna información sobre montos (neto, impuestos, total), comprador, proveedor adjudicado y el listado de productos/servicios adquiridos.`;

const inputSchema = {
  codigo_oc: z.string().describe(
    'Código alfanumérico (ej: "1057532-156-AG26") o ID numérico (ej: "54909627") de la Orden de Compra.'
  ),
};

export function registerDetalleOC(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const response = await client.obtenerDetalleOC(args.codigo_oc);

        if (!response.Listado || response.Listado.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No se encontró ninguna Orden de Compra asociada al identificador "${args.codigo_oc}".`,
            }],
          };
        }

        const oc = response.Listado[0];

        // Estructura simplificada e informativa para el LLM
        const result = {
          codigo: oc.Codigo,
          nombre: oc.Nombre,
          estado: oc.Estado,
          codigo_estado: oc.CodigoEstado,
          licitacion_asociada: oc.CodigoLicitacion,
          descripcion: oc.Descripcion,
          fecha_creacion: oc.FechaCreacion,
          fecha_aceptacion: oc.FechaAceptacion,
          montos: {
            neto: oc.MontoNeto,
            impuestos: oc.Impuestos,
            total: oc.Total,
          },
          comprador: {
            organismo: oc.Comprador.NombreOrganismo,
            unidad: oc.Comprador.NombreUnidad,
            region: oc.Comprador.RegionUsuario,
          },
          proveedor: {
            nombre: oc.Proveedor.Nombre,
            rut: oc.Proveedor.Rut,
          },
          items: (oc.Items?.Listado ?? []).map((item) => ({
            producto: item.Producto,
            cantidad: item.Cantidad,
            precio_neto: item.PrecioNeto,
            total_neto: item.TotalLnea ?? item.TotalLinea ?? null,
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
