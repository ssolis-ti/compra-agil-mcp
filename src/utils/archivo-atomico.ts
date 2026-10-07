/**
 * Escritura atómica y lectura tolerante de archivos de estado.
 *
 * Se escribe a un temporal y luego se renombra: un corte a mitad deja el
 * archivo anterior completo, nunca uno a medias e ilegible. Lo usan la caché
 * (ADR 0020) y, desde la 2.9.0, el estado de la vigilancia (R1.8).
 */

import fs from 'fs';

/** Devuelve false si no se pudo escribir; el archivo anterior queda intacto. */
export function escribirAtomico(ruta: string, contenido: string): boolean {
  const temporal = `${ruta}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporal, contenido, 'utf8');
    fs.renameSync(temporal, ruta);
    return true;
  } catch {
    try { fs.rmSync(temporal, { force: true }); } catch { /* nada que limpiar */ }
    return false;
  }
}

/** El JSON del archivo, o null si no existe o no se puede leer. */
export function leerJsonSeguro(ruta: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
}
