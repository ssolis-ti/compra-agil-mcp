/**
 * Búsqueda de texto dentro de los documentos locales (manuales, guías, normativa).
 *
 * ⚠ POR QUÉ EXISTE ESTE MÓDULO: la primera implementación buscaba la consulta
 *   completa como subcadena literal (`texto.includes(query)`). Con una palabra
 *   suelta funcionaba, pero cualquier pregunta en lenguaje natural —que es
 *   justo lo que envía un LLM— no coincidía nunca. Peor aún, el fallo era
 *   silencioso y seguro de sí mismo: "no se encontraron coincidencias en
 *   ninguno de los 10 documentos" ante la pregunta "¿qué multas me pueden
 *   aplicar?", existiendo un PDF entero dedicado a multas y sanciones. El
 *   modelo repetía ese "no hay información" al usuario como si fuera cierto.
 *
 *   Ahora la consulta se descompone en términos, se ignoran las palabras
 *   vacías y se puntúa cada línea por cuántos términos distintos contiene.
 *   Además se normalizan los acentos, porque en documentos en español
 *   "sanción" y "sancion" deben encontrarse mutuamente.
 */

/** Palabras sin valor discriminante en una consulta en español. */
const VACIAS = new Set([
  'que', 'qué', 'cual', 'cuál', 'cuales', 'cuáles', 'como', 'cómo', 'cuando',
  'cuándo', 'donde', 'dónde', 'quien', 'quién', 'por', 'para', 'con', 'sin',
  'los', 'las', 'del', 'unos', 'unas', 'una', 'uno', 'sus', 'sobre', 'entre',
  'este', 'esta', 'esto', 'estos', 'estas', 'ese', 'esa', 'eso', 'aquel',
  'son', 'ser', 'está', 'esta', 'estan', 'están', 'hay', 'han', 'hace',
  'puede', 'pueden', 'debe', 'deben', 'tiene', 'tienen', 'mas', 'más',
  'pero', 'sus', 'les', 'nos', 'mis', 'tus', 'muy', 'ya', 'les', 'algun',
  'algún', 'alguna', 'todo', 'toda', 'todos', 'todas', 'otro', 'otra',
]);

/** Minúsculas y sin acentos, para que "sanción" y "sancion" se encuentren. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Descompone la consulta en términos buscables: normalizados, sin palabras
 * vacías y de al menos 3 caracteres.
 *
 * Si al filtrar no queda ningún término (consulta hecha solo de palabras
 * vacías, ej. "qué es esto"), se devuelven todos los de 3+ caracteres antes
 * que dejar al usuario sin búsqueda.
 */
export function tokenizar(query: string): string[] {
  const crudos = normalizar(query)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length >= 3);

  const utiles = crudos.filter((t) => !VACIAS.has(t));
  const elegidos = utiles.length > 0 ? utiles : crudos;
  return [...new Set(elegidos)];
}

export interface Fragmento {
  /** Línea que coincidió, con su contexto inmediato. */
  texto: string;
  /** Términos de la consulta presentes en la línea. */
  terminos: string[];
  puntaje: number;
}

export interface ResultadoBusqueda {
  fragmentos: Fragmento[];
  /** Términos en que se descompuso la consulta. */
  terminos: string[];
  /** Términos que no aparecen en ninguna parte del texto. */
  ausentes: string[];
}

/**
 * Busca los términos de `query` en `texto` y devuelve los fragmentos más
 * relevantes, ordenados por cuántos términos distintos concentra cada uno.
 *
 * Una línea que contiene la consulta completa e íntegra se prioriza sobre
 * cualquier coincidencia parcial: si el usuario acertó la frase exacta, esa
 * es la mejor respuesta posible.
 */
export function buscarEnTexto(
  texto: string,
  query: string,
  maxFragmentos = 12
): ResultadoBusqueda {
  const terminos = tokenizar(query);
  if (terminos.length === 0) {
    return { fragmentos: [], terminos: [], ausentes: [] };
  }

  const frase = normalizar(query).trim();
  const lineas = texto.split('\n');
  const normalizadas = lineas.map(normalizar);

  const ausentes = terminos.filter((t) => !normalizadas.some((l) => l.includes(t)));

  const candidatos: Fragmento[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]?.trim();
    if (!linea) continue;
    const norm = normalizadas[i];

    const presentes = terminos.filter((t) => norm.includes(t));
    if (presentes.length === 0) continue;

    // La frase completa vale más que la suma de sus partes.
    const bonus = frase.length > 0 && norm.includes(frase) ? terminos.length * 10 : 0;

    const contexto: string[] = [];
    const anterior = lineas[i - 1]?.trim();
    const siguiente = lineas[i + 1]?.trim();
    if (anterior) contexto.push(`[Anterior] ${anterior}`);
    contexto.push(`[COINCIDENCIA] ${linea}`);
    if (siguiente) contexto.push(`[Siguiente] ${siguiente}`);

    candidatos.push({
      texto: contexto.join('\n'),
      terminos: presentes,
      puntaje: presentes.length + bonus,
    });
  }

  candidatos.sort((a, b) => b.puntaje - a.puntaje);
  return { fragmentos: candidatos.slice(0, maxFragmentos), terminos, ausentes };
}

/** Nombre del manual que describe el comportamiento medido de este servidor. */
export const ARCHIVO_MANUAL_SERVIDOR = 'manual_servidor_mcp.md';

export function esManualServidor(archivo: string): boolean {
  return archivo.replace(/\\/g, '/').toLowerCase().endsWith(ARCHIVO_MANUAL_SERVIDOR);
}

export interface ResultadoArchivo {
  archivo: string;
  /** Puntaje del mejor fragmento de ese archivo. */
  mejorPuntaje: number;
}

/**
 * Pone el manual del servidor al frente cuando coincidió de verdad.
 *
 * La guía de ChileCompra describe la API prometida y, en el orden del disco,
 * se lee antes. Una coincidencia de un solo término no alcanza cuando la
 * consulta tiene varios: si no, "multas de compra" adelantaría el manual
 * por la palabra "compra" y taparía la guía de multas.
 */
/** Misma guía en MD y PDF no debe gastar dos cupos. */
export function claveDocumento(archivo: string): string {
  const base = archivo.replace(/\\/g, '/').split('/').pop() ?? archivo;
  return base.replace(/\.(md|pdf|txt)$/i, '').toLowerCase();
}

export function deduplicarDocumentos<T extends ResultadoArchivo>(resultados: T[]): T[] {
  const elegidos = new Map<string, T>();
  for (const actual of resultados) {
    const clave = claveDocumento(actual.archivo);
    const previo = elegidos.get(clave);
    if (!previo) {
      elegidos.set(clave, actual);
      continue;
    }
    const actualEsMd = actual.archivo.toLowerCase().endsWith('.md');
    const previoEsPdf = previo.archivo.toLowerCase().endsWith('.pdf');
    if (actual.mejorPuntaje > previo.mejorPuntaje || (actual.mejorPuntaje === previo.mejorPuntaje && actualEsMd && previoEsPdf)) {
      elegidos.set(clave, actual);
    }
  }
  const vistos = new Set<string>();
  const orden: T[] = [];
  for (const actual of resultados) {
    const clave = claveDocumento(actual.archivo);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const elegido = elegidos.get(clave);
    if (elegido) orden.push(elegido);
  }
  return orden;
}

/** OC, adjuntos y adjudicación: el manual medido va primero aunque la guía oficial puntúe más. */
export function consultaSensible(query: string): boolean {
  const texto = normalizar(query);
  return /orden de compra|oc emitida|adjunto|adjudic|proveedor seleccion|ganador/.test(texto);
}

export function anteponerManualServidor<T extends ResultadoArchivo>(
  resultados: T[],
  cantidadTerminos: number,
  forzar = false,
): { resultados: T[]; manualPrimero: boolean } {
  const indice = resultados.findIndex((r) => esManualServidor(r.archivo));
  if (indice < 0) return { resultados, manualPrimero: false };

  const umbral = cantidadTerminos <= 1 ? 1 : 2;
  if (!forzar && resultados[indice].mejorPuntaje < umbral) {
    return { resultados, manualPrimero: false };
  }

  const manual = resultados[indice];
  const resto = resultados.filter((_, i) => i !== indice);
  return { resultados: [manual, ...resto], manualPrimero: true };
}

/** Cuántos archivos devuelve `consultar_documentos_locales` como máximo. */
export const TOPE_ARCHIVOS_LOCALES = 3;

/** PDF que trae el régimen de sanciones. Una coincidencia de «aplicar» no debe ganarle. */
export const ARCHIVO_SANCIONES = 'multas-sanciones-procedimientos.pdf';

export const MARCA_DESCRIPCION_PROMETIDA = 'Descripción prometida, no es la medición.';

export function consultaDeMultas(query: string): boolean {
  return normalizar(query).includes('multa');
}

export function esPdfSanciones(archivo: string): boolean {
  return archivo.replace(/\\/g, '/').toLowerCase().endsWith(ARCHIVO_SANCIONES);
}

/**
 * En una consulta de multas, el PDF de sanciones va primero.
 * Si el manual medido ya encabeza una consulta sensible, se queda ahí.
 */
export function anteponerSanciones<T extends ResultadoArchivo>(
  resultados: T[],
  query: string,
  manualYaPrimero: boolean,
): T[] {
  if (manualYaPrimero || !consultaDeMultas(query)) return resultados;
  const indice = resultados.findIndex((r) => esPdfSanciones(r.archivo));
  if (indice <= 0) return resultados;
  const sanciones = resultados[indice];
  return [sanciones, ...resultados.filter((_, i) => i !== indice)];
}

export function esGuiaOficial(archivo: string): boolean {
  const base = archivo.replace(/\\/g, '/').split('/').pop() ?? archivo;
  return /^documentacion_api_compra_agil\.(md|pdf)$/i.test(base);
}

export function marcarSiEsGuiaOficial(archivo: string, texto: string): string {
  if (!esGuiaOficial(archivo)) return texto;
  return `${MARCA_DESCRIPCION_PROMETIDA}\n\n${texto}`;
}

/** Corta en un espacio. Si la primera palabra no cabe, la deja entera. */
export function recortarEnPalabra(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const corte = texto.lastIndexOf(' ', limite);
  const espacio = corte > 0 ? corte : texto.indexOf(' ');
  const trozo = espacio > 0 ? texto.slice(0, espacio) : texto;
  return `${trozo}... [TRUNCADO]`;
}

/** Una línea lógica por documento, aunque exista en MD y en PDF. Conserva el orden de llegada. */
export function agruparCatalogo(archivos: string[]): Array<{ clave: string; archivos: string[] }> {
  const grupos = new Map<string, string[]>();
  const orden: string[] = [];
  for (const archivo of archivos) {
    const clave = claveDocumento(archivo);
    const lista = grupos.get(clave);
    if (!lista) {
      grupos.set(clave, [archivo]);
      orden.push(clave);
    } else {
      lista.push(archivo);
    }
  }
  return orden.map((clave) => ({ clave, archivos: grupos.get(clave) ?? [] }));
}

export interface RecorteArchivos<T extends ResultadoArchivo> {
  resultados: T[];
  /** Archivos que coincidieron y no entraron en el tope, del mayor puntaje al menor. */
  omitidos: T[];
}

/**
 * Deja el manual en el primer lugar cuando ya calificó, y completa el cupo
 * con los demás archivos de mayor puntaje.
 *
 * Sin este corte, cada archivo que roza un término aporta hasta 3.000
 * caracteres y la respuesta pega la carpeta entera. El empate se rompe por
 * el orden de llegada, que es el del disco.
 */
export function recortarArchivos<T extends ResultadoArchivo>(
  resultados: T[],
  manualPrimero: boolean,
  tope = TOPE_ARCHIVOS_LOCALES,
): RecorteArchivos<T> {
  const reservaManual = manualPrimero && resultados.length > 0 && tope > 0;
  const cabeza = reservaManual ? [resultados[0]] : [];
  const resto = reservaManual ? resultados.slice(1) : resultados;
  const porPuntaje = resto
    .map((archivo, indice) => ({ archivo, indice }))
    .sort((a, b) => b.archivo.mejorPuntaje - a.archivo.mejorPuntaje || a.indice - b.indice)
    .map((item) => item.archivo);
  const cupo = Math.max(0, tope - cabeza.length);
  const mostrados = [...cabeza, ...porPuntaje.slice(0, cupo)];
  return { resultados: mostrados, omitidos: porPuntaje.slice(cupo) };
}
