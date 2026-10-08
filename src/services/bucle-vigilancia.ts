/**
 * El bucle de rondas de vigilancia, reutilizable (2.9.0).
 *
 * Lo usan el daemon (`services/monitor.ts`) y el servidor MCP en el modo «con
 * Claude» (anexo de instalación, RA5), que vigila mientras el cliente está
 * abierto sin instalar nada en el sistema.
 *
 * Cada ronda vuelve a leer criterios y canales: un chat recién conectado o un
 * cambio de criterios se toma en la ronda siguiente, sin reiniciar.
 *
 * Rondas cortas (medido el 8-oct contra la API real: ~10 s por consulta, lotes
 * de hasta 8 páginas y timeouts frecuentes en la mañana): una ronda dura como
 * máximo RONDA_MAX_MS, guarda y entrega lo leído, y si quedó atrasada la
 * siguiente empieza enseguida, en vez de esperar el intervalo.
 */

import fs from 'fs';
import type { CompraAgilClient } from '../api/compra-agil-client.js';
import { rutaDeDatos } from '../utils/rutas.js';
import { safeError } from '../utils/redact.js';
import { ahora } from '../utils/reloj.js';
import { criteriosDesdeEntorno, lineaDeAlerta } from '../vigilancia/criterios.js';
import { rondaDeVigilancia } from '../vigilancia/ronda.js';
import { configSaludDesdeEntorno } from '../vigilancia/salud.js';
import { recuperacionDesdeEntorno } from '../vigilancia/lotes.js';
import { crearCanales } from '../avisos/canales/crear.js';
import { configAvisosDelEquipo } from '../avisos/preferencias.js';

const RONDA_MAX_MS = 4 * 60_000;
const PAUSA_SI_ATRASADA_MS = 5_000;

export type Registro = (nivel: 'info' | 'aviso' | 'error', mensaje: string) => void;

export function intervaloDesdeEntorno(env: Record<string, string | undefined>): number {
  return Math.max(1, Number.parseInt(env.MONITOR_INTERVAL_MINUTES || '15', 10) || 15) * 60_000;
}

/**
 * `mantenerVivo`: el daemon sí quiere que el temporizador mantenga vivo el proceso;
 * dentro del servidor MCP, el que manda es stdio y el temporizador no debe retenerlo.
 */
export function crearBucleVigilancia(o: { client: CompraAgilClient; env: Record<string, string | undefined>; registrar: Registro; mantenerVivo?: boolean }) {
  const { client, env, registrar } = o;
  // La vigilancia necesita respuestas frescas: la comprobación de un lote vuelve
  // a pedir la página 1, y desde la caché sería la misma respuesta.
  const api = { buscar: client.buscarFresco.bind(client) };
  const rutas = { estado: rutaDeDatos('.vigilancia.json'), estadoViejo: rutaDeDatos('.monitor-state.json'), vigilante: rutaDeDatos('.vigilante.lock') };
  const ALERTAS = rutaDeDatos('alerts.log');
  let temporizador: NodeJS.Timeout | null = null;
  let activo = false;

  /** true si la ronda quedó atrasada (parcial) y conviene seguir enseguida. */
  async function ronda(): Promise<boolean> {
    const t = new Date(ahora()).toISOString();
    const intervaloMs = intervaloDesdeEntorno(env);
    const configAvisos = configAvisosDelEquipo(env, rutaDeDatos('.preferencias.json'));
    const canales = crearCanales(configAvisos);
    const salud = configSaludDesdeEntorno(env, canales.map((c) => c.nombre), intervaloMs, configAvisos.resumen);
    try {
      const r = await rondaDeVigilancia({
        api, ahora, criterios: criteriosDesdeEntorno(env), rutas, pid: process.pid, intervaloMs,
        entregar: (alertas) => {
          for (const a of alertas) {
            const linea = lineaDeAlerta(a.item, a.coincidencia, new Date(a.cuando));
            fs.appendFileSync(ALERTAS, linea, 'utf8');
            registrar('info', linea.trim());
          }
        },
        avisos: { canales, config: configAvisos.bandeja },
        salud,
      }, { recuperacionMs: recuperacionDesdeEntorno(env), hastaMs: ahora() + RONDA_MAX_MS });
      for (const aviso of r.avisos) registrar('aviso', `[${t}] ${aviso}`);
      if (!r.tomada) {
        registrar('aviso', `[${t}] Otro proceso (PID ${r.otroVigilante ?? '?'}) está vigilando: esta ronda no lee nada.`);
        return false;
      }
      if (r.omitida) {
        registrar('aviso', `[${t}] Ronda saltada: tras un 429 de la API, las rondas se espacian hasta que se normalice.`);
        return false;
      }
      for (const n of r.notificaciones ?? []) {
        const por = n.entregadaPor.length > 0 ? ` (avisado por ${n.entregadaPor.join(', ')})` : '';
        registrar('aviso', `[${t}] [${n.evento.toUpperCase()}] ${n.titulo}${por}: ${n.lineas.join(' ')}`);
      }
      const c = r.ciclo!;
      registrar('info', `[${t}] Lotes leídos: ${c.lotesLeidos}, fallidos: ${c.lotesFallidos}, incompletos: ${c.incompletosNuevos}, ` +
        `procesos revisados: ${c.revisados}, alertas nuevas: ${c.alertas.length}, consultas: ${c.consultas}`);
      for (const [canal, n] of Object.entries(r.envios?.porCanal ?? {})) {
        if (n.entregados + n.fallidos + n.reintentos > 0) {
          registrar('info', `[${t}] Avisos por ${canal}: ${n.entregados} entregados, ${n.reintentos} por reintentar, ${n.fallidos} fallidos.`);
        }
      }
      if (c.hueco) registrar('aviso', `[${t}] Más de 48 h sin vigilar: no se revisó desde ${c.hueco.desde} hasta ${c.hueco.hasta}.`);
      if (c.lotesFallidos > 0) registrar('aviso', `[${t}] ${c.lotesFallidos} lote(s) fallaron: se reintentan en la próxima ronda.`);
      if (c.cuotaAgotada) registrar('aviso', `[${t}] La API respondió 429: la ronda se detuvo para no seguir gastando cuota.`);
      if (c.parcial) registrar('info', `[${t}] Ronda atrasada: guardado lo leído, la siguiente sigue enseguida.`);
      return c.parcial && !c.cuotaAgotada;
    } catch (error) {
      registrar('error', `[${t}] Falló la ronda de vigilancia: ${safeError(error)}`);
      return false;
    }
  }

  // Rondas encadenadas: nunca se enciman, y si una queda atrasada la siguiente
  // no espera el intervalo.
  async function siguiente(): Promise<void> {
    if (!activo) return;
    const atrasada = await ronda();
    if (!activo) return;
    temporizador = setTimeout(() => void siguiente(), atrasada ? PAUSA_SI_ATRASADA_MS : intervaloDesdeEntorno(env));
    if (!o.mantenerVivo) temporizador.unref?.();
  }

  return {
    iniciar(): void {
      if (activo) return;
      activo = true;
      void siguiente();
    },
    detener(): void {
      activo = false;
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
    },
    get activo() { return activo; },
  };
}
