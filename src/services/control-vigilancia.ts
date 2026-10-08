/**
 * Control de la vigilancia desde el servidor MCP (anexo de instalación por
 * agente, RA5; ADR 0028). Lo usa la herramienta activar_vigilancia.
 *
 * - `con_claude`: el bucle corre dentro de este proceso mientras el cliente
 *   (Claude Desktop) esté abierto. No cambia el sistema ni escribe secretos.
 *   La preferencia se guarda, y al abrir Claude de nuevo vuelve sola.
 * - `siempre`: tarea programada de Windows. Como la tarea corre sin el entorno
 *   de Claude, copia el ticket y el token del bot al `.env` de la carpeta de
 *   datos del usuario. La herramienta exige confirmación explícita.
 * - `apagada`: detiene el bucle y quita la tarea si estaba.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { CompraAgilClient } from '../api/compra-agil-client.js';
import { carpetaDatos, raizPaquete, rutaDeDatos } from '../utils/rutas.js';
import { actualizarPreferencias, leerPreferencias, type ModoVigilancia } from '../avisos/preferencias.js';
import { actualizarEnv } from '../cli/archivo-env.js';
import { crearBucleVigilancia, type Registro } from './bucle-vigilancia.js';

export interface ControlVigilancia {
  modo(): ModoVigilancia;
  /** true si el bucle corre dentro de este proceso. */
  enEsteProceso(): boolean;
  activar(modo: ModoVigilancia): Promise<{ ok: boolean; detalle: string }>;
  /** Al arrancar el servidor: retoma el modo con_claude si quedó elegido. */
  retomar(): void;
}

const VARIABLES_PARA_TAREA = ['COMPRA_AGIL_TICKET', 'COMPRA_AGIL_TELEGRAM_TOKEN', 'MONITOR_KEYWORDS', 'MONITOR_EXCLUIR', 'MONITOR_REGIONES', 'MONITOR_MIN_BUDGET_CLP'];

function powershell(script: string, args: string[]): Promise<{ codigo: number | null; salida: string }> {
  return new Promise((resolve) => {
    let salida = '';
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { windowsHide: true });
    p.stdout.on('data', (d) => { salida += String(d); });
    p.stderr.on('data', (d) => { salida += String(d); });
    p.on('exit', (codigo) => resolve({ codigo, salida }));
    p.on('error', (e) => resolve({ codigo: 1, salida: e.message }));
  });
}

export function crearControlVigilancia(o: { client: CompraAgilClient; env: Record<string, string | undefined>; registrar: Registro }): ControlVigilancia {
  const preferencias = () => rutaDeDatos('.preferencias.json');
  const bucle = crearBucleVigilancia({
    client: o.client, env: o.env, registrar: o.registrar,
    sigue: () => leerPreferencias(preferencias()).vigilancia === 'con_claude',
  });
  const guardar = (modo: ModoVigilancia) => actualizarPreferencias(preferencias(), (p) => { p.vigilancia = modo; });
  const scripts = path.join(raizPaquete(), 'scripts');

  return {
    modo: () => leerPreferencias(preferencias()).vigilancia ?? 'apagada',
    enEsteProceso: () => bucle.activo,
    retomar() {
      if (leerPreferencias(preferencias()).vigilancia === 'con_claude' && o.env.COMPRA_AGIL_TICKET) bucle.iniciar();
    },
    async activar(modo) {
      if (modo === 'con_claude') {
        // Primero la preferencia: el bucle la consulta antes de cada ronda.
        guardar('con_claude');
        bucle.iniciar();
        return { ok: true, detalle: 'La vigilancia corre mientras Claude Desktop esté abierto. Al cerrarlo se detiene, y al abrirlo vuelve sola.' };
      }
      if (modo === 'apagada') {
        bucle.detener();
        guardar('apagada');
        if (process.platform === 'win32') await powershell(path.join(scripts, 'quitar-tarea-windows.ps1'), []);
        return { ok: true, detalle: 'Vigilancia apagada.' };
      }
      if (process.platform !== 'win32') {
        return { ok: false, detalle: 'En este sistema, deja la vigilancia como servicio con scripts/compra-agil-vigilancia.service (ver la guía).' };
      }
      // La tarea corre sin el entorno de Claude: lo que necesita va al .env de la carpeta del usuario.
      const rutaEnv = path.join(carpetaDatos(), '.env');
      const anterior = fs.existsSync(rutaEnv) ? fs.readFileSync(rutaEnv, 'utf8') : '';
      const cambios = Object.fromEntries(VARIABLES_PARA_TAREA.filter((k) => o.env[k]?.trim()).map((k) => [k, o.env[k]!.trim()]));
      fs.mkdirSync(path.dirname(rutaEnv), { recursive: true });
      fs.writeFileSync(rutaEnv, actualizarEnv(anterior, cambios), { encoding: 'utf8', mode: 0o600 });
      const r = await powershell(path.join(scripts, 'instalar-tarea-windows.ps1'), ['-Node', process.execPath, '-Entrada', path.join(raizPaquete(), 'dist', 'index.js')]);
      if (r.codigo !== 0) return { ok: false, detalle: `No se pudo instalar la tarea: ${r.salida.split(/\r?\n/).filter((l) => /✘|Error/.test(l)).slice(0, 3).join(' ') || 'error desconocido'}` };
      bucle.detener();
      guardar('siempre');
      return { ok: true, detalle: 'La vigilancia quedó encendida como tarea de Windows: arranca sola con el computador, aunque Claude esté cerrado.' };
    },
  };
}
