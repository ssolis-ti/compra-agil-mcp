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
import { crearAlerta } from '../avisos/mensaje.js';
import { encolar, enviarPendientes, podarBandeja, type ConfigBandeja, type ResultadoEnvios } from '../avisos/bandeja.js';
import type { Canal } from '../avisos/canal.js';

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
  /** Canales activos (fase 3). Sin canales, las alertas solo van a `entregar`. */
  avisos?: { canales: Canal[]; config?: ConfigBandeja };
}

export interface ResultadoRonda {
  tomada: boolean;
  /** PID del vigilante activo cuando la ronda no se pudo tomar. */
  otroVigilante?: number;
  /** Migración, estado ilegible o disco que no dejó guardar. */
  avisos: string[];
  ciclo?: ResultadoCiclo;
  envios?: ResultadoEnvios;
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
  // Los avisos se encolan y se envían antes de guardar: lo que no se entregue
  // queda en la bandeja del estado y sale en la ronda siguiente (R3.5).
  let envios: ResultadoEnvios | undefined;
  if (deps.avisos && deps.avisos.canales.length > 0) {
    const alertas = ciclo.alertas.map((a) => crearAlerta(a.item, a.coincidencia, a.cuando));
    encolar(estado.bandeja, alertas, deps.avisos.canales.map((c) => c.nombre), deps.ahora());
    envios = await enviarPendientes(estado.bandeja, deps.avisos.canales, deps.ahora(), deps.avisos.config);
  }
  podarBandeja(estado.bandeja, deps.ahora());
  if (!guardarEstado(deps.rutas.estado, estado, deps.ahora())) {
    avisos.push(`No se pudo guardar ${deps.rutas.estado}: la próxima ronda repetirá estos lotes.`);
  }
  tomarVigilante(deps.rutas.vigilante, { pid: deps.pid, ahoraMs: deps.ahora(), latidoMaxMs });
  return { tomada: true, avisos, ciclo, envios };
}
