/**
 * Métricas de uso de este proceso del servidor: por herramienta (llamadas,
 * errores, latencia) y por consulta a la API (caché, resultado HTTP).
 *
 * ⚠ Fase 2.2 del plan 2.8.0: en el enjambre contra la API real (6-oct) las
 *   latencias solo se pudieron medir desde fuera, con la hora del sistema antes
 *   y después de cada llamada y 4–6 s del propio agente incluidos. Sin datos
 *   propios, el timeout y el presupuesto de tiempo se calibraban con supuestos.
 *
 * Viven en memoria y empiezan de cero con cada arranque: describen esta
 * sesión, no el historial. No guardan parámetros ni respuestas: solo nombres,
 * tiempos y códigos, así que no pueden filtrar nada.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Cuántas duraciones recientes se guardan por herramienta para los percentiles. */
const VENTANA_LATENCIAS = 100;

interface MetricaHerramienta {
  llamadas: number;
  errores: number;
  maximoMs: number;
  totalMs: number;
  recientes: number[];
}

const herramientas = new Map<string, MetricaHerramienta>();
const api = { enviadas: 0, desdeCache: 0, omitidasPorTiempo: 0, porResultado: new Map<string, number>() };
let inicio = Date.now();

export function registrarLlamadaHerramienta(nombre: string, ms: number, esError: boolean): void {
  const m = herramientas.get(nombre) ?? { llamadas: 0, errores: 0, maximoMs: 0, totalMs: 0, recientes: [] };
  m.llamadas++;
  if (esError) m.errores++;
  m.totalMs += ms;
  m.maximoMs = Math.max(m.maximoMs, ms);
  m.recientes.push(ms);
  if (m.recientes.length > VENTANA_LATENCIAS) m.recientes.shift();
  herramientas.set(nombre, m);
}

/** Resultado de una consulta enviada: el código HTTP, o la causa si no hubo respuesta. */
export function registrarConsultaApi(resultado: number | 'timeout' | 'red' | 'respuesta_invalida'): void {
  api.enviadas++;
  const clave = String(resultado);
  api.porResultado.set(clave, (api.porResultado.get(clave) ?? 0) + 1);
}

export function registrarAciertoCache(): void {
  api.desdeCache++;
}

export function registrarOmitidaPorTiempo(): void {
  api.omitidasPorTiempo++;
}

function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return 0;
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, i)];
}

export function resumenMetricas() {
  const porHerramienta: Record<string, unknown> = {};
  for (const [nombre, m] of [...herramientas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ordenados = [...m.recientes].sort((a, b) => a - b);
    porHerramienta[nombre] = {
      llamadas: m.llamadas,
      errores: m.errores,
      latencia_ms: {
        media: Math.round(m.totalMs / m.llamadas),
        mediana: Math.round(percentil(ordenados, 50)),
        p95: Math.round(percentil(ordenados, 95)),
        maxima: Math.round(m.maximoMs),
      },
    };
  }
  const solicitadas = api.enviadas + api.desdeCache;
  return {
    _alcance: 'Desde que arrancó este proceso del servidor; se reinicia con él. Latencias medidas dentro del servidor, desde que la herramienta recibe la llamada hasta que responde.',
    desde: new Date(inicio).toISOString(),
    herramientas: porHerramienta,
    consultas_api: {
      enviadas: api.enviadas,
      desde_cache: api.desdeCache,
      porcentaje_desde_cache: solicitadas === 0 ? 0 : Math.round((api.desdeCache / solicitadas) * 100),
      omitidas_por_tiempo: api.omitidasPorTiempo,
      por_resultado: Object.fromEntries([...api.porResultado.entries()].sort(([a], [b]) => a.localeCompare(b))),
    },
  };
}

/** Envuelve `registerTool` para medir cada llamada. Debe ir antes de registrar. */
export function instalarMetricas(server: McpServer): void {
  const registrar = (server.registerTool as (...a: unknown[]) => unknown).bind(server);
  (server as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool = (...args: unknown[]) => {
    const nombre = String(args[0]);
    const handler = args[args.length - 1];
    if (typeof handler === 'function') {
      args[args.length - 1] = async (...h: unknown[]) => {
        const t0 = performance.now();
        let esError = true;
        try {
          const r = await (handler as (...x: unknown[]) => Promise<{ isError?: boolean }>)(...h);
          esError = r?.isError === true;
          return r;
        } finally {
          registrarLlamadaHerramienta(nombre, performance.now() - t0, esError);
        }
      };
    }
    return registrar(...args);
  };
}

/** Solo para tests. */
export function reiniciarMetricas(): void {
  herramientas.clear();
  api.enviadas = 0;
  api.desdeCache = 0;
  api.omitidasPorTiempo = 0;
  api.porResultado.clear();
  inicio = Date.now();
}
