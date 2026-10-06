import { z } from 'zod';
import { esquemaCodigoCompra } from '../utils/validacion.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { esAdmisible, extraerMontoNeto, extraerPrecioUnitario } from '../utils/quotation.js';
import type { CompraAgilDetalle } from '../api/compra-agil-client.js';
import { safeError } from '../utils/redact.js';
import { describirFallosDetalle } from '../utils/presupuesto.js';
import { parsearFechaApi } from '../utils/fechas.js';
import { terminoComparables } from '../utils/doc-search.js';
import { filtrarPorPalabras, esquemaPalabrasComparables, type FiltroPalabras } from '../utils/palabras-clave.js';
import type { CompraAgilItem } from '../api/compra-agil-client.js';

export { terminoComparables };

/**
 * Días entre la publicación y el cierre, con una decimal. `null` si falta una de
 * las dos o no se entiende. Usa `parsearFechaApi`: con `new Date()` un valor
 * sin zona se leía en la del servidor y uno con "Z" en UTC, y si el par mezclaba
 * formatos la duración salía corrida en horas.
 */
export function duracionEnDias(publicacion: string | null | undefined, cierre: string | null | undefined): number | null {
  const inicio = parsearFechaApi(publicacion);
  const fin = parsearFechaApi(cierre);
  if (!inicio || !fin) return null;
  return Math.round(((fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) * 10) / 10;
}

const TOOL_NAME = 'auditar_compras_desiertas';

const TOOL_DESCRIPTION = `Audita un proceso de Compra Ágil que haya quedado "desierto" para identificar por qué falló (plazo ajustado, presupuesto bajo, requisitos restrictivos), comparándolo con los precios que el mercado cotizó en procesos similares.
Admite el código de la compra o un término de búsqueda para encontrar un proceso desierto reciente.
NOTA: la comparación se hace contra precios COTIZADOS por proveedores en procesos del mismo rubro, no contra precios adjudicados: la API de Mercado Público no expone qué oferta ganó (verificado empíricamente).
También reporta el motivo oficial de deserción y las cotizaciones declaradas inadmisibles, que suelen explicar el fracaso mejor que el precio.`;

const inputSchema = {
  codigo_compra: esquemaCodigoCompra().optional().describe('Código de la Compra Ágil desierta para auditar (ej: "1057539-228-COT26"). Opcional si se especifica "q".'),
  q: z.string().optional().describe('Término de búsqueda de producto/servicio para encontrar y auditar un proceso desierto reciente (ej: "resmas papel"). Opcional.'),
  limite_analisis: z.number().min(1).max(8).default(3).optional().describe('Cantidad de procesos comparables con los que contrastar (1-8, default 3). Cada uno es una consulta de cuota y una llamada de detalle — lo lento: medido en septiembre de 2026, 20-25 s cada una, con HTTP 504 intermitentes. Se piden en paralelo, así que subirlo no multiplica el tiempo, pero sí la probabilidad de que alguna falle.'),
  ...esquemaPalabrasComparables(),
};

export interface ArgsAuditoria extends FiltroPalabras {
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
  /** Igual, pero con el monto total (con IVA). */
  cotizaciones_sobre_presupuesto_con_iva: number | null;
  /**
   * true si la evidencia muestra que el comprador aplicó el presupuesto CON IVA:
   * una cotización que cabía en neto fue rechazada por sobrepasar el monto.
   * null si no hay cómo saberlo.
   */
  presupuesto_aplicado_con_iva: boolean | null;
  /** Inadmisibilidades agrupadas por tipo de motivo. */
  inadmisibilidad_por_categoria: Record<CategoriaInadmisibilidad, number>;
}

export type CategoriaInadmisibilidad = 'precio' | 'especificaciones' | 'entrega' | 'documentos' | 'otra';

/**
 * Agrupa una justificación de inadmisibilidad. Segundo enjambre (6-oct): la
 * auditoría recomendaba revisar «certificaciones difíciles de obtener» en un
 * proceso cuyas inadmisibilidades eran de especificaciones (procesador, disco,
 * licencia), de precio y por cobrar despacho: ninguna hablaba de certificados.
 */
export function categoriaInadmisibilidad(texto: string | null | undefined): CategoriaInadmisibilidad {
  const t = sinTildes(texto ?? '');
  if (/presupuest|monto maximo|monto disponible|sobrepas|exced/.test(t)) return 'precio';
  if (/despacho|flete|entrega|plazo/.test(t)) return 'entrega';
  if (/garantia|certific|document|adjunt|antecedente|boleta|declaracion/.test(t)) return 'documentos';
  if (/especificac|tecnic|modelo|no corresponde|no cumple|requerid|requisit|licencia|marca|caracteristic/.test(t)) return 'especificaciones';
  return 'otra';
}

export interface DatosAuditoria {
  proceso_auditado: {
    codigo: string;
    nombre: string;
    region: string;
    estado: string;
    presupuesto_disponible: number;
    duracion_dias: number;
    items_solicitados: Array<{ nombre: string; cantidad: number | null; unidad: string | null }>;
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
    /** Cuántos procesos comparables sostienen la diferencia. Con 1 es una referencia débil (S13). */
    comparables_usados: number | null;
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
  if (/requisit|requerid|no cumple|tecnic|especificac|garantia|certific|document|antecedente|adjunt|inadmisib|bases/.test(m)) return 'requisitos';
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
  const porCategoria: Record<CategoriaInadmisibilidad, number> = { precio: 0, especificaciones: 0, entrega: 0, documentos: 0, otra: 0 };
  for (const c of inadmisibles) porCategoria[categoriaInadmisibilidad(c.justificacion_inadmisibilidad)]++;
  // Si una cotización que cabía en neto fue rechazada por precio, el comprador
  // comparó con IVA (segundo enjambre: $957.980 neto, $1.139.996 con IVA,
  // rechazada contra un presupuesto de $1.000.000).
  const conIva = presupuesto > 0 && inadmisibles.some((c) => {
    const neto = extraerMontoNeto(c);
    const total = c.monto_total;
    return categoriaInadmisibilidad(c.justificacion_inadmisibilidad) === 'precio' &&
      neto !== null && typeof total === 'number' && neto <= presupuesto && total > presupuesto;
  });
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
    cotizaciones_sobre_presupuesto_con_iva: presupuesto > 0 ? totales.filter((n) => n > presupuesto).length : null,
    presupuesto_aplicado_con_iva: presupuesto > 0 ? (conIva ? true : null) : null,
    inadmisibilidad_por_categoria: porCategoria,
  };
}

const pct = (valor: number, base: number) => Math.round(((valor - base) / base) * 100);

/** Ninguna cotización cabe con IVA (la menor con IVA supera el presupuesto). */
function noCabeConIva(e: EvidenciaProceso, presupuesto: number): boolean {
  return presupuesto > 0 && e.menor_monto_neto !== null && e.menor_monto_total !== null && e.menor_monto_total > presupuesto;
}

/** Más de la mitad de las cotizaciones supera el presupuesto ya en neto. */
function mayoriaSobrePresupuesto(e: EvidenciaProceso): boolean {
  const sobre = e.cotizaciones_sobre_presupuesto;
  return sobre !== null && e.cotizaciones_recibidas > 0 && sobre * 2 > e.cotizaciones_recibidas;
}
const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;

/**
 * ¿La evidencia apunta a requisitos? Sí si el motivo oficial lo dice, o si todas
 * las cotizaciones fueron inadmisibles por algo que NO es el precio.
 *
 * ⚠ E1 (enjambre contra la API real, 6-oct): bastaba con que todas fueran
 *   inadmisibles. Un proceso desierto por «PROVEEDOR SOBREPASA PRESUPUESTO
 *   MÁXIMO», cuya única cotización fue inadmisible por precio, salía con
 *   `requisitos_complejos: true` y la recomendación de revisar «certificaciones
 *   difíciles de obtener»: una conclusión contra el motivo oficial.
 */
export function requisitosPorEvidencia(e: EvidenciaProceso): boolean {
  if (e.causa_segun_motivo_oficial === 'requisitos') return true;
  const n = e.cotizaciones_recibidas;
  if (n === 0 || e.cotizaciones_inadmisibles !== n) return false;
  const causas = e.motivos_de_inadmisibilidad.map(clasificarMotivo);
  // Sin justificaciones, el motivo oficial decide: si es el precio, no se infieren requisitos.
  if (causas.length === 0) return e.causa_segun_motivo_oficial !== 'presupuesto';
  return !causas.every((c) => c === 'presupuesto');
}

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
  } else if (noCabeConIva(e, presupuesto)) {
    // ⚠ S1b (segunda simulación, 6-oct): esto solo se avisaba si el motivo
    //   oficial era presupuesto. Una desierta por «requisitos técnicos» cuyas
    //   cuatro ofertas no cabían con IVA salía «presupuesto suficiente».
    const sobreNeto = e.cotizaciones_sobre_presupuesto ?? 0;
    r.push(
      `Presupuesto: ninguna cotización cabe con IVA — la menor es ${pesos(e.menor_monto_neto!)} neto y ${pesos(e.menor_monto_total!)} con IVA frente a ${pesos(presupuesto)}` +
      (sobreNeto > 0 ? `, y ${sobreNeto} de ${n} lo superan ya en neto` : '') + '. ' +
      (e.causa_segun_motivo_oficial === 'presupuesto'
        ? `El motivo oficial habla de presupuesto${motivoCitado}: probablemente el presupuesto incluye IVA.`
        : `Aunque el motivo oficial es otro${motivoCitado}, si el presupuesto incluye IVA (la API no lo informa) ninguna oferta era adjudicable por precio.`) +
      ` En un nuevo llamado conviene declarar si incluye IVA y cubrir al menos ${pesos(e.menor_monto_total!)}.`,
    );
  } else if (mayoriaSobrePresupuesto(e)) {
    r.push(
      `Presupuesto: ${e.cotizaciones_sobre_presupuesto} de ${n} cotizaciones de este proceso superan en neto los ${pesos(presupuesto)} disponibles` +
      (e.causa_segun_motivo_oficial === 'presupuesto' ? `, como señala el motivo oficial${motivoCitado}.` : `; el motivo oficial es otro${motivoCitado}, pero el presupuesto dejó fuera a la mayoría.`) +
      ` Contrasta con los montos cotizados en procesos comparables antes de fijar el presupuesto del nuevo llamado.`,
    );
  } else if (e.inadmisibilidad_por_categoria.precio > 0) {
    // Segundo enjambre: «Presupuesto en rango» con 4 de 11 rechazadas por precio.
    const conIva = e.cotizaciones_sobre_presupuesto_con_iva;
    r.push(
      `Presupuesto: ${e.inadmisibilidad_por_categoria.precio} de ${n} cotizaciones fueron rechazadas por sobrepasar el monto disponible (${pesos(presupuesto)}).` +
      (e.presupuesto_aplicado_con_iva
        ? ` Al menos una cabía en neto y no con IVA, así que el comprador aplicó el presupuesto con IVA: con IVA, ${conIva} de ${n} lo superan.`
        : conIva !== null ? ` Con IVA, ${conIva} de ${n} lo superan.` : '') +
      ` En un nuevo llamado conviene declarar si el presupuesto incluye IVA y contrastarlo con lo cotizado.`,
    );
  } else if (e.causa_segun_motivo_oficial === 'presupuesto') {
    const sobre = e.cotizaciones_sobre_presupuesto;
    r.push(
      `Presupuesto: el motivo oficial de deserción lo señala${motivoCitado}` +
      (sobre !== null && n > 0 ? `; ${sobre} de ${n} cotizaciones de este proceso superaron los ${pesos(presupuesto)} disponibles.` : '.') +
      ` Contrasta con los montos cotizados en procesos comparables antes de fijar el presupuesto del nuevo llamado.`,
    );
  }

  if (requisitosPorEvidencia(e)) {
    const motivos = e.motivos_de_inadmisibilidad.length > 0
      ? ` Motivos de inadmisibilidad declarados: ${e.motivos_de_inadmisibilidad.map((m) => `«${m}»`).join(', ')}.`
      : '';
    const cat = e.inadmisibilidad_por_categoria;
    const NOMBRES: Record<CategoriaInadmisibilidad, string> = {
      especificaciones: 'por especificaciones', documentos: 'por documentos o garantías', entrega: 'por condiciones de entrega o despacho',
      precio: 'por precio', otra: 'por otros motivos',
    };
    const desglose = (Object.keys(NOMBRES) as CategoriaInadmisibilidad[])
      .filter((k) => cat[k] > 0).map((k) => `${cat[k]} ${NOMBRES[k]}`).join(', ');
    // Consejos solo para lo que pasó: antes se recomendaba revisar
    // certificaciones aunque ningún motivo hablara de certificados.
    const consejos = [
      cat.especificaciones > 0 ? 'que las especificaciones sean claras y no excluyan productos equivalentes' : '',
      cat.documentos > 0 ? 'que los documentos y garantías exigidos estén listados de forma explícita y se puedan reunir en el plazo' : '',
      cat.entrega > 0 ? 'que las condiciones de entrega (por ejemplo, si el despacho va incluido) estén declaradas en las bases' : '',
    ].filter(Boolean);
    r.push(
      `Requisitos: ${e.causa_segun_motivo_oficial === 'requisitos' ? `el motivo oficial apunta a incumplimientos${motivoCitado}` : 'todas las cotizaciones fueron declaradas inadmisibles'}` +
      `${n > 0 ? ` (${e.cotizaciones_inadmisibles} de ${n} inadmisibles${desglose ? `: ${desglose}` : ''})` : ''}.${motivos}` +
      (consejos.length > 0 ? ` Revisa ${consejos.join('; ')}.` : ' Revisa en la ficha qué se exigió: los motivos declarados no indican un requisito en particular.'),
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
  
  const targetDuration = duracionEnDias(targetDetail.fechas?.fecha_publicacion, targetDetail.fechas?.fecha_cierre) ?? 0;

  if (targetDetail.institucion?.region !== null) {
    region = String(targetDetail.institucion.region);
  }

  // Determinar la palabra clave para la comparativa histórica
  const nombreBase = targetDetail.productos_solicitados?.[0]?.nombre || targetDetail.nombre || '';
  const terminoDelUsuario = Boolean(keyword);
  if (!keyword) keyword = terminoComparables(nombreBase);

  // 3. Buscar procesos comparables del mismo rubro que publiquen cotizaciones.
  //    Solo `desierta`: medido contra la API real, es el único estado que las
  //    expone (desierta 5/8 procesos con precios; cerrada 0/8). Sumar
  //    `cerrada` solo gastaría cuota. El sesgo —comparar contra procesos que
  //    también fracasaron— se declara en la nota metodológica (E3).
  //    `proveedor_seleccionado` devuelve 0 resultados.
  //
  //    ⚠ S12 (enjambre, 6-oct): si esta búsqueda fallaba, la auditoría no
  //      entregaba nada, aunque ya tenía el motivo oficial, las cotizaciones y
  //      los montos del propio proceso. Ahora se entrega esa evidencia y el
  //      fallo se informa como cobertura, no como conclusión.
  const limit = args.limite_analisis || 3;
  // En un objeto: TypeScript no ve la asignación dentro de buscarComparables
  // y estrecharía una variable suelta a `null`.
  const busquedaComparables: { fallo: string | null } = { fallo: null };
  const buscarComparables = async (termino: string): Promise<CompraAgilItem[]> => {
    logger.info(`auditar_compras_desiertas: Buscando procesos comparables para "${termino}"`);
    try {
      const r = await client.buscar({
        q: termino,
        estado: 'desierta',
        // Solo se examinan los primeros `limit` resultados, así que pedir 50
        // era desperdicio — y provocaba HTTP 504: medido en producción, esta
        // misma consulta con tamano_pagina=50 agota los ~30 s de la pasarela,
        // y con 15 responde en 9,9 s.
        tamano_pagina: 10,
        numero_pagina: 1,
      });
      return r.items || [];
    } catch (error) {
      busquedaComparables.fallo = error instanceof CompraAgilApiError ? error.actionableMessage : safeError(error);
      return [];
    }
  };
  // E7: los filtros de palabras se aplican a los comparables, no al proceso auditado.
  const comparablesDe = (items: CompraAgilItem[]) =>
    filtrarPorPalabras(items.filter((item) => item.codigo !== targetCode), args).items;
  let encontrados = comparablesDe(await buscarComparables(keyword));
  if (encontrados.length === 0 && !busquedaComparables.fallo && !terminoDelUsuario) {
    const corto = terminoComparables(nombreBase, 1);
    if (corto && corto !== keyword) {
      keyword = corto;
      encontrados = comparablesDe(await buscarComparables(keyword));
    }
  }
  const searchResponse = { items: encontrados };

  const successDurations: number[] = [];
  const successPrices: number[] = [];
  const successUnitPrices: number[] = [];
  const processedCases: ProcesoComparable[] = [];
  let fallosDetalle = 0;
  let textoFallos = '';
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

    const intentosDetalle = detallados.length;
    fallosDetalle = detallados.filter((d) => d === null).length;
    textoFallos = describirFallosDetalle(
      itemsToProcess.filter((_, i) => detallados[i] === null).map((i) => i.codigo),
      intentosDetalle,
    ).texto;

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

        const successDuration = duracionEnDias(detail.fechas?.fecha_publicacion, detail.fechas?.fecha_cierre);
        if (successDuration !== null) successDurations.push(successDuration);

        processedCases.push({
          codigo: item.codigo,
          estado: detail.estado?.glosa,
          institucion: item.institucion?.organismo_comprador || 'Desconocido',
          cotizaciones_recibidas: cotizaciones.length,
          cotizaciones_inadmisibles: inadmisibles,
          menor_monto_cotizado: menorNeto,
          mayor_monto_cotizado: Math.max(...netos),
          menor_precio_unitario: menorUnitario,
          duracion_dias: successDuration ?? 0,
          fecha_cierre: item.fechas?.fecha_cierre ?? undefined,
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
    (targetBudget > 0 && evidencia.menor_monto_neto !== null && evidencia.menor_monto_neto > targetBudget) ||
    noCabeConIva(evidencia, targetBudget) || mayoriaSobrePresupuesto(evidencia) ||
    evidencia.inadmisibilidad_por_categoria.precio > 0;

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
    comparables_usados: null,
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
      // ⚠ S13 (segunda simulación): con un solo comparable lo llamaba
      //   «promedio» y el informe concluía «en rango» sin advertirlo. Y no
      //   decía que lo cotizado es neto mientras el presupuesto puede incluir IVA.
      const nComparables = porUnidad ? successUnitPrices.length : successPrices.length;
      analisis_critico.comparables_usados = nComparables;
      const referencia = nComparables === 1
        ? `lo cotizado${porUnidad ? ' por unidad' : ''} en el único proceso comparable`
        : `el promedio de lo cotizado${porUnidad ? ' por unidad' : ''} en ${nComparables} procesos comparables`;
      analisis_critico.lectura_diferencia =
        `El presupuesto${porUnidad ? ' por unidad' : ''} está ${Math.abs(dif)} % ${dif < 0 ? 'bajo' : 'sobre'} ${referencia}` +
        (porUnidad ? '.' : ' (montos totales de procesos con cantidades posiblemente distintas: tómalo con cautela).') +
        (nComparables === 1 ? ' Un solo comparable es una referencia débil: no basta para afirmar que el presupuesto esté en rango.' : '') +
        ' Lo cotizado es neto (sin IVA): si el presupuesto incluye IVA, la holgura real es menor.';
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
  // Los criterios ambientales o sociales no bastan para afirmar que los
  // requisitos fueron el problema: solo la evidencia del proceso (E1).
  const porRequisitos = requisitosPorEvidencia(evidencia);
  analisis_critico.requisitos_complejos = porRequisitos;

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

  if (requisitosAmbientales && porRequisitos) {
    recomendaciones.push(
      `Flexibilizar los requisitos ambientales/sociales exigidos. Aunque promueven buenas prácticas, en procesos rápidos de bajo monto pueden asustar o inhabilitar a microempresas locales si implican adjuntar certificados complejos.`
    );
  } else if (requisitosAmbientales && !presupuestoPorEvidencia && !presupuestoPorComparables && !plazoPorComparables && causa !== 'plazo') {
    recomendaciones.push(
      `El proceso incluye criterios ambientales o sociales. Ningún dato indica que causaran la deserción, pero conviene revisar si exigían certificados difíciles de reunir en el plazo.`
    );
  }

  if (sinComparablesDistintos && busquedaComparables.fallo) {
    recomendaciones.push(
      `No se pudieron buscar procesos comparables: ${busquedaComparables.fallo} La evidencia de este proceso (motivo oficial, cotizaciones y montos) sigue siendo válida; reintenta en unos minutos para contrastarla con el mercado.`,
    );
  } else if (sinComparablesDistintos) {
    recomendaciones.push(
      `No se encontró otro proceso desierto con «${keyword}». No se compara este proceso consigo mismo, así que no hay brecha de presupuesto ni de plazo contra un mercado distinto. Para comparar, prueba con "q" y un término más general.`,
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
      // S10: salía «Región 5» aquí y «Región de Valparaíso» en el detalle.
      region: targetDetail.institucion?.nombre_region?.trim() || (region ? `Región ${region}` : 'No especificada'),
      estado: targetDetail.estado?.glosa || 'Desconocido',
      presupuesto_disponible: targetBudget,
      duracion_dias: targetDuration,
      items_solicitados: targetDetail.productos_solicitados?.map(p => ({
        nombre: p.nombre,
        cantidad: p.cantidad ?? null,
        unidad: p.unidad_medida ?? null,
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
        _aviso_cobertura: `${textoFallos} La comparación se basa en menos procesos de los pedidos; no lo interpretes como escasez de datos del rubro.`,
      }),
      ...(busquedaComparables.fallo && {
        _aviso_cobertura: `La búsqueda de procesos comparables falló, así que no hubo contraste con el mercado: ${busquedaComparables.fallo} No lo interpretes como escasez de datos del rubro.`,
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
    _nota_metodologica: 'La comparación usa el MENOR monto cotizado de cada proceso similar, no montos adjudicados: la API de Mercado Público no expone qué oferta ganó. Los comparables son procesos DESIERTOS, porque son los únicos que publican sus cotizaciones (medido: 5 de 8 desiertos frente a 0 de 8 cerrados): la muestra se inclina hacia compras que también fracasaron, así que tómala como referencia de precios ofertados y no como el precio de una compra exitosa. Revisa también "motivo_desierta": muchas deserciones se explican por incumplimientos formales (garantías, certificados) y no por precio.',
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
