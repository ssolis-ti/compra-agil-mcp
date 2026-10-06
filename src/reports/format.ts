/**
 * Formateo localizado para informes (Chile).
 *
 * Fuente única de verdad para representar montos, fechas y RUTs.
 * Evita que cada template invente su propio formato.
 */

import { parsearFechaApi } from '../utils/fechas.js';

const ZONA_CHILE = 'America/Santiago';

/** Formatea un monto en pesos chilenos. Ej: 1250000 → "$1.250.000" */
export function clp(monto: number | null | undefined): string {
  if (monto === null || monto === undefined || !Number.isFinite(monto)) return '—';
  return `$${Math.round(monto).toLocaleString('es-CL')}`;
}

/** Formatea un número con separador de miles chileno. */
export function numero(valor: number | null | undefined, decimales = 0): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
  return valor.toLocaleString('es-CL', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** Formatea un porcentaje. Ej: 12.3 → "12,3%" */
export function porcentaje(valor: number | null | undefined, decimales = 1): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
  return `${numero(valor, decimales)}%`;
}

/**
 * Formatea una fecha de la API a formato legible chileno, en HORA DE CHILE.
 * Ej: "2026-07-15 13:30" (sin zona, se asume UTC) → "15-07-2026 09:30".
 *
 * ⚠ Antes usaba `new Date(iso)` y `getHours()`: interpretaba el valor sin zona
 *   como hora del servidor y lo mostraba en la hora del servidor. El mismo
 *   cierre salía 12:00 en Chile, 15:00 en un servidor UTC y 17:00 en Madrid
 *   (auditoría QA, octubre 2026), y contradecía el `fecha_cierre_hora_chile`
 *   que la herramienta JSON entrega para el mismo proceso. Ahora usa el mismo
 *   parser que el resto del servidor (utils/fechas.ts).
 */
export function fecha(iso: string | null | undefined, conHora = true): string {
  const d = parsearFechaApi(iso);
  if (!d) return '—';
  const p = partesEnChile(d);
  if (!conHora) return `${p.day}-${p.month}-${p.year}`;
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

/** Fecha larga para portadas, según el calendario de Chile. Ej: "15 de julio de 2026" */
export function fechaLarga(d: Date = new Date()): string {
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONA_CHILE });
}

function partesEnChile(d: Date): Record<'day' | 'month' | 'year' | 'hour' | 'minute', string> {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_CHILE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const valor = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? '';
  return { day: valor('day'), month: valor('month'), year: valor('year'), hour: valor('hour'), minute: valor('minute') };
}

/**
 * Formatea un RUT chileno con puntos y guion. Ej: "761234567" → "76.123.456-7"
 * Si el valor no parece un RUT, se devuelve tal cual.
 */
export function rut(valor: string | null | undefined): string {
  if (!valor) return '—';
  const limpio = valor.replace(/[.\-\s]/g, '').toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return valor;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return `${Number(cuerpo).toLocaleString('es-CL')}-${dv}`;
}

/** Convierte horas a una glosa humana. Ej: 30.5 → "1d 6h" */
export function horasRestantes(horas: number | null | undefined): string {
  if (horas === null || horas === undefined || !Number.isFinite(horas) || horas <= 0) return '—';
  if (horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas < 24) return `${Math.round(horas)} h`;
  const dias = Math.floor(horas / 24);
  const resto = Math.round(horas % 24);
  return resto > 0 ? `${dias}d ${resto}h` : `${dias}d`;
}
