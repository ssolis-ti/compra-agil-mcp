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
import { spawn, spawnSync } from 'child_process';
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

const VARIABLES_PARA_TAREA = [
  'COMPRA_AGIL_TICKET', 'COMPRA_AGIL_TELEGRAM_TOKEN', 'COMPRA_AGIL_CORREO', 'COMPRA_AGIL_CORREO_CLAVE', 'COMPRA_AGIL_SMTP_HOST',
  'COMPRA_AGIL_SMTP_PUERTO', 'COMPRA_AGIL_CORREO_PARA', 'COMPRA_AGIL_AVISOS', 'COMPRA_AGIL_AVISOS_SILENCIO',
  'MONITOR_KEYWORDS', 'MONITOR_EXCLUIR', 'MONITOR_REGIONES', 'MONITOR_MIN_BUDGET_CLP', 'MONITOR_SOLO_SIN_OFERTAS',
  'MONITOR_TODAS_EN_REGION', 'MONITOR_SOLO_NUEVAS', 'MONITOR_INTERVAL_MINUTES',
];

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

/**
 * Claude Desktop de la Microsoft Store: el servidor corre con el Node interno
 * de Claude (dentro de `WindowsApps`), que no se puede lanzar desde fuera, y
 * Windows guarda los datos de la extensión dentro de la carpeta del paquete
 * (`Packages\Claude_…\LocalCache`). Una tarea programada correría fuera de
 * ese paquete: sin Node y sin ver criterios, Telegram ni `.env`. Medido en
 * la prueba real del 8-oct.
 */
export function esClaudeDeLaTienda(execPath: string = process.execPath): boolean {
  return /[\\/]WindowsApps[\\/]/i.test(execPath);
}

export const SIEMPRE_NO_DISPONIBLE_EN_TIENDA =
  'En Claude Desktop de la Microsoft Store el modo «siempre» no está disponible: Windows aísla la extensión y una tarea programada no puede usar su Node ni ver sus datos. ' +
  'Usa «con_claude» (vigila mientras Claude esté abierto). Para vigilar con Claude cerrado, instala el servidor desde npm o el repositorio y usa su tarea programada (ver la guía de vigilancia).';

export const SIEMPRE_SIN_NODE =
  'El modo «siempre» necesita Node.js instalado en el computador: la extensión corre con el Node interno de Claude Desktop, que una tarea de Windows no puede usar. ' +
  'Instala Node.js LTS desde https://nodejs.org y vuelve a pedirlo, o usa «con_claude» (vigila mientras Claude esté abierto).';

/** El primer `node` del PATH, o null. */
function nodeDelPath(): string | null {
  const r = spawnSync('where', ['node'], { encoding: 'utf8', windowsHide: true });
  const ruta = r.status === 0 ? r.stdout.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('node.exe')) : undefined;
  return ruta?.trim() || null;
}

/**
 * El Node que debe correr la tarea programada. Dentro de una extensión,
 * `process.execPath` es Claude.exe (Electron): lanzado sin
 * ELECTRON_RUN_AS_NODE abre la aplicación en vez de correr el servidor, en
 * cualquier instalación de Claude Desktop, no solo en la de la Store. Ahí se
 * usa el Node del PATH; si no hay, null.
 */
export function nodeParaTarea(d: { execPath?: string; electron?: string; buscarEnPath?: () => string | null } = {}): string | null {
  const electron = 'electron' in d ? d.electron : process.versions.electron;
  if (!electron) return d.execPath ?? process.execPath;
  return (d.buscarEnPath ?? nodeDelPath)();
}

/** Un campo opcional vacío de la extensión llega como «${user_config.x}»: no se copia. */
const valorReal = (v: string | undefined) => (v?.trim() && !v.trim().startsWith('${user_config.') ? v.trim() : undefined);

export function crearControlVigilancia(o: {
  client: CompraAgilClient; env: Record<string, string | undefined>; registrar: Registro; execPath?: string;
  /** En los tests: el Node para la tarea, sin mirar el proceso ni el PATH. */
  nodeParaTarea?: () => string | null;
}): ControlVigilancia {
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
      if (esClaudeDeLaTienda(o.execPath)) return { ok: false, detalle: SIEMPRE_NO_DISPONIBLE_EN_TIENDA };
      const node = (o.nodeParaTarea ?? (() => nodeParaTarea({ execPath: o.execPath })))();
      if (!node) return { ok: false, detalle: SIEMPRE_SIN_NODE };
      // La tarea corre sin el entorno de Claude: lo que necesita va al .env de la carpeta del usuario.
      const rutaEnv = path.join(carpetaDatos(), '.env');
      const anterior = fs.existsSync(rutaEnv) ? fs.readFileSync(rutaEnv, 'utf8') : '';
      const cambios = Object.fromEntries(VARIABLES_PARA_TAREA.flatMap((k) => { const v = valorReal(o.env[k]); return v ? [[k, v]] : []; }));
      fs.mkdirSync(path.dirname(rutaEnv), { recursive: true });
      fs.writeFileSync(rutaEnv, actualizarEnv(anterior, cambios), { encoding: 'utf8', mode: 0o600 });
      const r = await powershell(path.join(scripts, 'instalar-tarea-windows.ps1'), ['-Node', node, '-Entrada', path.join(raizPaquete(), 'dist', 'index.js')]);
      if (r.codigo !== 0) return { ok: false, detalle: `No se pudo instalar la tarea: ${r.salida.split(/\r?\n/).filter((l) => /✘|Error/.test(l)).slice(0, 3).join(' ') || 'error desconocido'}` };
      bucle.detener();
      guardar('siempre');
      return { ok: true, detalle: 'La vigilancia quedó encendida como tarea de Windows: arranca sola con el computador, aunque Claude esté cerrado.' };
    },
  };
}
