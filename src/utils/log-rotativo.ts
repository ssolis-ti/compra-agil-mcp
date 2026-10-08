/**
 * Log en archivo con rotación por tamaño (2.9.0; R10.4).
 *
 * El daemon de vigilancia corre meses sin supervisión: su log no debe llenar
 * el disco. Al pasar `maxBytes`, `log` pasa a `log.1`, `log.1` a `log.2`… y se
 * descarta el más viejo. Cada línea pasa por la redacción antes del disco. Si
 * el disco no deja escribir, se sigue sin log: vigilar importa más.
 */

import fs from 'fs';
import { redact } from './redact.js';

export interface OpcionesLog {
  /** Por defecto 5 MB. */
  maxBytes?: number;
  /** Archivos rotados que se conservan, además del actual. Por defecto 3. */
  archivos?: number;
  ahora?: () => number;
}

export function crearLogRotativo(ruta: string, o: OpcionesLog = {}): (linea: string) => void {
  const maxBytes = o.maxBytes ?? 5 * 1024 * 1024;
  const archivos = o.archivos ?? 3;
  const ahora = o.ahora ?? (() => Date.now());
  const rotar = () => {
    fs.rmSync(`${ruta}.${archivos}`, { force: true });
    for (let i = archivos - 1; i >= 1; i--) if (fs.existsSync(`${ruta}.${i}`)) fs.renameSync(`${ruta}.${i}`, `${ruta}.${i + 1}`);
    fs.renameSync(ruta, `${ruta}.1`);
  };
  return (linea) => {
    try {
      const texto = `[${new Date(ahora()).toISOString()}] ${redact(linea)}\n`;
      if (fs.existsSync(ruta) && fs.statSync(ruta).size + Buffer.byteLength(texto) > maxBytes) rotar();
      fs.appendFileSync(ruta, texto, 'utf8');
    } catch {
      // Sin log, la vigilancia sigue.
    }
  };
}
