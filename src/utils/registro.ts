/**
 * Nombres de lo que el servidor registra, anotados al registrarse.
 *
 * ⚠ Fase 1.5 (ítem 34 del plan 2.8.0): `src/index.ts` mantenía tres listas a
 *   mano para el log de arranque. Al agregar `verificar_hora_oficial` la de
 *   herramientas siguió diciendo 15. Ahora se anota lo que de verdad se
 *   registra, así que no hay nada que mantener ni que desincronizar.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface Registrados {
  herramientas: string[];
  recursos: string[];
  prompts: string[];
}

/** Debe llamarse antes de registrar. Devuelve las listas que se irán llenando. */
export function anotarRegistros(server: McpServer): Registrados {
  const registrados: Registrados = { herramientas: [], recursos: [], prompts: [] };
  const envolver = (metodo: 'registerTool' | 'registerResource' | 'registerPrompt', destino: string[]) => {
    const original = (server[metodo] as (...a: unknown[]) => unknown).bind(server);
    (server as unknown as Record<string, unknown>)[metodo] = (...args: unknown[]) => {
      destino.push(String(args[0]));
      return original(...args);
    };
  };
  envolver('registerTool', registrados.herramientas);
  envolver('registerResource', registrados.recursos);
  envolver('registerPrompt', registrados.prompts);
  return registrados;
}
