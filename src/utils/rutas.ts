/**
 * Dónde guarda el servidor sus archivos, sin depender del directorio de trabajo.
 *
 * ⚠ POR QUÉ EXISTE (fase 1.0 del roadmap): todo se resolvía con
 *   `process.cwd()`. Un cliente MCP —Claude Desktop, por ejemplo— lanza el
 *   servidor desde SU directorio, no desde el del proyecto. Medido el 5 de
 *   octubre al registrar el servidor para la validación local: con la
 *   configuración del README no encontraba el `.env` (sin ticket en la config
 *   del cliente, terminaba al arrancar) y repartía caché, estado de cuota e
 *   informes por la carpeta del cliente. Se rodeaba con
 *   `cmd /c cd /d <proyecto> && node dist/index.js`.
 *
 * Carpeta de datos, en este orden:
 *   1. `COMPRA_AGIL_DATA_DIR`, si está definida.
 *   2. La raíz del paquete, si es un clon del repositorio (no está dentro de
 *      un `node_modules`) y se puede escribir en ella: el caso habitual en
 *      desarrollo y en la instalación desde el repo.
 *   3. Una carpeta del usuario: `%LOCALAPPDATA%\mcp-compra-agil` en Windows,
 *      `$XDG_STATE_HOME/mcp-compra-agil` o `~/.local/state/mcp-compra-agil`
 *      en el resto. Es el caso de `npx`, cuyo paquete vive en una caché.
 *
 * Todo se calcula al usarse, no al importar: en ESM los `import` se evalúan
 * antes que el cuerpo de `index.ts`, y una constante de módulo se calculaba
 * antes de cargar el `.env` que podía definir `COMPRA_AGIL_DATA_DIR`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/** Raíz del paquete: dos niveles sobre este archivo, tanto en src/ como en dist/. */
export function raizPaquete(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export interface EntornoRutas {
  env?: NodeJS.ProcessEnv;
  raiz?: string;
  plataforma?: NodeJS.Platform;
  home?: string;
  /** Para tests: si se puede escribir en una carpeta. */
  escribible?: (dir: string) => boolean;
}

function esEscribible(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** ¿El paquete está instalado (npx, npm -g, dependencia) y no clonado? */
function esInstalado(raiz: string): boolean {
  return raiz.split(/[\\/]+/).includes('node_modules');
}

export function carpetaDeUsuario(e: EntornoRutas = {}): string {
  const env = e.env ?? process.env;
  const plataforma = e.plataforma ?? process.platform;
  const home = e.home ?? os.homedir();
  if (plataforma === 'win32') {
    return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'mcp-compra-agil');
  }
  return path.posix.join(env.XDG_STATE_HOME || path.posix.join(home, '.local', 'state'), 'mcp-compra-agil');
}

/** Carpeta donde viven caché, estado de cuota, estado del daemon e informes. */
export function carpetaDatos(e: EntornoRutas = {}): string {
  const env = e.env ?? process.env;
  const configurada = env.COMPRA_AGIL_DATA_DIR?.trim();
  if (configurada) return path.resolve(configurada);
  const raiz = e.raiz ?? raizPaquete();
  const escribible = e.escribible ?? esEscribible;
  if (!esInstalado(raiz) && escribible(raiz)) return raiz;
  return carpetaDeUsuario(e);
}

/** Ruta dentro de la carpeta de datos, creándola si hace falta. */
export function rutaDeDatos(nombre: string): string {
  const dir = carpetaDatos();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Si no se puede crear, la caché y el estado siguen en memoria (sus
    // escrituras ya toleran el fallo) y el informe explicará el error.
  }
  return path.join(dir, nombre);
}
