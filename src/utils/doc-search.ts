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
