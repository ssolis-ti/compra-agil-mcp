/**
 * Tool: generar_informe
 *
 * Genera informes profesionales (HTML imprimible) a partir de los datos del MCP.
 *
 * DISEÑO: el HTML nunca se devuelve al LLM — se escribe a disco y la tool
 * retorna solo la ruta y un resumen breve. Un informe pesa decenas de KB y
 * retornarlo consumiría miles de tokens de contexto por llamada.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

import { recolectarDatosRadar } from './radar-oportunidades.js';
import { renderRadarInforme } from '../reports/templates/radar-oportunidades.js';
import { escribirInforme, slug, stamp, defaultOutputDir } from '../reports/export.js';
import { clp } from '../reports/format.js';
import { PAPEL, FORMATO_POR_DEFECTO } from '../reports/theme.js';

const TOOL_NAME = 'generar_informe';

const TOOL_DESCRIPTION = `Genera un informe profesional imprimible (HTML con diseño de impresión) a partir de los datos de Compra Ágil.
El archivo se guarda en disco y la herramienta devuelve la RUTA del archivo (no su contenido, para no saturar el contexto).
El usuario puede abrirlo en su navegador y exportarlo a PDF con Ctrl+P (el diseño está optimizado para impresión: saltos de página controlados y cabeceras de tabla repetidas).
Formatos de papel: "carta" (216×279mm, estándar de oficina en Chile, por defecto), "oficio" (216×330mm, folio chileno para documentos oficiales) y "a4" (210×297mm, estándar ISO).
Tipos disponibles:
- "radar": Radar de oportunidades activas priorizadas por facilidad de adjudicación (KPIs, gráfico de puntuación, fichas destacadas y listado completo).`;

const inputSchema = {
  tipo: z.enum(['radar']).describe('Tipo de informe a generar. Actualmente disponible: "radar".'),
  formato_papel: z.enum(['carta', 'oficio', 'a4']).default('carta').optional().describe(
    'Tamaño de papel: "carta" (216×279mm, el más usado en oficinas chilenas, por defecto), "oficio" (216×330mm, folio chileno para documentos oficiales/legales) o "a4" (210×297mm, estándar ISO).'
  ),
  region: z.string().optional().describe('Código de región para acotar (1-16). Ej: "13" para Metropolitana.'),
  q: z.string().optional().describe('Término de búsqueda para acotar a un rubro o producto (ej: "licencias").'),
  presupuesto_minimo: z.number().optional().describe('Filtrar procesos con presupuesto disponible mayor o igual a este monto en CLP.'),
  limite_resultados: z.number().min(1).max(50).default(20).optional().describe('Cantidad máxima de oportunidades a incluir en el informe (1-50, default 20).'),
  max_paginas: z.number().min(1).max(10).default(3).optional().describe('Páginas de 50 resultados a escanear (1-10, default 3).'),
  ruta_salida: z.string().optional().describe('Directorio donde guardar el informe. Si se omite, se usa la carpeta "informes/" del directorio de trabajo.'),
};

export function registerGenerarInforme(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        if (args.tipo !== 'radar') {
          return {
            content: [{ type: 'text' as const, text: `Tipo de informe no soportado: "${args.tipo}".` }],
            isError: true,
          };
        }

        logger.info(`generar_informe: construyendo informe "${args.tipo}"`);
        const generadoEn = new Date();

        // 1. Recolectar datos con la MISMA función que usa la tool JSON del radar
        const datos = await recolectarDatosRadar(client, {
          region: args.region,
          q: args.q,
          presupuesto_minimo: args.presupuesto_minimo,
          limite_resultados: args.limite_resultados ?? 20,
          max_paginas: args.max_paginas,
        }, generadoEn.getTime());

        // 2. Renderizar el HTML en el formato de papel solicitado
        const formato = args.formato_papel ?? FORMATO_POR_DEFECTO;
        const html = renderRadarInforme({
          oportunidades: datos.oportunidades,
          totalAnalizadas: datos.totalAnalizadas,
          filtros: {
            region: args.region,
            q: args.q,
            presupuestoMinimo: args.presupuesto_minimo,
            paginasEscaneadas: datos.paginasEscaneadas,
          },
          generadoEn,
          formato,
        });

        // 3. Escribir a disco y devolver SOLO la ruta + resumen
        const ambito = args.region ? `region-${args.region}` : 'nacional';
        const rubro = args.q ? `-${slug(args.q)}` : '';
        const nombre = `radar-${ambito}${rubro}-${formato}-${stamp(generadoEn)}.html`;
        const { ruta, bytes } = escribirInforme(html, nombre, args.ruta_salida);

        const ops = datos.oportunidades;
        const sinOferentes = ops.filter((o) => o.ofertas_recibidas === 0).length;
        const montoTotal = ops.reduce((acc, o) => acc + (o.presupuesto_disponible || 0), 0);
        const mejor = ops[0];

        const resumen = [
          `✅ Informe generado: ${ruta}`,
          `   (${(bytes / 1024).toFixed(1)} KB · formato ${PAPEL[formato].glosa})`,
          `   Ábrelo en el navegador y usa Ctrl+P para exportar a PDF.`,
          `   ⚠ En el diálogo de impresión selecciona el papel "${formato === 'carta' ? 'Carta / Letter' : formato === 'oficio' ? 'Oficio / Folio (216×330mm)' : 'A4'}" para que calce exactamente.`,
          ``,
          `Resumen del contenido:`,
          `• ${ops.length} oportunidades incluidas (de ${datos.totalAnalizadas} vigentes analizadas)`,
          `• ${sinOferentes} sin oferentes (competencia cero)`,
          `• ${ops.filter((o) => o.horas_restantes <= 24).length} cierran en menos de 24 horas`,
          `• Monto total en juego: ${clp(montoTotal)}`,
          mejor ? `• Mejor oportunidad: ${mejor.nombre} (${mejor.codigo}) — ${mejor.puntuacion_caliente} pts` : '',
          ``,
          `Carpeta de informes: ${args.ruta_salida ? args.ruta_salida : defaultOutputDir()}`,
        ].filter(Boolean).join('\n');

        return {
          content: [{ type: 'text' as const, text: resumen }],
        };
      } catch (error) {
        const message = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : `Error inesperado al generar el informe: ${String(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
