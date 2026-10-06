/**
 * Normalización de las respuestas de la API en la frontera del cliente.
 *
 * ⚠ POR QUÉ EXISTE: las herramientas leen `item.montos.monto_disponible_clp`,
 *   `item.nombre.toLowerCase()` y similares dando por hecho la forma que
 *   documenta la guía. En la auditoría QA de octubre 2026, un listado con
 *   `montos: null` hizo caer `buscar_compras_agiles` con
 *   "Cannot read properties of null". Parchear ~150 accesos uno por uno no
 *   escala; garantizar la forma una sola vez, aquí, sí.
 *
 * Criterio: tolerante y sin inventar datos.
 * - Un sub-objeto ausente o nulo pasa a ser `{}`: sus campos quedan
 *   `undefined`/`null`, nunca un valor fabricado como 0 o "CLP".
 * - Una lista ausente pasa a `[]` y se descartan sus elementos que no son
 *   objetos.
 * - Solo los textos que el código trata con métodos de string (`nombre`,
 *   `codigo`, `estado.codigo`…) se vuelven `''` cuando faltan.
 * - Los campos que no se nombran aquí pasan intactos (`passthrough`): la API
 *   expone más de lo que la guía documenta y las herramientas lo usan.
 * - Solo se rechaza una respuesta cuya raíz no tiene arreglo: un payload que
 *   no es objeto, o un listado sin `items`.
 */

import { z } from 'zod';
import type { BuscarResponse, CompraAgilDetalle, OrdenCompraResponse } from './compra-agil-client.js';

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Sub-objeto que puede faltar: se garantiza `{}` y se conservan sus campos. */
function objeto<T extends z.ZodRawShape>(forma: T) {
  return z.preprocess((v) => (esObjeto(v) ? v : {}), z.object(forma).passthrough());
}

/** Lista que puede faltar: se garantiza `[]` y se descartan los no-objetos. */
function lista<T extends z.ZodTypeAny>(elemento: T) {
  return z.preprocess((v) => (Array.isArray(v) ? v.filter(esObjeto) : []), z.array(elemento));
}

/** Texto que el código manipula con métodos de string. */
const texto = z.preprocess((v) => (typeof v === 'string' ? v : v == null ? '' : String(v)), z.string());

/** Número de paginación: lo que no sea número finito cuenta como 0. */
const entero = z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0), z.number());

const estado = objeto({ codigo: texto, glosa: texto });

const comunes = {
  codigo: texto,
  nombre: texto,
  estado,
  convocatoria: objeto({}),
  documentos: lista(objeto({})),
  fechas: objeto({}),
  institucion: objeto({}),
  resumen: objeto({}),
  motivos: objeto({}),
};

const itemListado = objeto({
  ...comunes,
  montos: objeto({}),
  links: objeto({}),
});

const listado = z.object({
  items: z.array(z.unknown()).transform((v) => v.filter(esObjeto)).pipe(z.array(itemListado)),
  paginacion: objeto({
    total_paginas: entero,
    numero_pagina: entero,
    tamano_pagina: entero,
    total_resultados: entero,
  }),
}).passthrough();

const proveedor = objeto({
  rut_proveedor: texto,
  razon_social: texto,
  productos_cotizados: lista(objeto({})),
});

const detalle = objeto({
  ...comunes,
  entrega: objeto({}),
  presupuesto: objeto({ moneda: texto }),
  productos_solicitados: lista(objeto({ nombre: texto })),
  proveedores_cotizando: lista(proveedor),
  flags: objeto({}),
});

const ordenCompra = z.object({
  Listado: lista(objeto({ Items: objeto({ Listado: lista(objeto({})) }) })),
}).passthrough();

/** La forma raíz no se puede recuperar. El cliente lo convierte en error accionable. */
export class RespuestaInvalidaError extends Error {
  constructor(public readonly motivo: string) {
    super(motivo);
    this.name = 'RespuestaInvalidaError';
  }
}

function validar<T>(esquema: z.ZodTypeAny, valor: unknown, que: string): T {
  if (!esObjeto(valor)) throw new RespuestaInvalidaError(`${que}: la API no devolvió un objeto`);
  const r = esquema.safeParse(valor);
  if (!r.success) {
    const campo = r.error.issues[0]?.path.join('.') || 'raíz';
    throw new RespuestaInvalidaError(`${que}: forma inesperada en "${campo}"`);
  }
  return r.data as T;
}

export const normalizarListado = (v: unknown) => validar<BuscarResponse>(listado, v, 'listado');
export const normalizarDetalle = (v: unknown) => validar<CompraAgilDetalle>(detalle, v, 'detalle');
export const normalizarOrdenCompra = (v: unknown) => validar<OrdenCompraResponse>(ordenCompra, v, 'orden de compra');
