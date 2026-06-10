/**
 * Traductor de errores HTTP de la API Compra Ágil a mensajes accionables para LLMs.
 *
 * Cada mensaje está redactado para que un agente de IA entienda
 * exactamente qué salió mal y qué acción tomar.
 */

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
  const detail = apiErrors.length > 0
    ? ` Detalle de la API: "${apiErrors[0].mensaje}"`
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
    default:
      return `Error inesperado HTTP ${httpStatus} de la API de Compra Ágil.${detail}`;
  }
}

function formatRateLimitMessage(detail: string): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 1, 0, 0);
  const waitHours = Math.ceil((tomorrow.getTime() - now.getTime()) / (1000 * 60 * 60));

  return `Cuota diaria de la API agotada. El límite se restablece al inicio del próximo día calendario UTC (en aproximadamente ${waitHours} horas). Para reducir el consumo: usa filtros más específicos (estado, región, fechas), evita consultas masivas, y usa 'ttl_cambio_ms' para sincronización incremental en vez de descargas completas. Si necesitas más cuota, contacta a ChileCompra.${detail}`;
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
