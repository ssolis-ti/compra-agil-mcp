/**
 * Validación de entradas y formato único de sus errores.
 *
 * ⚠ E5 (enjambre contra la API real, 6-oct): un mismo tipo de problema salía
 *   en cuatro formatos — texto plano («No se hizo la llamada…»),
 *   `MCP error -32602: Input validation error: Invalid arguments for tool …`,
 *   «Error de validación: …» y mensajes de zod en inglés («Invalid input:
 *   expected string, received undefined») —, y solo algunos decían si se había
 *   gastado cuota. Un modelo no puede tratar igual errores que no se parecen.
 *
 * Desde aquí todo rechazo de una entrada se ve así:
 *
 *     Error de validación: <qué está mal y cómo corregirlo>. No se consultó la API.
 *
 * ⚠ E4: un código con formato imposible (`ABC`) llegaba a la API y gastaba una
 *   consulta para volver con un 400. Ahora el esquema lo rechaza antes.
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registrarRechazoValidacion } from './metricas.js';

export const PREFIJO_VALIDACION = 'Error de validación:';
export const SIN_CONSULTA = 'No se consultó la API.';

/**
 * Normaliza un mensaje de validación: un solo prefijo y la aclaración de que no
 * se gastó cuota, sin duplicarlos si el texto ya los traía.
 */
export function errorDeValidacion(texto: string): string {
  const cuerpo = texto
    .replace(/^\s*Error de validaci[oó]n:\s*/i, '')
    .replace(/\s*No se consult[oó] la API\.?/gi, '')
    .replace(/\s*No se hizo la llamada\.?/gi, '')
    .trim();
  // Termina en punto salvo que ya cierre una oración (también tras comillas o paréntesis).
  const conPunto = /[.!?]["»)]?$/.test(cuerpo) ? cuerpo : `${cuerpo}.`;
  return `${PREFIJO_VALIDACION} ${conPunto} ${SIN_CONSULTA}`;
}

// ─── Códigos ───────────────────────────────────────────────────────────────

/**
 * Código de Compra Ágil: "1057539-228-COT26", "5796-33-COT26". Tres partes
 * separadas por guion; la última, letras y el año en dos dígitos. Se acepta
 * cualquier sufijo de letras (no solo COT) para no rechazar un código válido
 * de un formato que no se haya visto.
 */
export const RE_CODIGO_COMPRA = /^\d{1,9}-\d{1,9}-[A-Za-z]{2,5}\d{2}$/;

/** Código de Orden de Compra: "1057539-1234-SE26", "2097-241-AG14". */
export const RE_CODIGO_OC = /^\d{1,9}-\d{1,9}-[A-Za-z]{2,5}\d{2}$/;

export function esCodigoCompra(valor: string): boolean {
  return RE_CODIGO_COMPRA.test(valor.trim());
}

function esquemaCodigo(re: RegExp, ejemplo: string, que: string) {
  return z.string().trim().refine((v) => re.test(v), (v) => ({
    message: `"${v}" no tiene el formato de un código de ${que} (ej: "${ejemplo}").`,
  }));
}

/** Reemplaza a `z.string()`: se le encadenan `.optional()` y `.describe()` como siempre. */
export function esquemaCodigoCompra() {
  return esquemaCodigo(RE_CODIGO_COMPRA, '1057539-228-COT26', 'Compra Ágil');
}

export function esquemaCodigoOC() {
  return esquemaCodigo(RE_CODIGO_OC, '1057539-1234-SE26', 'Orden de Compra');
}

// ─── Mensajes de zod en español ────────────────────────────────────────────

const TIPOS: Record<string, string> = {
  string: 'un texto', number: 'un número', boolean: 'verdadero o falso',
  array: 'una lista', object: 'un objeto', integer: 'un número entero',
};

/** Mapa de errores de zod en español, con el nombre del parámetro. */
export const mapaErroresZod: z.ZodErrorMap = (issue, ctx) => {
  const campo = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'el valor';
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: `Falta ${campo}, que es obligatorio.` };
      return { message: `${campo} debe ser ${TIPOS[issue.expected] ?? issue.expected}; llegó ${TIPOS[issue.received] ?? issue.received}.` };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'number') return { message: `${campo} debe ser como mínimo ${issue.minimum}.` };
      if (issue.type === 'string') return { message: `${campo} debe tener al menos ${issue.minimum} caracteres.` };
      return { message: `${campo} tiene menos elementos de los permitidos (mínimo ${issue.minimum}).` };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'number') return { message: `${campo} debe ser como máximo ${issue.maximum}.` };
      if (issue.type === 'string') return { message: `${campo} admite como máximo ${issue.maximum} caracteres.` };
      return { message: `${campo} tiene más elementos de los permitidos (máximo ${issue.maximum}).` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `${campo} debe ser uno de: ${issue.options.map((o) => `"${String(o)}"`).join(', ')}; llegó "${String(issue.received)}".` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Parámetro(s) no reconocido(s): ${issue.keys.map((k) => `"${k}"`).join(', ')}.` };
    default:
      return { message: ctx.defaultError };
  }
};

let mapaInstalado = false;
/** Instala el mapa de errores en español. Idempotente. */
export function configurarMensajesZod(): void {
  if (mapaInstalado) return;
  z.setErrorMap(mapaErroresZod);
  mapaInstalado = true;
}

// ─── Formato único en el servidor ──────────────────────────────────────────

/**
 * Convierte el texto que arma el SDK al rechazar un argumento
 * («MCP error -32602: Input validation error: Invalid arguments for tool X:
 * <mensajes> at <campo>») en nuestro formato.
 */
export function traducirRechazoDelEsquema(mensajeSdk: string): string {
  const detalle = mensajeSdk.replace(/^[\s\S]*?Invalid arguments for tool [^:]+:\s*/, '');
  const lineas = detalle
    .split('\n')
    .map((l) => l.replace(/\s+at\s+[\w.[\]]+\s*$/, '').trim())
    .filter(Boolean);
  return errorDeValidacion([...new Set(lineas)].join(' '));
}

type Resultado = { content?: Array<{ type: string; text?: string }>; isError?: boolean };

/** Si el resultado es un error de validación, lo deja en el formato único. */
export function normalizarResultado<T extends Resultado>(r: T): T {
  if (!r?.isError || !Array.isArray(r.content)) return r;
  const primero = r.content[0];
  if (primero?.type !== 'text' || typeof primero.text !== 'string') return r;
  if (!/^\s*(Error de validaci[oó]n:|No se hizo la llamada)/i.test(primero.text)) return r;
  return { ...r, content: [{ ...primero, text: errorDeValidacion(primero.text) }, ...r.content.slice(1)] };
}

/**
 * Instala el formato único de errores en el servidor. Debe llamarse ANTES de
 * registrar las herramientas.
 *
 * - Envuelve `registerTool` para normalizar los errores de validación que
 *   devuelven los handlers.
 * - Envuelve `validateToolInput` (interno del SDK 1.x) para reescribir los
 *   rechazos del esquema. Si una versión futura del SDK no lo tiene, se sigue
 *   con el formato del SDK: test/protocolo.test.ts lo detecta.
 *
 * Devuelve si pudo instalar la traducción de los rechazos del esquema.
 */
export function instalarFormatoDeErrores(server: McpServer): boolean {
  configurarMensajesZod();

  const registrar = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool = (...args: unknown[]) => {
    const handler = args[args.length - 1];
    if (typeof handler === 'function') {
      args[args.length - 1] = async (...h: unknown[]) => normalizarResultado(await (handler as (...x: unknown[]) => Promise<Resultado>)(...h));
    }
    return registrar(...args);
  };

  const interno = server as unknown as { validateToolInput?: (...a: unknown[]) => Promise<unknown> };
  const original = interno.validateToolInput;
  if (typeof original !== 'function') return false;
  interno.validateToolInput = async (...a: unknown[]) => {
    try {
      return await original.apply(server, a);
    } catch (error) {
      if (error instanceof McpError && error.code === ErrorCode.InvalidParams && /Input validation error/.test(error.message)) {
        // validateToolInput(tool, args, toolName): el nombre es el tercer argumento.
        if (typeof a[2] === 'string') registrarRechazoValidacion(a[2]);
        throw new Error(traducirRechazoDelEsquema(error.message), { cause: error });
      }
      throw error;
    }
  };
  return true;
}
