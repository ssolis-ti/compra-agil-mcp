/**
 * Interpretación de las fechas que entrega la API.
 *
 * ⚠ EL PROBLEMA: la API mezcla dos formatos para el mismo instante.
 *
 *     fechas.fecha_cierre                  "2026-09-11 12:00"      ← sin zona
 *     convocatoria.fecha_cierre_primer_llamado "2026-09-11T12:00:00Z"  ← UTC
 *
 *   Verificado en 8 de 8 procesos: el valor es idéntico, pero solo uno declara
 *   su zona horaria. Los campos sin marca son justamente los que un proveedor
 *   mira para saber cuándo cierra un llamado.
 *
 * ⚠ POR QUÉ NO BASTA CON `new Date()`: ante un string sin zona y con espacio en
 *   vez de "T", V8 lo interpreta en la zona horaria DEL SERVIDOR. Medido: el
 *   mismo "2026-09-11 12:00" se convierte en 15:00Z si el proceso corre en
 *   Chile y en 12:00Z si corre en UTC. Es decir, el radar calculaba
 *   `horas_restantes` —y con ello su puntaje de urgencia— con tres horas de
 *   diferencia según dónde estuviera desplegado, con los mismos datos.
 *
 * ⚠ POR QUÉ SE ASUME UTC: no se pudo determinar con certeza si esos valores son
 *   UTC u hora de Chile. La evidencia está dividida — el filtro `ttl_cambio_ms`
 *   de la API trata las marcas `Z` como UTC real, pero la ficha del portal
 *   muestra ese mismo "12:00" a usuarios chilenos sin convertir.
 *
 *   Ante la duda se elige UTC porque el error es asimétrico. Si el valor fuera
 *   hora de Chile y lo leemos como UTC, mostramos el cierre TRES HORAS ANTES de
 *   lo real: el proveedor se apura de más. Al revés —leerlo como hora local
 *   siendo UTC— le haría creer que tiene tres horas extra y perdería el plazo.
 *   Entre apurarse de más y llegar tarde a una licitación, la elección es clara.
 */

/** Formato sin zona horaria que devuelve la API: "2026-09-11 12:00". */
const SIN_ZONA = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:(\d{2}))?$/;

/**
 * Convierte una fecha de la API a un instante absoluto, sin depender de la zona
 * horaria del servidor. Devuelve `null` si el valor falta o no se entiende, para
 * que quien llame distinga "no hay fecha" de "medianoche".
 */
export function parsearFechaApi(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const texto = String(valor).trim();

  const m = SIN_ZONA.exec(texto);
  if (m) {
    // Se le añade la Z que la API omitió: así el resultado es el mismo en
    // cualquier servidor, que es la mitad del problema que esto resuelve.
    const segundos = m[4] ?? '00';
    const d = new Date(`${m[1]}T${m[2]}:${segundos}Z`);
    return isNaN(d.getTime()) ? null : d;
  }

  // Ya trae zona horaria (Z u offset): se respeta lo que dice.
  const d = new Date(texto);
  return isNaN(d.getTime()) ? null : d;
}

/** ¿El valor viene sin declarar su zona horaria? Entonces se asumió UTC. */
export function esFechaAmbigua(valor: string | null | undefined): boolean {
  return Boolean(valor) && SIN_ZONA.test(String(valor).trim());
}

/**
 * Texto que acompaña a una fecha ambigua para que ni el modelo ni la persona
 * asuman hora local. Va en la salida de las herramientas, no en los logs:
 * quien decide si alcanza a cotizar necesita verlo.
 */
export const NOTA_ZONA_HORARIA =
  'Las horas provienen de la API sin declarar zona horaria y se interpretan como UTC. ' +
  'En Chile continental (UTC-3) resta 3 horas: un cierre a las "12:00" corresponde a las 09:00 locales. ' +
  'Como la API no lo especifica, confirma el plazo exacto en la ficha del proceso antes de comprometerte.';

/**
 * Misma fecha, expresada también en hora de Chile, para que el usuario no tenga
 * que hacer la resta mental. Devuelve `null` si la fecha no se pudo interpretar.
 */
export function enHoraDeChile(valor: string | null | undefined): string | null {
  const d = parsearFechaApi(valor);
  if (!d) return null;
  // sv-SE da el formato ISO "YYYY-MM-DD HH:MM", legible y sin ambigüedad.
  return d.toLocaleString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 16);
}
