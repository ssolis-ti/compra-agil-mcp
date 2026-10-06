/**
 * Tool: obtener_detalle_compra
 *
 * Obtiene el detalle completo de una Compra Ágil específica,
 * incluyendo productos, proveedores, cotizaciones y estado de OC.
 */

import { z } from 'zod';
import { esquemaCodigoCompra } from '../utils/validacion.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient, CompraAgilDetalle, ProveedorCotizando } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { conNotaHoraria, enHoraDeChile } from '../utils/fechas.js';
import { esAdmisible } from '../utils/quotation.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'obtener_detalle_compra';

const TOOL_DESCRIPTION = `Obtiene el detalle completo de una Compra Ágil específica por su código único.
Incluye: descripción del proceso, productos solicitados con cantidades, proveedores que cotizaron con sus montos,
presupuesto disponible, dirección y plazo de entrega, estado de la Orden de Compra (si fue emitida),
y flags de sostenibilidad (requisitos medioambientales y de impacto social).
Incluye estado_codigo, el número de llamado (estado_convocatoria) y fecha_ultimo_cambio. Si la moneda no es CLP, incluye el tipo de cambio. Una cotización inadmisible trae su justificación.
Las fechas de la API están en hora de Chile: la respuesta trae "cierre_hora_chile" y la misma lectura para los cierres de cada llamado y el último cambio. Confirma el plazo en la ficha del proceso.
NOTA: medido contra la API real (45 procesos), las cotizaciones con sus precios vienen en los procesos "desierta" (5 de 8 los traían) y no en los "cerrada" de primer llamado (0 de 8). La guía oficial dice que se muestran desde "Cerrada" en segundo llamado, pero no se pudo confirmar. Una lista de proveedores vacía en un proceso publicado o cerrado no significa que no haya ofertas: mira "total_ofertas".`;

const inputSchema = {
  codigo: esquemaCodigoCompra().describe(
    'Código único de la Compra Ágil. Formato: XXXXXX-YYY-COTXX. Ej: "1057539-228-COT26".'
  ),
};

/**
 * Fechas del detalle. Los campos crudos son el texto de la API; los `*_hora_chile`
 * son su lectura validada (la API entrega hora de Chile, aunque algunos campos
 * digan "Z"; ver utils/fechas.ts).
 */
export function fechasDeDetalle(detalle: Pick<CompraAgilDetalle, 'fechas' | 'convocatoria'>) {
  return {
    publicacion: detalle.fechas.fecha_publicacion,
    cierre: detalle.fechas.fecha_cierre,
    cierre_hora_chile: enHoraDeChile(detalle.fechas.fecha_cierre),
    cierre_primer_llamado: detalle.convocatoria.fecha_cierre_primer_llamado,
    cierre_primer_llamado_hora_chile: enHoraDeChile(detalle.convocatoria.fecha_cierre_primer_llamado),
    cierre_segundo_llamado: detalle.convocatoria.fecha_cierre_segundo_llamado,
    cierre_segundo_llamado_hora_chile: enHoraDeChile(detalle.convocatoria.fecha_cierre_segundo_llamado),
    ultimo_cambio: detalle.fechas.fecha_ultimo_cambio,
    ultimo_cambio_hora_chile: enHoraDeChile(detalle.fechas.fecha_ultimo_cambio),
    cancelacion: detalle.fechas.fecha_cancelacion,
  };
}

/**
 * Orden de compra del detalle. S18: sin id de OC la API no informa, no niega:
 * `tiene_oc` es `null` («no informado»), no `false`. La API de Compra Ágil no
 * publica adjudicaciones (0 de 45 procesos con id_orden_compra).
 */
export function ordenCompraDeDetalle(detalle: Pick<CompraAgilDetalle, 'id_orden_compra' | 'orden_compra'>) {
  const id = detalle.id_orden_compra ?? detalle.orden_compra?.id_orden_compra ?? null;
  return {
    tiene_oc: id !== null ? true : null,
    id_orden_compra: id,
    id_oc: detalle.orden_compra?.id_oc ?? null,
    codigo_oc: detalle.orden_compra?.codigo_orden_compra ?? null,
    estado_oc: detalle.orden_compra?.estado_orden_compra ?? null,
  };
}

/** El tipo de cambio solo aparece cuando el presupuesto no está en pesos. */
export function presupuestoDeDetalle(presupuesto: CompraAgilDetalle['presupuesto']) {
  const visible = {
    tipo: presupuesto.tipo_presupuesto,
    monto_disponible_clp: presupuesto.monto_disponible_clp,
    moneda: presupuesto.moneda,
    presupuesto_estimado: presupuesto.presupuesto_estimado,
  };
  if (presupuesto.moneda.trim().toUpperCase() === 'CLP') return visible;
  return {
    ...visible,
    valor_cambio_moneda: presupuesto.valor_cambio_moneda,
    fecha_cambio_moneda: presupuesto.fecha_cambio_moneda,
  };
}

/** La justificación se omite cuando la cotización es admisible. No afirma una adjudicación. */
export function resumirCotizante(prov: ProveedorCotizando) {
  const resumen = {
    rut: prov.rut_proveedor,
    razon_social: prov.razon_social,
    es_empresa_menor_tamano: prov.es_emt,
    monto_total: prov.monto_total,
    valor_neto: prov.valor_neto,
    impuesto: prov.total_impuesto,
    despacho: prov.monto_despacho,
    descripcion: prov.descripcion_cotizacion || prov.descripcion,
    estado_por_comprador: prov.estado_por_comprador,
    admisible: esAdmisible(prov),
    productos_cotizados: prov.productos_cotizados?.map((pc) => ({
      nombre: pc.nombre_producto,
      cantidad: pc.cantidad,
      precio_unitario: pc.precio_unitario,
      total: pc.monto_total_producto,
    })),
  };
  if (resumen.admisible) return resumen;
  return {
    ...resumen,
    justificacion_inadmisibilidad: String(prov.justificacion_inadmisibilidad).trim(),
  };
}

export function registerDetalleCompra(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Detalle de una Compra Ágil",

      description: TOOL_DESCRIPTION,

      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const detalle = await client.detalle(args.codigo);

        // Formatear para LLM — estructura limpia y legible
        const result = conNotaHoraria({
          codigo: detalle.codigo,
          nombre: detalle.nombre,
          descripcion: detalle.descripcion,
          estado: detalle.estado.glosa,
          estado_codigo: detalle.estado.codigo,
          convocatoria: detalle.convocatoria.descripcion,
          estado_convocatoria: detalle.convocatoria.estado_convocatoria,
          institucion: {
            organismo: detalle.institucion.organismo_comprador,
            rut: detalle.institucion.rut,
            unidad: detalle.institucion.unidad_compra,
            region: detalle.institucion.nombre_region,
          },
          fechas: fechasDeDetalle(detalle),
          presupuesto: presupuestoDeDetalle(detalle.presupuesto),
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
          proveedores_cotizando: detalle.proveedores_cotizando.map(resumirCotizante),
          orden_compra: ordenCompraDeDetalle(detalle),
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
        });

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
