/**
 * Tool: analizar_precios_mercado
 *
 * Analiza la distribución de precios COTIZADOS por proveedores en procesos
 * históricos de Compra Ágil similares.
 *
 * POR QUÉ "COTIZADOS" Y NO "GANADORES":
 * Se verificó empíricamente contra la API real que los procesos adjudicados
 * NO son consultables (el filtro `estado=proveedor_seleccionado` devuelve 0
 * resultados y ninguna cotización trae `proveedor_seleccionado=1`).
 * Lo que la API sí expone son las cotizaciones presentadas, con su
 * `precio_unitario` real. Eso es señal de mercado genuina — y es lo que se
 * analiza aquí, sin prometer un dato que el servicio no entrega.
 *
 * Reemplaza a la antigua `recomendar_precio_ganador`, que buscaba adjudicaciones
 * y por tanto nunca encontraba datos.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { safeError } from '../utils/redact.js';
import {
  esGanador, esAdmisible, extraerPrecioUnitario, extraerMontoNeto,
  calcularEstadisticas,
} from '../utils/quotation.js';

const TOOL_NAME = 'analizar_precios_mercado';

const TOOL_DESCRIPTION = `Analiza a qué precios está cotizando el mercado en procesos históricos de Compra Ágil similares, para posicionar una oferta competitiva.
Admite el código de una compra activa (extrae sus palabras clave automáticamente) o un término de búsqueda.
Retorna la distribución de precios unitarios cotizados (mínimo, percentil 25, mediana, promedio, máximo) y el detalle de cada cotización observada.

LIMITACIONES IMPORTANTES, verificadas contra la API real (julio 2026):
1. Analiza precios COTIZADOS, no adjudicados. La API no expone qué oferta ganó (el estado "proveedor_seleccionado" devuelve 0 resultados y ninguna cotización viene marcada como seleccionada). La referencia es lo que ofertó la competencia.
2. Los precios provienen de procesos declarados DESIERTOS, porque son los únicos que publican sus cotizaciones (medido: desierta 5/8 procesos con precios, cerrada 0/8). Muchas deserciones se deben a incumplimientos formales (garantías, certificados) y no a que el precio fuera malo, por lo que siguen siendo señal de mercado válida — pero conviene interpretarlas con ese contexto.
3. Las cotizaciones declaradas inadmisibles por el comprador se reportan aparte y se excluyen de las estadísticas.`;

const inputSchema = {
  codigo_compra: z.string().optional().describe('Código de una Compra Ágil para extraer sus palabras clave automáticamente (ej: "1057539-228-COT26"). Opcional si se especifica "q".'),
  q: z.string().optional().describe('Término de búsqueda del producto/servicio a cotizar (ej: "resmas papel", "reactivos"). Opcional si se especifica "codigo_compra".'),
  region: z.string().optional().describe('Código de región para acotar el análisis (1-16). Ej: "13" para Metropolitana.'),
  limite_analisis: z.number().min(1).max(15).default(8).optional().describe('Cuántos procesos históricos auditar (1-15, default 8). Cada uno consume una consulta de cuota y la API es lenta (~1-5s por consulta).'),
};

export function registerAnalizarPreciosMercado(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    { description: TOOL_DESCRIPTION, inputSchema },
    async (args) => {
      try {
        let keyword = args.q || '';
        let region = args.region || '';
        let contextoProceso = '';

        // 1. Si dan un código, extraer keyword y región de ese proceso
        if (args.codigo_compra) {
          logger.info(`analizar_precios_mercado: leyendo compra ${args.codigo_compra}`);
          const activa = await client.detalle(args.codigo_compra);
          if (activa.productos_solicitados?.length > 0) {
            const p = activa.productos_solicitados[0];
            keyword = p.nombre;
            contextoProceso = `Producto solicitado: "${p.nombre}" (cantidad ${p.cantidad} ${p.unidad_medida})`;
          } else {
            keyword = activa.nombre;
            contextoProceso = `Proceso: "${activa.nombre}"`;
          }
          if (!region && activa.institucion.region !== null) {
            region = String(activa.institucion.region);
          }
        }

        if (!keyword) {
          return {
            content: [{ type: 'text' as const, text: 'Error de validación: debes proporcionar "codigo_compra" o un término de búsqueda "q".' }],
            isError: true,
          };
        }

        // 2. Buscar procesos que EXPONGAN cotizaciones.
        //
        //    Se usa SOLO `desierta`. Medición contra la API real (q="reparacion"):
        //      • estado=desierta → 5 de 8 procesos con cotizaciones, 20 precios unitarios
        //      • estado=cerrada  → 0 de 8 procesos con cotizaciones, 0 precios
        //    Los procesos `cerrada` de primer llamado no publican sus cotizaciones,
        //    así que incluirlos solo gasta cuota y tiempo (la API tarda 1-5s por consulta).
        //    `proveedor_seleccionado` queda descartado: devuelve 0 resultados.
        logger.info(`analizar_precios_mercado: buscando históricos de "${keyword}" región "${region || 'todas'}"`);
        const busqueda = await client.buscar({
          q: keyword,
          estado: 'desierta',
          region: region || undefined,
          tamano_pagina: 50, // mínimo de la API es 10; 50 maximiza el material por consulta
          numero_pagina: 1,
        });

        if (!busqueda.items?.length) {
          return {
            content: [{ type: 'text' as const, text: `No se encontraron procesos históricos con cotizaciones publicadas que coincidan con "${keyword}"${region ? ` en la región ${region}` : ''}. Prueba con un término más general o quita el filtro de región.` }],
          };
        }

        // 3. Recolectar cotizaciones de los detalles
        const limite = args.limite_analisis || 8;
        const preciosUnitarios: number[] = [];
        const montosNetos: number[] = [];
        const cotizaciones: any[] = [];
        const inadmisibles: any[] = [];
        let procesosConDatos = 0;
        let adjudicacionesDetectadas = 0;

        for (const item of busqueda.items.slice(0, limite)) {
          try {
            const det = await client.detalle(item.codigo);
            const provs = det.proveedores_cotizando ?? [];
            if (provs.length === 0) continue;
            procesosConDatos++;

            for (const prov of provs) {
              const unitario = extraerPrecioUnitario(prov, keyword);
              const neto = extraerMontoNeto(prov);
              const admisible = esAdmisible(prov);
              // Si la API alguna vez publica adjudicaciones, lo reportamos.
              if (esGanador(prov)) adjudicacionesDetectadas++;

              // Las cotizaciones inadmisibles SÍ entran en las estadísticas.
              // Motivo: en los procesos desiertos —única fuente de precios de la API—
              // prácticamente todas las cotizaciones fueron declaradas inadmisibles;
              // excluirlas dejaba la muestra vacía. Y el precio que un proveedor ofertó
              // es señal de mercado real aunque le hayan rechazado el papeleo (ej:
              // "no cumple con garantía solicitada"). Se anota el motivo de cada una
              // para que quien lea pueda ponderarlas — sobre todo las rechazadas por
              // precio ("sobrepasa el monto máximo"), que sesgan la muestra hacia arriba.
              const registro = {
                codigo_proceso: item.codigo,
                estado_proceso: det.estado.glosa,
                institucion: det.institucion.organismo_comprador,
                proveedor: prov.razon_social,
                es_emt: prov.es_emt,
                precio_unitario: unitario,
                monto_neto: neto,
                monto_total: prov.monto_total ?? null,
                admisible,
                motivo_inadmisibilidad: prov.justificacion_inadmisibilidad ?? null,
              };

              if (unitario !== null) preciosUnitarios.push(unitario);
              if (neto !== null) montosNetos.push(neto);
              cotizaciones.push(registro);
              if (!admisible) inadmisibles.push(registro);
            }
          } catch (e) {
            logger.warn(`analizar_precios_mercado: falló el detalle de ${item.codigo}: ${safeError(e)}`);
          }
        }

        if (preciosUnitarios.length === 0 && montosNetos.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: [
                `Se revisaron ${Math.min(limite, busqueda.items.length)} procesos históricos que coinciden con "${keyword}", pero ninguno expuso cotizaciones con precios.`,
                '',
                'Esto es habitual: la API de Mercado Público solo publica las cotizaciones de algunos procesos.',
                'Sugerencias: usa un término más general, amplía "limite_analisis", o quita el filtro de región.',
              ].join('\n'),
            }],
          };
        }

        // 4. Estadísticas y recomendación
        const statsUnitario = calcularEstadisticas(preciosUnitarios);
        const statsNeto = calcularEstadisticas(montosNetos);
        const base = statsUnitario ?? statsNeto!;
        const tipoBase = statsUnitario ? 'precio_unitario' : 'monto_neto_total';

        // El percentil 25 es una referencia competitiva más robusta que "5% bajo el
        // promedio": resiste valores atípicos y refleja el cuarto más económico.
        const sugerido = base.p25;

        // Control de dispersión: la búsqueda por palabra clave puede mezclar productos
        // muy distintos (ej. "reparación" trae desde materiales de $5.000 hasta
        // servicios de $5.000.000). En ese caso el estadístico es aritméticamente
        // correcto pero engañoso, y hay que decirlo en vez de entregar un número
        // con falsa precisión.
        const dispersion = base.mediana > 0 ? base.maximo / base.mediana : 0;
        const muestraHeterogenea = dispersion > 10;
        const advertenciaDispersion = muestraHeterogenea
          ? `⚠ MUESTRA MUY DISPERSA: el precio máximo (${base.maximo.toLocaleString('es-CL')}) es ${Math.round(dispersion)} veces la mediana (${base.mediana.toLocaleString('es-CL')}). El término "${keyword}" probablemente está mezclando productos o servicios de naturaleza distinta, así que este precio sugerido tiene poco valor. Acota la búsqueda con un término más específico o usa "codigo_compra" para partir del producto exacto.`
          : undefined;

        const resultado = {
          _nota_metodologica: [
            'Precios COTIZADOS por proveedores, NO adjudicados: la API de Mercado Público no expone qué oferta ganó (el estado "proveedor_seleccionado" devuelve 0 resultados y ninguna cotización viene marcada como seleccionada).',
            'La muestra proviene de procesos declarados DESIERTOS, los únicos que publican sus cotizaciones (medido: desierta 5/8 procesos con precios; cerrada 0/8).',
            'Las cotizaciones declaradas inadmisibles SÍ se incluyen en las estadísticas: en los procesos desiertos casi todas lo son, y el precio ofertado sigue siendo señal de mercado aunque se haya rechazado el papeleo. Revisa "motivos_de_inadmisibilidad": si predomina "sobrepasa el monto máximo", la muestra está sesgada hacia arriba; si predominan motivos formales (garantías, certificados), los precios son representativos.',
          ].join(' '),
          contexto: contextoProceso || undefined,
          termino_busqueda: keyword,
          region_analisis: region ? `Región ${region}` : 'Todas las regiones',
          cobertura: {
            procesos_encontrados: busqueda.paginacion.total_resultados,
            procesos_revisados: Math.min(limite, busqueda.items.length),
            procesos_con_cotizaciones: procesosConDatos,
            cotizaciones_totales: cotizaciones.length,
            cotizaciones_declaradas_inadmisibles: inadmisibles.length,
            motivos_de_inadmisibilidad: inadmisibles.length > 0
              ? [...new Set(inadmisibles.map((c) => c.motivo_inadmisibilidad).filter(Boolean))]
              : [],
            adjudicaciones_detectadas: adjudicacionesDetectadas,
          },
          estadisticas_precio_unitario: statsUnitario,
          estadisticas_monto_neto: statsNeto,
          base_de_la_sugerencia: tipoBase,
          _advertencia_dispersion: advertenciaDispersion,
          muestra_homogenea: !muestraHeterogenea,
          precio_sugerido_competitivo: sugerido,
          criterio_sugerencia: 'Percentil 25 de la distribución cotizada: te ubica en el cuarto más económico sin regalar margen. Resiste valores atípicos mejor que el promedio.',
          rango_competitivo: { desde: base.minimo, hasta: base.mediana },
          cotizaciones_observadas: cotizaciones,
          cotizaciones_inadmisibles: inadmisibles.length > 0 ? inadmisibles : undefined,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(resultado, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : `Error inesperado al analizar precios de mercado: ${safeError(error)}`;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );
}
