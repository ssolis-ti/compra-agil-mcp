/**
 * Una ronda de vigilancia (2.9.0, T2.6): tomar el vigilante, cargar el estado,
 * leer los lotes, entregar las alertas y guardar.
 *
 * Las alertas se entregan ANTES de guardar el estado (ADR 0022): si el proceso
 * muere entre las dos cosas, la ronda siguiente las vuelve a encontrar y una
 * alerta puede repetirse, pero nunca perderse. Si `entregar` lanza, el estado
 * tampoco se guarda, por la misma razón.
 *
 * La usan el daemon (`services/monitor.ts`) y, en la fase 8, la herramienta
 * del modo gateway.
 */

import { ejecutarCiclo, type AlertaVigilancia, type DependenciasCiclo, type LimitesCiclo, type ResultadoCiclo } from './ciclo.js';
import { cargarEstado, guardarEstado } from './estado.js';
import { tomarVigilante, vigilanteActivo } from './vigilante.js';

export interface RutasVigilancia {
  estado: string;
  /** `.monitor-state.json` de la 2.8.0, para migrarlo. */
  estadoViejo: string;
  vigilante: string;
}

export interface DependenciasRonda extends DependenciasCiclo {
  rutas: RutasVigilancia;
  pid: number;
  intervaloMs: number;
  entregar: (alertas: AlertaVigilancia[]) => void | Promise<void>;
}

export interface ResultadoRonda {
  tomada: boolean;
  /** PID del vigilante activo cuando la ronda no se pudo tomar. */
  otroVigilante?: number;
  /** Migración, estado ilegible o disco que no dejó guardar. */
  avisos: string[];
  ciclo?: ResultadoCiclo;
}

export async function rondaDeVigilancia(deps: DependenciasRonda, limites: LimitesCiclo = {}): Promise<ResultadoRonda> {
  const latidoMaxMs = 3 * deps.intervaloMs;
  const inicio = deps.ahora();
  if (!tomarVigilante(deps.rutas.vigilante, { pid: deps.pid, ahoraMs: inicio, latidoMaxMs })) {
    return { tomada: false, otroVigilante: vigilanteActivo(deps.rutas.vigilante, inicio, latidoMaxMs)?.pid, avisos: [] };
  }
  const { estado, avisos } = cargarEstado(deps.rutas.estado, deps.rutas.estadoViejo, inicio);
  const ciclo = await ejecutarCiclo(deps, estado, limites);
  if (ciclo.alertas.length > 0) await deps.entregar(ciclo.alertas);
  if (!guardarEstado(deps.rutas.estado, estado, deps.ahora())) {
    avisos.push(`No se pudo guardar ${deps.rutas.estado}: la próxima ronda repetirá estos lotes.`);
  }
  tomarVigilante(deps.rutas.vigilante, { pid: deps.pid, ahoraMs: deps.ahora(), latidoMaxMs });
  return { tomada: true, avisos, ciclo };
}
