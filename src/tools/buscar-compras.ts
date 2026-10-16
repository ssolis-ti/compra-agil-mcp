/**
 * Tool: buscar_compras_agiles
 *
 * Busca y filtra procesos de Compra Ágil en Mercado Público
 * usando palabras clave, fechas, estados y regiones.
 */

import { filtrarPorPalabras } from '../utils/palabras-clave.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { esquemaBusqueda, resumirCompraBusqueda, tieneFiltroDeApi } from '../api/busqueda.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { conNotaHoraria } from '../utils/fechas.js';
import { camposPagina } from '../utils/paginacion.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'buscar_compras_agiles';

const TOOL_DESCRIPTION = `Busca procesos de Compra Ágil en Mercado Público de Chile.
Permite filtrar por palabras clave, estado del proceso, región geográfica y rango de fechas de publicación.
Retorna un listado resumido con código, nombre, estado, presupuesto e institución compradora.
Las fechas de la API están en hora de Chile: la respuesta trae "fecha_cierre_hora_chile". Confirma el plazo en la ficha del proceso.
Cada resultado trae el RUT del organismo y fecha_ultimo_cambio. motivo_seleccion solo aparece si la API lo envió con texto; un valor presente no prueba que haya un proveedor adjudicado.
"ofertas_recibidas" es el dato del listado: la ficha (obtener_detalle_compra) puede informar otro número, y es la que vale. La búsqueda de texto de la API es amplia y puede traer procesos de otro rubro: acota con "palabras_clave_requeridas"/"palabras_clave_excluidas".
Hay que enviar al menos un filtro de la API: estado, region, q, id, publicado_desde o publicado_hasta. Sin ninguno, esta herramienta no hace la llamada. El orden, la página y las palabras clave locales no cuentan: las palabras se aplican después, sobre la respuesta.
Nota: los parámetros 'q' (búsqueda por texto) e 'id' (código exacto) son mutuamente excluyentes.
Estados que devuelven filas: publicada, cerrada, desierta, cancelada. proveedor_seleccionado devuelve 0 filas y oc_emitida responde HTTP 400.
Regiones: códigos del 1 al 16 (ej: 13 = Metropolitana, 5 = Valparaíso).`;

export { resumirCompraBusqueda, tieneFiltroDeApi };
export const inputSchema = esquemaBusqueda;


const MENSAJE_SIN_FILTRO = [
  'No se hizo la llamada.',
  'Indica al menos uno de estos filtros: estado, region, q, id, publicado_desde o publicado_hasta.',
  'El orden, el tamaño de página y palabras_clave_requeridas/excluidas no cuentan: se aplican aquí, después de que la API responde.',
].join(' ');

export function registerBuscarCompras(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Buscar Compras Ágiles",

      description: TOOL_DESCRIPTION,

      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        if (!tieneFiltroDeApi(args)) {
          return {
            content: [{ type: 'text' as const, text: MENSAJE_SIN_FILTRO }],
            isError: true,
          };
        }

        // Validar exclusión mutua de q e id
        if (args.q && args.id) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error de validación: Los parámetros "q" (búsqueda por texto) e "id" (código exacto) no pueden usarse juntos. Usa solo uno de los dos.',
            }],
            isError: true,
          };
        }

        const response = await client.buscar({
          q: args.q,
          id: args.id,
          estado: args.estado,
          region: args.region,
          publicado_desde: args.publicado_desde,
          publicado_hasta: args.publicado_hasta,
          ordenar_por: args.ordenar_por,
          tamano_pagina: args.tamano_pagina,
          numero_pagina: args.numero_pagina,
        });

        // Formatear resultado compacto para el LLM
        // Requeridas: todas (Y); excluidas: basta una (O). Sin tildes ni
        // mayúsculas. Compartido con las herramientas de análisis (E7).
        const filteredItems = filtrarPorPalabras(response.items, args).items;

        const summary = filteredItems.map(resumirCompraBusqueda);

        const result = conNotaHoraria({
          ...camposPagina(
            response.paginacion.numero_pagina,
            response.paginacion.total_paginas,
            response.paginacion.total_resultados,
            filteredItems.length,
          ),
          resultados: summary,
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
