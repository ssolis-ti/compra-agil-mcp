/**
 * Salud de la vigilancia (2.9.0; R8.1–R8.5): que el silencio deje de ser
 * ambiguo. Funciones puras sobre el estado:
 *
 * - `registrarRonda` acumula lo que pasó en cada ronda y ajusta el ritmo ante un 429.
 * - `notificacionesPendientes` decide qué hay que avisar ahora.
 * - `marcarNotificadas` registra lo que algún canal entregó. Lo no entregado se
 *   vuelve a intentar en la ronda siguiente.
 *
 * Cuota: con lectura lote por lote, cada lote se lee una vez, así que espaciar
 * las rondas NO ahorra consultas; solo atrasa los avisos. Por eso, ante una
 * proyección sobre el presupuesto se avisa sin espaciar; ante un 429 sí se
 * espacia, para darle aire a la API (diseño §11).
 */

import { paredDeChile } from '../utils/fechas.js';
import type { Notificacion } from '../avisos/notificacion.js';
import type { NombreCanal } from '../avisos/canal.js';
import type { ResultadoEnvios } from '../avisos/bandeja.js';
import type { ResultadoCiclo } from './ciclo.js';
import type { EstadoVigilancia } from './estado.js';

export interface ConfigSalud {
  umbralCegueraMs: number;
  /** Hora de Chile «HH:MM». */
  resumenHora: string;
  presupuestoConsultasDia: number;
  canales: NombreCanal[];
  intervaloMs: number;
}

export function configSaludDesdeEntorno(
  env: Record<string, string | undefined>, canales: NombreCanal[], intervaloMs: number, resumenHora: string,
): ConfigSalud {
  const entero = (v: string | undefined, porDefecto: number) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isInteger(n) && n > 0 ? n : porDefecto;
  };
  return {
    umbralCegueraMs: entero(env.COMPRA_AGIL_AVISOS_CEGUERA_MIN, 120) * 60_000,
    presupuestoConsultasDia: entero(env.COMPRA_AGIL_VIGILANCIA_CONSULTAS_DIA, 1500),
    resumenHora, canales, intervaloMs,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const diaUtc = (ms: number) => iso(ms).slice(0, 10);
const horaChile = (ms: number) => paredDeChile(new Date(ms)).replace('T', ' ').slice(0, 16);
const miles = (n: number) => Math.round(n).toLocaleString('es-CL');
const FACTOR_MAXIMO = 8;

/**
 * Consultas que se gastarían hoy (día UTC, como cuenta el ticket) a este ritmo.
 * Al principio del día se pondera como si hubieran pasado al menos 4 horas,
 * para no alarmar por un par de rondas.
 */
export function proyeccionConsultasDia(e: EstadoVigilancia, ahoraMs: number): number {
  const hoy = e.salud.consultasPorDia[diaUtc(ahoraMs)] ?? 0;
  const fraccion = (ahoraMs - Date.parse(`${diaUtc(ahoraMs)}T00:00:00Z`)) / 86_400_000;
  return hoy / Math.max(fraccion, 4 / 24);
}

/** Lo que pasó en la ronda, para el resumen diario, los canales caídos y el ritmo. */
export function registrarRonda(e: EstadoVigilancia, ciclo: ResultadoCiclo, envios: ResultadoEnvios | undefined, ahoraMs: number, cfg: ConfigSalud): void {
  const s = e.salud;
  s.inicio ??= iso(ahoraMs);
  const a = s.acumulado;
  a.revisados += ciclo.revisados;
  a.alertas += ciclo.alertas.length;
  a.lotesLeidos += ciclo.lotesLeidos;
  a.lotesFallidos += ciclo.lotesFallidos;
  a.incompletos += ciclo.incompletosNuevos;
  a.huecos += ciclo.hueco ? 1 : 0;
  a.consultas += ciclo.consultas;
  for (const [canal, n] of Object.entries(envios?.porCanal ?? {})) {
    a.entregados[canal] = (a.entregados[canal] ?? 0) + n.entregados;
    a.fallidos[canal] = (a.fallidos[canal] ?? 0) + n.fallidos;
    if (n.entregados > 0) {
      s.fallosPorCanal[canal] = 0;
      s.canalesCaidosAvisados = s.canalesCaidosAvisados.filter((c) => c !== canal);
    } else if (n.fallidos + n.reintentos > 0) {
      s.fallosPorCanal[canal] = (s.fallosPorCanal[canal] ?? 0) + 1;
    }
  }
  // Ritmo: un 429 duplica el intervalo; sin 429 y con holgura, vuelve de a poco.
  if (ciclo.cuotaAgotada) {
    s.ultimo429 = iso(ahoraMs);
    s.factorIntervalo = Math.min(FACTOR_MAXIMO, s.factorIntervalo * 2);
  } else if (s.factorIntervalo > 1 && proyeccionConsultasDia(e, ahoraMs) < cfg.presupuestoConsultasDia / 2) {
    s.factorIntervalo = Math.max(1, s.factorIntervalo / 2);
  }
  s.proximaRonda = s.factorIntervalo > 1 ? iso(ahoraMs + cfg.intervaloMs * s.factorIntervalo) : null;
}

export function notificacionesPendientes(e: EstadoVigilancia, ahoraMs: number, cfg: ConfigSalud): Notificacion[] {
  const s = e.salud;
  const n: Notificacion[] = [];

  // ── Ceguera y recuperación (R8.1, R8.2) ─────────────────────────────
  const referencia = s.ultimoCicloBueno ?? s.inicio;
  if (!s.cegueraAvisada && referencia && ahoraMs - Date.parse(referencia) > cfg.umbralCegueraMs) {
    const error = e.pendientes.at(-1)?.ultimoError;
    n.push({
      clave: 'ceguera', evento: 'ceguera',
      titulo: 'La vigilancia no está viendo los procesos nuevos',
      lineas: [
        s.ultimoCicloBueno
          ? `No hay una revisión completa desde las ${horaChile(Date.parse(s.ultimoCicloBueno))} (hora de Chile).`
          : `No ha habido ninguna revisión completa desde que arrancó, a las ${horaChile(Date.parse(s.inicio!))} (hora de Chile).`,
        error ? `Último error: ${error}` : 'La API no responde o la ronda no termina.',
        `Lotes pendientes: ${e.pendientes.length}. Se revisarán apenas la API responda; hasta entonces puede haber procesos sin avisar.`,
      ],
    });
  }
  if (s.cegueraAvisada && s.fallosSeguidos === 0 && s.ultimoCicloBueno) {
    const desde = s.cegueraDesde ? Date.parse(s.cegueraDesde) : 0;
    const huecos = e.huecos.filter((h) => h.registrado >= desde);
    n.push({
      clave: 'recuperacion', evento: 'recuperacion',
      titulo: 'La vigilancia volvió a la normalidad',
      lineas: [
        `Desde las ${horaChile(Date.parse(s.ultimoCicloBueno))} (hora de Chile) se revisa con normalidad.`,
        huecos.length === 0
          ? 'Se revisaron todos los lotes del período sin respuesta: no quedó nada sin mirar.'
          : `Quedaron sin revisar (más de 48 h): ${huecos.map((h) => `${horaChile(Date.parse(h.desde))}–${horaChile(Date.parse(h.hasta))}`).join(', ')}.`,
      ],
    });
  }

  // ── Resumen diario (R8.3) ───────────────────────────────────────────
  const paredHoy = paredDeChile(new Date(ahoraMs));
  const hoyChile = paredHoy.slice(0, 10);
  if (s.ultimoResumen === null) s.ultimoResumen = hoyChile; // primer arranque: no un resumen vacío
  if (s.ultimoResumen !== hoyChile && paredHoy.slice(11, 16) >= cfg.resumenHora) {
    const a = s.acumulado;
    const porCanal = Object.keys({ ...a.entregados, ...a.fallidos })
      .map((c) => `${c}: ${a.entregados[c] ?? 0} entregados, ${a.fallidos[c] ?? 0} fallidos`);
    n.push({
      clave: `resumen:${hoyChile}`, evento: 'resumen',
      titulo: `Resumen de la vigilancia (desde el ${s.ultimoResumen})`,
      lineas: [
        `${miles(a.revisados)} procesos revisados en ${miles(a.lotesLeidos)} lotes; ${miles(a.alertas)} alertas.`,
        `${a.lotesFallidos} lote(s) fallaron y se reintentaron; ${a.incompletos} quedaron incompletos; ${a.huecos} hueco(s) de más de 48 h.`,
        `${miles(a.consultas)} consultas a la API.`,
        ...(porCanal.length > 0 ? [`Avisos — ${porCanal.join('; ')}.`] : []),
        'Si mañana no llega este resumen, la vigilancia está detenida.',
      ],
    });
  }

  // ── Canal caído, avisado por los demás (R8.4) ───────────────────────
  for (const canal of cfg.canales) {
    if ((s.fallosPorCanal[canal] ?? 0) >= 3 && !s.canalesCaidosAvisados.includes(canal)) {
      n.push({
        clave: `canal_caido:${canal}`, evento: 'canal_caido', excluirCanal: canal,
        titulo: `El canal ${canal} no está entregando avisos`,
        lineas: [
          `Falló en ${s.fallosPorCanal[canal]} rondas seguidas. Los avisos quedan en espera y se reintentan.`,
          'Revisa su configuración en el .env o corre `mcp-compra-agil --probar-avisos`.',
        ],
      });
    }
  }

  // ── Cuota (R8.5) ────────────────────────────────────────────────────
  const hoyUtc = diaUtc(ahoraMs);
  const proyeccion = proyeccionConsultasDia(e, ahoraMs);
  const hubo429 = s.ultimo429?.slice(0, 10) === hoyUtc;
  if (s.cuotaAvisada !== hoyUtc && (hubo429 || proyeccion > cfg.presupuestoConsultasDia)) {
    n.push({
      clave: `cuota:${hoyUtc}`, evento: 'cuota',
      titulo: 'Atención con la cuota de la API',
      lineas: [
        ...(hubo429 ? [`La API respondió 429 (cuota): las rondas se espacian ×${s.factorIntervalo} hasta que se normalice.`] : []),
        `A este ritmo se gastarían ~${miles(proyeccion)} consultas hoy; el presupuesto es ${miles(cfg.presupuestoConsultasDia)}.`,
        'Con la lectura por lotes, espaciar las rondas no ahorra consultas. Si el ticket se agota seguido, sube COMPRA_AGIL_VIGILANCIA_CONSULTAS_DIA solo si tu ticket lo permite.',
      ],
    });
  }
  return n;
}

/** Registra lo que algún canal entregó. Lo no entregado vuelve a salir en la ronda siguiente. */
export function marcarNotificadas(e: EstadoVigilancia, claves: string[], ahoraMs: number): void {
  const s = e.salud;
  for (const clave of claves) {
    const [tipo, dato] = clave.split(':');
    if (tipo === 'ceguera') { s.cegueraAvisada = true; s.cegueraDesde = s.ultimoCicloBueno ?? s.inicio ?? iso(ahoraMs); }
    if (tipo === 'recuperacion') { s.cegueraAvisada = false; s.cegueraDesde = null; }
    if (tipo === 'resumen') {
      s.ultimoResumen = dato;
      s.acumulado = { revisados: 0, alertas: 0, lotesLeidos: 0, lotesFallidos: 0, incompletos: 0, huecos: 0, consultas: 0, entregados: {}, fallidos: {} };
    }
    if (tipo === 'canal_caido' && !s.canalesCaidosAvisados.includes(dato)) s.canalesCaidosAvisados.push(dato);
    if (tipo === 'cuota') s.cuotaAvisada = dato;
  }
}
