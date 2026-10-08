/**
 * Una ronda de vigilancia (2.9.0, T2.6 y fase 7): tomar el vigilante, cargar
 * el estado, leer los lotes, entregar las alertas, revisar la salud y guardar.
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
import { cargarEstado, guardarEstado, leerCriteriosGuardados, type EstadoVigilancia } from './estado.js';
import { coincidencia } from './criterios.js';
import { tomarVigilante, vigilanteActivo } from './vigilante.js';
import { criteriosEfectivos, podarGateway, registrarParaGateway } from './gateway.js';
import { marcarNotificadas, notificacionesPendientes, registrarRonda, type ConfigSalud } from './salud.js';
import { crearAlerta } from '../avisos/mensaje.js';
import { encolar, enviarPendientes, podarBandeja, type ConfigBandeja, type ResultadoEnvios } from '../avisos/bandeja.js';
import type { Canal } from '../avisos/canal.js';
import type { Notificacion } from '../avisos/notificacion.js';

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
  /** Umbrales de salud (fase 7). Sin esto, valores por defecto. */
  salud?: ConfigSalud;
}

export interface NotificacionEnviada extends Notificacion {
  /** Canales que la entregaron. Vacío si no hay canales: solo queda en el log. */
  entregadaPor: string[];
}

export interface ResultadoRonda {
  tomada: boolean;
  /** La ronda se saltó: tras un 429, la próxima ronda quedó fijada más adelante (R8.5). */
  omitida?: boolean;
  /** PID del vigilante activo cuando la ronda no se pudo tomar. */
  otroVigilante?: number;
  /** Migración, estado ilegible o disco que no dejó guardar. */
  avisos: string[];
  ciclo?: ResultadoCiclo;
  envios?: ResultadoEnvios;
  notificaciones?: NotificacionEnviada[];
}

export async function rondaDeVigilancia(deps: DependenciasRonda, limites: LimitesCiclo = {}): Promise<ResultadoRonda> {
  const latidoMaxMs = 3 * deps.intervaloMs;
  const inicio = deps.ahora();
  if (!tomarVigilante(deps.rutas.vigilante, { pid: deps.pid, ahoraMs: inicio, latidoMaxMs })) {
    return { tomada: false, otroVigilante: vigilanteActivo(deps.rutas.vigilante, inicio, latidoMaxMs)?.pid, avisos: [] };
  }
  const { estado, avisos } = cargarEstado(deps.rutas.estado, deps.rutas.estadoViejo, inicio);
  if (estado.salud.proximaRonda && inicio < Date.parse(estado.salud.proximaRonda)) {
    return { tomada: true, omitida: true, avisos };
  }
  const canales = deps.avisos?.canales ?? [];
  const salud: ConfigSalud = deps.salud ?? {
    umbralCegueraMs: 120 * 60_000, resumenHora: '08:00', presupuestoConsultasDia: 1500, intervaloMs: deps.intervaloMs,
    canales: canales.map((c) => c.nombre),
  };

  // Los criterios fijados con configurar_criterios mandan sobre los del entorno
  // (R2.2), y se releen del disco: el dueño puede cambiarlos durante la ronda.
  const vigentes = () => {
    const guardados = leerCriteriosGuardados(deps.rutas.estado);
    const masNuevos = guardados && (!estado.criterios || guardados.cambiadoEn >= estado.criterios.cambiadoEn) ? guardados : estado.criterios;
    return criteriosEfectivos({ criterios: masNuevos } as EstadoVigilancia, deps.criterios);
  };
  const ciclo = await ejecutarCiclo({ ...deps, criterios: vigentes(), criteriosVigentes: vigentes }, estado, limites);
  // Última revisión antes de avisar, con los criterios de este momento: lo que
  // ya no calza no sale, y vuelve a poder alertarse si los criterios cambian.
  const alFinal = vigentes();
  ciclo.alertas = ciclo.alertas.flatMap((a) => {
    const palabra = coincidencia(a.item, alFinal);
    if (palabra) return [{ ...a, coincidencia: palabra }];
    delete estado.alertados[a.codigo];
    return [];
  });
  if (ciclo.alertas.length > 0) await deps.entregar(ciclo.alertas);
  const alertasArmadas = ciclo.alertas.map((a) => crearAlerta(a.item, a.coincidencia, a.cuando));
  // Cola del modo gateway (R9): siempre, para que un gateway pueda pedirlas.
  registrarParaGateway(estado, alertasArmadas);
  podarGateway(estado, deps.ahora());
  // Los avisos se encolan y se envían antes de guardar: lo que no se entregue
  // queda en la bandeja del estado y sale en la ronda siguiente (R3.5).
  let envios: ResultadoEnvios | undefined;
  if (canales.length > 0) {
    encolar(estado.bandeja, alertasArmadas, canales.map((c) => c.nombre), deps.ahora());
    envios = await enviarPendientes(estado.bandeja, canales, deps.ahora(), deps.avisos?.config);
  }
  podarBandeja(estado.bandeja, deps.ahora());

  // Salud (fase 7): qué avisar sobre la vigilancia misma.
  registrarRonda(estado, ciclo, envios, deps.ahora(), salud);
  const notificaciones: NotificacionEnviada[] = [];
  for (const n of notificacionesPendientes(estado, deps.ahora(), salud)) {
    const entregadaPor: string[] = [];
    for (const canal of canales) {
      if (canal.nombre === n.excluirCanal || typeof canal.notificar !== 'function') continue;
      const r = await canal.notificar(n, deps.ahora()).catch(() => ({ ok: false }));
      if (r.ok) entregadaPor.push(canal.nombre);
    }
    notificaciones.push({ ...n, entregadaPor });
  }
  // Si ningún canal puede llevarla (no hay canales, o el único es el caído), la
  // notificación queda solo en el log de la entrada: se da por hecha para no
  // repetirla en cada ronda. Si hay quien la lleve, solo cuando alguno la entregó.
  const sinQuienLaLleve = (n: Notificacion) => canales.every((c) => c.nombre === n.excluirCanal);
  marcarNotificadas(estado, notificaciones.filter((n) => sinQuienLaLleve(n) || n.entregadaPor.length > 0).map((n) => n.clave), deps.ahora());

  if (!guardarEstado(deps.rutas.estado, estado, deps.ahora())) {
    avisos.push(`No se pudo guardar ${deps.rutas.estado}: la próxima ronda repetirá estos lotes.`);
  }
  tomarVigilante(deps.rutas.vigilante, { pid: deps.pid, ahoraMs: deps.ahora(), latidoMaxMs });
  return { tomada: true, avisos, ciclo, envios, notificaciones };
}
