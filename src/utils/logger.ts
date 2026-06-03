/**
 * Logger seguro para servidores MCP con transporte Stdio.
 *
 * REGLA CRÍTICA: En servidores MCP que usan Stdio, JAMÁS se debe escribir
 * a stdout (console.log) ya que corrompe el stream JSON-RPC.
 * Todo el logging va exclusivamente a stderr (console.error).
 */

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
  const line = data
    ? `${prefix} ${message} ${JSON.stringify(data)}`
    : `${prefix} ${message}`;

  // SIEMPRE stderr, NUNCA stdout
  console.error(line);

  // Intentar enviar el log de forma nativa al cliente MCP si el servidor está configurado
  if (mcpServer) {
    mcpServer.sendLoggingMessage({
      level,
      logger: 'mcp-compra-agil',
      data: data ? `${message} ${JSON.stringify(data)}` : message,
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

