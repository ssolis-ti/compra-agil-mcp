/**
 * Piezas compartidas de la búsqueda: el esquema de filtros, la regla de
 * «al menos un filtro de la API» y la fila resumida. Las usan
 * buscar_compras_agiles y exportar_procesos (2.10.0).
 */

import { z } from 'zod';
import { esquemaRegion } from '../utils/region.js';
import { enHoraDeChile } from '../utils/fechas.js';
import { TAMANO_PAGINA_SEGURO } from '../utils/paginacion.js';
import type { CompraAgilItem } from './compra-agil-client.js';

export const esquemaBusqueda = {
  q: z.string().optional().describe(
    'Palabras clave para buscar en el nombre/descripción del proceso. Ej: "materiales electricos". No usar junto con "id".'
  ),
  id: z.string().optional().describe(
    'Código exacto de una Compra Ágil. Ej: "1057539-228-COT26". No usar junto con "q".'
  ),
  estado: z.string().optional().describe(
    'Estado(s) que devuelven filas, separados por coma: publicada, cerrada, desierta, cancelada. proveedor_seleccionado devuelve 0 filas. oc_emitida responde HTTP 400.'
  ),
  region: esquemaRegion(
    'Código(s) de región del organismo comprador, separados por coma (1-16). Ej: "13" para Metropolitana, "13,5" para Metropolitana y Valparaíso.',
    { multiple: true },
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

/** Listado que ve el modelo. El cierre crudo se conserva; al lado va su lectura validada en hora de Chile. */
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
  // Enjambre (6-oct): «presupuesto_clp» junto a «moneda: UTM» hacía dudar de la unidad.
  const enOtraMoneda = (item.montos.moneda ?? '').trim().toUpperCase() !== 'CLP' && (item.montos.moneda ?? '').trim() !== '';
  if (enOtraMoneda) {
    (resumen as Record<string, unknown>)._nota_moneda =
      `presupuesto_clp ya viene convertido a pesos chilenos; la moneda original del proceso es ${item.montos.moneda}.`;
  }
  const conOfertas = item.resumen.total_ofertas_recibidas === 0
    ? { ...resumen, _nota_ofertas: 'El listado informa 0 ofertas. No es un hecho de la ficha.' }
    : resumen;
  const motivo = item.motivos.motivo_seleccion?.trim();
  if (!motivo) return conOfertas;
  // E9 (enjambre, 6-oct): un proceso DESIERTO traía «su precio total fue el
  // más bajo» sin ninguna marca en la fila. La descripción lo advertía, la
  // fila no; y la API no publica adjudicaciones.
  return {
    ...conOfertas,
    motivo_seleccion: motivo,
    _nota_motivo: `Proceso "${item.estado.glosa}": este texto es un criterio que declaró el comprador, no prueba que haya un proveedor adjudicado.`,
  };
}

