/**
 * Traductor de errores HTTP de la API Compra Ágil a mensajes accionables para LLMs.
 *
 * Cada mensaje está redactado para que un agente de IA entienda
 * exactamente qué salió mal y qué acción tomar.
 */

import { redact } from './redact.js';

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

export class CompraAgilApiError extends Error {
  public readonly httpStatus: number;
  public readonly apiErrors: ApiError[];
  public readonly actionableMessage: string;

  constructor(httpStatus: number, apiErrors: ApiError[] = []) {
    const actionable = getActionableMessage(httpStatus, apiErrors);
    super(actionable);
    this.name = 'CompraAgilApiError';
    this.httpStatus = httpStatus;
    this.apiErrors = apiErrors;
    this.actionableMessage = actionable;
  }
}

function getActionableMessage(httpStatus: number, apiErrors: ApiError[]): string {
  // El mensaje viene de la API: no se controla su contenido y podría hacer eco
  // de la URL solicitada (que en el endpoint legado lleva el ticket en la query).
  const detail = apiErrors.length > 0
    ? ` Detalle de la API: "${redact(apiErrors[0].mensaje ?? '')}"`
    : '';

  switch (httpStatus) {
    case 400:
      return `Parámetros inválidos enviados a la API de Compra Ágil. Verifica el formato de fechas (ISO-8601), que 'q' e 'id' no se usen juntos, y que los códigos de región estén entre 1 y 16.${detail}`;
    case 401:
      return `Ticket de acceso no proporcionado. Configura la variable de entorno COMPRA_AGIL_TICKET con un ticket válido obtenido en https://www.chilecompra.cl/api/.${detail}`;
    case 403:
      return `Ticket de acceso inválido, inactivo o bloqueado. Verifica que el ticket sea correcto y esté vigente. Si fue bloqueado, solicita uno nuevo en https://www.chilecompra.cl/api/.${detail}`;
    case 404:
      return `No se encontró el recurso solicitado (Compra Ágil u Orden de Compra) con el código proporcionado. Verifica que el código sea correcto, que exista y sea público.${detail}`;
    case 429:
      return formatRateLimitMessage(detail);
    case 500:
      return `Error interno del servidor de Mercado Público (api2.mercadopublico.cl). Esto no es un problema de tu consulta. Reintenta en unos minutos.${detail}`;
    case 503:
      return `El servicio de Mercado Público está temporalmente no disponible (posible mantenimiento). Reintenta más tarde.${detail}`;
    // 502 y 504 no están en la tabla de errores de la guía oficial, pero la API
    // los devuelve: se observó un 504 sistemático (septiembre 2026) al pedir
    // tamano_pagina=50 sobre `estado=desierta` con búsqueda de texto — la
    // pasarela corta a los ~30 s. Sin este caso caían en "Error inesperado", que
    // hacía parecer un fallo del cliente lo que es una lentitud del servicio.
    case 502:
    case 504:
      return `La pasarela de Mercado Público cortó la conexión antes de que la API respondiera (HTTP ${httpStatus}): la consulta tardó demasiado, no es un error de tus parámetros. Reintenta, y si se repite reduce el trabajo por consulta — un 'tamano_pagina' más chico, menos 'limite_analisis' o un filtro más específico. Las búsquedas por texto sobre 'estado=desierta' son las más lentas.${detail}`;
    default:
      return `Error inesperado HTTP ${httpStatus} de la API de Compra Ágil.${detail}`;
  }
}

function formatRateLimitMessage(detail: string): string {
  // La cuota se comporta como un token bucket que se recarga solo (glosario de
  // la guía oficial): medido en producción, la API volvió a responder ~13 min
  // después de un 429. Por eso no se aconseja esperar al día siguiente.
  return `Se agotaron temporalmente los tokens de cuota de la API. No es necesario esperar al día siguiente: la cuota se recarga sola, así que reintenta en unos minutos. Para gastar menos: usa filtros más específicos (estado, región, fechas), baja 'limite_analisis'/'max_paginas' en las herramientas de análisis, y prefiere 'ttl_cambio_ms' o un rango 'cambio_desde'/'cambio_hasta' para sincronización incremental en vez de descargas completas. Si el 429 persiste durante horas, la cuota diaria del ticket sí puede estar agotada: contacta a ChileCompra para uno de mayor límite.${detail}`;
}

/**
 * Parsea la respuesta de error de la API y lanza una excepción tipada.
 */
export async function handleApiResponse(response: Response): Promise<unknown> {
  if (response.ok) {
    const json = await response.json() as { success?: string; payload?: unknown };
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
