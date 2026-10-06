/**
 * Validación contra la API REAL. Gasta cuota del ticket: ~15-25 consultas en
 * total. Correr con:  QA_API_REAL=1 node scripts/qa/cliente-mcp.mjs scripts/qa/escenarios-reales.mjs
 *
 * Va en orden de dependencia y de costo: primero lo barato y verificable.
 * Los códigos de proceso se toman de la búsqueda: cámbialos por procesos
 * vigentes si quieres repetir un caso puntual. Ver docs/internals/qa/validacion-api-real.md.
 */
export default [
  ['ticket valido', 'verificar_ticket', {}],
  ['hora oficial (SHOA)', 'verificar_hora_oficial', {}],
  ['busqueda publicada RM', 'buscar_compras_agiles', { estado: 'publicada', region: '13' }],
  ['busqueda por texto', 'buscar_compras_agiles', { q: 'resmas', estado: 'publicada' }],
  ['monitoreo 60 min', 'monitorear_cambios_recientes', { minutos: 60 }],
  ['radar RM, 1 pagina', 'radar_oportunidades_calientes', { region: '13', max_paginas: 1 }],
  ['precios (3 historicos)', 'analizar_precios_mercado', { q: 'resmas', limite_analisis: 3 }, 120_000],
  ['auditoria desiertas (2)', 'auditar_compras_desiertas', { q: 'resmas', limite_analisis: 2 }, 120_000],
  ['informe radar RM', 'generar_informe', { tipo: 'radar', region: '13', max_paginas: 1 }],
  ['estadisticas de uso', 'obtener_estadisticas_uso', {}],
];
