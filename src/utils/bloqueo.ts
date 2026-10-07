/**
 * Candado entre procesos para leer-modificar-escribir un archivo de estado.
 *
 * Sin candado, dos procesos leían el mismo estado, lo cambiaban en memoria y
 * el último en escribir borraba al otro (pasó con el conteo de cuota). El
 * candado es un archivo `<ruta>.lock` creado con `wx`, que falla si ya existe.
 *
 * Es síncrono a propósito: las secciones protegidas son lecturas y escrituras
 * cortas de disco, y así no se pueden intercalar con otro código del proceso.
 */

import fs from 'fs';

export interface OpcionesBloqueo {
  /** Cuánto esperar el candado antes de seguir sin él (por defecto 2 s). */
  esperaMaxMs?: number;
  /** Un candado más viejo que esto se considera abandonado (por defecto 5 s). */
  caducidadMs?: number;
}

const pausa = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Ejecuta `fn` con el candado de `ruta`. Si no lo consigue a tiempo, la ejecuta
 * igual: persistir el estado es una mejora, y bloquear la herramienta por un
 * candado ajeno sería peor. En ese caso no toca el candado del otro proceso.
 */
export function conBloqueo<T>(ruta: string, fn: () => T, opciones: OpcionesBloqueo = {}): T {
  const { esperaMaxMs = 2000, caducidadMs = 5000 } = opciones;
  const candado = `${ruta}.lock`;
  const inicio = Date.now();
  let fd: number | undefined;
  while (fd === undefined && Date.now() - inicio < esperaMaxMs) {
    try {
      fd = fs.openSync(candado, 'wx');
    } catch {
      try {
        if (Date.now() - fs.statSync(candado).mtimeMs > caducidadMs) fs.unlinkSync(candado);
      } catch {
        // Otro proceso soltó el candado entre el fallo y el stat.
      }
      if (fd === undefined) pausa(15);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
      try { fs.unlinkSync(candado); } catch { /* ya no está */ }
    }
  }
}
