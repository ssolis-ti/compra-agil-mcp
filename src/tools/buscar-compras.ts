/**
 * Tool: buscar_compras_agiles
 *
 * Busca y filtra procesos de Compra Ágil en Mercado Público
 * usando palabras clave, fechas, estados y regiones.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient, CompraAgilItem } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { conNotaHoraria, enHoraDeChile } from '../utils/fechas.js';
import { TAMANO_PAGINA_SEGURO, camposPagina } from '../utils/paginacion.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'buscar_compras_agiles';

const TOOL_DESCRIPTION = `Busca procesos de Compra Ágil en Mercado Público de Chile.
Permite filtrar por palabras clave, estado del proceso, región geográfica y rango de fechas de publicación.
Retorna un listado resumido con código, nombre, estado, presupuesto e institución compradora.
La fecha de cierre llega sin zona horaria: la respuesta incluye "_nota_horaria" y "fecha_cierre_hora_chile", calculada asumiendo UTC. Confirma el plazo en la ficha del proceso.
Cada resultado trae el RUT del organismo y fecha_ultimo_cambio. motivo_seleccion solo aparece si la API lo envió con texto; un valor presente no prueba que haya un proveedor adjudicado.
Hay que enviar al menos un filtro de la API: estado, region, q, id, publicado_desde o publicado_hasta. Sin ninguno, esta herramienta no hace la llamada. El orden, la página y las palabras clave locales no cuentan: las palabras se aplican después, sobre la respuesta.
Nota: los parámetros 'q' (búsqueda por texto) e 'id' (código exacto) son mutuamente excluyentes.
Estados que devuelven filas: publicada, cerrada, desierta, cancelada. proveedor_seleccionado devuelve 0 filas y oc_emitida responde HTTP 400.
Regiones: códigos del 1 al 16 (ej: 13 = Metropolitana, 5 = Valparaíso).`;

export const inputSchema = {
  q: z.string().optional().describe(
    'Palabras clave para buscar en el nombre/descripción del proceso. Ej: "materiales electricos". No usar junto con "id".'
  ),
  id: z.string().optional().describe(
    'Código exacto de una Compra Ágil. Ej: "1057539-228-COT26". No usar junto con "q".'
  ),
  estado: z.string().optional().describe(
    'Estado(s) que devuelven filas, separados por coma: publicada, cerrada, desierta, cancelada. proveedor_seleccionado devuelve 0 filas. oc_emitida responde HTTP 400.'
  ),
  region: z.string().optional().describe(
    'Código(s) de región del organismo comprador, separados por coma (1-16). Ej: "13" para Metropolitana, "13,5" para Metropolitana y Valparaíso.'
  ),
  publicado_desde: z.string().optional().describe(
    'Fecha mínima de publicación en formato ISO-8601. Ej: "2026-01-01T00:00:00Z".'
  ),
  publicado_hasta: z.string().optional().describe(
    'Fecha máxima de publicación en formato ISO-8601. Ej: "2026-01-31T23:59:59Z".'
  ),
  palabras_clave_requeridas: z.string().optional().describe(
    'Lista de palabras clave separadas por comas que DEBEN estar presentes en el nombre de la compra (filtro local. Ej: "software,desarrollo").'
  ),
  palabras_clave_excluidas: z.string().optional().describe(
    'Lista de palabras clave separadas por comas que NO DEBEN estar en el nombre de la compra (filtro local. Ej: "soporte,licencias").'
  ),
  ordenar_por: z.enum(['FechaUltimaModificacion', 'FechaPublicacion']).optional().describe(
    'Criterio de ordenamiento. "FechaPublicacion" para las más recientes primero, "FechaUltimaModificacion" (default) para las últimas modificadas.'
  ),
  tamano_pagina: z.number().min(10).max(10).default(TAMANO_PAGINA_SEGURO).describe(
    'Fijo en 10. Una página de 50 sobre un filtro amplio responde HTTP 504.'
  ),
  numero_pagina: z.number().min(1).optional().describe(
    'Número de página a consultar (comienza en 1).'
  ),
};

/** Filtros que la API acepta. Paginación, orden y palabras locales no disparan la consulta. */
const FILTROS_API = ['q', 'id', 'estado', 'region', 'publicado_desde', 'publicado_hasta'] as const;

export function tieneFiltroDeApi(args: Partial<Record<(typeof FILTROS_API)[number], string>>): boolean {
  return FILTROS_API.some((clave) => {
    const valor = args[clave];
    return typeof valor === 'string' && valor.trim().length > 0;
  });
}

const MENSAJE_SIN_FILTRO = [
  'No se hizo la llamada.',
  'Indica al menos uno de estos filtros: estado, region, q, id, publicado_desde o publicado_hasta.',
  'El orden, el tamaño de página y palabras_clave_requeridas/excluidas no cuentan: se aplican aquí, después de que la API responde.',
].join(' ');

/** Listado que ve el modelo. El cierre crudo se conserva; al lado va la hora de Chile bajo la suposición UTC. */
export function resumirCompraBusqueda(item: CompraAgilItem) {
  const resumen = {
    codigo: item.codigo,
    nombre: item.nombre,
    estado: item.estado.glosa,
    estado_codigo: item.estado.codigo,
    convocatoria: item.convocatoria.descripcion,
    estado_convocatoria: item.convocatoria.estado_convocatoria,
    presupuesto_clp: item.montos.monto_disponible_clp,
    moneda: item.montos.moneda,
    tipo_cambio: null,
    tipo_cambio_nota: (item.montos.moneda ?? '').trim().toUpperCase() === 'CLP'
      ? 'omitido porque la moneda es CLP'
      : 'el listado no trae el tipo de cambio; pídelo en el detalle',
    institucion: item.institucion.organismo_comprador,
    rut_organismo: item.institucion.rut,
    region: item.institucion.nombre_region,
    fecha_publicacion: item.fechas.fecha_publicacion,
    fecha_publicacion_hora_chile: enHoraDeChile(item.fechas.fecha_publicacion),
    fecha_cierre: item.fechas.fecha_cierre,
    fecha_cierre_hora_chile: enHoraDeChile(item.fechas.fecha_cierre),
    fecha_ultimo_cambio: item.fechas.fecha_ultimo_cambio,
    fecha_ultimo_cambio_hora_chile: enHoraDeChile(item.fechas.fecha_ultimo_cambio),
    ofertas_recibidas: item.resumen.total_ofertas_recibidas,
  };
  const conOfertas = item.resumen.total_ofertas_recibidas === 0
    ? { ...resumen, _nota_ofertas: 'El listado informa 0 ofertas. No es un hecho de la ficha.' }
    : resumen;
  const motivo = item.motivos.motivo_seleccion?.trim();
  if (!motivo) return conOfertas;
  return { ...conOfertas, motivo_seleccion: motivo };
}

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
        let filteredItems = response.items;

        // Filtrado local por palabras_clave_requeridas (AND lógico entre los términos)
        if (args.palabras_clave_requeridas) {
          const reqKeywords = args.palabras_clave_requeridas
            .split(',')
            .map(kw => kw.trim().toLowerCase())
            .filter(Boolean);
          if (reqKeywords.length > 0) {
            filteredItems = filteredItems.filter(item => {
              const nameLower = item.nombre.toLowerCase();
              return reqKeywords.every(kw => nameLower.includes(kw));
            });
          }
        }

        // Filtrado local por palabras_clave_excluidas (OR lógico entre los términos)
        if (args.palabras_clave_excluidas) {
          const excKeywords = args.palabras_clave_excluidas
            .split(',')
            .map(kw => kw.trim().toLowerCase())
            .filter(Boolean);
          if (excKeywords.length > 0) {
            filteredItems = filteredItems.filter(item => {
              const nameLower = item.nombre.toLowerCase();
              return !excKeywords.some(kw => nameLower.includes(kw));
            });
          }
        }

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
