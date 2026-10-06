/**
 * Batería de la auditoría QA de octubre 2026, contra la API simulada
 * (scripts/qa/mock-api.mjs). [etiqueta, herramienta, argumentos, timeoutMs?]
 *
 * Esperado tras el Sprint 0: "busqueda nulls" ok, "JSON corrupto" y los
 * cuelgues con mensaje claro, "informe ruta fuera de la raíz" ERROR, y
 * ningún TICKETLEAK. La batería hace más de 15 consultas, así que alguna de
 * las últimas queda retenida hasta ~60 s por el freno propio de 15/min: es el
 * defecto 1.1 del roadmap (docs/internals/qa/roadmap.md), no una regresión.
 */
import os from 'node:os';

export default [
  ['busqueda', 'buscar_compras_agiles', { q: 'licencias' }],
  // Antes de llenar el freno de 15/min: si va después, se mide el freno y no el timeout.
  ['detalle que cuelga', 'obtener_detalle_compra', { codigo: 'HANG-1' }, 60_000],
  ['busqueda vacia', 'buscar_compras_agiles', { q: 'EMPTY' }],
  ['busqueda nulls', 'buscar_compras_agiles', { q: 'NULLS' }],
  ['detalle', 'obtener_detalle_compra', { codigo: '1057539-228-COT26' }],
  ['detalle desde cache', 'obtener_detalle_compra', { codigo: '1057539-228-COT26' }],
  ['detalle 404', 'obtener_detalle_compra', { codigo: 'NOEXISTE-1' }],
  ['API 504', 'buscar_compras_agiles', { q: 'E504' }],
  ['JSON corrupto', 'buscar_compras_agiles', { q: 'BADJSON' }],
  ['monitoreo', 'monitorear_cambios_recientes', { minutos: 60 }],
  ['radar', 'radar_oportunidades_calientes', {}],
  ['precios', 'analizar_precios_mercado', { q: 'bandejas' }],
  ['auditoria', 'auditar_compras_desiertas', { q: 'bandejas' }],
  ['borrador', 'generar_borrador_cotizacion', { codigo_compra: '1057539-228-COT26' }],
  ['informe radar con XSS', 'generar_informe', { tipo: 'radar', q: 'XSS' }],
  ['informe competencia con XSS', 'generar_informe', { tipo: 'competencia', codigo_compra: 'XSS-1-COT26' }],
  ['informe cotizacion', 'generar_informe', { tipo: 'cotizacion', codigo_compra: '1057539-228-COT26' }],
  ['informe ruta fuera de la raíz', 'generar_informe', { tipo: 'radar', ruta_salida: os.tmpdir() }],
  ['informe sin codigo', 'generar_informe', { tipo: 'cotizacion' }],
  ['esquema invalido', 'buscar_compras_agiles', { tamano_pagina: 500 }],
  ['docs: listar', 'consultar_documentos_locales', {}],
  ['docs: multas', 'consultar_documentos_locales', { query: '¿qué multas me pueden aplicar?' }],
  ['enlace adjunto', 'obtener_enlace_documento', { id_documento: '123', codigo_compra: '1-2-COT26' }],
  ['estadisticas', 'obtener_estadisticas_uso', {}],
  ['429', 'buscar_compras_agiles', { q: 'E429' }, 90_000],
  ['tras el 429, la cache sigue sirviendo', 'obtener_detalle_compra', { codigo: '1057539-228-COT26' }],
];
