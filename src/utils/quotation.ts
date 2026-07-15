/**
 * Utilidades de cotización: análisis de precios y detección de adjudicación.
 *
 * ⚠ REALIDAD DE LA API (verificado empíricamente contra el servicio real,
 *   julio 2026 — 45 procesos inspeccionados, 52 cotizaciones):
 *
 *   • `proveedor_seleccionado` SÍ existe, pero su valor fue **0 en el 100%**
 *     de las cotizaciones observadas. Nunca se observó un 1.
 *   • Ningún proceso traía `id_orden_compra` (siempre null).
 *   • El filtro `estado=proveedor_seleccionado` devuelve **0 resultados**.
 *   • El filtro `estado=oc_emitida` devuelve **HTTP 400** (ni siquiera es válido).
 *   • `seleccion.*` y `estado_cotizacion.*` NO existen en la respuesta.
 *     En su lugar hay `estado` (número; siempre 3 en la muestra).
 *
 *   CONCLUSIÓN: la API no expone procesos adjudicados. Cualquier análisis
 *   basado en "el precio que ganó" está condenado a no encontrar datos.
 *
 *   Lo que SÍ hay: cotizaciones reales con `precio_unitario` y `valor_neto`
 *   (17 de 45 procesos las traían). Por eso el análisis se basa en precios
 *   COTIZADOS — señal de mercado genuina — y no en precios adjudicados.
 */

import type { ProveedorCotizando } from '../api/compra-agil-client.js';

/**
 * Determina si un proveedor fue el adjudicado.
 *
 * Se conserva porque es correcta si la API alguna vez publica adjudicaciones,
 * pero en la práctica retorna false SIEMPRE (ver nota de cabecera). No debe
 * usarse como única fuente de un análisis: hazlo degradar con elegancia.
 */
export function esGanador(prov: ProveedorCotizando): boolean {
  // Señal 1: flag directo (la API lo entrega como número: 0 | 1)
  if (prov.proveedor_seleccionado === true || prov.proveedor_seleccionado === 1) {
    return true;
  }
  // Señal 2: objeto `seleccion` anidado — documentado pero inexistente en la
  // respuesta real. Se mantiene por si la API lo incorpora.
  if (prov.seleccion?.proveedor_seleccionado === true) {
    return true;
  }
  // Señal 3: estado_por_comprador === '1' (observado siempre null)
  if (prov.estado_por_comprador === '1') {
    return true;
  }
  // Señal 4: motivo/criterio de selección presente implica adjudicación
  if (prov.seleccion?.motivo_seleccion || prov.seleccion?.criterio_seleccion) {
    return true;
  }
  return false;
}

/**
 * Una cotización es admisible si el comprador no la declaró inadmisible.
 * Útil para separar precios "sanos" de los descartados por incumplimiento
 * (ej: "Oferta no cumple con garantía solicitada"), que distorsionan la muestra.
 */
export function esAdmisible(prov: ProveedorCotizando): boolean {
  const j = prov.justificacion_inadmisibilidad;
  return j === null || j === undefined || String(j).trim() === '';
}

/**
 * Extrae el precio UNITARIO de la cotización de un proveedor para un término
 * de búsqueda dado. Retorna null si no hay un precio unitario confiable.
 *
 * No cae al monto total: el precio unitario y el total NO son comparables y
 * mezclarlos corrompe cualquier estadística agregada.
 */
export function extraerPrecioUnitario(
  prov: ProveedorCotizando,
  keyword?: string
): number | null {
  const productos = prov.productos_cotizados;
  if (!productos || productos.length === 0) {
    return null;
  }

  // Un solo producto → su precio unitario
  if (productos.length === 1) {
    return normalizarPrecio(productos[0].precio_unitario);
  }

  // Varios productos → intentar casar con la keyword
  if (keyword) {
    const kw = keyword.toLowerCase();
    const matched = productos.find((p) =>
      (p.nombre_producto || '').toLowerCase().includes(kw)
    );
    if (matched) {
      return normalizarPrecio(matched.precio_unitario);
    }
  }

  // Fallback: primer producto con precio unitario válido
  for (const p of productos) {
    const precio = normalizarPrecio(p.precio_unitario);
    if (precio !== null) return precio;
  }
  return null;
}

/**
 * Extrae el monto NETO total de la cotización de un proveedor.
 * Útil para estadísticas de monto cotizado (distintas de precio unitario).
 */
export function extraerMontoNeto(prov: ProveedorCotizando): number | null {
  return normalizarPrecio(prov.valor_neto) ?? normalizarPrecio(prov.monto_total);
}

export interface EstadisticasPrecio {
  muestras: number;
  minimo: number;
  maximo: number;
  promedio: number;
  mediana: number;
  /** Percentil 25 — referencia para posicionarse de forma competitiva. */
  p25: number;
}

/**
 * Calcula estadísticas de una serie de precios.
 * Retorna null si la serie está vacía, para poder distinguir "sin datos"
 * de "datos que dan cero".
 */
export function calcularEstadisticas(valores: number[]): EstadisticasPrecio | null {
  if (!valores || valores.length === 0) return null;
  const s = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return {
    muestras: s.length,
    minimo: s[0],
    maximo: s[s.length - 1],
    promedio: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    mediana: s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2),
    p25: percentil(s, 25),
  };
}

/** Percentil por interpolación lineal sobre una serie YA ordenada. */
export function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return 0;
  if (ordenados.length === 1) return ordenados[0];
  const pos = (p / 100) * (ordenados.length - 1);
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (bajo === alto) return ordenados[bajo];
  return Math.round(ordenados[bajo] + (ordenados[alto] - ordenados[bajo]) * (pos - bajo));
}

function normalizarPrecio(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return null;
  return valor;
}
