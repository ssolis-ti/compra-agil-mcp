/**
 * Tool: verificar_orden_compra
 *
 * Verifica si una Compra Ágil ya tiene una Orden de Compra (OC) emitida.
 * Resuelve la limitación documentada donde el estado "oc_emitida" no aparece
 * en la práctica y el campo codigo_orden_compra retorna null incluso con OC emitida.
 *
 * Implementa la lógica del Ejemplo 8.6 de la documentación oficial.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { esGanador } from '../utils/quotation.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'verificar_orden_compra';

const TOOL_DESCRIPTION = `Verifica si una Compra Ágil específica ya tiene una Orden de Compra (OC) emitida, leyendo id_orden_compra del detalle y cruzándolo con la API de Órdenes de Compra.
⚠ LIMITACIÓN VERIFICADA EMPÍRICAMENTE (julio 2026): en 45 procesos inspeccionados, NINGUNO traía id_orden_compra (siempre null), y el filtro de estado "proveedor_seleccionado" devuelve 0 resultados. En la práctica, la API de Compra Ágil no está publicando adjudicaciones ni órdenes de compra, por lo que esta herramienta reportará "sin OC" en la mayoría o totalidad de los casos.
Un resultado "sin OC" NO significa necesariamente que la OC no exista: puede significar que la API no la expone. Para confirmarlo, consulta la ficha pública del proceso en https://buscador.mercadopublico.cl/ficha?code={codigo}`;

const inputSchema = {
  codigo: z.string().describe(
    'Código único de la Compra Ágil a verificar. Formato: XXXXXX-YYY-COTXX. Ej: "1057539-228-COT26".'
  ),
};

export function registerVerificarOC(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const detalle = await client.detalle(args.codigo);

        const idOrdenCompra = detalle.id_orden_compra ?? detalle.orden_compra?.id_orden_compra ?? null;
        const idOc = detalle.orden_compra?.id_oc ?? null;
        const tieneOC = idOrdenCompra !== null && idOrdenCompra !== undefined;

        let detalleOCInfo = null;
        if (tieneOC) {
          try {
            const ocResponse = await client.obtenerDetalleOC(idOrdenCompra);
            if (ocResponse.Listado && ocResponse.Listado.length > 0) {
              const oc = ocResponse.Listado[0];
              detalleOCInfo = {
                codigo_oc: oc.Codigo,
                nombre_oc: oc.Nombre,
                estado_oc: oc.Estado,
                codigo_estado_oc: oc.CodigoEstado,
                monto_total: oc.Total,
                fecha_creacion: oc.FechaCreacion,
                fecha_aceptacion: oc.FechaAceptacion,
              };
            }
          } catch (e) {
            logger.warn(`No se pudo obtener el detalle de la OC ${idOrdenCompra} desde la API: ${safeError(e)}`);
          }
        }

        const result = {
          codigo: detalle.codigo,
          nombre: detalle.nombre,
          estado_actual: detalle.estado.glosa,
          convocatoria: detalle.convocatoria.descripcion,
          verificacion_oc: {
            tiene_orden_compra: tieneOC,
            id_orden_compra: idOrdenCompra,
            id_oc: idOc,
            codigo_orden_compra: detalleOCInfo?.codigo_oc ?? detalle.orden_compra?.codigo_orden_compra ?? null,
            estado_orden_compra: detalleOCInfo?.estado_oc ?? detalle.orden_compra?.estado_orden_compra ?? null,
            detalle_orden: detalleOCInfo,
            nota: tieneOC
              ? `La OC fue emitida. Código: ${detalleOCInfo?.codigo_oc ?? 'Desconocido'}. Usa la herramienta obtener_detalle_orden_compra para profundizar.`
              : `La API no reporta Orden de Compra para este proceso (id_orden_compra = null). ⚠ Ojo: esto NO prueba que la OC no exista. Se verificó que la API de Compra Ágil no está publicando adjudicaciones (45 procesos inspeccionados, 0 con id_orden_compra). Para confirmarlo consulta la ficha pública: https://buscador.mercadopublico.cl/ficha?code=${detalle.codigo}`,
          },
          proveedor_seleccionado: detalle.proveedores_cotizando
            .filter(esGanador)
            .map((p) => ({
              rut: p.rut_proveedor,
              razon_social: p.razon_social,
              monto_total: p.monto_total,
            })),
          presupuesto_clp: detalle.presupuesto.monto_disponible_clp,
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
