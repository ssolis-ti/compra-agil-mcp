/**
 * Un solo vigilante a la vez (2.9.0; R1.7, ADR 0026).
 *
 * El daemon y una herramienta llamada por un gateway pueden querer leer lotes
 * al mismo tiempo: leerían lo mismo y gastarían la cuota dos veces. El archivo
 * `.vigilante.lock` guarda quién vigila y su último latido. Un vigilante cuyo
 * proceso ya no existe, o que no late hace más de `latidoMaxMs` (3 intervalos),
 * se considera muerto y se reemplaza.
 */

import fs from 'fs';
import { conBloqueo } from '../utils/bloqueo.js';
import { escribirAtomico, leerJsonSeguro } from '../utils/archivo-atomico.js';

export interface DatosVigilante { pid: number; inicio: number; latido: number }

/** `kill(pid, 0)` no envía señal: solo pregunta si el proceso existe. EPERM es «existe, pero es de otro usuario». */
export function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function leer(ruta: string): DatosVigilante | null {
  const d = leerJsonSeguro(ruta) as Partial<DatosVigilante> | null;
  return d && typeof d.pid === 'number' && typeof d.inicio === 'number' && typeof d.latido === 'number' ? (d as DatosVigilante) : null;
}

const activo = (d: DatosVigilante, ahoraMs: number, latidoMaxMs: number, vivo: (pid: number) => boolean) =>
  ahoraMs - d.latido <= latidoMaxMs && vivo(d.pid);

export function vigilanteActivo(ruta: string, ahoraMs: number, latidoMaxMs: number, vivo = procesoVivo): DatosVigilante | null {
  const d = leer(ruta);
  return d && activo(d, ahoraMs, latidoMaxMs, vivo) ? d : null;
}

/** true si `pid` queda como vigilante (ya lo era, o el anterior estaba muerto). */
export function tomarVigilante(
  ruta: string,
  o: { pid: number; ahoraMs: number; latidoMaxMs: number; vivo?: (pid: number) => boolean },
): boolean {
  const vivo = o.vivo ?? procesoVivo;
  return conBloqueo(ruta, () => {
    const d = leer(ruta);
    if (d && d.pid !== o.pid && activo(d, o.ahoraMs, o.latidoMaxMs, vivo)) return false;
    const inicio = d?.pid === o.pid ? d.inicio : o.ahoraMs;
    return escribirAtomico(ruta, JSON.stringify({ pid: o.pid, inicio, latido: o.ahoraMs }));
  });
}

/** Renueva el latido; false si el vigilante ya no es `pid`. */
export function latir(ruta: string, pid: number, ahoraMs: number): boolean {
  return conBloqueo(ruta, () => {
    const d = leer(ruta);
    if (d?.pid !== pid) return false;
    return escribirAtomico(ruta, JSON.stringify({ ...d, latido: ahoraMs }));
  });
}

export function soltarVigilante(ruta: string, pid: number): void {
  conBloqueo(ruta, () => {
    if (leer(ruta)?.pid === pid) fs.rmSync(ruta, { force: true });
  });
}
