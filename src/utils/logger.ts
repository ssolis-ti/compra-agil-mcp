/**
 * Logger seguro para servidores MCP con transporte Stdio.
 *
 * REGLA CRÍTICA: En servidores MCP que usan Stdio, JAMÁS se debe escribir
 * a stdout (console.log) ya que corrompe el stream JSON-RPC.
 * Todo el logging va exclusivamente a stderr (console.error).
 */

import { redact } from './redact.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function formatTimestamp(): string {
  return new Date().toISOString();
}

let mcpServer: any = null;

export function setMcpServer(server: any): void {
  mcpServer = server;
}

function log(level: LogLevel, message: string, data?: unknown): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const prefix = `[${formatTimestamp()}] [${level.toUpperCase()}]`;
  // Redacción en el punto de salida: cubre tanto el mensaje como los datos
  // adjuntos, sin importar de qué ruta provengan.
  const cuerpo = data ? `${message} ${JSON.stringify(data)}` : message;
  const seguro = redact(cuerpo);

  // SIEMPRE stderr, NUNCA stdout
  console.error(`${prefix} ${seguro}`);

  // El cliente MCP recibe los logs de forma nativa — es decir, van al contexto
  // del LLM y a la transcripción. Se envía la versión ya redactada.
  if (mcpServer) {
    mcpServer.sendLoggingMessage({
      level,
      logger: 'mcp-compra-agil',
      data: seguro,
    }).catch(() => {
      // Ignorar fallos silenciosamente para no interrumpir el flujo principal
    });
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
};

