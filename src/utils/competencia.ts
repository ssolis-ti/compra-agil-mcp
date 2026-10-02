/**
 * Comparación de cotizantes de un proceso ya leído.
 *
 * No consulta la API y no declara un adjudicado. `proveedor_seleccionado`
 * se observó en 0 en toda la muestra; una cotización presente no es un ganador.
 */

import type { CompraAgilDetalle, ProveedorCotizando } from '../api/compra-agil-client.js';
import { esAdmisible, extraerMontoNeto } from './quotation.js';

export interface CotizanteComparado {
  rut: string;
  razon_social: string;
  es_empresa_menor_tamano: boolean;
  monto_total: number | null;
  valor_neto: number | null;
  impuesto: number | null;
  despacho: number | null;
  descripcion: string;
  admisible: boolean;
  justificacion_inadmisibilidad?: string;
}

export interface DatosCompetencia {
  codigo: string;
  nombre: string;
  organismo: string;
  region: string;
  estado: string;
  presupuesto_clp: number;
  moneda: string;
  cotizantes: CotizanteComparado[];
  spread: {
    cotizaciones: number;
    admisibles: number;
    inadmisibles: number;
    neto_minimo: number | null;
    neto_maximo: number | null;
    brecha_neto: number | null;
    brecha_porcentaje: number | null;
  };
  _nota: string;
}

const NOTA_COMPETENCIA =
  'La tabla ordena las cotizaciones por monto neto, de menor a mayor. No identifica un proveedor adjudicado: la API no publica quién ganó. Una cotización inadmisible permanece en la tabla, con su justificación.';

function resumir(prov: ProveedorCotizando): CotizanteComparado {
  const admisible = esAdmisible(prov);
  const fila: CotizanteComparado = {
    rut: prov.rut_proveedor,
    razon_social: prov.razon_social,
    es_empresa_menor_tamano: prov.es_emt,
    monto_total: prov.monto_total ?? null,
    valor_neto: prov.valor_neto ?? null,
    impuesto: prov.total_impuesto ?? null,
    despacho: prov.monto_despacho ?? null,
    descripcion: (prov.descripcion_cotizacion || prov.descripcion || '').trim(),
    admisible,
  };
  if (!admisible) {
    fila.justificacion_inadmisibilidad = String(prov.justificacion_inadmisibilidad).trim();
  }
  return fila;
}

function netoOrdenable(prov: ProveedorCotizando): number | null {
  return extraerMontoNeto(prov);
}

export function compararCotizantes(detalle: CompraAgilDetalle): DatosCompetencia {
  const origen = detalle.proveedores_cotizando ?? [];
  const pares = origen.map((prov) => ({ prov, fila: resumir(prov), neto: netoOrdenable(prov) }));
  pares.sort((a, b) => {
    if (a.neto === null && b.neto === null) return 0;
    if (a.neto === null) return 1;
    if (b.neto === null) return -1;
    return a.neto - b.neto;
  });

  const netos = pares.map((p) => p.neto).filter((n): n is number => n !== null);
  const minimo = netos.length > 0 ? netos[0] : null;
  const maximo = netos.length > 0 ? netos[netos.length - 1] : null;
  const brecha = minimo !== null && maximo !== null && netos.length >= 2 ? maximo - minimo : null;
  const porcentaje = brecha !== null && minimo !== null && minimo > 0
    ? Math.round((brecha / minimo) * 100)
    : null;

  const region = detalle.institucion?.nombre_region
    || (detalle.institucion?.region !== null && detalle.institucion?.region !== undefined
      ? `Región ${detalle.institucion.region}`
      : 'No especificada');

  return {
    codigo: detalle.codigo,
    nombre: detalle.nombre,
    organismo: detalle.institucion?.organismo_comprador || 'No especificado',
    region,
    estado: detalle.estado?.glosa || 'Desconocido',
    presupuesto_clp: detalle.presupuesto?.monto_disponible_clp || detalle.presupuesto?.monto_disponible || 0,
    moneda: detalle.presupuesto?.moneda || 'CLP',
    cotizantes: pares.map((p) => p.fila),
    spread: {
      cotizaciones: pares.length,
      admisibles: pares.filter((p) => p.fila.admisible).length,
      inadmisibles: pares.filter((p) => !p.fila.admisible).length,
      neto_minimo: minimo,
      neto_maximo: maximo,
      brecha_neto: brecha,
      brecha_porcentaje: porcentaje,
    },
    _nota: NOTA_COMPETENCIA,
  };
}
