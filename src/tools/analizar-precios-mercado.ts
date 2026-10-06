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
import { esquemaCodigoCompra } from '../utils/validacion.js';
import { esquemaRegion } from '../utils/region.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { safeError } from '../utils/redact.js';
import { describirFallosDetalle } from '../utils/presupuesto.js';
import { terminoComparables } from '../utils/doc-search.js';
import { filtrarPorPalabras, esquemaPalabrasComparables, textoSinCoincidencias, type FiltroPalabras } from '../utils/palabras-clave.js';
import type { CompraAgilDetalle, CompraAgilItem } from '../api/compra-agil-client.js';

const mensajeDeError = (error: unknown) =>
  error instanceof CompraAgilApiError ? error.actionableMessage : safeError(error);
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
3. Las cotizaciones declaradas inadmisibles por el comprador SÍ entran en las estadísticas principales: en los procesos desiertos suelen ser muchas y excluirlas puede dejar la muestra vacía. Cada una viene marcada con su motivo, y "estadisticas_precio_unitario_solo_admisibles" trae la misma distribución sin ellas para comparar.`;

const inputSchema = {
  codigo_compra: esquemaCodigoCompra().optional().describe('Código de una Compra Ágil para extraer sus palabras clave automáticamente (ej: "1057539-228-COT26"). Opcional si se especifica "q".'),
  q: z.string().optional().describe('Término de búsqueda del producto/servicio a cotizar (ej: "resmas papel", "reactivos"). Opcional si se especifica "codigo_compra".'),
  region: esquemaRegion('Código de región para acotar el análisis (1-16). Ej: "13" para Metropolitana. Si se omite, el análisis es nacional, también con "codigo_compra": la región del comprador no se aplica sola.'),
  limite_analisis: z.number().min(1).max(15).default(5).optional().describe('Cuántos procesos históricos auditar (1-15, default 5). Cada uno consume una consulta de cuota Y una llamada de detalle, que es lo lento: medido en septiembre de 2026, entre 20 y 25 segundos cada una, con HTTP 504 intermitentes. Los detalles se piden en paralelo, así que el total se parece más al más lento que a la suma — pero subir este número aumenta la probabilidad de que alguno falle. Con 5 el análisis completo ronda los 45-55 s.'),
  ...esquemaPalabrasComparables(),
};

export interface ArgsPreciosMercado extends FiltroPalabras {
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
    /** Procesos del listado descartados por palabras_clave_requeridas/excluidas (E7). */
    filtrados_por_palabras_clave?: number;
    procesos_revisados: number;
    procesos_que_fallaron: number;
    /** Qué procesos no se pudieron leer, para abrirlos a mano en su ficha. */
    procesos_que_fallaron_detalle?: Array<{ codigo: string; motivo: 'api_no_respondio' | 'omitido_por_tiempo'; ficha: string }>;
    _aviso_cobertura?: string;
    procesos_con_cotizaciones: number;
    cotizaciones_totales: number;
    cotizaciones_declaradas_inadmisibles: number;
    motivos_de_inadmisibilidad: string[];
    adjudicaciones_detectadas: number;
  };
  estadisticas_precio_unitario: EstadisticasPrecio | null;
  /** La misma distribución sin las cotizaciones inadmisibles. */
  estadisticas_precio_unitario_solo_admisibles: EstadisticasPrecio | null;
  estadisticas_monto_neto: EstadisticasPrecio | null;
  base_de_la_sugerencia: 'precio_unitario' | 'monto_neto_total';
  _advertencia_dispersion?: string;
  muestra_homogenea: boolean;
  /**
   * Si la muestra alcanza para usar el precio sugerido como referencia.
   * `muestra_homogenea` solo mide dispersión: cuatro precios de un único
   * comprador pueden ser homogéneos y aun así no representar al mercado.
   */
  suficiencia_muestra: {
    nivel: 'baja' | 'media' | 'suficiente';
    procesos_con_cotizaciones: number;
    compradores_distintos: number;
    precios_unitarios: number;
    nota: string;
  };
  /** Presente si la búsqueda de históricos salió de la caché local. */
  _frescura?: string;
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
    // ⚠ S12 (segunda simulación y enjambre, 6-oct): si el detalle del proceso
    //   de referencia daba 504, el análisis entero fallaba con el texto del
    //   504. El listado (`buscar` por `id`) es más liviano y suele responder
    //   cuando el detalle no: de ahí sale el nombre para buscar comparables.
    let activa: CompraAgilDetalle | null = null;
    let errorDetalle: unknown = null;
    try {
      activa = await client.detalle(args.codigo_compra);
    } catch (error) {
      errorDetalle = error;
    }
    if (activa) {
      if (activa.productos_solicitados?.length > 0) {
        const p = activa.productos_solicitados[0];
        keyword = p.nombre;
        contextoProceso = `Producto solicitado: "${p.nombre}" (cantidad ${p.cantidad} ${p.unidad_medida})`;
      } else {
        keyword = activa.nombre;
        contextoProceso = `Proceso: "${activa.nombre}"`;
      }
    } else {
      let delListado: CompraAgilItem | undefined;
      try {
        delListado = (await client.buscar({ id: args.codigo_compra, tamano_pagina: 10, numero_pagina: 1 })).items?.[0];
      } catch {
        // Sin listado tampoco: se informa el fallo del detalle, que es el primero.
      }
      if (!delListado && !args.q) {
        return {
          kind: 'mensaje',
          isError: true,
          texto: `No se pudo leer el proceso ${args.codigo_compra}, así que no se sabe qué producto analizar. Falló al pedir su detalle: ${mensajeDeError(errorDetalle)} ` +
            `Reintenta en unos minutos, o usa "q" con el nombre del producto para analizar precios sin depender de ese proceso.`,
        };
      }
      keyword = args.q || terminoComparables(delListado!.nombre, 3);
      contextoProceso = delListado
        ? `Proceso: "${delListado.nombre}" (el detalle no respondió; el término de búsqueda sale del nombre del listado)`
        : `Proceso ${args.codigo_compra} (el detalle no respondió; se usa el término indicado en "q")`;
    }
    const regionActiva = activa?.institucion.region;
    // ⚠ La región del comprador NO se aplica como filtro. Antes se imponía sin
    //   decirlo: en la simulación con agentes (6-oct) un proceso de
    //   Valparaíso respondió «No se encontraron procesos… en la región 5.
    //   Prueba… quita el filtro de región», un filtro que el usuario no había
    //   puesto, mientras `generar_borrador_cotizacion` sobre el mismo código
    //   (que busca en todo el país) sí encontraba precios. Las desiertas con
    //   cotizaciones son escasas: acotar por región deja la muestra vacía.
    //   Quien quiera el análisis regional lo pide con `region`.
    if (!region && regionActiva !== null && regionActiva !== undefined) {
      regionDelComprador = String(regionActiva);
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
  const paramsBusqueda = {
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
  };
  // Antes de buscar: si la respuesta ya está en caché, se informa su edad.
  // En la simulación con agentes (6-oct) repetir el análisis devolvía en 2 ms
  // la misma respuesta sin decir que era una copia.
  const edadCache = typeof (client as Partial<CompraAgilClient>).edadBusquedaEnCache === 'function'
    ? (client as CompraAgilClient).edadBusquedaEnCache(paramsBusqueda)
    : undefined;
  let busqueda: Awaited<ReturnType<typeof client.buscar>>;
  try {
    busqueda = await client.buscar(paramsBusqueda);
  } catch (error) {
    // Se dice en qué paso falló: sin eso el usuario no sabe si reintentar
    // con otro término o esperar (enjambre, 6-oct).
    return {
      kind: 'mensaje',
      isError: true,
      texto: `Falló la búsqueda de procesos históricos con «${keyword}», el primer paso del análisis; no se consultó ningún detalle. ${mensajeDeError(error)}`,
    };
  }

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
  const preciosUnitariosAdmisibles: number[] = [];
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
  // E7: el filtro se aplica al listado antes de pedir detalles (no gasta cuota).
  const filtrado = filtrarPorPalabras(busqueda.items, args);
  if (filtrado.items.length === 0) {
    return { kind: 'mensaje', isError: false, texto: textoSinCoincidencias(busqueda.items.length, args) };
  }
  const seleccionados = filtrado.items.slice(0, limite);
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
  const fallidos = detallados
    .map((d, i) => (d === null ? seleccionados[i].codigo : null))
    .filter((c): c is string => c !== null);
  const fallos = describirFallosDetalle(fallidos, consultasIntentadas);

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
        if (unitario !== null && admisible) preciosUnitariosAdmisibles.push(unitario);
        if (neto !== null) montosNetos.push(neto);
        cotizaciones.push(registro);
        if (!admisible) inadmisibles.push(registro);
      }
    }
  }

  if (preciosUnitarios.length === 0 && montosNetos.length === 0) {
    // Sin datos hay dos causas muy distintas y no deben confundirse:
    // que la API no respondiera, o que respondiera sin precios.
    if (consultasOk === 0 && fallos.porTiempo.length === consultasIntentadas) {
      return {
        kind: 'mensaje',
        isError: true,
        texto: [
          `No alcanzó el tiempo para consultar el detalle de ninguno de los ${consultasIntentadas} procesos que coinciden con "${keyword}": el límite propio de consultas por minuto ya estaba lleno por consultas recientes, y esperar habría pasado el corte del cliente MCP.`,
          '',
          '⚠ Esto NO dice nada del mercado ni de la API, y no gastó cuota. Reintenta en un minuto, o baja "limite_analisis" para pedir menos de una vez.',
        ].join('\n'),
      };
    }
    if (consultasOk === 0) {
      return {
        kind: 'mensaje',
        isError: true,
        texto: [
          `No se pudo consultar el detalle de ninguno de los ${consultasIntentadas} procesos que coinciden con "${keyword}". ${fallos.texto}`,
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
      ? `\n⚠ Además, ${fallos.texto} La cobertura real fue menor a la pedida.`
      : '';

    return {
      kind: 'mensaje',
      isError: false,
      texto: [
        `Se revisaron ${consultasOk} procesos históricos que coinciden con "${keyword}", y ninguno expuso cotizaciones con precios.`,
        '',
        'Esto es habitual: la API de Mercado Público solo publica las cotizaciones de algunos procesos.',
        `Sugerencias: usa un término más general o amplía "limite_analisis"${region ? ', o quita el parámetro "region"' : ''}.` + aviso,
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

  const compradores = new Set(cotizaciones.map((c) => c.institucion).filter(Boolean)).size;
  const nPrecios = preciosUnitarios.length;
  const nivel: DatosPreciosMercado['suficiencia_muestra']['nivel'] =
    procesosConDatos < 2 || compradores < 2 || nPrecios < 5 ? 'baja'
      : procesosConDatos < 4 || nPrecios < 10 ? 'media'
        : 'suficiente';
  const notaSuficiencia = nivel === 'baja'
    ? `Muestra chica: ${nPrecios} precio(s) de ${procesosConDatos} proceso(s) y ${compradores} comprador(es). Toma el precio sugerido como indicativo, no como precio de mercado.`
    : nivel === 'media'
      ? `Muestra acotada: ${nPrecios} precios de ${procesosConDatos} procesos y ${compradores} compradores. Úsala como referencia y contrástala con la ficha.`
      : `${nPrecios} precios de ${procesosConDatos} procesos y ${compradores} compradores.`;

  const resultado: DatosPreciosMercado = {
    _nota_metodologica: [
      'Precios COTIZADOS por proveedores, NO adjudicados: la API de Mercado Público no expone qué oferta ganó (el estado "proveedor_seleccionado" devuelve 0 resultados y ninguna cotización viene marcada como seleccionada).',
      'La muestra proviene de procesos declarados DESIERTOS, los únicos que publican sus cotizaciones (medido: desierta 5/8 procesos con precios; cerrada 0/8).',
      // ⚠ Antes decía «en los procesos desiertos casi todas lo son» sin mirar
      //   la muestra; en la simulación del 6-oct eran 2 de 7. Ahora cuenta.
      `Las cotizaciones declaradas inadmisibles SÍ se incluyen en estas estadísticas (en esta muestra, ${inadmisibles.length} de ${cotizaciones.length}): el precio ofertado sigue siendo señal de mercado aunque se haya rechazado el papeleo, y excluirlas puede dejar la muestra vacía. "estadisticas_precio_unitario_solo_admisibles" trae la distribución sin ellas. Revisa "motivos_de_inadmisibilidad": si predomina "sobrepasa el monto máximo", la muestra está sesgada hacia arriba; si predominan motivos formales (garantías, certificados), los precios son representativos.`,
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
      ...(filtrado.descartados > 0 ? { filtrados_por_palabras_clave: filtrado.descartados } : {}),
      procesos_revisados: consultasOk,
      procesos_que_fallaron: consultasFallidas,
      ...(consultasFallidas > 0 && {
        procesos_que_fallaron_detalle: fallidos.map((codigo) => ({
          codigo,
          motivo: fallos.porTiempo.includes(codigo) ? 'omitido_por_tiempo' as const : 'api_no_respondio' as const,
          ficha: `https://buscador.mercadopublico.cl/ficha?code=${codigo}`,
        })),
        _aviso_cobertura: `${fallos.texto} La muestra es más chica que la pedida; no lo interpretes como escasez de datos del rubro. Sus cotizaciones se pueden ver en la ficha pública de cada uno.`,
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
    estadisticas_precio_unitario_solo_admisibles: inadmisibles.length > 0 ? calcularEstadisticas(preciosUnitariosAdmisibles) : statsUnitario,
    estadisticas_monto_neto: statsNeto,
    base_de_la_sugerencia: tipoBase,
    _advertencia_dispersion: advertenciaDispersion,
    muestra_homogenea: !muestraHeterogenea,
    suficiencia_muestra: {
      nivel,
      procesos_con_cotizaciones: procesosConDatos,
      compradores_distintos: compradores,
      precios_unitarios: nPrecios,
      nota: notaSuficiencia,
    },
    ...(edadCache !== undefined && {
      _frescura: `La búsqueda de históricos salió de la caché local (guardada hace ${edadCache < 60 ? `${edadCache} s` : `${Math.round(edadCache / 60)} min`}); no es una consulta nueva a la API. Las cotizaciones de procesos desiertos no cambian.`,
    }),
    precio_sugerido_competitivo: sugerido,
    criterio_sugerencia: (nivel === 'baja' ? '⚠ Muestra chica: tómalo como indicativo. ' : '') +
      'Percentil 25 de la distribución cotizada: te ubica en el cuarto más económico sin regalar margen. Resiste valores atípicos mejor que el promedio.',
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
