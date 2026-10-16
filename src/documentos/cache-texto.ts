/**
 * Caché del texto extraído de cada adjunto (2.10.0, L8).
 *
 * El agente suele consultar el mismo TDR varias veces (una sección, luego
 * otra): sin esto, cada consulta lo bajaba y lo volvía a leer. Se guarda por
 * id de adjunto, 24 h, en la carpeta de datos.
 */

import fs from 'fs';
import path from 'path';
import { rutaDeDatos } from '../utils/rutas.js';
import { escribirAtomico } from '../utils/archivo-atomico.js';

const VIDA_MS = 24 * 3600_000;

/** Solo ids con letras, números y guiones: el id viene del portal (S4). */
const ruta = (id: string) => (/^[A-Za-z0-9-]{1,80}$/.test(id) ? path.join(rutaDeDatos('adjuntos'), `${id}.txt`) : null);

export function textoGuardado(id: string, ahoraMs = Date.now()): string | null {
  const r = ruta(id);
  if (!r) return null;
  try {
    const st = fs.statSync(r);
    return ahoraMs - st.mtimeMs < VIDA_MS ? fs.readFileSync(r, 'utf8') : null;
  } catch {
    return null;
  }
}

export function guardarTexto(id: string, texto: string): void {
  const r = ruta(id);
  if (!r) return;
  try {
    fs.mkdirSync(path.dirname(r), { recursive: true });
    escribirAtomico(r, texto);
  } catch {
    // Sin caché se sigue funcionando: solo se vuelve a descargar.
  }
}
