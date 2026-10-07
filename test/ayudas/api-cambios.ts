/**
 * Cliente falso para los tests del núcleo de vigilancia (T1.4 de la 2.9.0).
 *
 * Responde con el catálogo de lotes de scripts/qa/catalogo-cambios.mjs, pasa
 * cada respuesta por el normalizador real y lanza los mismos errores que el
 * cliente de verdad. No tiene el freno de 15 consultas por minuto: los tests
 * de la vigilancia hacen cientos.
 */
import type { BuscarParams, BuscarResponse } from '../../src/api/compra-agil-client.js';
import { normalizarListado } from '../../src/api/normalizar.js';
import { CompraAgilApiError } from '../../src/utils/error-handler.js';
// @ts-expect-error: módulo JavaScript sin tipos, compartido con la API simulada por HTTP.
import { crearCatalogoCambios, poblarLotes, marcaDeLote } from '../../scripts/qa/catalogo-cambios.mjs';

export interface CatalogoCambios {
  agregar(marcaMs: number, cantidad: number, opciones?: { region?: number; estado?: string; monto?: number; ofertas?: number; nombre?: string }): string[];
  mover(codigo: string, nuevaMarcaMs: number): void;
  fallarLote(marcaMs: number, veces?: number): void;
  buscar(params: Record<string, unknown>): { status: number; body: unknown };
  procesos(): Array<{ codigo: string }>;
  llamadas(): number;
  alBuscar(fn: (params: Record<string, unknown>, llamada: number) => void): void;
}

export const nuevoCatalogo = crearCatalogoCambios as () => CatalogoCambios;
export const poblar = poblarLotes as (c: CatalogoCambios, desdeMs: number, hastaMs: number, porLote: number | ((marcaMs: number) => number)) => void;
export const marca = marcaDeLote as (ms: number) => number;

export function clienteFalso(catalogo: CatalogoCambios): { buscar(p: BuscarParams): Promise<BuscarResponse> } {
  return {
    async buscar(params) {
      const { status, body } = catalogo.buscar(params as Record<string, unknown>);
      if (status !== 200) throw new CompraAgilApiError(status, [], `GET /v2/compra-agil (simulada)`);
      return normalizarListado((body as { payload: unknown }).payload);
    },
  };
}
