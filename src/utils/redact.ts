/**
 * Redacción de secretos: punto único de estrangulamiento.
 *
 * POR QUÉ EXISTE
 * El ticket de acceso viaja en la query string del endpoint legado
 * (/servicios/.../OrdenCompra.json). Se verificó empíricamente que algunos
 * errores de `fetch` incluyen la URL completa en su mensaje:
 *
 *   TypeError: Failed to parse URL from http://host/x?ticket=SECRETO
 *
 * Ese texto termina en la respuesta de la tool → contexto del LLM →
 * transcripción, logs y capturas de pantalla. Auditar caso por caso cada
 * `String(error)` es una batalla perdida: siempre aparecerá una ruta nueva.
 *
 * En vez de eso, TODO string que sale del proceso pasa por `redact()`.
 * Aunque surja un camino de error imprevisto, el secreto no se escapa.
 *
 * Se aplica en tres puntos: el logger, el error-handler y los catch de tools.
 */

const MARCA = '[REDACTED]';

/** Longitud mínima para registrar un secreto: evita redactar palabras comunes. */
const LARGO_MINIMO = 8;

const secretos = new Set<string>();

/**
 * Registra un valor secreto para que sea removido de toda salida.
 * Idempotente y seguro de llamar con undefined.
 */
export function registrarSecreto(valor: string | undefined | null): void {
  if (!valor) return;
  const v = valor.trim();
  // Un secreto muy corto redactaría texto legítimo por coincidencia.
  if (v.length < LARGO_MINIMO) return;

  secretos.add(v);

  // La misma credencial puede aparecer URL-encodeada dentro de una URL.
  const encoded = encodeURIComponent(v);
  if (encoded !== v) secretos.add(encoded);
}

/** Solo para tests: limpia los secretos registrados. */
export function _resetSecretos(): void {
  secretos.clear();
}

/** Cantidad de secretos registrados (diagnóstico). */
export function secretosRegistrados(): number {
  return secretos.size;
}

/**
 * Elimina cualquier secreto conocido de un texto.
 *
 * Defensa en dos capas:
 * 1. Coincidencia exacta de los secretos registrados.
 * 2. Patrón `ticket=<valor>` en query strings — cubre el caso en que el
 *    secreto no alcanzó a registrarse (ej. error durante el arranque).
 */
export function redact(texto: string): string {
  if (!texto) return texto;
  let out = texto;

  for (const s of secretos) {
    if (out.includes(s)) {
      out = out.split(s).join(MARCA);
    }
  }

  // Capa 2: cualquier ticket= en una URL, esté o no registrado.
  out = out.replace(/([?&]ticket=)[^&\s"'<>)\]]+/gi, `$1${MARCA}`);
  // Capa 2b: header/JSON con forma "ticket": "valor"
  out = out.replace(/(["']?ticket["']?\s*[:=]\s*["'])([^"']+)(["'])/gi, `$1${MARCA}$3`);

  return out;
}

/**
 * Convierte cualquier valor lanzado en un string seguro para mostrar.
 * Reemplaza el patrón `String(error)` usado en los catch de las tools.
 */
export function safeError(error: unknown): string {
  let base: string;
  if (error instanceof Error) {
    // El `cause` de undici puede traer detalle útil (y potencialmente la URL).
    const cause = (error as Error & { cause?: unknown }).cause;
    base = cause ? `${error.message} (${String(cause)})` : error.message;
  } else {
    base = String(error);
  }
  return redact(base);
}

/**
 * Enmascara una credencial para mostrarla como referencia sin revelarla.
 * Ej: "abcd1234-ef56-7890" → "••••7890"
 */
export function pista(valor: string | undefined | null): string {
  if (!valor) return '(no configurado)';
  const v = valor.trim();
  if (v.length <= 4) return '••••';
  return `••••${v.slice(-4)}`;
}
