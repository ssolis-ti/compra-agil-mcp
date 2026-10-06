/**
 * Interpretación de las fechas que entrega la API.
 *
 * ⚠ LA API ENTREGA HORA DE CHILE, AUNQUE ALGUNOS CAMPOS DIGAN "Z".
 *
 *     fechas.fecha_cierre                      "2026-10-08 09:00"            ← sin zona
 *     convocatoria.fecha_cierre_primer_llamado "2026-10-08T09:00:00Z"        ← "Z", pero es Chile
 *     fechas.fecha_ultimo_cambio               "2026-10-06T15:05:00.583Z"    ← ídem
 *
 *   Medido el 6 de octubre de 2026 contra la API real
 *   (docs/internals/qa/resultado-enjambre-api-real.md):
 *   - 89 de 92 cierres caen entre 08:00 y 18:59 leídos como hora de Chile; leídos
 *     como UTC aparecían cierres a las 03:00, 05:00 y 07:00.
 *   - A las 15:42 de Chile (18:42 UTC, reloj verificado contra el SHOA) el cambio
 *     más reciente decía `15:40:00.903Z`: la hora de Chile de hace dos minutos,
 *     con una etiqueta UTC que no le corresponde.
 *   - La API compara esas marcas contra la hora UTC real en su filtro
 *     `ttl_cambio_ms`: toda ventana menor a tres horas volvía vacía.
 *
 *   Hasta la 2.7.0 este módulo asumía UTC. La validación de esa versión llegó a
 *   esa conclusión porque supuso que el filtro de la API compara bien las horas;
 *   comete el mismo error ahí, y con eso las dos hipótesis daban lo mismo. El
 *   efecto era mostrar cada cierre tres horas antes (cuatro en invierno) y que el
 *   radar ocultara los procesos que cerraban en las tres horas siguientes.
 *
 * ⚠ POR QUÉ NO BASTA CON `new Date()`: ante un string sin zona V8 usa la zona
 *   horaria DEL SERVIDOR, y ante uno con "Z" usa UTC. Ninguna de las dos es la de
 *   la API. Todo valor de la API pasa por `parsearFechaApi`.
 *
 * Las fechas que escribe el usuario (por ejemplo `cambio_desde`) sí respetan la
 * zona que declaran: para esas está `parsearFechaUsuario`.
 */

export const ZONA_CHILE = 'America/Santiago';

/**
 * Fecha/hora "de pared" de la API: "2026-10-08 09:00", "2026-10-08T09:00:00Z",
 * "2026-10-06T15:05:00.583Z". La "Z" final es opcional y se ignora a propósito.
 */
const PARED_API = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?Z?$/;

/** Offset numérico explícito (+hh:mm / -hh:mm): ese sí se respeta. */
const CON_OFFSET = /[+-]\d{2}:?\d{2}$/;

const FORMATO_PARED = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZONA_CHILE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Desfase de Chile respecto de UTC en ese instante, en minutos (−180 o −240). */
function desfaseMinutos(instante: number): number {
  const pared = FORMATO_PARED.format(new Date(instante)).replace(' ', 'T');
  const comoUtc = Date.parse(`${pared}Z`);
  // Los segundos fraccionarios se pierden al formatear: se redondea al minuto.
  return Math.round((comoUtc - Math.floor(instante / 1000) * 1000) / 60_000);
}

/**
 * Instante absoluto que corresponde a una hora "de pared" de Chile.
 *
 * Dos pasadas porque el desfase depende del propio instante: cerca del cambio de
 * hora la primera estimación puede caer del otro lado. Una hora que no existe
 * (el salto de septiembre) se resuelve hacia adelante; una que existe dos veces
 * (abril), hacia la primera ocurrencia. Ambos casos son de madrugada de sábado a
 * domingo, cuando no cierra ninguna Compra Ágil.
 */
export function instanteDesdeParedDeChile(
  anio: number, mes: number, dia: number, hora = 0, minuto = 0, segundo = 0, ms = 0,
): Date {
  const comoUtc = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, ms);
  const d1 = desfaseMinutos(comoUtc);
  const i1 = comoUtc - d1 * 60_000;
  const d2 = desfaseMinutos(i1);
  if (d1 === d2) return new Date(i1);

  // Cerca del cambio de hora las dos estimaciones difieren. Un candidato es
  // válido si su propio desfase es el que se usó para calcularlo.
  const i2 = comoUtc - d2 * 60_000;
  const valido1 = desfaseMinutos(i1) === d1;
  const valido2 = desfaseMinutos(i2) === d2;
  if (valido1 && !valido2) return new Date(i1);
  if (valido2 && !valido1) return new Date(i2);
  // Ambos válidos: la hora existe dos veces (abril) → la primera ocurrencia.
  // Ninguno: la hora no existe (septiembre) → hacia adelante.
  return new Date(valido1 ? Math.min(i1, i2) : Math.max(i1, i2));
}

/** Hora "de pared" de Chile de un instante: "2026-10-06T15:42:39". */
export function paredDeChile(instante: Date): string {
  return FORMATO_PARED.format(instante).replace(' ', 'T');
}

/**
 * Convierte una fecha de la API a un instante absoluto, igual en cualquier
 * servidor. Devuelve `null` si el valor falta o no se entiende, para que quien
 * llame distinga "no hay fecha" de "medianoche".
 *
 * Con o sin "Z", el valor es hora de Chile (ver el encabezado del módulo). Solo
 * un offset numérico explícito se respeta tal cual.
 */
export function parsearFechaApi(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const texto = String(valor).trim();

  const m = PARED_API.exec(texto);
  if (m) {
    const [, a, mo, d, h, mi, s, f] = m;
    const instante = instanteDesdeParedDeChile(
      Number(a), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0),
      Number((f ?? '0').padEnd(3, '0')),
    );
    return isNaN(instante.getTime()) ? null : instante;
  }

  if (CON_OFFSET.test(texto)) {
    const d = new Date(texto);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Fecha escrita por el usuario (p. ej. `cambio_desde`): debe declarar su zona
 * ("Z" o un offset) y se respeta lo que dice. Devuelve `null` si no la declara o
 * no se entiende, para que la herramienta rechace el valor sin gastar cuota.
 */
export function parsearFechaUsuario(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(texto)) return null;
  const d = new Date(texto);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Un instante, escrito como lo compara la API: la hora de pared de Chile con una
 * "Z" final. Es lo que hay que mandarle en `cambio_desde`/`cambio_hasta` para
 * que la ventana caiga donde se pidió. Se manda sin milisegundos.
 */
export function aFormatoApi(instante: Date): string {
  return `${paredDeChile(instante)}Z`;
}

/**
 * Margen hacia el futuro en las ventanas relativas. La API agrupa los cambios en
 * ciclos de 5 minutos y la hora de esta máquina puede diferir unos segundos de
 * la suya: sin margen, el último ciclo podría quedar fuera.
 */
export const MARGEN_FUTURO_VENTANA_MS = 2 * 60_000;

/**
 * Ventana "últimos N minutos" lista para la API, como rango absoluto.
 *
 * ⚠ NO USAR `ttl_cambio_ms`: la API compara sus marcas (hora de Chile con "Z")
 *   contra la hora UTC real, y una ventana relativa menor a tres horas volvía
 *   siempre vacía. Ver el encabezado de este módulo.
 */
export function ventanaUltimosMinutos(minutos: number, ahoraMs: number): { cambio_desde: string; cambio_hasta: string } {
  return {
    cambio_desde: aFormatoApi(new Date(ahoraMs - minutos * 60_000)),
    cambio_hasta: aFormatoApi(new Date(ahoraMs + MARGEN_FUTURO_VENTANA_MS)),
  };
}

/**
 * Texto que acompaña a las fechas en la salida de las herramientas, no en los
 * logs: quien decide si alcanza a cotizar necesita verlo.
 */
export const NOTA_ZONA_HORARIA =
  'Las fechas de la API (fecha_cierre, fecha_publicacion y fecha_ultimo_cambio, aunque esta última traiga "Z") están en hora de Chile continental (America/Santiago): ' +
  'los campos *_hora_chile las muestran tal cual, ya validadas. ' +
  'Medido contra la API real el 6 de octubre de 2026; hasta la versión 2.7.0 este servidor las leía como UTC y mostraba los cierres 3 horas antes. ' +
  'Confirma el plazo exacto en la ficha del proceso antes de comprometerte.';

/**
 * Pone la nota al inicio del JSON que ve el modelo, y un aviso si el reloj de
 * esta máquina no está confirmado contra el SHOA (ver utils/reloj.ts).
 */
export function conNotaHoraria<T extends Record<string, unknown>>(
  datos: T,
): { _nota_horaria: string; _aviso_reloj?: string } & T {
  const aviso = avisoRelojActual();
  return aviso
    ? { _nota_horaria: NOTA_ZONA_HORARIA, _aviso_reloj: aviso, ...datos }
    : { _nota_horaria: NOTA_ZONA_HORARIA, ...datos };
}

/**
 * Proveedor del aviso de reloj. Lo registra utils/reloj.ts al cargarse; queda
 * como función inyectada para que este módulo no dependa de la red ni del NTP.
 */
let avisoRelojActual: () => string | null = () => null;
export function registrarProveedorAvisoReloj(fn: () => string | null): void {
  avisoRelojActual = fn;
}

/**
 * Fecha de la API en hora de Chile, "YYYY-MM-DD HH:MM", para que el usuario no
 * tenga que hacer la resta mental. Devuelve `null` si no se pudo interpretar.
 */
export function enHoraDeChile(valor: string | null | undefined): string | null {
  const d = parsearFechaApi(valor);
  if (!d) return null;
  return paredDeChile(d).replace('T', ' ').slice(0, 16);
}

/**
 * Desfase continental de America/Santiago en ese instante.
 * UTC-3 en horario de verano y UTC-4 en invierno. No es una tabla de meses:
 * el cambio de hora no cae el día 1.
 */
export function desfaseChileEn(instante: Date): 'UTC-3' | 'UTC-4' {
  return desfaseMinutos(instante.getTime()) <= -240 ? 'UTC-4' : 'UTC-3';
}
