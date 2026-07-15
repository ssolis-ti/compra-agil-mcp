/**
 * Resource: compra-agil://estados
 *
 * Catálogo de estados válidos de una Compra Ágil con descripciones
 * y notas sobre comportamiento real de la API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Catálogo de estados con el comportamiento REAL medido contra la API
 * (julio 2026). La documentación oficial difiere en dos puntos importantes,
 * verificados empíricamente y anotados abajo.
 */
const ESTADOS = [
  {
    codigo: 'publicada',
    descripcion: 'La Compra Ágil está abierta y recibiendo cotizaciones de proveedores.',
    funciona: true,
    nota: 'Es el estado a usar para buscar oportunidades vigentes.',
  },
  {
    codigo: 'cerrada',
    descripcion: 'El plazo de cotización finalizó. El organismo está evaluando las ofertas.',
    funciona: true,
    nota: 'En la muestra observada, los procesos "cerrada" de primer llamado NO exponen sus cotizaciones (proveedores_cotizando viene vacío).',
  },
  {
    codigo: 'desierta',
    descripcion: 'No se recibieron ofertas válidas para este proceso.',
    funciona: true,
    nota: 'Contraintuitivo pero útil: los procesos desiertos SÍ suelen exponer las cotizaciones que recibieron (y por qué fueron declaradas inadmisibles). Es la mejor fuente de precios de mercado disponible en la API.',
  },
  {
    codigo: 'cancelada',
    descripcion: 'El proceso fue cancelado por el organismo comprador.',
    funciona: true,
    nota: 'El motivo está en motivos.motivo_cancelacion del detalle.',
  },
  {
    codigo: 'proveedor_seleccionado',
    descripcion: 'Documentado como "se seleccionó al proveedor ganador".',
    funciona: false,
    nota: '⚠ LIMITACIÓN VERIFICADA: la API acepta este filtro pero devuelve SIEMPRE 0 resultados. Además, en 45 procesos inspeccionados con 52 cotizaciones, el campo proveedor_seleccionado valió 0 en el 100% de los casos y ningún proceso traía id_orden_compra. CONCLUSIÓN: la API no expone procesos adjudicados. No bases análisis en este estado. Para precios de mercado usa "analizar_precios_mercado", que se apoya en cotizaciones reales.',
  },
  {
    codigo: 'oc_emitida',
    descripcion: 'Documentado como "se emitió una Orden de Compra".',
    funciona: false,
    nota: '⚠ LIMITACIÓN VERIFICADA: enviar este valor devuelve HTTP 400 (Parámetros de consulta inválidos). No es un filtro válido, pese a estar documentado.',
  },
];

/** Advertencia general que acompaña al catálogo. */
const ADVERTENCIA = 'Estados verificados contra la API real en julio de 2026. Solo publicada, cerrada, desierta y cancelada devuelven datos. proveedor_seleccionado devuelve 0 resultados y oc_emitida da error 400, pese a estar ambos documentados oficialmente.';

export function registerEstadosResource(server: McpServer): void {
  server.registerResource(
    'estados',
    'compra-agil://estados',
    {
      description: 'Catálogo de estados de una Compra Ágil con su comportamiento REAL verificado contra la API. Consúltalo antes de filtrar por estado: dos de los estados documentados oficialmente (proveedor_seleccionado y oc_emitida) NO funcionan en la práctica.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'compra-agil://estados',
        mimeType: 'application/json',
        text: JSON.stringify({ _advertencia: ADVERTENCIA, estados: ESTADOS }, null, 2),
      }],
    })
  );
}
