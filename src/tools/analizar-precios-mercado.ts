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
  type EstadisticasPrecio,
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
  region: z.string().optional().describe('Código de región para acotar el análisis (1-16). Ej: "13" para Metropolitana. Si se omite, el análisis es nacional, también con "codigo_compra": la región del comprador no se aplica sola.'),
  limite_analisis: z.number().min(1).max(15).default(5).optional().describe('Cuántos procesos históricos auditar (1-15, default 5). Cada uno consume una consulta de cuota Y una llamada de detalle, que es lo lento: medido en septiembre de 2026, entre 20 y 25 segundos cada una, con HTTP 504 intermitentes. Los detalles se piden en paralelo, así que el total se parece más al más lento que a la suma — pero subir este número aumenta la probabilidad de que alguno falle. Con 5 el análisis completo ronda los 45-55 s.'),
};

export interface ArgsPreciosMercado {
  codigo_compra?: string;
  q?: string;
  region?: string;
  limite_analisis?: number;
}

export interface CotizacionObservada {
  codigo_proceso: string;
  estado_proceso: string;
  institucion: string;
  proveedor: string;
  es_emt: boolean;
  precio_unitario: number | null;
  monto_neto: number | null;
  monto_total: number | null;
  admisible: boolean;
  motivo_inadmisibilidad: string | null;
}

export interface DatosPreciosMercado {
  _nota_metodologica: string;
  contexto?: string;
  termino_busqueda: string;
  region_analisis: string;
  cobertura: {
    procesos_encontrados: number;
    procesos_revisados: number;
    procesos_que_fallaron: number;
    _aviso_cobertura?: string;
    procesos_con_cotizaciones: number;
    cotizaciones_totales: number;
    cotizaciones_declaradas_inadmisibles: number;
    motivos_de_inadmisibilidad: string[];
    adjudicaciones_detectadas: number;
  };
  estadisticas_precio_unitario: EstadisticasPrecio | null;
  estadisticas_monto_neto: EstadisticasPrecio | null;
  base_de_la_sugerencia: 'precio_unitario' | 'monto_neto_total';
  _advertencia_dispersion?: string;
  muestra_homogenea: boolean;
  precio_sugerido_competitivo: number;
  criterio_sugerencia: string;
  rango_competitivo: { desde: number; hasta: number };
  cotizaciones_observadas: CotizacionObservada[];
  cotizaciones_inadmisibles?: CotizacionObservada[];
}

export type RecoleccionPrecios =
  | { kind: 'mensaje'; texto: string; isError: boolean }
  | { kind: 'datos'; datos: DatosPreciosMercado };

/**
 * Misma recolección que `analizar_precios_mercado`. La tool JSON y el informe
 * HTML leen este resultado. Los mensajes de vacío o de fallo se devuelven tal
 * cual: un fallo de la API no se convierte en un informe de mercado.
 */
export async function recolectarDatosPrecios(
  client: Pick<CompraAgilClient, 'buscar' | 'detalle' | 'detallesEnParalelo'> & {
    ultimoHttpDeConcurrencia?: () => number | null;
  },
  args: ArgsPreciosMercado,
): Promise<RecoleccionPrecios> {
  let keyword = args.q || '';
  const region = args.region || '';
  let regionDelComprador = '';
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
    // ⚠ La región del comprador NO se aplica como filtro. Antes se imponía sin
    //   decirlo: en la simulación con agentes (6-oct) un proceso de
    //   Valparaíso respondió «No se encontraron procesos… en la región 5.
    //   Prueba… quita el filtro de región», un filtro que el usuario no había
    //   puesto, mientras `generar_borrador_cotizacion` sobre el mismo código
    //   (que busca en todo el país) sí encontraba precios. Las desiertas con
    //   cotizaciones son escasas: acotar por región deja la muestra vacía.
    //   Quien quiera el análisis regional lo pide con `region`.
    if (!region && activa.institucion.region !== null && activa.institucion.region !== undefined) {
      regionDelComprador = String(activa.institucion.region);
    }
  }

  if (!keyword) {
    return {
      kind: 'mensaje',
      isError: true,
      texto: 'Error de validación: debes proporcionar "codigo_compra" o un término de búsqueda "q".',
    };
  }

  // 2. Buscar procesos que EXPONGAN cotizaciones.
  //
  //    Se usa SOLO `desierta`. Medición contra la API real (q="reparacion"):
  //      • estado=desierta → 5 de 8 procesos con cotizaciones, 20 precios unitarios
  //      • estado=cerrada  → 0 de 8 procesos con cotizaciones, 0 precios
  //    Los procesos `cerrada` de primer llamado no publican sus cotizaciones,
  //    así que incluirlos solo gasta cuota y tiempo (medido en septiembre de 2026:
  //    10-17 s por búsqueda y 20-25 s por detalle, con 504 intermitentes).
  //    `proveedor_seleccionado` queda descartado: devuelve 0 resultados.
  const limite = args.limite_analisis || 5;

  logger.info(`analizar_precios_mercado: buscando históricos de "${keyword}" región "${region || 'todas'}"`);
  const busqueda = await client.buscar({
    q: keyword,
    estado: 'desierta',
    region: region || undefined,
    // Solo se examinan los primeros `limite` resultados (ver más abajo),
    // así que pedir más es desperdicio — y desperdicio caro: medido en
    // producción (septiembre 2026), `estado=desierta` con búsqueda de
    // texto y tamano_pagina=50 devuelve HTTP 504 sistemáticamente porque
    // la pasarela corta a los ~30 s. Con 15 la misma consulta respondió
    // en 9,9 s. Se pide lo que se va a usar, con el mínimo de 10 que
    // exige la API.
    tamano_pagina: 10,
    numero_pagina: 1,
  });

  if (!busqueda.items?.length) {
    return {
      kind: 'mensaje',
      isError: false,
      texto: region
        ? `No se encontraron procesos históricos con cotizaciones publicadas que coincidan con "${keyword}" en la región ${region}. Prueba con un término más general o sin el parámetro "region" (análisis nacional).`
        : `No se encontraron procesos históricos con cotizaciones publicadas que coincidan con "${keyword}" en todo el país. Prueba con un término más general o con "q" en vez de "codigo_compra".`,
    };
  }

  // 3. Recolectar cotizaciones de los detalles
  const preciosUnitarios: number[] = [];
  const montosNetos: number[] = [];
  const cotizaciones: CotizacionObservada[] = [];
  const inadmisibles: CotizacionObservada[] = [];
  let procesosConDatos = 0;
  let adjudicacionesDetectadas = 0;

  // Los detalles se piden EN PARALELO, con concurrencia adaptativa. Son
  // independientes entre sí y la API tarda mucho por consulta —medido en
  // producción (septiembre 2026): 20 a 25 s cada detalle—, así que en
  // serie el total superaba los 105 s y ningún cliente MCP espera tanto.
  // En paralelo la misma tanda tardó 29,5 s. El limitador del cliente
  // baja el paralelismo si aparecen 504, para no insistir contra un
  // servicio saturado; un histórico que falla llega como `null` y se
  // descarta, PERO se cuenta (ver `consultasFallidas` más abajo).
  const seleccionados = busqueda.items.slice(0, limite);
  const detalles = await client.detallesEnParalelo(seleccionados.map((i) => i.codigo));
  const detallados = seleccionados.map((item, i) =>
    detalles[i] ? { item, det: detalles[i]! } : null
  );

  // ⚠ Cuántas consultas de detalle FALLARON, no cuántas se pretendía hacer.
  //   Sin esto, la herramienta informaba "se revisaron N procesos pero
  //   ninguno expuso cotizaciones con precios" incluso cuando las N
  //   consultas habían fallado con HTTP 504 y no se revisó nada. El
  //   usuario concluía que su rubro no tiene precios publicados —una
  //   afirmación sobre el mercado— cuando el hecho real era que la API no
  //   respondió. Observado en producción el 8 de septiembre de 2026: 6 de
  //   6 detalles devolvieron 504 y el mensaje siguió siendo el de "sin
  //   precios". Un fallo de infraestructura no puede disfrazarse de
  //   conclusión de negocio.
  const consultasIntentadas = detallados.length;
  const consultasFallidas = detallados.filter((d) => d === null).length;
  const consultasOk = consultasIntentadas - consultasFallidas;

  for (const entrada of detallados) {
    if (!entrada) continue;
    {
      const { item, det } = entrada;
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
        const registro: CotizacionObservada = {
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
    }
  }

  if (preciosUnitarios.length === 0 && montosNetos.length === 0) {
    // Sin datos hay dos causas muy distintas y no deben confundirse:
    // que la API no respondiera, o que respondiera sin precios.
    if (consultasOk === 0) {
      return {
        kind: 'mensaje',
        isError: true,
        texto: [
          `No se pudo consultar el detalle de ninguno de los ${consultasIntentadas} procesos que coinciden con "${keyword}": las ${consultasFallidas} consultas fallaron.`,
          '',
          '⚠ Esto NO significa que no haya precios publicados para este rubro: significa que la API no respondió. No saques conclusiones de mercado desde este resultado.',
          consultasIntentadas <= 1
            ? 'Reintenta en unos minutos. Esta consulta ya pidió el mínimo de procesos.'
            : 'Reintenta en unos minutos. Si persiste, baja "limite_analisis" para pedir menos por vez.',
          ...(typeof client.ultimoHttpDeConcurrencia === 'function' && client.ultimoHttpDeConcurrencia() !== null
            ? [`El corte visto en esta tanda fue HTTP ${client.ultimoHttpDeConcurrencia()}.`]
            : []),
        ].join('\n'),
      };
    }

    const aviso = consultasFallidas > 0
      ? `\n⚠ Además, ${consultasFallidas} de las ${consultasIntentadas} consultas de detalle fallaron, así que la cobertura real fue menor a la pedida.`
      : '';

    return {
      kind: 'mensaje',
      isError: false,
      texto: [
        `Se revisaron ${consultasOk} procesos históricos que coinciden con "${keyword}", y ninguno expuso cotizaciones con precios.`,
        '',
        'Esto es habitual: la API de Mercado Público solo publica las cotizaciones de algunos procesos.',
        'Sugerencias: usa un término más general, amplía "limite_analisis", o quita el filtro de región.' + aviso,
      ].join('\n'),
    };
  }

  // 4. Estadísticas y recomendación
  const statsUnitario = calcularEstadisticas(preciosUnitarios);
  const statsNeto = calcularEstadisticas(montosNetos);
  const base = statsUnitario ?? statsNeto!;
  const tipoBase = statsUnitario ? 'precio_unitario' as const : 'monto_neto_total' as const;

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

  const resultado: DatosPreciosMercado = {
    _nota_metodologica: [
      'Precios COTIZADOS por proveedores, NO adjudicados: la API de Mercado Público no expone qué oferta ganó (el estado "proveedor_seleccionado" devuelve 0 resultados y ninguna cotización viene marcada como seleccionada).',
      'La muestra proviene de procesos declarados DESIERTOS, los únicos que publican sus cotizaciones (medido: desierta 5/8 procesos con precios; cerrada 0/8).',
      'Las cotizaciones declaradas inadmisibles SÍ se incluyen en las estadísticas: en los procesos desiertos casi todas lo son, y el precio ofertado sigue siendo señal de mercado aunque se haya rechazado el papeleo. Revisa "motivos_de_inadmisibilidad": si predomina "sobrepasa el monto máximo", la muestra está sesgada hacia arriba; si predominan motivos formales (garantías, certificados), los precios son representativos.',
    ].join(' '),
    contexto: contextoProceso || undefined,
    termino_busqueda: keyword,
    region_analisis: region
      ? `Región ${region}`
      : regionDelComprador
        ? `Todas las regiones (el comprador es de la región ${regionDelComprador}; pasa "region": "${regionDelComprador}" para acotar)`
        : 'Todas las regiones',
    cobertura: {
      procesos_encontrados: busqueda.paginacion.total_resultados,
      procesos_revisados: consultasOk,
      procesos_que_fallaron: consultasFallidas,
      ...(consultasFallidas > 0 && {
        _aviso_cobertura: `${consultasFallidas} de ${consultasIntentadas} consultas de detalle fallaron (la API no respondió), así que la muestra es más chica que la pedida. No interpretes esto como escasez de datos del rubro.`,
      }),
      procesos_con_cotizaciones: procesosConDatos,
      cotizaciones_totales: cotizaciones.length,
      cotizaciones_declaradas_inadmisibles: inadmisibles.length,
      motivos_de_inadmisibilidad: inadmisibles.length > 0
        ? [...new Set(inadmisibles.map((c) => c.motivo_inadmisibilidad).filter((m): m is string => Boolean(m)))]
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

  return { kind: 'datos', datos: resultado };
}

export function registerAnalizarPreciosMercado(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    { title: "Analizar precios de mercado", description: TOOL_DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } },
    async (args) => {
      try {
        const recoleccion = await recolectarDatosPrecios(client, args);
        if (recoleccion.kind === 'mensaje') {
          return {
            content: [{ type: 'text' as const, text: recoleccion.texto }],
            ...(recoleccion.isError ? { isError: true as const } : {}),
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(recoleccion.datos, null, 2) }],
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
