/**
 * Construcción del servidor MCP: capacidades, formato de errores y registro de
 * herramientas, recursos y prompts. No lee el entorno ni abre un transporte:
 * eso lo hace `index.ts`.
 *
 * Separado de `index.ts` en la fase 1.6 del plan 2.8.0 para que los tests
 * levanten el servidor REAL en el mismo proceso (transporte en memoria del SDK
 * y un cliente de API falso) y ejerzan cada handler de punta a punta. Antes la
 * única prueba completa lanzaba un proceso aparte, cuya cobertura no se medía.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { CompraAgilClient } from './api/compra-agil-client.js';
import { logger } from './utils/logger.js';
import { instalarFormatoDeErrores } from './utils/validacion.js';
import { anotarRegistros, type Registrados } from './utils/registro.js';
import { instalarPresupuesto } from './utils/presupuesto.js';
import { instalarMetricas } from './utils/metricas.js';
import { INSTRUCCIONES } from './instrucciones.js';

// Tools
import { registerBuscarCompras } from './tools/buscar-compras.js';
import { registerDetalleCompra } from './tools/detalle-compra.js';
import { registerMonitorearCambios } from './tools/monitorear-cambios.js';
import { registerVerificarOC } from './tools/verificar-oc.js';
import { registerEstadisticasUso } from './tools/estadisticas-uso.js';
import { registerDetalleOC } from './tools/detalle-oc.js';
import { registerDocumentosTools } from './tools/documentos.js';
import { registerAnalizarPreciosMercado } from './tools/analizar-precios-mercado.js';
import { registerAuditarDesiertas } from './tools/auditar-desiertas.js';
import { registerGenerarBorrador } from './tools/generar-borrador.js';
import { registerRadarOportunidades } from './tools/radar-oportunidades.js';
import { registerGenerarInforme } from './tools/generar-informe.js';
import { registerVerificarTicket } from './tools/verificar-ticket.js';
import { registerVerificarHora } from './tools/verificar-hora.js';
import { registerVigilanciaTools } from './tools/vigilancia.js';

// Resources
import { registerRegionesResource } from './resources/regiones.js';
import { registerEstadosResource } from './resources/estados.js';
import { registerGlosarioResource } from './resources/glosario.js';
import { registerComprasTemplateResource } from './resources/compras-template.js';
import { registerDocumentacionResource } from './resources/documentacion.js';

// Prompts
import { registerBuscarOportunidadesPrompt } from './prompts/buscar-oportunidades.js';
import { registerAnalizarCompetenciaPrompt } from './prompts/analizar-competencia.js';
import { registerConfigurarVigilanciaPrompt } from './prompts/configurar-vigilancia.js';

export function crearServidor(client: CompraAgilClient, version: string): { server: McpServer; registrados: Registrados } {
  const server = new McpServer(
    {
      name: 'mcp-compra-agil',
      version,
    },
    {
      // ⚠ SIN ESTA DECLARACIÓN LOS LOGS NUNCA LLEGAN AL CLIENTE. El servidor
      //   llamaba a `sendLoggingMessage()` desde utils/logger.ts, pero no
      //   declaraba la capacidad `logging`, así que el SDK rechazaba cada envío
      //   y el `.catch()` del logger se lo tragaba en silencio. Verificado en
      //   auditoría (8 de septiembre de 2026): el servidor anunciaba solo
      //   `tools, resources, prompts`, `logging/setLevel` respondía "Method not
      //   found" y llegaban 0 notificaciones pese a LOG_LEVEL=debug. La
      //   característica que el README anuncia como "Logs Nativos en el
      //   Protocolo" nunca había funcionado.
      capabilities: { logging: {} },
      instructions: INSTRUCCIONES,
    }
  );

  // Un solo formato para todo rechazo de una entrada, con o sin consulta a la
  // API (E5). Debe ir antes de registrar las herramientas.
  if (!instalarFormatoDeErrores(server)) {
    logger.warn('El SDK de MCP cambió: los rechazos del esquema quedan en su formato propio, no en el del servidor.');
  }

  // Los nombres del log de arranque se anotan al registrar, no a mano (ítem 34).
  const registrados = anotarRegistros(server);

  // Latencia, llamadas y errores por herramienta (fase 2.2).
  instalarMetricas(server);

  // Herramientas. Cada llamada corre con un presupuesto de tiempo bajo el
  // corte del cliente MCP (ver utils/presupuesto.ts).
  instalarPresupuesto(server);
  registerBuscarCompras(server, client);
  registerDetalleCompra(server, client);
  registerMonitorearCambios(server, client);
  registerVerificarOC(server, client);
  registerEstadisticasUso(server, client);
  registerDetalleOC(server, client);
  registerDocumentosTools(server); // registra 3 tools de documentos
  registerAnalizarPreciosMercado(server, client);
  registerAuditarDesiertas(server, client);
  registerGenerarBorrador(server, client);
  registerRadarOportunidades(server, client);
  registerGenerarInforme(server, client);
  registerVerificarTicket(server, client);
  registerVerificarHora(server);
  registerVigilanciaTools(server, client); // 5 herramientas de vigilancia y avisos (2.9.0)

  // Recursos
  registerRegionesResource(server);
  registerEstadosResource(server);
  registerGlosarioResource(server);
  registerComprasTemplateResource(server, client);
  registerDocumentacionResource(server);

  // Prompts
  registerBuscarOportunidadesPrompt(server);
  registerAnalizarCompetenciaPrompt(server);
  registerConfigurarVigilanciaPrompt(server);

  return { server, registrados };
}
