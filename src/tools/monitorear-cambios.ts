/**
 * Tool: monitorear_cambios_recientes
 *
 * Detecta procesos de Compra Ágil creados o modificados dentro de una ventana
 * de cambios: relativa (últimos N minutos) o absoluta (rango de fechas
 * arbitrario). Ideal para alertas, monitoreo de oportunidades y sincronización
 * incremental de un período pasado.
 */

import { z } from 'zod';
import { esquemaRegion } from '../utils/region.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient, CompraAgilItem } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import {
  conNotaHoraria, enHoraDeChile, parsearFechaUsuario, aFormatoApi, paredDeChile, ventanaUltimosMinutos,
} from '../utils/fechas.js';
import { ahora } from '../utils/reloj.js';
import { TAMANO_PAGINA_SEGURO, camposPagina } from '../utils/paginacion.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'monitorear_cambios_recientes';

const TOOL_DESCRIPTION = `Busca Compras Ágiles que hayan sido creadas o modificadas dentro de una ventana de cambios.
Ideal para monitoreo de nuevas oportunidades de negocio, alertas en tiempo real y sincronización incremental.
La ventana se define de UNA de dos formas, mutuamente excluyentes:
  • Relativa: 'minutos' (últimos N minutos, máx 1440 = 24h). Es el modo por defecto (60 min).
  • Absoluta: 'cambio_desde' + 'cambio_hasta' (rango ISO-8601 arbitrario), para resincronizar un período pasado
    o retomar desde el último timestamp procesado, sin el techo de 24 horas.
Puede combinarse con filtros de estado y región para acotar los resultados.
La API no entrega los resultados ordenados por último cambio (los agrupa, por ejemplo, por estado): para no perder el cambio más reciente, revisa todas las páginas o acota la ventana.
Las fechas de la API están en hora de Chile: la respuesta trae "fecha_cierre_hora_chile" y "ultimo_cambio_hora_chile". Confirma el plazo en la ficha del proceso.
Las fechas que indiques en "cambio_desde"/"cambio_hasta" deben declarar su zona; para hora de Chile usa el desfase vigente (ej. "-03:00").`;

/** "2026-10-06 15:42", en hora de Chile, para las glosas de la ventana. */
function enChile(d: Date): string {
  return paredDeChile(d).replace('T', ' ').slice(0, 16);
}

export const inputSchema = {
  minutos: z.number().min(1).max(1440).optional().describe(
    'Ventana RELATIVA: buscar cambios en los últimos N minutos. Ej: 60 = última hora, 1440 = últimas 24 horas. Máximo 1440 (24h). Se usa 60 por defecto si no se indica ni "minutos" ni un rango. No combinar con "cambio_desde"/"cambio_hasta".'
  ),
  cambio_desde: z.string().optional().describe(
    'Ventana ABSOLUTA: fecha/hora ISO-8601 de inicio del rango de cambios, con su zona. Ej: "2026-09-01T00:00:00-03:00" (medianoche en Chile en horario de verano). Úsala para sincronización incremental de un período arbitrario (sin el límite de 24h de "minutos"). No combinar con "minutos".'
  ),
  cambio_hasta: z.string().optional().describe(
    'Ventana ABSOLUTA: fecha/hora ISO-8601 de fin del rango de cambios, con su zona. Ej: "2026-09-02T00:00:00-03:00". Requiere "cambio_desde". No combinar con "minutos".'
  ),
  estado: z.string().optional().describe(
    'Filtrar por estado(s), separados por coma. Ej: "publicada" para solo oportunidades abiertas.'
  ),
  region: esquemaRegion(
    'Código(s) de región (1-16), separados por coma. Ej: "13" para Metropolitana.',
    { multiple: true },
  ),
  tamano_pagina: z.number().min(10).max(10).default(TAMANO_PAGINA_SEGURO).describe(
    'Fijo en 10. Una página de 50 sobre un filtro amplio responde HTTP 504. Para ver más, pide numero_pagina siguiente.'
  ),
  numero_pagina: z.number().min(1).optional().describe(
    'Número de página a consultar (comienza en 1).'
  ),
};

/** Ventana de cambios ya resuelta y lista para enviar a la API. */
export interface VentanaCambios {
  /** Parámetros de la API que definen la ventana (uno u otro grupo, nunca ambos). */
  params: { ttl_cambio_ms?: number; cambio_desde?: string; cambio_hasta?: string };
  /** Glosa legible para el reporte de salida. */
  descripcion: string;
}

/**
 * Resuelve la ventana de cambios a partir de los argumentos de la herramienta.
 *
 * La API expone dos formas mutuamente excluyentes de acotar los cambios
 * (Guía API Compra Ágil v2 §5.1, Grupo 1): `ttl_cambio_ms` (opción A) o el par
 * `cambio_desde`/`cambio_hasta` (opción B). Enviar ambas a la vez es un 400,
 * así que se decide aquí y se falla localmente para no gastar cuota.
 *
 * ⚠ LA API COMPARA EN HORA DE CHILE ETIQUETADA COMO UTC. Sus marcas de cambio
 *   son la hora de pared de Chile con una "Z", y su filtro las compara contra la
 *   hora UTC real: `ttl_cambio_ms` de 60 minutos volvía siempre vacío (medido el
 *   6-oct-2026; ver utils/fechas.ts). Por eso las dos ventanas se mandan como
 *   rango absoluto escrito como la API lo compara (`aFormatoApi`). Verificado
 *   contra la API real: los últimos 60 min trajeron 1.517 cambios, el más
 *   reciente de hace 2 min, igual que un `ttl_cambio_ms` compensado en 3 h.
 *
 * Retorna un string con el error de validación, o la ventana resuelta.
 */
export function resolverVentanaCambios(args: {
  minutos?: number;
  cambio_desde?: string;
  cambio_hasta?: string;
}, ahoraMs: number = ahora()): VentanaCambios | { error: string } {
  const usaRango = Boolean(args.cambio_desde || args.cambio_hasta);

  if (usaRango && args.minutos !== undefined) {
    return {
      error:
        'Error de validación: "minutos" (ventana relativa) y "cambio_desde"/"cambio_hasta" (ventana absoluta) son mutuamente excluyentes. Usa solo uno de los dos modos.',
    };
  }

  if (usaRango) {
    if (!args.cambio_desde) {
      return {
        error:
          'Error de validación: "cambio_hasta" requiere también "cambio_desde" para delimitar el rango.',
      };
    }
    const instantes: Record<'cambio_desde' | 'cambio_hasta', Date | null> = { cambio_desde: null, cambio_hasta: null };
    for (const nombre of ['cambio_desde', 'cambio_hasta'] as const) {
      const valor = args[nombre];
      if (!valor) continue;
      const d = parsearFechaUsuario(valor);
      if (!d || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor.trim())) {
        return {
          error: `Error de validación: "${nombre}" debe estar en formato ISO-8601 con zona horaria. Ej: "2026-09-01T00:00:00-03:00" (hora de Chile en verano) o "2026-09-01T03:00:00Z". Recibido: "${valor}".`,
        };
      }
      instantes[nombre] = d;
    }
    const desde = instantes.cambio_desde as Date;
    const hasta = instantes.cambio_hasta;
    // Se comparan instantes, no textos: "10:00-03:00" es posterior a "12:00Z".
    if (hasta && desde.getTime() > hasta.getTime()) {
      return {
        error: `Error de validación: "cambio_desde" (${args.cambio_desde}) es posterior a "cambio_hasta" (${args.cambio_hasta}). El rango quedaría vacío.`,
      };
    }

    return {
      params: { cambio_desde: aFormatoApi(desde), cambio_hasta: hasta ? aFormatoApi(hasta) : undefined },
      descripcion: hasta
        ? `Cambios entre ${enChile(desde)} y ${enChile(hasta)} (hora de Chile)`
        : `Cambios desde ${enChile(desde)} (hora de Chile)`,
    };
  }

  // Modo relativo (por defecto): 60 minutos si no se indicó nada.
  const minutos = args.minutos ?? 60;
  return {
    params: ventanaUltimosMinutos(minutos, ahoraMs),
    descripcion: `Últimos ${minutos} minutos (desde ${enChile(new Date(ahoraMs - minutos * 60_000))}, hora de Chile)`,
  };
}

/** Igual que el listado de búsqueda: el cierre crudo y su lectura en hora de Chile. */
export function resumirCambio(item: CompraAgilItem) {
  return {
    codigo: item.codigo,
    nombre: item.nombre,
    estado: item.estado.glosa,
    presupuesto_clp: item.montos.monto_disponible_clp,
    institucion: item.institucion.organismo_comprador,
    region: item.institucion.nombre_region,
    fecha_cierre: item.fechas.fecha_cierre,
    fecha_cierre_hora_chile: enHoraDeChile(item.fechas.fecha_cierre),
    ultimo_cambio: item.fechas.fecha_ultimo_cambio,
    ultimo_cambio_hora_chile: enHoraDeChile(item.fechas.fecha_ultimo_cambio),
  };
}

export function registerMonitorearCambios(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Monitorear cambios recientes",

      description: TOOL_DESCRIPTION,

      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const ventana = resolverVentanaCambios(args);
        if ('error' in ventana) {
          return {
            content: [{ type: 'text' as const, text: ventana.error }],
            isError: true,
          };
        }

        const response = await client.buscar({
          ...ventana.params,
          estado: args.estado,
          region: args.region,
          tamano_pagina: args.tamano_pagina,
          numero_pagina: args.numero_pagina,
        });

        const summary = response.items.map(resumirCambio);

        const result = conNotaHoraria({
          ventana_temporal: ventana.descripcion,
          ...camposPagina(
            response.paginacion.numero_pagina,
            response.paginacion.total_paginas,
            response.paginacion.total_resultados,
            summary.length,
            true,
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
