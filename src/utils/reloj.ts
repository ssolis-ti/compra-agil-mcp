/**
 * Reloj de referencia del servidor: la hora de esta máquina corregida con el
 * desfase medido contra el SHOA (`ntp.shoa.cl`), que fija la hora oficial de
 * Chile.
 *
 * ⚠ POR QUÉ EXISTE: los plazos (`horas_restantes`, la urgencia del radar, las
 *   ventanas de cambios del monitoreo y del daemon) se calculan restando "ahora".
 *   Hasta la 2.7.0 ese "ahora" era `Date.now()` sin contrastar: un reloj
 *   desviado falseaba todos los plazos aunque las fechas de la API se leyeran
 *   bien, y el chequeo contra el SHOA vivía aislado en una herramienta que nadie
 *   llama antes de pedir el radar.
 *
 * ⚠ LO QUE EL NTP NO RESUELVE: entrega la hora UTC exacta, no la zona horaria.
 *   El paso a UTC-3 / UTC-4 sale de la base de zonas de Node
 *   (`process.versions.tz`); ver utils/fechas.ts.
 *
 * Nunca bloquea: la medición corre en segundo plano y, mientras no hay una
 * medición válida (o si la red bloquea el UDP 123), `ahora()` usa el reloj local.
 */

import {
  consultarHoraOficial, DESFASE_PREOCUPANTE_MS, SERVIDOR_NTP_CHILE,
  type ResultadoNtp, type FalloNtp,
} from './ntp.js';
import { registrarProveedorAvisoReloj } from './fechas.js';

/** Cada cuánto se vuelve a medir. Un reloj de PC deriva segundos por día, no por hora. */
export const INTERVALO_MEDICION_MS = 30 * 60_000;

/** Una medición más antigua que esto ya no se aplica: se vuelve al reloj local. */
const VIGENCIA_MEDICION_MS = 3 * INTERVALO_MEDICION_MS;

interface EstadoReloj {
  desfaseMs: number | null;
  medidoEn: number | null;
  ultimoFallo: string | null;
}

const estado: EstadoReloj = { desfaseMs: null, medidoEn: null, ultimoFallo: null };
let temporizador: NodeJS.Timeout | null = null;

function medicionVigente(): boolean {
  return estado.desfaseMs !== null && estado.medidoEn !== null &&
    Date.now() - estado.medidoEn < VIGENCIA_MEDICION_MS;
}

/** "Ahora", en ms Unix, corregido contra el SHOA si hay una medición vigente. */
export function ahora(): number {
  return Date.now() + (medicionVigente() ? (estado.desfaseMs as number) : 0);
}

/** Registra una medición (la usan el ciclo automático y `verificar_hora_oficial`). */
export function registrarMedicion(r: ResultadoNtp | FalloNtp): void {
  if (r.ok) {
    estado.desfaseMs = r.desfaseMs;
    estado.medidoEn = Date.now();
    estado.ultimoFallo = null;
  } else {
    estado.ultimoFallo = r.motivo;
  }
}

/** Fuente del "ahora" que usa el servidor, para informarla en la salida. */
export function estadoReloj(): { fuente: 'shoa' | 'local'; desfaseMs: number | null; medidoHaceS: number | null; motivo: string | null } {
  const vigente = medicionVigente();
  return {
    fuente: vigente ? 'shoa' : 'local',
    desfaseMs: vigente ? estado.desfaseMs : null,
    medidoHaceS: estado.medidoEn !== null ? Math.round((Date.now() - estado.medidoEn) / 1000) : null,
    motivo: vigente ? null : (estado.ultimoFallo ?? 'Todavía no se midió contra el SHOA.'),
  };
}

/**
 * Aviso para las respuestas con plazos. Solo cuando importa: si el reloj local
 * se desvía un minuto o más del SHOA. Ya está corregido en `ahora()`, pero quien
 * lea la ficha con el reloj de su equipo verá otra cosa, y debe saberlo.
 */
export function avisoReloj(): string | null {
  if (!medicionVigente()) return null;
  const d = estado.desfaseMs as number;
  if (Math.abs(d) < DESFASE_PREOCUPANTE_MS) return null;
  const minutos = Math.round(Math.abs(d) / 60_000);
  const sentido = d > 0 ? 'atrasado' : 'adelantado';
  return `El reloj de esta máquina está ${sentido} ~${minutos} min respecto del SHOA. Los plazos de esta respuesta ya están corregidos con la hora oficial; si comparas con el reloj de tu equipo, considera esa diferencia.`;
}

registrarProveedorAvisoReloj(avisoReloj);

/**
 * Arranca la medición periódica en segundo plano. Idempotente. No retiene el
 * proceso (`unref`): un servidor stdio que se cierra no espera al NTP.
 */
export function iniciarRelojOficial(servidor: string = SERVIDOR_NTP_CHILE): void {
  if (temporizador) return;
  const medir = () => { void consultarHoraOficial(servidor).then(registrarMedicion); };
  medir();
  temporizador = setInterval(medir, INTERVALO_MEDICION_MS);
  temporizador.unref();
}

/** Solo para tests: vuelve al estado inicial y detiene la medición periódica. */
export function reiniciarRelojParaTests(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
  estado.desfaseMs = null;
  estado.medidoEn = null;
  estado.ultimoFallo = null;
}
