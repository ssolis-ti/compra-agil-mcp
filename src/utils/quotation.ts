/**
 * Utilidades de cotización: detección del proveedor ganador y extracción de precios.
 *
 * CONTEXTO IMPORTANTE (ver docs/api §6.5):
 * La API real de Compra Ágil NO garantiza los campos `seleccion.*` ni
 * `proveedor_seleccionado` en la respuesta ("Documentado pero no confirmado
 * en la respuesta real"). Por eso la detección del ganador combina TODAS las
 * señales disponibles en un único punto, para que las tools analíticas
 * (recomendar_precio, auditar_desiertas, generar_borrador, verificar_orden_compra)
 * se comporten de forma consistente y no fallen silenciosamente.
 */

import type { ProveedorCotizando } from '../api/compra-agil-client.js';

/**
 * Determina si un proveedor cotizante fue el seleccionado/adjudicado,
 * combinando todas las señales conocidas (documentadas y observadas en la práctica).
 */
export function esGanador(prov: ProveedorCotizando): boolean {
  // Señal 1: flag directo (numérico o booleano)
  if (prov.proveedor_seleccionado === true || prov.proveedor_seleccionado === 1) {
    return true;
  }
  // Señal 2: objeto seleccion anidado (documentado, no siempre presente)
  if (prov.seleccion?.proveedor_seleccionado === true) {
    return true;
  }
  // Señal 3: estado_por_comprador === '1' (observado en respuestas reales)
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
 * Extrae el precio UNITARIO de la cotización de un proveedor para un término
 * de búsqueda dado. Retorna null si no hay un precio unitario confiable.
 *
 * No cae al monto total: el precio unitario y el total NO son comparables y
 * mezclarlos corrompe cualquier estadística agregada (ver hallazgo C2).
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
 * Útil para estadísticas de "monto adjudicado" (distintas de precio unitario).
 */
export function extraerMontoNeto(prov: ProveedorCotizando): number | null {
  return normalizarPrecio(prov.valor_neto) ?? normalizarPrecio(prov.monto_total);
}

function normalizarPrecio(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return null;
  return valor;
}
