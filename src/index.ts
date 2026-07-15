#!/usr/bin/env node

import { loadEnvManual } from './utils/env-loader.js';
// Inicializar entorno antes de cualquier otra importación o llamada
loadEnvManual();

/**
 * MCP Server: Compra Ágil v2 — Mercado Público de Chile
 *
 * Servidor MCP que envuelve la API REST de Compra Ágil v2,
 * permitiendo a cualquier IA, agente o cliente MCP consultar
 * procesos de compra pública del Estado de Chile.
 *
 * Transporte: Stdio (compatible con Claude Desktop, Cursor, OpenClaw, etc.)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json') as { version: string };

import { CompraAgilClient } from './api/compra-agil-client.js';
import { logger, setMcpServer } from './utils/logger.js';
import { registrarSecreto, pista } from './utils/redact.js';

// Tools
import { registerBuscarCompras } from './tools/buscar-compras.js';
import { registerDetalleCompra } from './tools/detalle-compra.js';
import { registerMonitorearCambios } from './tools/monitorear-cambios.js';
import { registerVerificarOC } from './tools/verificar-oc.js';
import { registerEstadisticasUso } from './tools/estadisticas-uso.js';
import { registerDetalleOC } from './tools/detalle-oc.js';
import { registerDocumentosTools } from './tools/documentos.js';
import { registerRecomendarPrecio } from './tools/recomendar-precio.js';
import { registerAuditarDesiertas } from './tools/auditar-desiertas.js';
import { registerGenerarBorrador } from './tools/generar-borrador.js';
import { registerRadarOportunidades } from './tools/radar-oportunidades.js';
import { registerGenerarInforme } from './tools/generar-informe.js';
import { registerVerificarTicket } from './tools/verificar-ticket.js';

// Resources
import { registerRegionesResource } from './resources/regiones.js';
import { registerEstadosResource } from './resources/estados.js';
import { registerGlosarioResource } from './resources/glosario.js';
import { registerComprasTemplateResource } from './resources/compras-template.js';
import { registerDocumentacionResource } from './resources/documentacion.js';

// Prompts
import { registerBuscarOportunidadesPrompt } from './prompts/buscar-oportunidades.js';
import { registerAnalizarCompetenciaPrompt } from './prompts/analizar-competencia.js';

// ─── Configuración ──────────────────────────────────────────────────

const TICKET = process.env.COMPRA_AGIL_TICKET;
const BASE_URL = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';

// Registrar el ticket como secreto ANTES de cualquier log o request: a partir de
// aquí, `redact()` lo borra de todo texto que salga del proceso (logs, errores,
// respuestas de tools). Ver src/utils/redact.ts.
registrarSecreto(TICKET);

if (!TICKET) {
  logger.error(
    'Variable de entorno COMPRA_AGIL_TICKET no configurada. ' +
    'Obtén tu ticket en https://www.chilecompra.cl/api/ y configúrala antes de iniciar el servidor.'
  );
  process.exit(1);
}

// Ticket validado — asignar a const tipada para usar dentro de main()
const VALID_TICKET: string = TICKET;

// ─── Inicialización ─────────────────────────────────────────────────

async function main() {
  logger.info('Iniciando servidor MCP Compra Ágil v2...');

  // 1. Crear cliente HTTP para la API de Mercado Público
  const client = new CompraAgilClient(VALID_TICKET, BASE_URL);
  logger.info(`Cliente API configurado → ${BASE_URL}`);

  // 2. Crear servidor MCP
  const server = new McpServer({
    name: 'mcp-compra-agil',
    version: PKG_VERSION,
  });

  // 3. Registrar herramientas (Tools)
  registerBuscarCompras(server, client);
  registerDetalleCompra(server, client);
  registerMonitorearCambios(server, client);
  registerVerificarOC(server, client);
  registerEstadisticasUso(server, client);
  registerDetalleOC(server, client);
  registerDocumentosTools(server); // registra 3 tools de documentos
  registerRecomendarPrecio(server, client);
  registerAuditarDesiertas(server, client);
  registerGenerarBorrador(server, client);
  registerRadarOportunidades(server, client);
  registerGenerarInforme(server, client);
  registerVerificarTicket(server, client);
  const TOOL_NAMES = [
    'buscar_compras_agiles', 'obtener_detalle_compra', 'monitorear_cambios_recientes',
    'verificar_orden_compra', 'obtener_estadisticas_uso', 'obtener_detalle_orden_compra',
    'obtener_enlace_documento', 'descargar_y_leer_documento', 'consultar_documentos_locales',
    'recomendar_precio_ganador', 'auditar_compras_desiertas', 'generar_borrador_cotizacion',
    'radar_oportunidades_calientes', 'generar_informe', 'verificar_ticket',
  ];
  logger.info(`${TOOL_NAMES.length} herramientas registradas: ${TOOL_NAMES.join(', ')}`);

  // 4. Registrar recursos (Resources)
  registerRegionesResource(server);
  registerEstadosResource(server);
  registerGlosarioResource(server);
  registerComprasTemplateResource(server, client);
  registerDocumentacionResource(server);
  const RESOURCE_NAMES = [
    'regiones', 'estados', 'glosario',
    'compra-agil://compras/{codigo}', 'compra-agil://documentacion/{filename}',
  ];
  logger.info(`${RESOURCE_NAMES.length} recursos registrados: ${RESOURCE_NAMES.join(', ')}`);

  // 5. Registrar prompts
  registerBuscarOportunidadesPrompt(server);
  registerAnalizarCompetenciaPrompt(server);
  const PROMPT_NAMES = ['buscar_oportunidades_proveedor', 'analizar_competencia'];
  logger.info(`${PROMPT_NAMES.length} prompts registrados: ${PROMPT_NAMES.join(', ')}`);

  // 6. Conectar al transporte Stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 7. Enlazar logger con la instancia del servidor conectado para logs nativos
  setMcpServer(server);

  logger.info('Servidor MCP Compra Ágil v2 listo y escuchando via Stdio.');
}

main().catch((error) => {
  logger.error('Error fatal al iniciar el servidor MCP:', error);
  process.exit(1);
});

