/**
 * Presupuesto de tiempo de cada llamada a una herramienta.
 *
 * ⚠ POR QUÉ EXISTE: un cliente MCP corta la herramienta a los ~60 s, y el
 *   freno propio de 15 consultas/min podía retener una consulta casi todo ese
 *   tiempo antes de enviarla. Medido: en la batería de scripts/qa una consulta
 *   esperó 57 s, y en la simulación con agentes (6-oct) cuatro llamadas
 *   tardaron 25-45 s con la API respondiendo en ~400 ms. La herramienta
 *   terminaba cortada por el cliente sin entregar nada, aunque ya tuviera
 *   parte de los datos.
 *
 *   Ahora cada llamada lleva un presupuesto (45 s por defecto). Antes de
 *   esperar en el freno, el cliente HTTP comprueba si la espera cabe: si no,
 *   no envía la consulta (no gasta cuota) y la herramienta responde con lo que
 *   tenga, diciendo qué omitió.
 *
 * El contexto viaja con AsyncLocalStorage: cada llamada a herramienta tiene
 * el suyo aunque varias corran a la vez sobre el mismo cliente.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Por debajo de los ~60 s del cliente MCP, con margen para armar la respuesta. */
export const PRESUPUESTO_POR_DEFECTO_MS = 45_000;

export interface ContextoLlamada {
  /** Instante (epoch ms) en que se agota el presupuesto. */
  vence: number;
  presupuestoMs: number;
  /** Códigos cuyo detalle no se pidió para no pasar el presupuesto. */
  omitidas: string[];
  /** Último HTTP de error visto en los detalles de ESTA llamada. */
  ultimoHttp: number | null;
}

const almacen = new AsyncLocalStorage<ContextoLlamada>();

export function presupuestoDesdeEntorno(): number {
  const n = Number(process.env.COMPRA_AGIL_PRESUPUESTO_MS);
  return Number.isFinite(n) && n > 0 ? n : PRESUPUESTO_POR_DEFECTO_MS;
}

export function conPresupuesto<T>(fn: () => Promise<T>, presupuestoMs = presupuestoDesdeEntorno()): Promise<T> {
  return almacen.run({ vence: Date.now() + presupuestoMs, presupuestoMs, omitidas: [], ultimoHttp: null }, fn);
}

/**
 * Corre `fn` fuera de toda llamada a herramienta. Lo que `fn` deje programado
 * (temporizadores, promesas) tampoco hereda el presupuesto.
 *
 * ⚠ Para trabajo que sobrevive a la herramienta que lo lanza: la vigilancia
 *   encendida con activar_vigilancia heredaba los 45 s de esa llamada y, ya
 *   vencidos, cada consulta de las rondas siguientes se cancelaba o ni se
 *   enviaba (prueba real del 8-oct: 11 lotes pendientes en una hora).
 */
export function fueraDeLaHerramienta<T>(fn: () => T): T {
  return almacen.exit(fn);
}

export function contextoActual(): ContextoLlamada | undefined {
  return almacen.getStore();
}

/** Milisegundos que quedan en esta llamada, o `undefined` fuera de una herramienta. */
export function tiempoRestante(): number | undefined {
  const c = almacen.getStore();
  return c ? c.vence - Date.now() : undefined;
}

/** De `codigos`, los que se omitieron por tiempo en esta llamada. */
export function omitidasPorTiempo(codigos: string[]): string[] {
  const c = almacen.getStore();
  if (!c) return [];
  const omitidas = new Set(c.omitidas);
  return codigos.filter((x) => omitidas.has(x));
}

/**
 * Envuelve `server.registerTool` para que toda herramienta registrada después
 * corra dentro de su propio presupuesto. Se instala una vez, en el punto de
 * entrada, antes de registrar las herramientas.
 */
export function instalarPresupuesto(server: McpServer, presupuestoMs?: number): void {
  const original = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool = (nombre, config, handler) =>
    original(nombre, config, (...args: unknown[]) =>
      conPresupuesto(() => Promise.resolve((handler as (...a: unknown[]) => unknown)(...args)), presupuestoMs ?? presupuestoDesdeEntorno()),
    );
}

/**
 * Describe los detalles que no se obtuvieron en una tanda, separando los que
 * fallaron en la API de los que se omitieron por tiempo. Son cosas distintas:
 * lo primero habla del servicio; lo segundo, solo de la carga de esta
 * instalación en el último minuto, y no gastó cuota.
 */
export function describirFallosDetalle(sinDetalle: string[], intentados: number): {
  porApi: string[];
  porTiempo: string[];
  texto: string;
} {
  const porTiempo = omitidasPorTiempo(sinDetalle);
  const omitidos = new Set(porTiempo);
  const porApi = sinDetalle.filter((c) => !omitidos.has(c));
  const partes: string[] = [];
  const pl = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
  if (porApi.length > 0) {
    partes.push(`${porApi.length} ${pl(porApi.length, 'falló', 'fallaron')} porque la API no respondió (${porApi.join(', ')})`);
  }
  if (porTiempo.length > 0) {
    partes.push(`${porTiempo.length} no se ${pl(porTiempo.length, 'pidió', 'pidieron')} para no pasar el tiempo límite de la herramienta (${porTiempo.join(', ')}); eso no gastó cuota`);
  }
  return {
    porApi,
    porTiempo,
    texto: `${sinDetalle.length} de ${intentados} ${pl(intentados, 'consulta de detalle no se completó', 'consultas de detalle no se completaron')}: ${partes.join(', y ')}.`,
  };
}
