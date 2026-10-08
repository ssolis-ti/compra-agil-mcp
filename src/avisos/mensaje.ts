/**
 * La alerta que viaja a los canales (2.9.0; R4.1, R4.2, R4.6).
 *
 * Se arma una sola vez, ya limpia, a partir del proceso del listado: sin
 * descripción libre, sin proveedores y con `sinContactos` sobre lo que escribe
 * el comprador. No dice que el proceso sea una buena oportunidad ni nombra
 * ganadores: informa que calza con los criterios.
 *
 * `avisos/` no importa de `api/` (un canal nuevo no debe conocer la API): el
 * proceso de entrada se describe aquí con lo mínimo que se usa, y el ítem del
 * listado calza con esa forma.
 */

import { enHoraDeChile, parsearFechaApi } from '../utils/fechas.js';
import { sinContactos } from '../utils/privacidad.js';

export interface ProcesoParaAviso {
  codigo: string;
  nombre: string;
  fechas?: { fecha_cierre?: string | null; fecha_publicacion?: string | null } | null;
  convocatoria?: { estado_convocatoria?: number | null } | null;
  montos?: { monto_disponible_clp?: number | null } | null;
  institucion?: { organismo_comprador?: string | null; region?: number | null; nombre_region?: string | null } | null;
}

export interface Alerta {
  codigo: string;
  nombre: string;
  organismo: string;
  region: string;
  presupuestoClp: number | null;
  cierreHoraChile: string | null;
  cierreUtc: string | null;
  /** «AAAA-MM-DD HH:MM» en hora de Chile. Las alertas guardadas antes de este campo no lo traen. */
  publicadaHoraChile?: string | null;
  /** Reabierta en segundo llamado: la publicación es de días atrás, pero la oportunidad es nueva. */
  segundoLlamado?: boolean;
  /** La palabra clave del dueño que calzó (no es texto de terceros). */
  coincidencia: string;
  /**
   * «rubro»: calzó con las palabras del dueño. «region»: solo entró por la
   * alerta total de la región, y se muestra aparte y más breve. Las alertas
   * guardadas antes de existir este campo son del rubro.
   */
  nivel?: 'rubro' | 'region';
  ficha: string;
  /** Epoch ms en que se generó la alerta. */
  creada: number;
}

export const LARGO_MAXIMO_NOMBRE = 160;

/** Coincidencia de un proceso que entró solo por la alerta total de la región. */
export const EN_TU_REGION = '(en tu región)';

export const esDeLaRegion = (a: Alerta) => a.nivel === 'region';

/** Las del rubro primero; dentro de cada grupo, el orden de llegada. */
export const rubroPrimero = <T extends { alerta: Alerta }>(xs: T[]): T[] =>
  [...xs.filter((x) => !esDeLaRegion(x.alerta)), ...xs.filter((x) => esDeLaRegion(x.alerta))];

const limpio = (texto: string | null | undefined, largo: number) => {
  const t = sinContactos((texto ?? '').replace(/\s+/g, ' ').trim());
  return t.length > largo ? `${t.slice(0, largo - 1)}…` : t;
};

export function crearAlerta(proceso: ProcesoParaAviso, coincidencia: string, creada: number): Alerta {
  const cierre = parsearFechaApi(proceso.fechas?.fecha_cierre ?? null);
  const inst = proceso.institucion;
  const monto = proceso.montos?.monto_disponible_clp;
  return {
    codigo: proceso.codigo,
    nombre: limpio(proceso.nombre, LARGO_MAXIMO_NOMBRE),
    organismo: limpio(inst?.organismo_comprador, 120) || 'No informado',
    region: inst?.nombre_region?.trim() || (typeof inst?.region === 'number' ? `Región ${inst.region}` : 'No informada'),
    presupuestoClp: typeof monto === 'number' && Number.isFinite(monto) ? monto : null,
    cierreHoraChile: enHoraDeChile(proceso.fechas?.fecha_cierre ?? null),
    cierreUtc: cierre ? cierre.toISOString() : null,
    publicadaHoraChile: enHoraDeChile(proceso.fechas?.fecha_publicacion ?? null),
    segundoLlamado: proceso.convocatoria?.estado_convocatoria === 2,
    coincidencia,
    nivel: coincidencia === EN_TU_REGION ? 'region' : 'rubro',
    ficha: `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(proceso.codigo)}`,
    creada,
  };
}

/** Horas enteras hasta el cierre (hacia abajo), o null si no hay cierre. */
export function horasRestantes(a: Alerta, ahoraMs: number): number | null {
  if (!a.cierreUtc) return null;
  return Math.floor((Date.parse(a.cierreUtc) - ahoraMs) / 3600_000);
}

/** «2026-10-09 12:00» → «09-10 12:00»: día-mes, como se lee en Chile. */
export function fechaCorta(horaChile: string | null): string {
  const m = horaChile?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  return m ? `${m[3]}-${m[2]} ${m[4]}` : 'sin fecha';
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** «2026-10-09 14:00» → «jue 09-10 14:00»: con el día de la semana, que es lo que se mira para cotizar a tiempo. */
export function fechaConDia(horaChile: string | null | undefined): string {
  const m = horaChile?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  if (!m) return 'sin fecha';
  const dia = DIAS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  return `${dia} ${m[3]}-${m[2]} ${m[4]}`;
}

/** La que cierra antes primero; sin cierre, al final. Estable para el mismo cierre. */
export const porCierre = <T extends { alerta: Alerta }>(xs: T[]): T[] =>
  [...xs].sort((x, y) => (x.alerta.cierreUtc ? Date.parse(x.alerta.cierreUtc) : Infinity) - (y.alerta.cierreUtc ? Date.parse(y.alerta.cierreUtc) : Infinity));

/** La coincidencia que vale la pena mostrar: la palabra del dueño, no los marcadores. */
export const palabraMostrable = (a: Alerta): string | null =>
  a.coincidencia.startsWith('(') ? null : a.coincidencia;

export const pesos = (n: number | null) => (n === null ? 'sin monto publicado' : `$${n.toLocaleString('es-CL')}`);
