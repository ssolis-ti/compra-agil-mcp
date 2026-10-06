import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { esAdmisible, extraerMontoNeto, extraerPrecioUnitario } from '../utils/quotation.js';
import type { CompraAgilDetalle } from '../api/compra-agil-client.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'auditar_compras_desiertas';

const TOOL_DESCRIPTION = `Audita un proceso de Compra Ágil que haya quedado "desierto" para identificar por qué falló (plazo ajustado, presupuesto bajo, requisitos restrictivos), comparándolo con los precios que el mercado cotizó en procesos similares.
Admite el código de la compra o un término de búsqueda para encontrar un proceso desierto reciente.
NOTA: la comparación se hace contra precios COTIZADOS por proveedores en procesos del mismo rubro, no contra precios adjudicados: la API de Mercado Público no expone qué oferta ganó (verificado empíricamente).
También reporta el motivo oficial de deserción y las cotizaciones declaradas inadmisibles, que suelen explicar el fracaso mejor que el precio.`;

const inputSchema = {
  codigo_compra: z.string().optional().describe('Código de la Compra Ágil desierta para auditar (ej: "1057539-228-COT26"). Opcional si se especifica "q".'),
  q: z.string().optional().describe('Término de búsqueda de producto/servicio para encontrar y auditar un proceso desierto reciente (ej: "resmas papel"). Opcional.'),
  limite_analisis: z.number().min(1).max(8).default(3).optional().describe('Cantidad de procesos comparables con los que contrastar (1-8, default 3). Cada uno es una consulta de cuota y una llamada de detalle — lo lento: medido en septiembre de 2026, 20-25 s cada una, con HTTP 504 intermitentes. Se piden en paralelo, así que subirlo no multiplica el tiempo, pero sí la probabilidad de que alguna falle.'),
};

export interface ArgsAuditoria {
  codigo_compra?: string;
  q?: string;
  limite_analisis?: number;
}

export interface ProcesoComparable {
  codigo: string;
  estado?: string;
  institucion: string;
  cotizaciones_recibidas: number;
  cotizaciones_inadmisibles: number;
  menor_monto_cotizado: number;
  mayor_monto_cotizado: number;
  /** Menor precio unitario cotizado, si las cotizaciones lo traen. */
  menor_precio_unitario: number | null;
  duracion_dias: number;
  fecha_cierre?: string;
  motivo_desierta: string | null;
}

/** Causa que declara el motivo oficial de deserción, leída por palabras clave. */
export type CausaMotivo = 'presupuesto' | 'requisitos' | 'plazo' | 'sin_ofertas' | 'otra' | 'no_informado';

/**
 * Lo que el propio proceso auditado dice de su fracaso. Es la evidencia más
 * directa que hay: sus cotizaciones frente a su presupuesto y su motivo
 * oficial. Los comparables solo dan contexto de mercado.
 */
export interface EvidenciaProceso {
  causa_segun_motivo_oficial: CausaMotivo;
  cotizaciones_recibidas: number;
  cotizaciones_inadmisibles: number;
  motivos_de_inadmisibilidad: string[];
  menor_monto_neto: number | null;
  menor_monto_total: number | null;
  /** null si el proceso no informa presupuesto: no se puede comparar. */
  cotizaciones_sobre_presupuesto: number | null;
}

export interface DatosAuditoria {
  proceso_auditado: {
    codigo: string;
    nombre: string;
    region: string;
    estado: string;
    presupuesto_disponible: number;
    duracion_dias: number;
    items_solicitados: Array<{ nombre: string; cantidad: number; unidad: string }>;
    motivo_desierta: string;
  };
  evidencia_del_proceso_auditado: EvidenciaProceso;
  busqueda_comparativa: {
    termino_clave: string;
    procesos_comparables_con_cotizaciones: number;
    _aviso_cobertura?: string;
    estadisticas_montos_cotizados: { minimo_cotizado: number; maximo_cotizado: number; promedio_cotizado: number } | null;
    estadisticas_duracion: { minimo_dias: number; maximo_dias: number; promedio_dias: number } | null;
  };
  /**
   * `true` hay brecha, `false` se evaluó y no la hay, `null` no se pudo
   * evaluar (sin comparables ni evidencia propia). Nunca `false` por falta de
   * datos: el informe imprimía «Presupuesto en rango» sin haber comparado nada.
   */
  analisis_de_brechas: {
    presupuesto_insuficiente: boolean | null;
    plazo_insuficiente: boolean | null;
    requisitos_complejos: boolean;
    /** (presupuesto − promedio cotizado) / promedio × 100, en la base indicada. */
    diferencia_presupuesto_porcentaje: number | null;
    diferencia_plazo_dias: number | null;
    /** Por unidad cuando los comparables traen precio unitario; si no, montos totales. */
    base_comparacion: 'precio_unitario' | 'monto_total' | null;
    lectura_diferencia: string | null;
  };
  recomendaciones_de_optimizacion: string[];
  procesos_comparables_analizados: ProcesoComparable[];
  _nota_metodologica: string;
}

export type RecoleccionAuditoria =
  | { kind: 'mensaje'; texto: string; isError: boolean }
  | { kind: 'datos'; datos: DatosAuditoria };

const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Lee el motivo oficial de deserción. Es texto libre del comprador, así que se
 * clasifica por palabras clave y, ante la duda, queda como 'otra': mejor no
 * atribuir una causa que inventarla.
 */
export function clasificarMotivo(motivo: string | null | undefined): CausaMotivo {
  if (!motivo || !motivo.trim()) return 'no_informado';
  const m = sinTildes(motivo);
  if (/sin ofertas|no se recibieron|no hubo ofertas|ninguna oferta|no se presentaron/.test(m)) return 'sin_ofertas';
  if (/presupuest|monto maximo|monto disponible|sobrepas|exced|sobre el monto/.test(m)) return 'presupuesto';
  if (/requisit|tecnic|especificac|garantia|certific|document|antecedente|adjunt|inadmisib|bases/.test(m)) return 'requisitos';
  if (/plazo/.test(m)) return 'plazo';
  return 'otra';
}

export function evidenciaDelProceso(detalle: CompraAgilDetalle, presupuesto: number): EvidenciaProceso {
  const cotizaciones = detalle.proveedores_cotizando ?? [];
  const netos = cotizaciones.map((c) => extraerMontoNeto(c)).filter((n): n is number => n !== null);
  const totales = cotizaciones
    .map((c) => c.monto_total)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  const inadmisibles = cotizaciones.filter((c) => !esAdmisible(c));
  return {
    causa_segun_motivo_oficial: clasificarMotivo(detalle.motivos?.motivo_desierta),
    cotizaciones_recibidas: cotizaciones.length,
    cotizaciones_inadmisibles: inadmisibles.length,
    motivos_de_inadmisibilidad: [...new Set(
      inadmisibles.map((c) => c.justificacion_inadmisibilidad?.trim()).filter((m): m is string => Boolean(m)),
    )],
    menor_monto_neto: netos.length > 0 ? Math.min(...netos) : null,
    menor_monto_total: totales.length > 0 ? Math.min(...totales) : null,
    cotizaciones_sobre_presupuesto: presupuesto > 0 ? netos.filter((n) => n > presupuesto).length : null,
  };
}

const pct = (valor: number, base: number) => Math.round(((valor - base) / base) * 100);
const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;

/**
 * Recomendaciones que salen del propio proceso. Van antes que las de los
 * comparables: lo que pasó en ESTE proceso pesa más que un promedio de otros.
 *
 * ⚠ Antes la auditoría solo miraba comparables. En la simulación del 6-oct un
 *   proceso desierto por «Ofertas sobre el presupuesto disponible», con una
 *   cotización 33 % sobre su presupuesto, recibió «No se detectaron
 *   discrepancias obvias de presupuesto… revisar que no estén amarrados a una
 *   única marca»: la conclusión opuesta a su propia evidencia.
 */
function recomendacionesPropias(e: EvidenciaProceso, presupuesto: number, motivo: string | null | undefined): string[] {
  const r: string[] = [];
  const motivoCitado = motivo?.trim() ? ` («${motivo.trim()}»)` : '';
  const n = e.cotizaciones_recibidas;

  if (presupuesto > 0 && e.menor_monto_neto !== null && e.menor_monto_neto > presupuesto) {
    r.push(
      `Presupuesto: ${n === 1 ? 'la única cotización' : `las ${n} cotizaciones`} de este mismo proceso ${n === 1 ? 'superó' : 'superaron'} el presupuesto de ${pesos(presupuesto)}. ` +
      `La menor fue ${pesos(e.menor_monto_neto)} neto, ${pct(e.menor_monto_neto, presupuesto)} % por sobre él. ` +
      `Para un nuevo llamado, el presupuesto debería cubrir al menos ese monto (más IVA si el presupuesto lo incluye), o hay que reducir cantidades.`,
    );
  } else if (
    presupuesto > 0 && e.menor_monto_neto !== null && e.menor_monto_total !== null &&
    e.menor_monto_total > presupuesto && e.causa_segun_motivo_oficial === 'presupuesto'
  ) {
    r.push(
      `Presupuesto: la menor cotización cabe en neto (${pesos(e.menor_monto_neto)}) pero no con IVA (${pesos(e.menor_monto_total)}) frente a ${pesos(presupuesto)}, y el motivo oficial habla de presupuesto${motivoCitado}. ` +
      `Probablemente el presupuesto incluye IVA: en un nuevo llamado conviene declararlo explícitamente o subirlo al menos a ${pesos(e.menor_monto_total)}.`,
    );
  } else if (e.causa_segun_motivo_oficial === 'presupuesto') {
    const sobre = e.cotizaciones_sobre_presupuesto;
    r.push(
      `Presupuesto: el motivo oficial de deserción lo señala${motivoCitado}` +
      (sobre !== null && n > 0 ? `; ${sobre} de ${n} cotizaciones de este proceso superaron los ${pesos(presupuesto)} disponibles.` : '.') +
      ` Contrasta con los montos cotizados en procesos comparables antes de fijar el presupuesto del nuevo llamado.`,
    );
  }

  if (e.causa_segun_motivo_oficial === 'requisitos' || (n > 0 && e.cotizaciones_inadmisibles === n)) {
    const motivos = e.motivos_de_inadmisibilidad.length > 0
      ? ` Motivos de inadmisibilidad declarados: ${e.motivos_de_inadmisibilidad.map((m) => `«${m}»`).join(', ')}.`
      : '';
    r.push(
      `Requisitos: ${e.causa_segun_motivo_oficial === 'requisitos' ? `el motivo oficial apunta a incumplimientos${motivoCitado}` : 'todas las cotizaciones fueron declaradas inadmisibles'}` +
      `${n > 0 ? ` (${e.cotizaciones_inadmisibles} de ${n} inadmisibles)` : ''}.${motivos}` +
      ` Revisa que las bases pidan solo lo necesario, que los documentos exigidos estén listados de forma explícita y que no requieran certificaciones difíciles de obtener en el plazo.`,
    );
  }

  if (e.causa_segun_motivo_oficial === 'sin_ofertas' || n === 0) {
    r.push(
      `Participación: el proceso no recibió cotizaciones${motivoCitado}. Revisa el plazo de publicación, que el rubro y la región tengan proveedores, y que el nombre del proceso use los términos con que los proveedores buscan.`,
    );
  }

  if (e.causa_segun_motivo_oficial === 'plazo') {
    r.push(`Plazo: el motivo oficial de deserción lo señala${motivoCitado}. Considera ampliar el plazo de postulación y el de entrega en un nuevo llamado.`);
  }

  return r;
}

/**
 * Misma recolección que `auditar_compras_desiertas`. La tool JSON y el informe
 * HTML leen este resultado. Los textos de validación y de búsqueda vacía no cambian.
 */
export async function recolectarDatosAuditoria(
  client: Pick<CompraAgilClient, 'buscar' | 'detalle' | 'detallesEnParalelo'>,
  args: ArgsAuditoria,
): Promise<RecoleccionAuditoria> {
  let targetCode = args.codigo_compra || '';
  let keyword = args.q || '';
  let region = '';

  // 1. Si no hay código pero hay keyword q, buscar un proceso desierto reciente
  if (!targetCode && keyword) {
    logger.info(`auditar_compras_desiertas: Buscando proceso desierto reciente para "${keyword}"`);
    const desiertasSearch = await client.buscar({
      q: keyword,
      estado: 'desierta',
      tamano_pagina: 10, // API v2 requiere mínimo 10
      numero_pagina: 1,
    });

    if (!desiertasSearch.items || desiertasSearch.items.length === 0) {
      return { kind: 'mensaje', isError: false, texto: `No se encontraron procesos recientes en estado "desierta" para la búsqueda "${keyword}". Por favor intenta con otra palabra clave o ingresa un "codigo_compra" específico.` };
    }
    targetCode = desiertasSearch.items[0].codigo;
  }

  if (!targetCode) {
    return { kind: 'mensaje', isError: true, texto: 'Error de validación: Debes proporcionar "codigo_compra" o un término de búsqueda "q" para encontrar un proceso a auditar.' };
  }

  // 2. Obtener el detalle del proceso desierto a auditar
  logger.info(`auditar_compras_desiertas: Consultando detalle del proceso objetivo ${targetCode}`);
  const targetDetail = await client.detalle(targetCode);

  // Extraer metadatos clave del proceso objetivo
  const targetName = targetDetail.nombre || 'Sin nombre';
  const targetBudget = targetDetail.presupuesto?.monto_disponible_clp || targetDetail.presupuesto?.monto_disponible || 0;
  
  let targetDuration = 0;
  if (targetDetail.fechas?.fecha_cierre && targetDetail.fechas?.fecha_publicacion) {
    const start = new Date(targetDetail.fechas.fecha_publicacion).getTime();
    const end = new Date(targetDetail.fechas.fecha_cierre).getTime();
    targetDuration = Math.round(((end - start) / (1000 * 60 * 60 * 24)) * 10) / 10;
  }

  if (targetDetail.institucion?.region !== null) {
    region = String(targetDetail.institucion.region);
  }

  // Determinar la palabra clave para la comparativa histórica
  if (!keyword) {
    if (targetDetail.productos_solicitados && targetDetail.productos_solicitados.length > 0) {
      keyword = targetDetail.productos_solicitados[0].nombre;
    } else {
      keyword = targetDetail.nombre;
    }
  }

  // 3. Buscar procesos comparables del mismo rubro que publiquen cotizaciones.
  //    Solo `desierta`: medido contra la API real, es el único estado que las
  //    expone (desierta 5/8 procesos con precios; cerrada 0/8).
  //    `proveedor_seleccionado` devuelve 0 resultados.
  logger.info(`auditar_compras_desiertas: Buscando procesos comparables para "${keyword}"`);
  const limit = args.limite_analisis || 3;
  const searchResponse = await client.buscar({
    q: keyword,
    estado: 'desierta',
    // Solo se examinan los primeros `limit` resultados, así que pedir 50
    // era desperdicio — y provocaba HTTP 504: medido en producción, esta
    // misma consulta con tamano_pagina=50 agota los ~30 s de la pasarela,
    // y con 15 responde en 9,9 s.
    tamano_pagina: 10,
    numero_pagina: 1,
  });

  const successDurations: number[] = [];
  const successPrices: number[] = [];
  const successUnitPrices: number[] = [];
  const processedCases: ProcesoComparable[] = [];
  let fallosDetalle = 0;
  let intentosDetalle = 0;
  const itemsToProcess = (searchResponse.items || [])
    .filter((item) => item.codigo !== targetCode)
    .slice(0, limit);
  const sinComparablesDistintos = itemsToProcess.length === 0;

  if (itemsToProcess.length > 0) {
    logger.info(`auditar_compras_desiertas: Analizando detalles de ${itemsToProcess.length} procesos comparables`);

    // En paralelo y con concurrencia adaptativa: los detalles son
    // independientes y la API tarda 20-25 s por consulta (medido en
    // septiembre 2026), así que en serie el total superaba el timeout de
    // cualquier cliente MCP. El limitador vive en el cliente y es
    // compartido, así que si otra herramienta acaba de chocar con 504,
    // esta tanda ya sale con menos paralelismo.
    const detalles = await client.detallesEnParalelo(itemsToProcess.map((i) => i.codigo));
    const detallados = itemsToProcess.map((item, i) =>
      detalles[i] ? { item, detail: detalles[i]! } : null
    );

    intentosDetalle = detallados.length;
    fallosDetalle = detallados.filter((d) => d === null).length;

    for (const entrada of detallados) {
      if (!entrada) continue;
      {
        const { item, detail } = entrada;

        // Se recolectan TODAS las cotizaciones del proceso, incluidas las
        // declaradas inadmisibles: en los procesos desiertos casi todas lo son
        // (por eso quedaron desiertos) y filtrarlas dejaba la muestra vacía.
        // El precio ofertado sigue siendo señal de mercado.
        // Antes se buscaba solo al adjudicado, pero la API nunca marca un
        // ganador (verificado), así que ese camino no encontraba nada.
        const cotizaciones = detail.proveedores_cotizando ?? [];
        if (cotizaciones.length === 0) continue;
        const inadmisibles = cotizaciones.filter((c) => !esAdmisible(c)).length;

        const netos = cotizaciones
          .map((c) => extraerMontoNeto(c))
          .filter((n): n is number => n !== null);
        if (netos.length === 0) continue;

        // Referencia por proceso: la cotización más económica — es el precio
        // al que ese mercado estuvo dispuesto a atender la necesidad.
        const menorNeto = Math.min(...netos);
        successPrices.push(menorNeto);
        const unitarios = cotizaciones
          .map((c) => extraerPrecioUnitario(c, keyword))
          .filter((n): n is number => n !== null);
        const menorUnitario = unitarios.length > 0 ? Math.min(...unitarios) : null;
        if (menorUnitario !== null) successUnitPrices.push(menorUnitario);

        let successDuration = 0;
        if (detail.fechas?.fecha_cierre && detail.fechas?.fecha_publicacion) {
          const start = new Date(detail.fechas.fecha_publicacion).getTime();
          const end = new Date(detail.fechas.fecha_cierre).getTime();
          successDuration = Math.round(((end - start) / (1000 * 60 * 60 * 24)) * 10) / 10;
          successDurations.push(successDuration);
        }

        processedCases.push({
          codigo: item.codigo,
          estado: detail.estado?.glosa,
          institucion: item.institucion?.organismo_comprador || 'Desconocido',
          cotizaciones_recibidas: cotizaciones.length,
          cotizaciones_inadmisibles: inadmisibles,
          menor_monto_cotizado: menorNeto,
          mayor_monto_cotizado: Math.max(...netos),
          menor_precio_unitario: menorUnitario,
          duracion_dias: successDuration,
          fecha_cierre: item.fechas?.fecha_cierre,
          motivo_desierta: detail.motivos?.motivo_desierta ?? null,
        });
      }
    }
  }

  // 4. Calcular métricas estadísticas para el análisis comparativo
  let avgPrice = 0, minPrice = 0, maxPrice = 0;
  if (successPrices.length > 0) {
    successPrices.sort((a, b) => a - b);
    minPrice = successPrices[0];
    maxPrice = successPrices[successPrices.length - 1];
    avgPrice = Math.round(successPrices.reduce((a, b) => a + b, 0) / successPrices.length);
  }

  let avgDuration = 0, minDuration = 0, maxDuration = 0;
  if (successDurations.length > 0) {
    successDurations.sort((a, b) => a - b);
    minDuration = successDurations[0];
    maxDuration = successDurations[successDurations.length - 1];
    avgDuration = Math.round((successDurations.reduce((a, b) => a + b, 0) / successDurations.length) * 10) / 10;
  }

  // 5. Análisis crítico de brechas.
  //    Primero lo que dice el propio proceso (motivo oficial y sus
  //    cotizaciones frente a su presupuesto); después, el contraste con los
  //    comparables. Las brechas de comparables se anulan si no hay comparables
  //    distintos —no se compara un proceso consigo mismo—, pero la evidencia
  //    propia se conserva.
  const evidencia = evidenciaDelProceso(targetDetail, targetBudget);
  const causa = evidencia.causa_segun_motivo_oficial;
  const presupuestoPorEvidencia = causa === 'presupuesto' ||
    (targetBudget > 0 && evidencia.menor_monto_neto !== null && evidencia.menor_monto_neto > targetBudget);

  // ⚠ Se compara por unidad cuando se puede. Comparar montos totales de
  //   procesos con cantidades distintas daba cifras sin sentido: en la
  //   simulación del 6-oct salió «diferencia_presupuesto_porcentaje: 142» entre
  //   compras de 2 y de 9 computadores.
  const cantidadObjetivo = (targetDetail.productos_solicitados ?? []).reduce((acc, p) => acc + (p.cantidad || 0), 0);
  const porUnidad = cantidadObjetivo > 0 && successUnitPrices.length > 0 && successUnitPrices.length === successPrices.length;
  const promedio = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const refPresupuesto = porUnidad ? targetBudget / cantidadObjetivo : targetBudget;
  const refPromedio = porUnidad ? promedio(successUnitPrices) : avgPrice;
  const refMinimo = porUnidad ? Math.min(...successUnitPrices) : minPrice;

  const analisis_critico: DatosAuditoria['analisis_de_brechas'] = {
    presupuesto_insuficiente: null,
    plazo_insuficiente: null,
    requisitos_complejos: false,
    diferencia_presupuesto_porcentaje: null,
    diferencia_plazo_dias: null,
    base_comparacion: null,
    lectura_diferencia: null,
  };
  let presupuestoComparado = false;
  let plazoComparado = false;

  if (!sinComparablesDistintos) {
    if (targetBudget > 0 && refPromedio > 0) {
      presupuestoComparado = true;
      const dif = Math.round(((refPresupuesto - refPromedio) / refPromedio) * 100);
      analisis_critico.diferencia_presupuesto_porcentaje = dif;
      analisis_critico.base_comparacion = porUnidad ? 'precio_unitario' : 'monto_total';
      analisis_critico.lectura_diferencia =
        `El presupuesto${porUnidad ? ' por unidad' : ''} está ${Math.abs(dif)} % ${dif < 0 ? 'bajo' : 'sobre'} el promedio ` +
        `de lo cotizado${porUnidad ? ' por unidad' : ''} en procesos comparables` +
        (porUnidad ? '.' : ' (montos totales de procesos con cantidades posiblemente distintas: tómalo con cautela).');
      if (refPresupuesto < refMinimo || refPresupuesto < refPromedio * 0.8) {
        analisis_critico.presupuesto_insuficiente = true;
      }
    } else if (targetBudget === 0 && avgPrice > 0) {
      // Si el presupuesto objetivo es $0 o no especificado, se marca como potencial brecha si el histórico requiere fondos
      presupuestoComparado = true;
      analisis_critico.presupuesto_insuficiente = true;
    }

    if (targetDuration > 0 && avgDuration > 0) {
      plazoComparado = true;
      analisis_critico.diferencia_plazo_dias = Math.round((targetDuration - avgDuration) * 10) / 10;
      if (targetDuration < 2 || targetDuration < avgDuration * 0.6) {
        analisis_critico.plazo_insuficiente = true;
      }
    }
  }
  if (targetDuration > 0 && targetDuration < 2) {
    // Plazo menor a 2 días siempre se marca como potencialmente insuficiente en Compra Ágil
    analisis_critico.plazo_insuficiente = true;
  }
  const presupuestoPorComparables = analisis_critico.presupuesto_insuficiente === true;
  const plazoPorComparables = analisis_critico.plazo_insuficiente === true;

  const requisitosAmbientales = Boolean(
    targetDetail.flags?.considera_requisitos_medioambientales ||
    targetDetail.flags?.considera_requisitos_impacto_social_economico
  );
  const presupuestoEvaluado = presupuestoComparado || (targetBudget > 0 && evidencia.menor_monto_neto !== null);
  analisis_critico.presupuesto_insuficiente = presupuestoPorComparables || presupuestoPorEvidencia
    ? true
    : presupuestoEvaluado ? false : null;
  analisis_critico.plazo_insuficiente = plazoPorComparables || causa === 'plazo'
    ? true
    : plazoComparado ? false : null;
  analisis_critico.requisitos_complejos = requisitosAmbientales || causa === 'requisitos' ||
    (evidencia.cotizaciones_recibidas > 0 && evidencia.cotizaciones_inadmisibles === evidencia.cotizaciones_recibidas);

  // 6. Recomendaciones: primero las del propio proceso, luego las de mercado.
  const recomendaciones: string[] = recomendacionesPropias(evidencia, targetBudget, targetDetail.motivos?.motivo_desierta);
  if (presupuestoPorComparables) {
    if (targetBudget > 0) {
      recomendaciones.push(
        porUnidad
          ? `Aumentar el presupuesto disponible. Por unidad, el presupuesto ($${Math.round(refPresupuesto).toLocaleString('es-CL')}) es un ${Math.abs(analisis_critico.diferencia_presupuesto_porcentaje ?? 0)}% inferior al promedio de lo que el mercado cotizó en procesos similares ($${refPromedio.toLocaleString('es-CL')} por unidad). Para ${cantidadObjetivo} unidades, se sugiere al menos $${Math.round(refPromedio * 1.05 * cantidadObjetivo).toLocaleString('es-CL')}.`
          : `Aumentar el presupuesto disponible. El presupuesto actual de $${targetBudget.toLocaleString('es-CL')} es un ${Math.abs(analisis_critico.diferencia_presupuesto_porcentaje ?? 0)}% inferior al promedio de lo que el mercado cotizó en procesos similares ($${avgPrice.toLocaleString('es-CL')}, montos totales sin normalizar por cantidad). Se sugiere incrementarlo a al menos $${Math.round(avgPrice * 1.05).toLocaleString('es-CL')}.`
      );
    } else {
      recomendaciones.push(
        `Especificar o incrementar el presupuesto estimado. El promedio de lo cotizado por el mercado para productos similares es de $${avgPrice.toLocaleString('es-CL')}.`
      );
    }
  }

  if (plazoPorComparables) {
    recomendaciones.push(
      avgDuration > 0
        ? `Extender el plazo de postulación. El proceso actual ofreció ${targetDuration} días entre publicación y cierre, mientras que los procesos comparables promedian ${avgDuration} días. Se recomienda extender el plazo a un mínimo de 3 a 5 días hábiles.`
        : `Extender el plazo de postulación. El proceso actual ofreció ${targetDuration} días entre publicación y cierre. Se recomienda un mínimo de 3 a 5 días hábiles.`
    );
  }

  if (requisitosAmbientales) {
    recomendaciones.push(
      `Flexibilizar los requisitos ambientales/sociales exigidos. Aunque promueven buenas prácticas, en procesos rápidos de bajo monto pueden asustar o inhabilitar a microempresas locales si implican adjuntar certificados complejos.`
    );
  }

  if (sinComparablesDistintos) {
    recomendaciones.push(
      'No hay otro proceso desierto en la muestra. No se compara este proceso consigo mismo, así que no hay brecha de presupuesto ni de plazo contra un mercado distinto.',
    );
  } else if (recomendaciones.length === 0) {
    // Sin motivo oficial, sin evidencia propia y sin brechas de mercado: no
    // hay base para afirmar una causa. Se sugiere dónde mirar, sin atribuir.
    recomendaciones.push(
      `Los datos disponibles no muestran una causa clara: el motivo oficial no la precisa, las cotizaciones del proceso no superan su presupuesto y no hay brechas frente a los comparables. Revisa las bases técnicas en la ficha del proceso: especificaciones demasiado específicas o requisitos difíciles de acreditar son causas frecuentes.`
    );
  }

  const result = {
    proceso_auditado: {
      codigo: targetCode,
      nombre: targetName,
      region: region ? `Región ${region}` : 'No especificada',
      estado: targetDetail.estado?.glosa || 'Desconocido',
      presupuesto_disponible: targetBudget,
      duracion_dias: targetDuration,
      items_solicitados: targetDetail.productos_solicitados?.map(p => ({
        nombre: p.nombre,
        cantidad: p.cantidad,
        unidad: p.unidad_medida,
      })) || [],
      motivo_desierta: targetDetail.motivos?.motivo_desierta || 'No especificado en el sistema',
    },
    evidencia_del_proceso_auditado: evidencia,
    busqueda_comparativa: {
      termino_clave: keyword,
      procesos_comparables_con_cotizaciones: successPrices.length,
      sin_comparables_distintos: sinComparablesDistintos,
      // Un comparativo vacío puede deberse a que no hay comparables o a
      // que la API no respondió, y son cosas muy distintas: la primera
      // habla del mercado, la segunda solo de la infraestructura.
      ...(fallosDetalle > 0 && {
        _aviso_cobertura: `${fallosDetalle} de ${intentosDetalle} consultas de detalle fallaron (la API no respondió). La comparación se basa en menos procesos de los pedidos; no lo interpretes como escasez de datos del rubro.`,
      }),
      estadisticas_montos_cotizados: successPrices.length > 0 ? {
        minimo_cotizado: minPrice,
        maximo_cotizado: maxPrice,
        promedio_cotizado: avgPrice,
      } : null,
      estadisticas_duracion: successDurations.length > 0 ? {
        minimo_dias: minDuration,
        maximo_dias: maxDuration,
        promedio_dias: avgDuration,
      } : null,
    },
    analisis_de_brechas: analisis_critico,
    recomendaciones_de_optimizacion: recomendaciones,
    procesos_comparables_analizados: processedCases,
    _nota_metodologica: 'La comparación usa el MENOR monto cotizado de cada proceso similar (cerrado o desierto), no montos adjudicados: la API de Mercado Público no expone qué oferta ganó. Revisa también "motivo_desierta": muchas deserciones se explican por incumplimientos formales (garantías, certificados) y no por precio.',
  };

  return { kind: 'datos', datos: result };
}

export function registerAuditarDesiertas(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Auditar una compra desierta",

      description: TOOL_DESCRIPTION,

      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const recoleccion = await recolectarDatosAuditoria(client, args);
        if (recoleccion.kind === 'mensaje') {
          return {
            content: [{ type: 'text' as const, text: recoleccion.texto }],
            ...(recoleccion.isError ? { isError: true as const } : {}),
          };
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(recoleccion.datos, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : `Error inesperado al auditar compra desierta: ${safeError(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
