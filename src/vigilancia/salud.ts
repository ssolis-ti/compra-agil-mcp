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
      titulo: 'La vigilancia no puede revisar las compras',
      lineas: [
        s.ultimoCicloBueno
          ? `Última revisión completa: ${horaChile(Date.parse(s.ultimoCicloBueno))}.`
          : `No ha podido revisar desde que arrancó, a las ${horaChile(Date.parse(s.inicio!))}.`,
        'Mercado Público no responde o no hay internet. Mientras tanto puede haber compras sin avisar; cuando vuelva, revisa lo atrasado.',
        ...(error ? [`Detalle: ${error}`] : []),
      ],
    });
  }
  // Recuperada: una revisión completa posterior al aviso. Que no haya fallos no
  // basta: una vigilancia atrasada no falla, pero tampoco ve lo nuevo.
  const desde = s.cegueraDesde ? Date.parse(s.cegueraDesde) : 0;
  if (s.cegueraAvisada && s.fallosSeguidos === 0 && s.ultimoCicloBueno && Date.parse(s.ultimoCicloBueno) > desde) {
    const huecos = e.huecos.filter((h) => h.registrado >= desde);
    n.push({
      clave: 'recuperacion', evento: 'recuperacion',
      titulo: 'La vigilancia volvió a funcionar',
      lineas: [
        huecos.length === 0
          ? `Desde las ${horaChile(Date.parse(s.ultimoCicloBueno))} revisa con normalidad, y ya revisó todo lo atrasado.`
          : `Desde las ${horaChile(Date.parse(s.ultimoCicloBueno))} revisa con normalidad. No alcanzó a revisar: ${huecos.map((h) => `${horaChile(Date.parse(h.desde))}–${horaChile(Date.parse(h.hasta))}`).join(', ')}.`,
      ],
    });
  }

  // ── Resumen diario (R8.3) ───────────────────────────────────────────
  const paredHoy = paredDeChile(new Date(ahoraMs));
  const hoyChile = paredHoy.slice(0, 10);
  if (s.ultimoResumen === null) s.ultimoResumen = hoyChile; // primer arranque: no un resumen vacío
  if (s.ultimoResumen !== hoyChile && paredHoy.slice(11, 16) >= cfg.resumenHora) {
    const a = s.acumulado;
    const porCanal = Object.keys(a.fallidos).filter((c) => (a.fallidos[c] ?? 0) > 0).map((c) => `${c} ${a.fallidos[c]}`);
    const sinEntregar = Object.values(a.fallidos).reduce((x, y) => x + y, 0);
    n.push({
      clave: `resumen:${hoyChile}`, evento: 'resumen',
      titulo: 'Resumen del día',
      lineas: [
        `Revisó ${miles(a.revisados)} compras y te avisó de ${miles(a.alertas)}.`,
        ...(sinEntregar > 0 ? [`${miles(sinEntregar)} aviso(s) no llegaron: ${porCanal.join('; ')}.`] : []),
        ...(a.huecos > 0 ? [`Hubo ${a.huecos} período(s) de más de 48 h sin poder revisar.`] : []),
        'Si mañana no llega este resumen, la vigilancia está apagada.',
      ],
    });
  }

  // ── Canal caído, avisado por los demás (R8.4) ───────────────────────
  for (const canal of cfg.canales) {
    if ((s.fallosPorCanal[canal] ?? 0) >= 3 && !s.canalesCaidosAvisados.includes(canal)) {
      n.push({
        clave: `canal_caido:${canal}`, evento: 'canal_caido', excluirCanal: canal,
        titulo: `Los avisos por ${canal} no están llegando`,
        lineas: [
          `Fallaron ${s.fallosPorCanal[canal]} veces seguidas. Quedan guardados y se reintentan.`,
          'Pídele a tu asistente «prueba los avisos» para ver qué pasa.',
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
      titulo: 'Se está usando mucho el ticket',
      lineas: [
        ...(hubo429 ? ['Mercado Público pidió bajar el ritmo: la vigilancia revisa más espaciado hasta que se normalice.'] : []),
        `Hoy se usarían unas ${miles(proyeccion)} consultas (límite: ${miles(cfg.presupuestoConsultasDia)}).`,
        'Si se repite, revisa con quien te instaló esto.',
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
