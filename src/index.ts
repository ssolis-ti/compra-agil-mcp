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
 *
 * Este archivo solo lee el entorno, valida el ticket y abre el transporte. La
 * construcción del servidor vive en `servidor.ts`, para poder probarla en el
 * mismo proceso.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json') as { version: string };

import { CompraAgilClient } from './api/compra-agil-client.js';
import { logger, setMcpServer } from './utils/logger.js';
import { registrarSecreto } from './utils/redact.js';
import { iniciarRelojOficial } from './utils/reloj.js';
import { crearServidor } from './servidor.js';
import { crearControlVigilancia } from './services/control-vigilancia.js';

// ─── Configuración ──────────────────────────────────────────────────

const TICKET = process.env.COMPRA_AGIL_TICKET;
const BASE_URL = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';

// Comandos de terminal (2.9.0): no abren el servidor ni necesitan el ticket.
if (process.argv.includes('--telegram-chat-id')) {
  const { comandoTelegramChatId } = await import('./cli/avisos.js');
  process.exit(await comandoTelegramChatId(process.env, (linea) => console.log(linea)));
}
if (process.argv.includes('--configurar')) {
  const { comandoConfigurar } = await import('./cli/configurar.js');
  const { consolaDeTerminal, instaladorDeArranque } = await import('./cli/consola.js');
  const { raizPaquete, carpetaDatos } = await import('./utils/rutas.js');
  const fsMod = await import('fs');
  const pathMod = await import('path');
  // El .env del proyecto si existe (instalación desde el repositorio); si no, el de la carpeta de datos.
  const enProyecto = pathMod.join(raizPaquete(), '.env');
  const rutaEnv = fsMod.existsSync(enProyecto) || fsMod.existsSync(pathMod.join(raizPaquete(), '.git')) ? enProyecto : pathMod.join(carpetaDatos(), '.env');
  const consola = consolaDeTerminal();
  const codigo = await comandoConfigurar({ env: process.env, rutaEnv, consola, instalarArranque: instaladorDeArranque(raizPaquete()) });
  consola.cerrar();
  process.exit(codigo);
}
if (process.argv.includes('--check')) {
  const { comandoCheck } = await import('./cli/check.js');
  process.exit(await comandoCheck(process.env, (linea) => console.log(linea)));
}
if (process.argv.includes('--probar-avisos')) {
  const { comandoProbarAvisos } = await import('./cli/check.js');
  process.exit(await comandoProbarAvisos(process.env, (linea) => console.log(linea)));
}
if (process.argv.includes('--vigilar')) {
  // El daemon de vigilancia arranca al importarse y sigue corriendo con sus
  // temporizadores. La promesa que no se resuelve detiene el resto de este
  // módulo: en este modo no se abre el servidor MCP por stdio.
  await import('./services/monitor.js');
  await new Promise<never>(() => undefined);
}

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

  const client = new CompraAgilClient(VALID_TICKET, BASE_URL, { persistir: true });

  // Plazos, radar y ventanas de cambios usan la hora del SHOA (utils/reloj.ts).
  // En segundo plano: si el UDP 123 está bloqueado, se sigue con el reloj local.
  // COMPRA_AGIL_NTP=off lo desactiva; bajo Vitest no corre, para no salir a la red.
  if (process.env.COMPRA_AGIL_NTP !== 'off' && !process.env.VITEST) iniciarRelojOficial();
  logger.info(`Cliente API configurado → ${BASE_URL}`);

  // La vigilancia «con Claude» corre dentro de este proceso (anexo de instalación, RA5).
  const vigilancia = crearControlVigilancia({
    client, env: process.env,
    registrar: (nivel, mensaje) => (nivel === 'error' ? logger.error(mensaje) : nivel === 'aviso' ? logger.warn(mensaje) : logger.info(mensaje)),
  });
  const { server, registrados } = crearServidor(client, PKG_VERSION, { vigilancia });
  logger.info(`${registrados.herramientas.length} herramientas registradas: ${registrados.herramientas.join(', ')}`);
  logger.info(`${registrados.recursos.length} recursos registrados: ${registrados.recursos.join(', ')}`);
  logger.info(`${registrados.prompts.length} prompts registrados: ${registrados.prompts.join(', ')}`);

  await server.connect(new StdioServerTransport());

  // Enlazar logger con la instancia del servidor conectado para logs nativos
  setMcpServer(server);

  logger.info('Servidor MCP Compra Ágil v2 listo y escuchando via Stdio.');
  // Si el usuario eligió vigilar «con Claude», vuelve sola al abrir Claude.
  if (!process.env.VITEST) vigilancia.retomar();
}

main().catch((error) => {
  logger.error('Error fatal al iniciar el servidor MCP:', error);
  process.exit(1);
});
