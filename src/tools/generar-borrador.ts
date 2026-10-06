import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient, CompraAgilDetalle } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { enHoraDeChile } from '../utils/fechas.js';
import { describirFallosDetalle } from '../utils/presupuesto.js';
import { extraerPrecioUnitario, percentil } from '../utils/quotation.js';
import { safeError } from '../utils/redact.js';

/** Precio de relleno cuando no se pudo estimar nada. Hay que advertirlo. */
export const PRECIO_PLACEHOLDER = 1000;

export interface EstimacionPrecio {
  precio: number;
  fuente: string;
  /** `false` ⇒ es el placeholder y el borrador debe advertirlo. */
  sugerido: boolean;
  /**
   * `true` solo cuando el monto lo calculó el servidor (mercado o presupuesto).
   * El precio que escribió el usuario no es una sugerencia automática.
   */
  automatico: boolean;
}

/** Presupuesto del comprador, mirando también el estimado. */
function presupuestoDelComprador(detalle: CompraAgilDetalle): number {
  const p = detalle.presupuesto;
  return p?.monto_disponible_clp || p?.monto_disponible || p?.presupuesto_estimado || 0;
}

/**
 * Decide el precio unitario del borrador, en orden de preferencia:
 *   1. el que ingresó el usuario,
 *   2. el percentil 25 de lo que cotizó el mercado en procesos similares,
 *   3. el presupuesto del comprador menos 10%, con el IVA ya incluido,
 *   4. un placeholder de $1.000, que se advierte explícitamente.
 *
 * ⚠ POR QUÉ EL PASO 3 VIVE FUERA DEL try: antes, la consulta de precios de
 *   mercado y el respaldo por presupuesto estaban dentro del mismo bloque, así
 *   que CUALQUIER fallo de la API durante la consulta —un 429 por cuota
 *   agotada, típicamente— saltaba también el respaldo y el borrador salía con
 *   $1.000, pese a que el presupuesto ya estaba en la mano desde el detalle y
 *   no requería ninguna llamada adicional. Detectado en auditoría: un llamado
 *   de $4.800.000 generó un borrador de $1.000 por este camino.
 */
export async function estimarPrecioUnitario(
  client: Pick<CompraAgilClient, 'buscar' | 'detalle' | 'detallesEnParalelo'>,
  detalle: CompraAgilDetalle,
  precioPersonalizado?: number
): Promise<EstimacionPrecio> {
  if (precioPersonalizado !== undefined && precioPersonalizado > 0) {
    return {
      precio: precioPersonalizado,
      fuente: 'Precio neto ingresado por el usuario',
      sugerido: true,
      automatico: false,
    };
  }

  const keyword = detalle.productos_solicitados?.[0]?.nombre || detalle.nombre || '';
  const precios: number[] = [];
  let fallosDetalle = 0;
  let intentosDetalle = 0;
  let textoFallos = '';

  if (keyword) {
    try {
      logger.info(`generar_borrador_cotizacion: Consultando precios cotizados por el mercado para "${keyword}"`);
      // Solo `desierta`: medido contra la API real, es el único estado que
      // publica cotizaciones (desierta 5/8 procesos con precios; cerrada 0/8).
      // `proveedor_seleccionado` devuelve 0 resultados.
      const busqueda = await client.buscar({
        q: keyword,
        estado: 'desierta',
        // Solo se examinan los primeros 5 resultados (ver el slice más abajo),
        // así que pedir 50 era desperdicio — y provocaba HTTP 504: medido en
        // producción, esta consulta con tamano_pagina=50 agota los ~30 s de la
        // pasarela. Se pide el mínimo que exige la API.
        tamano_pagina: 10,
        numero_pagina: 1,
      });

      // En paralelo y con concurrencia adaptativa: la API tarda 20-25 s por
      // detalle (medido en septiembre 2026), así que en serie estas cinco
      // consultas bastaban para pasarse del timeout de un cliente MCP. Un
      // histórico que falla llega como `null` y no invalida el resto.
      const detallados = await client.detallesEnParalelo(
        (busqueda.items || []).slice(0, 5).map((item) => item.codigo)
      );

      // Se cuentan los fallos: si todas las consultas de detalle se cayeron,
      // el precio no se estimó "porque no había comparables" sino porque la
      // API no respondió, y el borrador debe decirlo. Confundir ambas cosas
      // llevaría al proveedor a cotizar sobre una premisa falsa.
      fallosDetalle = detallados.filter((d) => d === null).length;
      intentosDetalle = detallados.length;
      const codigos = (busqueda.items || []).slice(0, 5).map((item) => item.codigo);
      textoFallos = describirFallosDetalle(codigos.filter((_, i) => detallados[i] === null), intentosDetalle).texto;

      for (const det of detallados) {
        if (!det) continue;
        // Se toman TODAS las cotizaciones, incluidas las inadmisibles: en los
        // procesos desiertos casi todas lo son (por eso quedaron desiertos), y
        // el precio ofertado sigue siendo señal de mercado. Filtrarlas dejaba
        // la muestra vacía. La API nunca marca un ganador, así que la
        // referencia es lo que ofertó la competencia.
        for (const prov of det.proveedores_cotizando ?? []) {
          const unitario = extraerPrecioUnitario(prov, keyword);
          if (unitario !== null) precios.push(unitario);
        }
      }
    } catch (err) {
      logger.warn(`generar_borrador_cotizacion: No se pudo consultar precios de mercado: ${safeError(err)}`);
    }
  }

  if (precios.length > 0) {
    precios.sort((a, b) => a - b);
    // Percentil 25 de lo cotizado: ubica la oferta en el cuarto más económico
    // sin regalar margen, y resiste valores atípicos mejor que un promedio.
    return {
      precio: percentil(precios, 25),
      fuente: `Sugerencia automática: percentil 25 de ${precios.length} precio(s) cotizado(s) por el mercado en procesos similares (NO son precios adjudicados: la API no los expone)`,
      sugerido: true,
      automatico: true,
    };
  }

  const presupuesto = presupuestoDelComprador(detalle);
  if (presupuesto > 0) {
    const cantidadTotal = detalle.productos_solicitados?.reduce((acc, p) => acc + p.cantidad, 0) || 1;
    // ⚠ E2 (enjambre contra la API real, 6-oct): antes el 90 % del presupuesto
    //   era el NETO, y con el IVA el total quedaba en el 107 %: el borrador
    //   proponía por defecto una oferta que no cabía ($552.874 frente a
    //   $516.267). La API no dice si el presupuesto incluye IVA, así que el
    //   total CON IVA queda en el 90 %: cabe en los dos casos.
    const base = 'presupuesto del comprador descontado 10%, IVA incluido (el total con IVA cabe aunque el presupuesto lo incluya)';
    return {
      precio: Math.floor((presupuesto * 0.9) / 1.19 / cantidadTotal),
      fuente: intentosDetalle > 0 && fallosDetalle === intentosDetalle
        ? `Sugerencia automática: ${base}. ⚠ NO se pudo consultar el mercado — ${textoFallos} Esto no significa que no existan comparables: reintenta más tarde para obtener un precio de mercado.`
        : `Sugerencia automática: ${base} (no se encontraron cotizaciones de mercado comparables${fallosDetalle > 0 ? `; además, ${textoFallos}` : ''})`,
      sugerido: true,
      automatico: true,
    };
  }

  return {
    precio: PRECIO_PLACEHOLDER,
    fuente: `Valor por defecto (placeholder de $${PRECIO_PLACEHOLDER.toLocaleString('es-CL')})`,
    sugerido: false,
    automatico: false,
  };
}

export interface ArgsBorradorCotizacion {
  codigo_compra: string;
  rut_proveedor?: string;
  razon_social?: string;
  precio_unitario_personalizado?: number;
  plazo_entrega_dias?: number;
  descripcion_propuesta?: string;
}

export interface BorradorCotizacion {
  _advertencia: string;
  _campos_a_revisar: string[];
  codigo_compra: string;
  nombre_compra: string;
  organismo_comprador: string;
  rut_proveedor: string;
  razon_social: string;
  es_emt: null;
  activo: true;
  _nota_campos_fijos: string;
  plazo_entrega_dias: number;
  valor_neto: number;
  porcentaje_impuesto: 19;
  nombre_impuesto: 'IVA';
  total_impuesto: number;
  monto_total: number;
  descripcion_cotizacion: string;
  productos_cotizados: Array<{
    codigo_producto: number | string;
    nombre_producto: string;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    monto_total_producto: number;
  }>;
  metadata_estimacion: {
    precio_unitario_utilizado: number;
    fuente_precio_unitario: string;
    precio_unitario_sugerido_automatico: boolean;
  };
  /**
   * El borrador frente a lo que el comprador puede pagar. `null` si el proceso
   * no informa presupuesto. La API no dice si el presupuesto incluye IVA, así
   * que se compara en neto y con IVA.
   */
  comparacion_presupuesto: {
    presupuesto_comprador: number;
    valor_neto_sobre_presupuesto: boolean;
    monto_total_sobre_presupuesto: boolean;
    precio_unitario_maximo_neto: number;
    precio_unitario_maximo_si_incluye_iva: number;
  } | null;
  fecha_cierre: string | null;
  fecha_cierre_hora_chile: string | null;
}

/**
 * Advierte cuando el borrador no cabe en el presupuesto del comprador.
 *
 * ⚠ En la simulación con agentes (6-oct) el borrador ofreció $9.148.113 con
 *   IVA frente a un presupuesto de $9.021.000, con `_campos_a_revisar: []`: la
 *   usuaria habría presentado una oferta sobre el máximo sin saberlo. En los
 *   procesos desiertos, «sobrepasa el monto máximo» es causa típica de
 *   inadmisibilidad.
 */
export function compararConPresupuesto(
  presupuesto: number,
  valorNeto: number,
  montoTotal: number,
  cantidadTotal: number,
): { comparacion: NonNullable<BorradorCotizacion['comparacion_presupuesto']>; advertencia: string | null } | null {
  if (!(presupuesto > 0) || !(cantidadTotal > 0)) return null;
  const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
  const maxNeto = Math.floor(presupuesto / cantidadTotal);
  const maxConIva = Math.floor(presupuesto / 1.19 / cantidadTotal);
  const comparacion = {
    presupuesto_comprador: presupuesto,
    valor_neto_sobre_presupuesto: valorNeto > presupuesto,
    monto_total_sobre_presupuesto: montoTotal > presupuesto,
    precio_unitario_maximo_neto: maxNeto,
    precio_unitario_maximo_si_incluye_iva: maxConIva,
  };
  let advertencia: string | null = null;
  if (valorNeto > presupuesto) {
    advertencia =
      `El valor neto (${pesos(valorNeto)}) supera el presupuesto del comprador (${pesos(presupuesto)}) en ${pesos(valorNeto - presupuesto)}. ` +
      `Una oferta sobre el monto disponible suele declararse inadmisible. Para caber, el precio unitario neto debe ser como máximo ${pesos(maxNeto)} ` +
      `(${pesos(maxConIva)} si el presupuesto incluye IVA).`;
  } else if (montoTotal > presupuesto) {
    advertencia =
      `El total con IVA (${pesos(montoTotal)}) supera el presupuesto del comprador (${pesos(presupuesto)}) en ${pesos(montoTotal - presupuesto)}; el neto sí cabe. ` +
      `La API no informa si el presupuesto incluye IVA: si lo incluye, la oferta quedaría sobre el máximo. ` +
      `Para caber con IVA, el precio unitario neto debe ser como máximo ${pesos(maxConIva)}. Confírmalo en la ficha del proceso.`;
  }
  return { comparacion, advertencia };
}

/**
 * Arma el borrador que devuelve `generar_borrador_cotizacion`.
 * La tool JSON y el informe HTML leen este objeto, así que no pueden divergir.
 */
export async function construirBorradorCotizacion(
  client: Pick<CompraAgilClient, 'buscar' | 'detalle' | 'detallesEnParalelo'>,
  args: ArgsBorradorCotizacion,
): Promise<BorradorCotizacion> {
  logger.info(`generar_borrador_cotizacion: Obteniendo detalle de la compra activa ${args.codigo_compra}`);
  const targetDetail = await client.detalle(args.codigo_compra);

  // Detectar qué campos son placeholders (no aportados por el usuario) para advertir en la salida.
  const advertencias: string[] = [];
  const rutProv = args.rut_proveedor || '76.000.000-0';
  const razonSocial = args.razon_social || 'Proveedor Demo SpA';
  if (!args.rut_proveedor) advertencias.push('rut_proveedor es un valor PLACEHOLDER; reemplázalo por el RUT real del proveedor antes de presentar.');
  if (!args.razon_social) advertencias.push('razon_social es un valor PLACEHOLDER; reemplázalo por la razón social real.');
  let plazoEntrega = args.plazo_entrega_dias;
  if (plazoEntrega === undefined) {
    plazoEntrega = targetDetail.entrega?.plazo_entrega_dias || 5;
  }

  const estimacion = await estimarPrecioUnitario(
    client,
    targetDetail,
    args.precio_unitario_personalizado
  );
  const suggestedPrice = estimacion.precio;
  const isPriceSuggested = estimacion.sugerido;
  const priceSource = estimacion.fuente;

  // Construir productos cotizados
  const productosCotizados = (targetDetail.productos_solicitados || []).map(prod => {
    const uPrice = suggestedPrice;
    const totalProd = prod.cantidad * uPrice;
    return {
      codigo_producto: prod.codigo_producto,
      nombre_producto: prod.nombre,
      descripcion: prod.descripcion || `Suministro de ${prod.nombre}`,
      cantidad: prod.cantidad,
      precio_unitario: uPrice,
      monto_total_producto: totalProd,
    };
  });

  // Totales de cotización
  const valorNeto = productosCotizados.reduce((acc, p) => acc + p.monto_total_producto, 0);
  const totalImpuesto = Math.round(valorNeto * 0.19); // 19% IVA en Chile
  const montoTotal = valorNeto + totalImpuesto;

  // Cover letter/carta de presentación comercial
  const userDesc = args.descripcion_propuesta || '';
  const coverLetter = `Estimados ${targetDetail.institucion?.organismo_comprador || 'Sres. Compradores'},\n\n` +
    `Junto con saludar, a través del presente documento presentamos este borrador de cotización para el proceso de Compra Ágil "${targetDetail.nombre}" (Código: ${targetDetail.codigo}). No ha sido enviado.\n\n` +
    `Detalles de nuestra propuesta:\n` +
    (userDesc ? `- ${userDesc}\n` : '') +
    `- Cumplimiento garantizado con todas las especificaciones y características solicitadas.\n` +
    `- Plazo de entrega: ${plazoEntrega} días corridos contados desde la recepción de la Orden de Compra.\n` +
    `- Validez de la oferta: 30 días corridos.\n\n` +
    `Agradecemos de antemano su consideración y nos mantenemos a su disposición para aclarar cualquier duda técnica o comercial.\n\n` +
    `Atentamente,\n` +
    `${razonSocial}\nRUT: ${rutProv}`;

  const cantidadTotal = productosCotizados.reduce((acc, p) => acc + (p.cantidad || 0), 0);
  const frentePresupuesto = compararConPresupuesto(presupuestoDelComprador(targetDetail), valorNeto, montoTotal, cantidadTotal);
  if (frentePresupuesto?.advertencia) advertencias.push(frentePresupuesto.advertencia);

  // ⚠ Enjambre contra la API real (6-oct): en 5796-33-COT26 la API listaba un
  //   solo producto («Toallas de papel» × 100) y el pedido real —jabón,
  //   lavaloza, desinfectante, papel higiénico— estaba en la descripción y en
  //   un adjunto .docx. El borrador cotizaba solo lo que la API lista, sin
  //   avisarlo. Los adjuntos no se pueden leer por la API (ver README).
  const adjuntos = targetDetail.documentos ?? [];
  if (adjuntos.length > 0) {
    const nombres = adjuntos.slice(0, 3).map((d) => `«${d.nombre}»`).join(', ') + (adjuntos.length > 3 ? '…' : '');
    advertencias.push(
      `El proceso tiene ${adjuntos.length} adjunto(s) (${nombres}). Este borrador cotiza solo los ${productosCotizados.length} producto(s) que lista la API; ` +
      `las especificaciones, y a veces productos adicionales, suelen estar en los adjuntos. Revísalos en la ficha antes de enviar: https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(targetDetail.codigo)}`,
    );
  }

  if (!isPriceSuggested) {
    advertencias.push(`precio_unitario es un valor por defecto ($${suggestedPrice.toLocaleString('es-CL')}); no se pudo estimar de mercado. Ingresa "precio_unitario_personalizado".`);
  }

  return {
    _advertencia: '⚠ BORRADOR AUTOGENERADO. Revisa y reemplaza los campos marcados como placeholder antes de presentar la cotización real. Este documento no ha sido enviado a Mercado Público.',
    _campos_a_revisar: advertencias,
    codigo_compra: targetDetail.codigo,
    nombre_compra: targetDetail.nombre,
    organismo_comprador: targetDetail.institucion?.organismo_comprador || 'No especificado',
    rut_proveedor: rutProv,
    razon_social: razonSocial,
    es_emt: null, // Desconocido: depende del Registro de Proveedores del RUT real, no se asume.
    activo: true,
    _nota_campos_fijos: 'activo queda en true y es_emt en null. No son un dictamen sobre el proveedor.',
    plazo_entrega_dias: plazoEntrega,
    valor_neto: valorNeto,
    porcentaje_impuesto: 19,
    nombre_impuesto: 'IVA',
    total_impuesto: totalImpuesto,
    monto_total: montoTotal,
    descripcion_cotizacion: coverLetter,
    productos_cotizados: productosCotizados,
    metadata_estimacion: {
      precio_unitario_utilizado: suggestedPrice,
      fuente_precio_unitario: priceSource,
      precio_unitario_sugerido_automatico: estimacion.automatico,
    },
    comparacion_presupuesto: frentePresupuesto?.comparacion ?? null,
    fecha_cierre: targetDetail.fechas?.fecha_cierre ?? null,
    fecha_cierre_hora_chile: enHoraDeChile(targetDetail.fechas?.fecha_cierre),
  };
}

const TOOL_NAME = 'generar_borrador_cotizacion';

const TOOL_DESCRIPTION = `Genera un borrador estructurado en formato JSON para presentar una cotización formal a un llamado de Compra Ágil activa.
Calcula automáticamente los valores netos, impuestos (19% IVA de Chile) y montos brutos, sugiriendo un precio unitario de mercado si no se ingresa uno personalizado.`;

const inputSchema = {
  codigo_compra: z.string().describe('Código de la Compra Ágil activa a cotizar (ej: "1057539-228-COT26").'),
  rut_proveedor: z.string().optional().describe('RUT del proveedor que realiza la cotización (ej: "76.123.456-7").'),
  razon_social: z.string().optional().describe('Razón social/Nombre de fantasía de la empresa (ej: "Mi Pyme SpA").'),
  precio_unitario_personalizado: z.number().optional().describe('Precio unitario neto personalizado para aplicar a los ítems. Si se omite, se buscará un precio estimado de mercado.'),
  plazo_entrega_dias: z.number().optional().describe('Plazo de entrega en días corridos/hábiles. Si se omite, se adopta el sugerido por el comprador o 5 días.'),
  descripcion_propuesta: z.string().optional().describe('Mensaje comercial o aclaraciones técnicas del proveedor para adjuntar a la propuesta.'),
};

export function registerGenerarBorrador(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Generar borrador de cotización",

      description: TOOL_DESCRIPTION,

      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: inputSchema,
    },
    async (args) => {
      try {
        const borradorCotizacion = await construirBorradorCotizacion(client, args);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(borradorCotizacion, null, 2),
          }],
        };

      } catch (error) {
        const message = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : `Error inesperado al generar borrador de cotización: ${safeError(error)}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
