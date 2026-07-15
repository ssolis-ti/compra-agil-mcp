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
import { RateLimiter } from '../utils/rate-limiter.js';

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

export class CompraAgilClient {
  private readonly baseUrl: string;
  private readonly ticket: string;
  private readonly rateLimiter: RateLimiter;

  constructor(ticket: string, baseUrl?: string) {
    this.ticket = ticket;
    this.baseUrl = baseUrl || 'https://api2.mercadopublico.cl';
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Realiza un GET autenticado a la API.
   */
  private async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    // Verificar rate limit diario antes de enviar
    const limitCheck = this.rateLimiter.checkLimit();
    if (limitCheck.limited) {
      throw new CompraAgilApiError(429, [{
        codigo: '429',
        mensaje: `Cuota diaria agotada. Se restablece en ${limitCheck.resetIn}.`,
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
    logger.debug(`API Request: GET ${sanitizedUrl.toString()}`);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'ticket': this.ticket,
      },
    });

    if (response.status === 429) {
      this.rateLimiter.markLimited();
    } else {
      this.rateLimiter.recordRequest();
    }

    const payload = await handleApiResponse(response);
    return payload as T;
  }

  /**
   * Buscar Compras Ágiles con filtros y paginación.
   */
  async buscar(params: BuscarParams): Promise<BuscarResponse> {
    const queryParams: Record<string, string | number | undefined> = {
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

    return this.request<BuscarResponse>('/v2/compra-agil', queryParams);
  }

  /**
   * Buscar todas las páginas de resultados (auto-paginación).
   * Útil cuando la IA necesita todos los resultados sin gestionar páginas.
   */
  async buscarTodo(params: BuscarParams, maxPages = 10): Promise<CompraAgilItem[]> {
    const allItems: CompraAgilItem[] = [];
    let currentPage = 1;

    while (currentPage <= maxPages) {
      const response = await this.buscar({
        ...params,
        tamano_pagina: params.tamano_pagina || 50,
        numero_pagina: currentPage,
      });

      allItems.push(...response.items);

      logger.debug(
        `Auto-paginación: página ${response.paginacion.numero_pagina}/${response.paginacion.total_paginas}`
      );

      if (currentPage >= response.paginacion.total_paginas) {
        break;
      }
      currentPage++;
    }

    return allItems;
  }

  /**
   * Obtener el detalle completo de una Compra Ágil específica.
   */
  async detalle(codigo: string): Promise<CompraAgilDetalle> {
    return this.request<CompraAgilDetalle>(`/v2/compra-agil/${encodeURIComponent(codigo)}`);
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

  /**
   * Obtener el detalle completo de una Orden de Compra (OC).
   * Admite tanto el ID numérico interno como el código alfanumérico.
   */
  async obtenerDetalleOC(idOC: string | number): Promise<OrdenCompraResponse> {
    return this.request<OrdenCompraResponse>('/servicios/v1/publico/OrdenCompra.json', {
      codigo: String(idOC),
    });
  }
}
