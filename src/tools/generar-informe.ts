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
import { esquemaRegion } from '../utils/region.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

import { recolectarDatosRadar } from './radar-oportunidades.js';
import { construirBorradorCotizacion } from './generar-borrador.js';
import { recolectarDatosPrecios } from './analizar-precios-mercado.js';
import { recolectarDatosAuditoria } from './auditar-desiertas.js';
import { compararCotizantes } from '../utils/competencia.js';
import { renderRadarInforme } from '../reports/templates/radar-oportunidades.js';
import { renderCotizacionInforme } from '../reports/templates/cotizacion.js';
import { renderPrecioInforme } from '../reports/templates/precio.js';
import { renderAuditoriaInforme } from '../reports/templates/auditoria.js';
import { renderCompetenciaInforme } from '../reports/templates/competencia.js';
import { escribirInforme, slug, stamp, RutaSalidaError, resolverDirectorioSalida } from '../reports/export.js';
import path from 'path';
import { clp } from '../reports/format.js';
import { PAPEL, FORMATO_POR_DEFECTO, type FormatoPapel } from '../reports/theme.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'generar_informe';

const TOOL_DESCRIPTION = `Genera un informe profesional imprimible (HTML con diseño de impresión) a partir de los datos de Compra Ágil.
El archivo se guarda en disco y la herramienta devuelve la RUTA del archivo (no su contenido, para no saturar el contexto).
El usuario puede abrirlo en su navegador y exportarlo a PDF con Ctrl+P (el diseño está optimizado para impresión: saltos de página controlados y cabeceras de tabla repetidas).
Formatos de papel: "carta" (216×279mm, estándar de oficina en Chile, por defecto), "oficio" (216×330mm, folio chileno para documentos oficiales) y "a4" (210×297mm, estándar ISO).
Tipos disponibles:
- "radar": Radar de oportunidades activas priorizadas por facilidad de adjudicación (KPIs, gráfico de puntuación, fichas destacadas y listado completo).
- "cotizacion": Borrador presentable de una cotización (ítems, neto, IVA 19 %, total y carta). Requiere codigo_compra. No se envía a Mercado Público.
- "precio": Distribución de precios cotizados, no adjudicados, con gráfico. Requiere codigo_compra o q.
- "auditoria": Brechas de presupuesto y plazo de un proceso desierto, con las recomendaciones de auditar_compras_desiertas. Requiere codigo_compra o q.
- "competencia": Tabla de cotizantes y la brecha entre el menor y el mayor monto neto. Requiere codigo_compra. No identifica un adjudicado.`;

const inputSchema = {
  tipo: z.enum(['radar', 'cotizacion', 'precio', 'auditoria', 'competencia']).describe(
    'Tipo de informe: "radar", "cotizacion", "precio", "auditoria" o "competencia".'
  ),
  formato_papel: z.enum(['carta', 'oficio', 'a4']).default('carta').optional().describe(
    'Tamaño de papel: "carta" (216×279mm, el más usado en oficinas chilenas, por defecto), "oficio" (216×330mm, folio chileno para documentos oficiales/legales) o "a4" (210×297mm, estándar ISO).'
  ),
  region: esquemaRegion('Código de región para acotar (1-16). Ej: "13" para Metropolitana. Lo usan "radar" y "precio".'),
  q: z.string().optional().describe('Término de búsqueda para acotar a un rubro o producto (ej: "licencias"). Lo usan "radar", "precio" y "auditoria".'),
  presupuesto_minimo: z.number().optional().describe('Solo "radar". Filtrar procesos con presupuesto disponible mayor o igual a este monto en CLP.'),
  limite_resultados: z.number().min(1).max(50).default(20).optional().describe('Solo "radar". Cantidad máxima de oportunidades a incluir en el informe (1-50, default 20).'),
  max_paginas: z.number().min(1).max(10).default(3).optional().describe('Solo "radar". Cuántas páginas de 10 resultados escanear (1-10, default 3). Cada página es una consulta de unos 8 s. Una página de 50 del mismo filtro responde HTTP 504.'),
  codigo_compra: z.string().optional().describe('Código de la Compra Ágil. Obligatorio en "cotizacion" y "competencia". En "precio" y "auditoria" arma la búsqueda si no viene "q".'),
  rut_proveedor: z.string().optional().describe('Solo "cotizacion". RUT del proveedor. Si se omite, el borrador marca un placeholder.'),
  razon_social: z.string().optional().describe('Solo "cotizacion". Razón social. Si se omite, el borrador marca un placeholder.'),
  precio_unitario_personalizado: z.number().optional().describe('Solo "cotizacion". Precio unitario neto. Si se omite, se estima con el mismo criterio del borrador JSON.'),
  plazo_entrega_dias: z.number().optional().describe('Solo "cotizacion". Plazo de entrega en días. Si se omite, se usa el del comprador o 5.'),
  descripcion_propuesta: z.string().optional().describe('Solo "cotizacion". Mensaje comercial que entra en la carta.'),
  limite_analisis: z.number().min(1).max(15).optional().describe('Procesos históricos a revisar. En "precio", 1-15 (default 5). En "auditoria", 1-8 (default 3).'),
  ruta_salida: z.string().optional().describe('Subcarpeta dentro de la carpeta de informes (ej: "radar/octubre"). Si se omite, se usa la carpeta de informes: "informes/" del directorio de trabajo, o la que fije COMPRA_AGIL_INFORMES_DIR. No acepta carpetas fuera de ella.'),
};

function texto(contenido: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text: contenido }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function entregar(
  html: string,
  nombre: string,
  formato: FormatoPapel,
  rutaSalida: string | undefined,
  lineas: string[],
) {
  const { ruta, bytes } = escribirInforme(html, nombre, rutaSalida);
  const papel = formato === 'carta' ? 'Carta / Letter' : formato === 'oficio' ? 'Oficio / Folio (216×330mm)' : 'A4';
  const resumen = [
    `✅ Informe generado: ${ruta}`,
    `   (${(bytes / 1024).toFixed(1)} KB · formato ${PAPEL[formato].glosa})`,
    `   Ábrelo en el navegador y usa Ctrl+P para exportar a PDF.`,
    `   ⚠ En el diálogo de impresión selecciona el papel "${papel}" para que calce exactamente.`,
    ``,
    `Resumen del contenido:`,
    ...lineas,
    ``,
    `Carpeta de informes: ${path.dirname(ruta)}`,
  ].join('\n');
  return texto(resumen);
}

export function registerGenerarInforme(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Generar informe imprimible",

      description: TOOL_DESCRIPTION,

      // Único tool con efecto en disco: crea un archivo HTML nuevo por llamada.

      // No destruye nada (solo agrega) y no es idempotente (cada informe lleva su timestamp).

      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        // Antes de gastar cuota: una carpeta fuera de la raíz se rechaza ya.
        resolverDirectorioSalida(args.ruta_salida);

        if (args.tipo === 'radar') {
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
            `• ${sinOferentes} con 0 ofertas en el listado`,
            `• ${ops.filter((o) => o.horas_restantes <= 24).length} cierran en menos de 24 horas`,
            `• Monto total en juego: ${clp(montoTotal)}`,
            mejor ? `• Mejor oportunidad: ${mejor.nombre} (${mejor.codigo}) — ${mejor.puntuacion_caliente} pts` : '',
            ``,
            `Carpeta de informes: ${path.dirname(ruta)}`,
          ].filter(Boolean).join('\n');

          return {
            content: [{ type: 'text' as const, text: resumen }],
          };
        }

        logger.info(`generar_informe: construyendo informe "${args.tipo}"`);
        const generadoEn = new Date();
        const formato = args.formato_papel ?? FORMATO_POR_DEFECTO;

        if (args.tipo === 'cotizacion') {
          if (!args.codigo_compra) {
            return texto('Error de validación: el informe "cotizacion" requiere "codigo_compra".', true);
          }
          const borrador = await construirBorradorCotizacion(client, {
            codigo_compra: args.codigo_compra,
            rut_proveedor: args.rut_proveedor,
            razon_social: args.razon_social,
            precio_unitario_personalizado: args.precio_unitario_personalizado,
            plazo_entrega_dias: args.plazo_entrega_dias,
            descripcion_propuesta: args.descripcion_propuesta,
          });
          const html = renderCotizacionInforme({ borrador, generadoEn, formato });
          const nombre = `cotizacion-${slug(borrador.codigo_compra)}-${formato}-${stamp(generadoEn)}.html`;
          return entregar(html, nombre, formato, args.ruta_salida, [
            `• ${borrador.codigo_compra} — ${borrador.nombre_compra}`,
            `• ${borrador.productos_cotizados.length} ítem(s), total ${clp(borrador.monto_total)} (IVA incluido)`,
            borrador.comparacion_presupuesto
              ? `• Presupuesto del comprador ${clp(borrador.comparacion_presupuesto.presupuesto_comprador)}: ${borrador.comparacion_presupuesto.monto_total_sobre_presupuesto ? '⚠ el total lo SUPERA' : 'el total cabe'}`
              : '• El proceso no informa presupuesto',
            ...(borrador._campos_a_revisar.length > 0
              ? [`• ${borrador._campos_a_revisar.length} advertencia(s) antes de presentar:`, ...borrador._campos_a_revisar.map((a) => `  - ${a}`)]
              : ['• Sin advertencias']),
          ]);
        }

        if (args.tipo === 'precio') {
          const recoleccion = await recolectarDatosPrecios(client, {
            codigo_compra: args.codigo_compra,
            q: args.q,
            region: args.region,
            limite_analisis: args.limite_analisis,
          });
          if (recoleccion.kind === 'mensaje') return texto(recoleccion.texto, recoleccion.isError);
          const datos = recoleccion.datos;
          const html = renderPrecioInforme({ datos, generadoEn, formato });
          const nombre = `precio-${slug(datos.termino_busqueda)}-${formato}-${stamp(generadoEn)}.html`;
          return entregar(html, nombre, formato, args.ruta_salida, [
            `• ${datos.termino_busqueda} — ${datos.region_analisis}`,
            `• Sugerido (p25): ${clp(datos.precio_sugerido_competitivo)} sobre ${datos.cobertura.cotizaciones_totales} cotizaciones`,
            datos.muestra_homogenea
              ? '• La muestra es homogénea'
              : '• La muestra está dispersa: el número sugerido vale poco',
          ]);
        }

        if (args.tipo === 'auditoria') {
          if (args.limite_analisis !== undefined && args.limite_analisis > 8) {
            return texto('Error de validación: en el informe "auditoria", "limite_analisis" va de 1 a 8.', true);
          }
          const recoleccion = await recolectarDatosAuditoria(client, {
            codigo_compra: args.codigo_compra,
            q: args.q,
            limite_analisis: args.limite_analisis,
          });
          if (recoleccion.kind === 'mensaje') return texto(recoleccion.texto, recoleccion.isError);
          const datos = recoleccion.datos;
          const html = renderAuditoriaInforme({ datos, generadoEn, formato });
          const nombre = `auditoria-${slug(datos.proceso_auditado.codigo)}-${formato}-${stamp(generadoEn)}.html`;
          const g = datos.analisis_de_brechas;
          const brechas = [
            g.presupuesto_insuficiente ? 'presupuesto' : '',
            g.plazo_insuficiente ? 'plazo' : '',
            g.requisitos_complejos ? 'requisitos' : '',
          ].filter(Boolean);
          const noEvaluables = [
            g.presupuesto_insuficiente === null ? 'presupuesto' : '',
            g.plazo_insuficiente === null ? 'plazo' : '',
          ].filter(Boolean);
          return entregar(html, nombre, formato, args.ruta_salida, [
            `• ${datos.proceso_auditado.codigo} — ${datos.proceso_auditado.nombre}`,
            `• ${datos.recomendaciones_de_optimizacion.length} recomendación(es)`,
            brechas.length > 0 ? `• Brechas: ${brechas.join(', ')}` : '• Sin brecha marcada en lo que se pudo evaluar',
            ...(noEvaluables.length > 0 ? [`• No evaluable (sin comparables ni evidencia): ${noEvaluables.join(', ')}`] : []),
          ]);
        }

        if (!args.codigo_compra) {
          return texto('Error de validación: el informe "competencia" requiere "codigo_compra".', true);
        }
        const detalle = await client.detalle(args.codigo_compra);
        const datos = compararCotizantes(detalle);
        const html = renderCompetenciaInforme({ datos, generadoEn, formato });
        const nombre = `competencia-${slug(datos.codigo)}-${formato}-${stamp(generadoEn)}.html`;
        return entregar(html, nombre, formato, args.ruta_salida, [
          `• ${datos.codigo} — ${datos.nombre}`,
          `• ${datos.spread.cotizaciones} cotización(es), ${datos.spread.inadmisibles} inadmisible(s)`,
          datos.spread.brecha_neto === null
            ? '• Sin brecha: hace falta más de un monto neto'
            : `• Brecha entre el menor y el mayor neto: ${clp(datos.spread.brecha_neto)}`,
          '• No identifica un proveedor adjudicado',
        ]);
      } catch (error) {
        const message = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : error instanceof RutaSalidaError
            ? error.message
            : `Error inesperado al generar el informe: ${safeError(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
