/**
 * Cliente HTTP para la API REST de Compra Ágil v2 de Mercado Público.
 *
 * Centraliza autenticación, manejo de errores, rate limiting
 * y paginación automática.
 *
 * Usa fetch nativo de Node.js 22+ (sin dependencias externas).
 */

import { logger } from '../utils/logger.js';
import { handleApiResponse, CompraAgilApiError } from '../utils/error-handler.js';
import { RateLimiter, RUTA_ESTADO_POR_DEFECTO } from '../utils/rate-limiter.js';
import { ResponseCache } from '../utils/cache.js';
import { LimitadorConcurrencia } from '../utils/concurrencia.js';
import path from 'path';
import { registrarSecreto } from '../utils/redact.js';
import { TAMANO_PAGINA_SEGURO } from '../utils/paginacion.js';
import { normalizarDetalle, normalizarListado, normalizarOrdenCompra, RespuestaInvalidaError } from './normalizar.js';

// ─── Tipos ──────────────────────────────────────────────────────────

export interface BuscarParams {
  // Ventana de cambios (Grupo 1)
  ttl_cambio_ms?: number;
  cambio_desde?: string;
  cambio_hasta?: string;
  // Fecha de publicación (Grupo 2)
  publicado_desde?: string;
  publicado_hasta?: string;
  // Estado (Grupo 3)
  estado?: string;
  // Región (Grupo 4)
  region?: string;
  // Búsqueda (Grupo 5)
  id?: string;
  q?: string;
  // Paginación (Grupo 6)
  tamano_pagina?: number;
  numero_pagina?: number;
  // Orden (Grupo 7)
  ordenar_por?: string;
}

export interface Paginacion {
  total_paginas: number;
  numero_pagina: number;
  tamano_pagina: number;
  total_resultados: number;
}

export interface CompraAgilItem {
  codigo: string;
  nombre: string;
  estado: { id_estado: number; codigo: string; glosa: string };
  convocatoria: { estado_convocatoria: number; descripcion: string };
  documentos: Array<{ id: string; nombre: string }>;
  fechas: {
    fecha_publicacion: string;
    fecha_cierre: string;
    fecha_ultimo_cambio: string;
    fecha_cancelacion: string | null;
  };
  montos: {
    moneda: string;
    monto_disponible: number;
    monto_disponible_clp: number;
  };
  institucion: {
    organismo_comprador: string;
    rut: string;
    unidad_compra: string;
    region: number | null;
    nombre_region: string | null;
  };
  resumen: { total_ofertas_recibidas: number };
  motivos: {
    motivo_cancelacion: string | null;
    motivo_desierta: string | null;
    motivo_seleccion: string | null;
  };
  links: { detalle: string };
}

export interface BuscarResponse {
  items: CompraAgilItem[];
  paginacion: Paginacion;
}

export interface OrdenCompraDetalle {
  Codigo: string;
  Nombre: string;
  CodigoEstado: number;
  Estado: string;
  CodigoLicitacion: string | null;
  Descripcion: string | null;
  FechaCreacion: string;
  FechaAceptacion: string | null;
  MontoNeto: number;
  Impuestos: number;
  Total: number;
  Comprador: {
    NombreOrganismo: string;
    NombreUnidad: string;
    RegionUsuario: string;
  };
  Proveedor: {
    Nombre: string;
    Rut: string;
  };
  Items: {
    Listado: Array<{
      Producto: string;
      Cantidad: number;
      PrecioNeto: number;
      // La API legada de ChileCompra ha usado ambas variantes del nombre del campo.
      TotalLnea?: number;
      TotalLinea?: number;
    }>;
  };
}

export interface OrdenCompraResponse {
  Cantidad: number;
  Listado: OrdenCompraDetalle[];
}

export interface ProductoSolicitado {
  codigo_producto: number | string;
  nombre: string;
  descripcion: string | null;
  cantidad: number;
  unidad_medida: string;
}

export interface ProductoCotizado {
  codigo_producto: number | string;
  nombre_producto: string;
  descripcion: string | null;
  cantidad: number;
  precio_unitario: number | null;
  monto_total_producto: number | null;
}

export interface ProveedorCotizando {
  rut_proveedor: string;
  razon_social: string;
  es_emt: boolean;
  id_cotizacion?: number;
  codigo_empresa?: string;
  codigo_sucursal_empresa?: string;
  estado_cotizacion?: { id: number; glosa: string };
  estado_por_comprador?: string | null;
  activo?: boolean;
  fecha_creacion?: string;
  fecha_vigencia?: string | null;
  valor_neto?: number | null;
  total_impuesto?: number | null;
  monto_despacho?: number | null;
  monto_total?: number | null;
  nombre_impuesto?: string | null;
  porcentaje_impuesto?: number | null;
  descripcion_cotizacion?: string | null;
  descripcion?: string | null;
  justificacion_inadmisibilidad?: string | null;
  proveedor_seleccionado?: number | boolean;
  seleccion?: {
    proveedor_seleccionado: boolean;
    motivo_seleccion: string | null;
    criterio_seleccion: string | null;
  };
  productos_cotizados?: ProductoCotizado[];
}

export interface CompraAgilDetalle {
  codigo: string;
  nombre: string;
  descripcion: string;
  // Campo raíz — la API real expone id_orden_compra aquí directamente
  id_orden_compra?: number | null;
  estado: { id_estado: number; codigo: string; glosa: string };
  convocatoria: {
    estado_convocatoria: number;
    descripcion: string;
    fecha_cierre_primer_llamado: string | null;
    fecha_cierre_segundo_llamado: string | null;
  };
  fechas: {
    fecha_publicacion: string;
    fecha_cierre: string;
    fecha_ultimo_cambio: string;
    fecha_cancelacion: string | null;
  };
  entrega: {
    direccion_entrega: string;
    plazo_entrega_dias: number | null;
  };
  documentos: Array<{ id: string; nombre: string }>;
  presupuesto: {
    tipo_presupuesto: string;
    moneda: string;
    presupuesto_estimado: number | null;
    monto_disponible: number | null;
    monto_disponible_clp: number | null;
    valor_cambio_moneda: number | null;
    fecha_cambio_moneda: string | null;
  };
  // Sub-objeto opcional — puede no venir si la API lo omite
  orden_compra?: {
    id_orden_compra: number | null;
    id_oc: number | null;
    codigo_orden_compra: string | null;
    estado_orden_compra: string | null;
  };
  institucion: {
    organismo_comprador: string;
    rut: string;
    unidad_compra: string;
    region: number | null;
    nombre_region: string | null;
  };
  productos_solicitados: ProductoSolicitado[];
  proveedores_cotizando: ProveedorCotizando[];
  resumen: {
    multa_sancion: number | null;
    total_ofertas_recibidas: number;
    total_demandas: number;
  };
  motivos: {
    motivo_cancelacion: string | null;
    motivo_desierta: string | null;
  };
  flags: {
    considera_requisitos_medioambientales: boolean;
    considera_requisitos_impacto_social_economico: boolean;
  };
}

// ─── Cliente ────────────────────────────────────────────────────────

/** Archivo donde se reutilizan respuestas entre reinicios del servidor. */
export const RUTA_CACHE_POR_DEFECTO = path.resolve(process.cwd(), '.api-cache.json');

/**
 * Vigencia por tipo de consulta, en segundos.
 *
 * El detalle vive más que la búsqueda porque es lo que más se repite: las
 * herramientas de análisis piden el detalle de los mismos procesos históricos
 * una y otra vez, y un proceso ya cerrado o desierto no cambia. La búsqueda
 * caduca antes porque sí aparecen procesos nuevos durante el día.
 */
const TTL_DETALLE_SEG = 15 * 60;
const TTL_BUSQUEDA_SEG = 5 * 60;

/**
 * Tiempo máximo de una consulta a la API.
 *
 * ⚠ Sin esto una API que no responde dejaba la herramienta colgada para
 *   siempre: medido en la auditoría QA de octubre 2026, la llamada siguió
 *   abierta hasta que el cliente MCP se rindió a los 150 s.
 *
 *   35 s y no menos: la pasarela de Mercado Público corta a los ~30 s con un
 *   504 que el servidor ya sabe explicar, y hay consultas legítimas que tardan
 *   20-30 s. El límite solo debe cortar lo que la pasarela no cortó.
 */
export const TIMEOUT_POR_DEFECTO_MS = 35_000;

function timeoutDesdeEntorno(): number {
  const n = Number(process.env.COMPRA_AGIL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : TIMEOUT_POR_DEFECTO_MS;
}

/** Fallo de red antes de recibir respuesta: DNS, conexión rechazada o cortada. */
function esFalloDeRed(error: unknown): boolean {
  // undici (el fetch de Node) envuelve todo fallo de red en TypeError('fetch failed').
  const e = error as { message?: string; cause?: { code?: string } } | null;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i
    .test(`${e?.message ?? ''} ${e?.cause?.code ?? ''}`);
}

function esTimeout(error: unknown): boolean {
  const nombre = (error as { name?: string } | null)?.name;
  return nombre === 'TimeoutError' || nombre === 'AbortError';
}

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class CompraAgilClient {
  private readonly baseUrl: string;
  private readonly ticket: string;
  private readonly rateLimiter: RateLimiter;
  private readonly cache: ResponseCache;
  /**
   * Compartido por todas las herramientas: lo que una aprende sobre el estado
   * del servicio le sirve a la siguiente. Si `analizar_precios_mercado` acaba
   * de chocar con una tanda de 504, `auditar_compras_desiertas` no debería
   * volver a intentarlo con el paralelismo máximo.
   */
  private readonly concurrencia: LimitadorConcurrencia;
  private readonly timeoutMs: number;

  /**
   * @param opciones.persistir Rutas en disco para la cuota y la caché.
   *
   * ⚠ La persistencia es OPT-IN y por defecto está apagada: quien decide
   *   escribir en disco es el punto de entrada (`index.ts`, `monitor.ts`), no
   *   la librería. Si el cliente persistiera siempre, los tests compartirían
   *   el archivo real del proyecto y dejarían de ser herméticos —una entrada
   *   en caché de una corrida anterior hacía que `fetch` no se llamara y el
   *   test que vigila que el ticket viaje por header fallaba sin que hubiera
   *   nada roto—.
   * @param opciones.timeoutMs Corte de cada consulta. Por defecto
   *   `COMPRA_AGIL_TIMEOUT_MS` o `TIMEOUT_POR_DEFECTO_MS`.
   */
  constructor(
    ticket: string,
    baseUrl?: string,
    opciones: { persistir?: boolean; timeoutMs?: number } = {}
  ) {
    this.ticket = ticket;
    this.baseUrl = baseUrl || 'https://api2.mercadopublico.cl';
    const persistir = opciones.persistir === true;
    // Con persistencia: la cuota es del ticket y del día, no del proceso, así
    // que reiniciar el servidor no debe borrar la memoria de un 429.
    this.rateLimiter = new RateLimiter(15, persistir ? RUTA_ESTADO_POR_DEFECTO : null);
    this.cache = new ResponseCache({ rutaEstado: persistir ? RUTA_CACHE_POR_DEFECTO : null });
    this.concurrencia = new LimitadorConcurrencia({ maximo: 5 });
    this.timeoutMs = opciones.timeoutMs ?? timeoutDesdeEntorno();
    // El cliente se auto-protege: cualquier consumidor (servidor MCP, daemon,
    // scripts, tests) queda cubierto sin tener que acordarse de registrarlo.
    registrarSecreto(ticket);
  }

  /**
   * Realiza un GET autenticado a la API.
   */
  private async request<T>(
    path: string,
    params: Record<string, string | number | undefined> | undefined,
    normalizar: (payload: unknown) => T,
  ): Promise<T> {
    // Una respuesta vigente en caché ahorra la consulta entera: ni cuota, ni
    // espera, ni riesgo de 429. Se comprueba antes que el rate limit, para que
    // un ticket temporalmente limitado igual pueda servir lo ya conocido.
    // Se normaliza también al leer: el archivo pudo escribirlo una versión
    // anterior que guardaba la respuesta cruda.
    const claveCache = ResponseCache.clave(path, params);
    const enCache = this.cache.obtener<unknown>(claveCache);
    if (enCache !== undefined) {
      try {
        const valor = normalizar(enCache);
        logger.debug(`Caché: acierto para ${claveCache}`);
        return valor;
      } catch {
        // Una entrada vieja que ya no tiene la forma esperada se ignora.
      }
    }

    // Verificar rate limit diario antes de enviar
    const limitCheck = this.rateLimiter.checkLimit();
    if (limitCheck.limited) {
      throw new CompraAgilApiError(429, [{
        codigo: '429',
        mensaje: `Esta instalación ya vio un 429 y espera hasta ${limitCheck.resetIn}. Es un token bucket, no el saldo del ticket ni un bloqueo hasta el día siguiente.`,
        detalle: null,
      }]);
    }

    // Throttle proactivo: espaciar solicitudes bajo el máximo por minuto para no gatillar 429 por ráfagas
    await this.rateLimiter.throttle();

    // Construir URL con query params
    const base = path.startsWith('/servicios') ? 'https://api.mercadopublico.cl' : this.baseUrl;
    const url = new URL(path, base);
    if (path.startsWith('/servicios')) {
      url.searchParams.set('ticket', this.ticket);
    }
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const sanitizedUrl = new URL(url.toString());
    if (sanitizedUrl.searchParams.has('ticket')) {
      sanitizedUrl.searchParams.set('ticket', 'REDACTED');
    }
    const consulta = `GET ${sanitizedUrl.pathname}${sanitizedUrl.search}`;
    logger.debug(`API Request: GET ${sanitizedUrl.toString()}`);

    const response = await this.enviar(url.toString(), consulta);

    if (response.status === 429) {
      // La guía (§7) indica esperar lo que diga Retry-After; si no viene, el
      // limitador aplica su propia espera progresiva.
      const retryAfter = Number(response.headers?.get?.('retry-after'));
      this.rateLimiter.markLimited(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
    } else {
      this.rateLimiter.recordRequest();
    }

    let payload: T;
    try {
      payload = normalizar(await handleApiResponse(response));
    } catch (error) {
      if (error instanceof CompraAgilApiError) {
        throw new CompraAgilApiError(error.httpStatus, error.apiErrors, consulta, error.local);
      }
      if (error instanceof RespuestaInvalidaError) {
        throw new CompraAgilApiError(response.status, [], consulta, { causa: 'respuesta_invalida', motivo: error.motivo });
      }
      throw error;
    }

    // Solo se guardan respuestas exitosas y con forma válida: un error no debe
    // quedar congelado.
    const ttl = path.includes('/compra-agil/') ? TTL_DETALLE_SEG : TTL_BUSQUEDA_SEG;
    this.cache.guardar(claveCache, payload, ttl);

    return payload;
  }

  /**
   * Envía el GET con tiempo límite y UN reintento solo ante fallo de red.
   *
   * ⚠ No se reintenta un timeout ni un 5xx: la pasarela ya esperó ~30 s, y
   *   repetir llevaría la herramienta por sobre los 60 s que espera un cliente
   *   MCP, gastando cuota en una consulta que acaba de fallar por lenta. Un
   *   fallo de red (conexión cortada, DNS) es inmediato y suele ser
   *   transitorio, así que un segundo intento es barato.
   */
  private async enviar(url: string, consulta: string): Promise<Response> {
    for (let intento = 1; ; intento++) {
      try {
        return await fetch(url, {
          method: 'GET',
          headers: { 'ticket': this.ticket },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (esTimeout(error)) {
          // La consulta salió: la API pudo contarla contra la cuota.
          this.rateLimiter.recordRequest();
          throw new CompraAgilApiError(0, [], consulta, { causa: 'timeout', timeoutMs: this.timeoutMs });
        }
        if (!esFalloDeRed(error)) throw error;
        if (intento >= 2) {
          throw new CompraAgilApiError(0, [], consulta, { causa: 'red', origen: error });
        }
        logger.warn(`Fallo de red en ${consulta}; se reintenta una vez.`);
        // Espera con jitter para no sincronizar el reintento de varias tareas.
        await esperar(250 + Math.random() * 500);
        await this.rateLimiter.throttle();
      }
    }
  }

  /**
   * Pide varios detalles a la vez, con concurrencia adaptativa.
   *
   * Sustituye al `Promise.all(...map(...catch))` que cada herramienta de
   * análisis tenía por su cuenta. La diferencia no es solo quitar duplicación:
   * al pasar por un único limitador compartido, la saturación que detecta una
   * herramienta protege a las siguientes, y el paralelismo baja a mitad de
   * tanda si los primeros detalles ya vienen con 504.
   *
   * Devuelve un arreglo del mismo largo y orden que `codigos`, con `null` donde
   * la consulta falló — que es como las herramientas ya cuentan sus fallos para
   * distinguir "la API no respondió" de "no había datos".
   */
  async detallesEnParalelo(codigos: string[]): Promise<Array<CompraAgilDetalle | null>> {
    const resultados = await this.concurrencia.ejecutar(
      codigos.map((codigo) => () => this.detalle(codigo))
    );
    const fallidos = resultados.filter((r) => r === null).length;
    if (fallidos > 0) {
      logger.warn(
        `Detalles en paralelo: ${fallidos} de ${codigos.length} fallaron ` +
        `(concurrencia actual: ${this.concurrencia.limiteActual}).`
      );
    }
    return resultados;
  }

  /** Estado del limitador de concurrencia, para diagnóstico. */
  getConcurrenciaStats() {
    return this.concurrencia.estadisticas();
  }

  /**
   * Devuelve el detalle SOLO si ya está en caché; nunca sale a la red.
   *
   * Permite que una herramienta enriquezca su respuesta cuando el dato ya se
   * pagó, sin gastar cuota si no lo está. Lo usa `verificar_orden_compra`,
   * que de otro modo consumiría una consulta para responder algo que la API
   * estructuralmente no publica.
   */
  detalleEnCache(codigo: string): CompraAgilDetalle | undefined {
    const clave = ResponseCache.clave(`/v2/compra-agil/${encodeURIComponent(codigo)}`);
    const valor = this.cache.obtener<unknown>(clave);
    if (valor === undefined) return undefined;
    try {
      return normalizarDetalle(valor);
    } catch {
      return undefined;
    }
  }

  /** Estadísticas de reutilización de respuestas (cuánta cuota se ahorró). */
  getCacheStats() {
    return this.cache.estadisticas();
  }

  /** Descarta las respuestas guardadas y fuerza consultas frescas. */
  limpiarCache(): void {
    this.cache.limpiar();
  }

  /**
   * Buscar Compras Ágiles con filtros y paginación.
   */
  private paramsDeBusqueda(params: BuscarParams): Record<string, string | number | undefined> {
    return {
      ttl_cambio_ms: params.ttl_cambio_ms,
      cambio_desde: params.cambio_desde,
      cambio_hasta: params.cambio_hasta,
      publicado_desde: params.publicado_desde,
      publicado_hasta: params.publicado_hasta,
      estado: params.estado,
      region: params.region,
      id: params.id,
      q: params.q,
      tamano_pagina: params.tamano_pagina,
      numero_pagina: params.numero_pagina,
      ordenar_por: params.ordenar_por,
    };
  }

  async buscar(params: BuscarParams): Promise<BuscarResponse> {
    return this.request('/v2/compra-agil', this.paramsDeBusqueda(params), normalizarListado);
  }

  busquedaEnCache(params: BuscarParams): boolean {
    return this.cache.vigente(ResponseCache.clave('/v2/compra-agil', this.paramsDeBusqueda(params)));
  }

  /**
   * Buscar todas las páginas de resultados (auto-paginación).
   * Útil cuando la IA necesita todos los resultados sin gestionar páginas.
   */
  async buscarInformado(params: BuscarParams, maxPages = 10): Promise<{
    items: CompraAgilItem[];
    totalResultados: number;
    totalPaginas: number;
    paginasLeidas: number;
    paginasDesdeCache: number;
  }> {
    const allItems: CompraAgilItem[] = [];
    let currentPage = 1;
    let totalResultados = 0;
    let totalPaginas = 0;
    let paginasLeidas = 0;
    let paginasDesdeCache = 0;

    while (currentPage <= maxPages) {
      const pagina = {
        ...params,
        tamano_pagina: params.tamano_pagina || TAMANO_PAGINA_SEGURO,
        numero_pagina: currentPage,
      };
      if (this.busquedaEnCache(pagina)) paginasDesdeCache++;
      const response = await this.buscar(pagina);
      paginasLeidas++;

      allItems.push(...response.items);
      totalResultados = response.paginacion.total_resultados;
      totalPaginas = response.paginacion.total_paginas;

      logger.debug(
        `Auto-paginación: página ${response.paginacion.numero_pagina}/${response.paginacion.total_paginas}`
      );

      // El tope y el fin de resultados cortan aquí. Incrementar la página antes
      // de salir hacía que paginasLeidas contara una página que no se pidió.
      if (totalPaginas <= 0 || currentPage >= totalPaginas || currentPage >= maxPages) {
        break;
      }
      currentPage++;
    }

    return {
      items: allItems,
      totalResultados,
      totalPaginas,
      paginasLeidas,
      paginasDesdeCache,
    };
  }

  async buscarTodo(params: BuscarParams, maxPages = 10): Promise<CompraAgilItem[]> {
    return (await this.buscarInformado(params, maxPages)).items;
  }

  /**
   * Obtener el detalle completo de una Compra Ágil específica.
   */
  async detalle(codigo: string): Promise<CompraAgilDetalle> {
    return this.request(`/v2/compra-agil/${encodeURIComponent(codigo)}`, undefined, normalizarDetalle);
  }

  /**
   * Buscar cambios recientes en los últimos N milisegundos.
   */
  async cambiosRecientes(ttlMs: number, filtros?: Partial<BuscarParams>): Promise<BuscarResponse> {
    return this.buscar({
      ttl_cambio_ms: ttlMs,
      ...filtros,
    });
  }

  /**
   * Obtener estadísticas del rate limiter.
   */
  getRateLimitStats() {
    return this.rateLimiter.getStats();
  }

  /** HTTP del último fallo de la tanda de detalles en paralelo. Null si no hubo status. */
  ultimoHttpDeConcurrencia(): number | null {
    return this.concurrencia.ultimoHttpVisto;
  }

  /**
   * Obtener el detalle completo de una Orden de Compra (OC).
   * Admite tanto el ID numérico interno como el código alfanumérico.
   */
  async obtenerDetalleOC(idOC: string | number): Promise<OrdenCompraResponse> {
    return this.request('/servicios/v1/publico/OrdenCompra.json', {
      codigo: String(idOC),
    }, normalizarOrdenCompra);
  }
}
