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
  fechas?: { fecha_cierre?: string | null } | null;
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
  /** La palabra clave del dueño que calzó (no es texto de terceros). */
  coincidencia: string;
  ficha: string;
  /** Epoch ms en que se generó la alerta. */
  creada: number;
}

export const LARGO_MAXIMO_NOMBRE = 160;

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
    coincidencia,
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

export const pesos = (n: number | null) => (n === null ? 'sin monto publicado' : `$${n.toLocaleString('es-CL')}`);
