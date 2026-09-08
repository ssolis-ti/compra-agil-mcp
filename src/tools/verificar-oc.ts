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

const TOOL_DESCRIPTION = `Informa si una Compra Ágil tiene Orden de Compra emitida, leyendo id_orden_compra del detalle.
⚠ LIMITACIÓN VERIFICADA (julio 2026, re-confirmada en septiembre): en 45 procesos inspeccionados NINGUNO traía id_orden_compra, y el filtro "proveedor_seleccionado" devuelve 0 resultados. La API de Compra Ágil no publica adjudicaciones. Por eso esta herramienta NO consulta la API por su cuenta —sería gastar cuota para responder "no puedo saberlo"—: reutiliza el detalle si ya se pidió con "obtener_detalle_compra", y en cualquier caso indica cómo confirmarlo en la ficha pública.
Un "sin OC" NO prueba que la OC no exista: significa que la API no la expone.`;

const inputSchema = {
  codigo: z.string().describe(
    'Código único de la Compra Ágil a verificar. Formato: XXXXXX-YYY-COTXX. Ej: "1057539-228-COT26".'
  ),
};

export function registerVerificarOC(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Verificar Orden de Compra",

      description: TOOL_DESCRIPTION,

      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        // ⚠ NO se consulta la API si el detalle no está ya en caché.
        //   Esta herramienta gastaba una consulta de cuota para responder algo
        //   que la API estructuralmente no publica: en 45 procesos inspeccionados
        //   más las verificaciones de septiembre 2026, NINGUNO trajo
        //   id_orden_compra. Pagar cuota por un "no puedo saberlo" garantizado
        //   es el peor negocio posible cuando el balde de tokens es escaso.
        //
        //   Si el detalle ya se pagó antes (flujo natural: obtener_detalle_compra
        //   y luego preguntar por la OC), se aprovecha y la respuesta va completa
        //   sin costo. Si no, se responde igual con la explicación y la ficha.
        const detalle = client.detalleEnCache(args.codigo);

        if (!detalle) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                codigo: args.codigo,
                verificacion_oc: {
                  tiene_orden_compra: null,
                  motivo: 'No se consultó la API a propósito, para no gastar cuota en una respuesta que se conoce de antemano: la API de Compra Ágil no publica adjudicaciones ni órdenes de compra (0 de 45 procesos inspeccionados traían id_orden_compra, re-verificado en septiembre de 2026).',
                  como_confirmarlo: `Abre la ficha pública del proceso, que sí muestra el estado real: https://buscador.mercadopublico.cl/ficha?code=${args.codigo}`,
                  si_quieres_los_datos_del_proceso: 'Llama primero a "obtener_detalle_compra"; después esta herramienta reutiliza ese detalle sin costo adicional y te informa lo que la API sí trae.',
                },
              }, null, 2),
            }],
          };
        }

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
