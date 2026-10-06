/**
 * Traductor de errores HTTP de la API Compra Ágil a mensajes accionables para LLMs.
 *
 * Cada mensaje está redactado para que un agente de IA entienda
 * exactamente qué salió mal y qué acción tomar.
 */

import { redact, safeError } from './redact.js';

export interface ApiError {
  codigo: string;
  mensaje: string;
  detalle: string | null;
}

export interface ApiErrorResponse {
  success: 'NOK';
  trace: string | null;
  payload: null;
  errors: ApiError[];
}

/**
 * Fallos que no traen un HTTP de la API porque la respuesta nunca llegó o no
 * se pudo leer. Van como `causa` y no como un status inventado: un 408 o un 0
 * se confundirían con algo que la API dijo.
 */
export type CausaLocal = 'timeout' | 'red' | 'respuesta_invalida' | 'tiempo_agotado';

export interface DetalleLocal {
  causa?: CausaLocal;
  /** Límite que se agotó, para que el mensaje nombre el número real. */
  timeoutMs?: number;
  /** Error original de red, ya redactado al formatear. */
  origen?: unknown;
  /** Qué parte de una respuesta legible no tiene la forma esperada. */
  motivo?: string;
  /** Espera que habría tenido la consulta en el freno propio (tiempo_agotado). */
  esperaMs?: number;
  /** Presupuesto de la llamada a la herramienta (tiempo_agotado). */
  presupuestoMs?: number;
}

export class CompraAgilApiError extends Error {
  public readonly httpStatus: number;
  public readonly apiErrors: ApiError[];
  public readonly actionableMessage: string;
  /** Llamada que falló, ya sin ticket. Vacío cuando el error es local (cuota). */
  public readonly consulta: string;
  /** Presente solo si la API no alcanzó a dar una respuesta legible. */
  public readonly causa?: CausaLocal;
  public readonly local: DetalleLocal;

  constructor(httpStatus: number, apiErrors: ApiError[] = [], consulta = '', local: DetalleLocal = {}) {
    const actionable = local.causa
      ? getLocalMessage(local, consulta)
      : getActionableMessage(httpStatus, apiErrors, consulta);
    super(actionable);
    this.name = 'CompraAgilApiError';
    this.httpStatus = httpStatus;
    this.apiErrors = apiErrors;
    this.consulta = consulta;
    this.causa = local.causa;
    this.local = local;
    this.actionableMessage = actionable;
  }
}

function getLocalMessage(local: DetalleLocal, consulta: string): string {
  const llamada = consulta ? ` La llamada que falló: ${redact(consulta)}.` : '';
  switch (local.causa) {
    case 'timeout': {
      const seg = Math.round((local.timeoutMs ?? 0) / 1000);
      return `La API de Mercado Público no respondió en ${seg} s y la consulta se canceló.${llamada} No es un problema de tus parámetros. No reintentes en ráfaga: espera unos minutos y, si se repite, acota la búsqueda (estado, región, fechas). Este fallo no dejó nada en caché.`;
    }
    case 'tiempo_agotado': {
      const espera = Math.ceil((local.esperaMs ?? 0) / 1000);
      const presupuesto = Math.round((local.presupuestoMs ?? 0) / 1000);
      return `Esta consulta habría tenido que esperar ~${espera} s en el límite propio de consultas por minuto, y no cabe en los ${presupuesto} s que tiene la herramienta antes de que el cliente MCP la corte.${llamada} No se envió ni gastó cuota. Reintenta en ~${espera} s, o pide menos de una vez (por ejemplo, un "limite_analisis" menor).`;
    }
    case 'red':
      return `No se pudo conectar con la API de Mercado Público (error de red: ${safeError(local.origen)}).${llamada} Se reintentó una vez. Revisa la conexión a internet o un proxy, y reintenta en unos minutos.`;
    case 'respuesta_invalida':
      if (local.motivo) {
        return `La API de Mercado Público respondió con una forma inesperada (${redact(local.motivo)}).${llamada} No es un problema de tus parámetros y no quedó en caché. Si se repite, la API pudo haber cambiado: confirma el proceso en la ficha pública.`;
      }
      return `La API de Mercado Público respondió, pero con un cuerpo que no es JSON válido (respuesta cortada o página de error de la pasarela).${llamada} No es un problema de tus parámetros y no quedó en caché. Reintenta en unos minutos.`;
    default:
      return `Error inesperado al consultar la API de Compra Ágil.${llamada}`;
  }
}

/**
 * La combinación medida como la más lenta: texto (`q`) sobre `estado=desierta`.
 * Solo se menciona si ESA llamada la trae. Un 504 de otro filtro no es esa causa.
 */
function esDetallePorCodigo(consulta: string): boolean {
  return /\/v2\/compra-agil\/[^/?\s]+/.test(consulta);
}

/** Código del proceso de una llamada de detalle, para enlazar su ficha. */
function codigoDelDetalle(consulta: string): string | null {
  const m = /\/v2\/compra-agil\/([^/?\s]+)/.exec(consulta);
  return m ? decodeURIComponent(m[1]) : null;
}

function esOrdenDeCompra(consulta: string): boolean {
  return /OrdenCompra\.json/i.test(consulta);
}

const fichaDe = (codigo: string) => `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(codigo)}`;

function esTextoSobreDesierta(consulta: string): boolean {
  const separador = consulta.indexOf('?');
  if (separador < 0) return false;
  const params = new URLSearchParams(consulta.slice(separador + 1));
  const estado = params.get('estado') ?? '';
  const texto = params.get('q');
  return estado.split(',').includes('desierta') && texto !== null && texto !== '';
}

/** Solo si ESA url pidió más de 10. Un 10 ya es el mínimo y no se puede bajar. */
function pistaTamano(consulta: string): string {
  const separador = consulta.indexOf('?');
  if (separador < 0) return '';
  const n = Number(new URLSearchParams(consulta.slice(separador + 1)).get('tamano_pagina'));
  if (!Number.isFinite(n) || n <= 10) return '';
  return " Baja 'tamano_pagina' hasta 10.";
}

function getActionableMessage(httpStatus: number, apiErrors: ApiError[], consulta = ''): string {
  // El mensaje viene de la API: no se controla su contenido y podría hacer eco
  // de la URL solicitada (que en el endpoint legado lleva el ticket en la query).
  const detail = apiErrors.length > 0
    ? ` Detalle de la API: "${redact(apiErrors[0].mensaje ?? '')}"`
    : '';
  const llamada = consulta ? ` La llamada que falló: ${redact(consulta)}.` : '';

  switch (httpStatus) {
    // ⚠ E4 y E11 (enjambre, 6-oct): el 400 hablaba siempre de fechas, de q/id y
    //   de regiones, también cuando lo rechazado era un código de proceso; y el
    //   404 no decía si se buscaba una compra o una OC. Se distingue por la
    //   llamada que falló.
    case 400: {
      const codigo = codigoDelDetalle(consulta);
      if (codigo) {
        return `La API rechazó el código "${codigo}". Un código de Compra Ágil tiene la forma "1057539-228-COT26".${detail}`;
      }
      if (esOrdenDeCompra(consulta)) {
        return `La API de Órdenes de Compra rechazó la consulta. Revisa el código de la OC (ej: "1057539-1234-SE26").${detail}`;
      }
      return `Parámetros inválidos enviados a la API de Compra Ágil. Verifica el formato de fechas (ISO-8601), que 'q' e 'id' no se usen juntos, y que los códigos de región estén entre 1 y 16.${detail}`;
    }
    case 401:
      return `Ticket de acceso no proporcionado. Configura la variable de entorno COMPRA_AGIL_TICKET con un ticket válido obtenido en https://www.chilecompra.cl/api/.${detail}`;
    case 403:
      return `Ticket de acceso inválido, inactivo o bloqueado. Verifica que el ticket sea correcto y esté vigente. Si fue bloqueado, solicita uno nuevo en https://www.chilecompra.cl/api/.${detail}`;
    case 404: {
      const codigo = codigoDelDetalle(consulta);
      if (codigo) {
        return `No existe una Compra Ágil pública con el código "${codigo}". Verifica el código; si lo copiaste del portal, confírmalo en la ficha: ${fichaDe(codigo)}${detail}`;
      }
      if (esOrdenDeCompra(consulta)) {
        return `No se encontró la Orden de Compra con ese código, o no es pública. Verifica el código de la OC.${detail}`;
      }
      return `No se encontró el recurso solicitado (Compra Ágil u Orden de Compra) con el código proporcionado. Verifica que el código sea correcto, que exista y sea público.${detail}`;
    }
    case 429:
      return formatRateLimitMessage(detail);
    case 500:
      return `Error interno del servidor de Mercado Público (api2.mercadopublico.cl). Esto no es un problema de tu consulta. Reintenta en unos minutos.${detail}`;
    case 503:
      return `El servicio de Mercado Público está temporalmente no disponible (posible mantenimiento). Reintenta más tarde.${detail}`;
    // 502 y 504 no están en la tabla de errores de la guía oficial, pero la API
    // los devuelve: la pasarela corta a los ~30 s. El mensaje nombra la llamada
    // real. La nota de texto+desierta se agrega solo cuando esa llamada la trae:
    // decirla siempre hacía que el agente cambiara un filtro que no había usado.
    case 502:
    case 504: {
      if (esDetallePorCodigo(consulta)) {
        // S18: el aviso remitía a «la ficha pública» sin dar el enlace.
        const codigo = codigoDelDetalle(consulta);
        return `La pasarela de Mercado Público cortó el detalle por código (HTTP ${httpStatus}).${llamada} Esta llamada no tiene tamaño de página ni otro parámetro que bajar. No reintentes en ráfaga. Espera y, si se repite, confirma el proceso en la ficha pública${codigo ? `: ${fichaDe(codigo)}` : ''}. Este fallo no dejó el detalle en caché.${detail}`;
      }
      const pistaLenta = esTextoSobreDesierta(consulta)
        ? ' Esta llamada combina búsqueda de texto y estado=desierta, la combinación más lenta medida.'
        : '';
      return `La pasarela de Mercado Público cortó la conexión antes de que la API respondiera (HTTP ${httpStatus}).${llamada} La consulta tardó demasiado. No reintentes en ráfaga.${pistaTamano(consulta)}${pistaLenta}${detail}`;
    }
    default:
      return `Error inesperado HTTP ${httpStatus} de la API de Compra Ágil.${detail}`;
  }
}

function formatRateLimitMessage(detail: string): string {
  // La cuota se comporta como un token bucket que se recarga solo (glosario de
  // la guía oficial): medido en producción, la API volvió a responder ~13 min
  // después de un 429. Por eso no se aconseja esperar al día siguiente.
  return `Se agotaron temporalmente los tokens de cuota de la API. No es necesario esperar al día siguiente: la cuota se recarga sola, así que reintenta en unos minutos. Para gastar menos: usa filtros más específicos (estado, región, fechas), baja 'limite_analisis'/'max_paginas' en las herramientas de análisis, y prefiere monitorear_cambios_recientes (ventana de cambios) para sincronización incremental en vez de descargas completas. Si el 429 persiste durante horas, la cuota diaria del ticket sí puede estar agotada: contacta a ChileCompra para uno de mayor límite.${detail}`;
}

/**
 * Parsea la respuesta de error de la API y lanza una excepción tipada.
 */
export async function handleApiResponse(response: Response): Promise<unknown> {
  if (response.ok) {
    let json: { success?: string; payload?: unknown };
    try {
      json = await response.json() as { success?: string; payload?: unknown };
    } catch (e) {
      // Un 200 con cuerpo cortado o HTML de la pasarela. Sin esto salía como
      // "Error inesperado: Unexpected token…", un texto de JavaScript crudo.
      throw new CompraAgilApiError(response.status, [], '', { causa: 'respuesta_invalida', origen: e });
    }
    if (json && json.success === 'NOK') {
      throw new CompraAgilApiError(response.status, (json as unknown as ApiErrorResponse).errors);
    }
    return (json && typeof json === 'object' && 'payload' in json) ? json.payload : json;
  }

  let apiErrors: ApiError[] = [];
  try {
    const errorJson = await response.json() as ApiErrorResponse;
    if (errorJson.errors) {
      apiErrors = errorJson.errors;
    }
  } catch {
    // Response body was not JSON, proceed with HTTP status only
  }

  throw new CompraAgilApiError(response.status, apiErrors);
}
