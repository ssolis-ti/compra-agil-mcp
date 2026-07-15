/**
 * Formateo localizado para informes (Chile).
 *
 * Fuente única de verdad para representar montos, fechas y RUTs.
 * Evita que cada template invente su propio formato.
 */

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

/** Formatea una fecha ISO a formato legible chileno. Ej: "15-07-2026 09:30" */
export function fecha(iso: string | null | undefined, conHora = true): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  if (!conHora) return `${dia}-${mes}-${anio}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dia}-${mes}-${anio} ${hh}:${mm}`;
}

/** Fecha larga para portadas. Ej: "15 de julio de 2026" */
export function fechaLarga(d: Date = new Date()): string {
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
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
