/**
 * exportar_procesos (2.10.0, E1–E6; FALTA-001 de Hermes).
 *
 * Pagina la búsqueda por dentro y escribe el conjunto en un archivo. Al agente
 * le devuelve la ruta y agregados, no las filas.
 *
 * ⚠ Tiempo: una herramienta tiene 45 s y Hermes midió 154 s para 20 páginas.
 *   La exportación corre en segundo plano, identificada por sus filtros: la
 *   herramienta espera hasta 35 s y, si no terminó, responde con el avance.
 *   La misma llamada, repetida, entrega el resultado sin repetir consultas.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CompraAgilClient, CompraAgilItem, BuscarParams } from '../api/compra-agil-client.js';
import { esquemaBusqueda, resumirCompraBusqueda, tieneFiltroDeApi } from '../api/busqueda.js';
import { filtrarPorPalabras } from '../utils/palabras-clave.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { safeError } from '../utils/redact.js';
import { errorDeValidacion } from '../utils/validacion.js';
import { fueraDeLaHerramienta } from '../utils/presupuesto.js';
import { escribirAtomico } from '../utils/archivo-atomico.js';
import { aFormatoApi, conNotaHoraria, paredDeChile, parsearFechaApi } from '../utils/fechas.js';
import { ahora } from '../utils/reloj.js';
import { rutaDeDatos } from '../utils/rutas.js';
import { TAMANO_PAGINA_SEGURO } from '../utils/paginacion.js';
import { csvDeTabla, xlsxDeTabla, type Valor } from '../documentos/escribir.js';

const TOOL_NAME = 'exportar_procesos';

const TOOL_DESCRIPTION = `Exporta a un archivo (Excel, CSV o JSON) todas las Compras Ágiles de una búsqueda, no solo una página.
Usa los mismos filtros que buscar_compras_agiles. Devuelve la ruta del archivo y un resumen: cantidad, monto total, mediana y totales por organismo y por región.
Si tarda, sigue en segundo plano: vuelve a llamarla con los mismos filtros para obtener el resultado.
Si hay más páginas que el tope, la respuesta dice con qué publicado_hasta seguir.
Cada página son 10 procesos y una consulta a la API. max_paginas pone el tope (20 por defecto, 50 como máximo).`;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { tamano_pagina: _t, numero_pagina: _n, ...filtros } = esquemaBusqueda;

export const inputSchema = {
  ...filtros,
  formato: z.enum(['xlsx', 'csv', 'json']).default('xlsx').describe('xlsx (Excel, por defecto), csv o json.'),
  max_paginas: z.number().int().min(1).max(50).default(20).describe('Tope de páginas (10 procesos cada una). Por defecto 20, máximo 50.'),
};

export type Formato = 'xlsx' | 'csv' | 'json';
type Filtros = Omit<BuscarParams, 'tamano_pagina' | 'numero_pagina'> & {
  palabras_clave_requeridas?: string;
  palabras_clave_excluidas?: string;
};

export interface Avance { paginas_leidas: number; total_paginas: number | null }

export interface ResultadoExportacion {
  archivo: string;
  formato: Formato;
  filas: number;
  total_en_la_api: number;
  paginas_leidas: number;
  paginas_totales: number;
  consultas_api: number;
  truncado: boolean;
  parcial: boolean;
  falta_desde_pagina?: number;
  /** Si quedó truncado: el filtro para exportar lo anterior (orden por publicación). */
  siguiente_tramo?: { publicado_hasta: string };
  motivo_parcial?: string;
  descartados_por_palabras: number;
  agregados: ReturnType<typeof agregar>;
}

const COLUMNAS = [
  'codigo', 'nombre', 'estado', 'institucion', 'rut_organismo', 'region', 'presupuesto_clp', 'moneda',
  'fecha_publicacion_hora_chile', 'fecha_cierre_hora_chile', 'ofertas_recibidas', 'ficha',
] as const;

function fila(item: CompraAgilItem): Record<(typeof COLUMNAS)[number], Valor> {
  const r = resumirCompraBusqueda(item);
  return {
    codigo: r.codigo, nombre: r.nombre, estado: r.estado, institucion: r.institucion,
    rut_organismo: r.rut_organismo, region: r.region, presupuesto_clp: r.presupuesto_clp ?? null,
    moneda: r.moneda, fecha_publicacion_hora_chile: r.fecha_publicacion_hora_chile,
    fecha_cierre_hora_chile: r.fecha_cierre_hora_chile, ofertas_recibidas: r.ofertas_recibidas ?? null,
    ficha: `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(r.codigo)}`,
  };
}

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
}

function agruparPor(filas: Array<Record<string, Valor>>, campo: string, tope: number) {
  const g = new Map<string, { cantidad: number; monto_clp: number }>();
  for (const f of filas) {
    const k = String(f[campo] ?? 'Sin dato');
    const e = g.get(k) ?? { cantidad: 0, monto_clp: 0 };
    e.cantidad++;
    if (typeof f.presupuesto_clp === 'number') e.monto_clp += f.presupuesto_clp;
    g.set(k, e);
  }
  return [...g.entries()].sort((a, b) => b[1].cantidad - a[1].cantidad || b[1].monto_clp - a[1].monto_clp)
    .slice(0, tope).map(([nombre, v]) => ({ nombre, ...v }));
}

export function agregar(filas: Array<Record<string, Valor>>) {
  const montos = filas.map((f) => f.presupuesto_clp).filter((m): m is number => typeof m === 'number' && m > 0);
  return {
    cantidad: filas.length,
    con_presupuesto: montos.length,
    monto_total_clp: montos.reduce((a, b) => a + b, 0),
    mediana_clp: mediana(montos),
    por_organismo: agruparPor(filas, 'institucion', 10),
    por_region: agruparPor(filas, 'region', 16),
  };
}

function nombreArchivo(formato: Formato): string {
  const sello = paredDeChile(new Date(ahora())).replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `procesos-${sello}.${formato}`;
}

function escribir(ruta: string, contenido: string | Uint8Array): void {
  if (typeof contenido === 'string') {
    if (!escribirAtomico(ruta, contenido)) throw new Error(`no se pudo escribir ${ruta}`);
    return;
  }
  const temporal = `${ruta}.${process.pid}.tmp`;
  fs.writeFileSync(temporal, contenido);
  fs.renameSync(temporal, ruta);
}

/** Pagina, filtra y escribe. Si una página falla tras la primera, exporta lo leído (E4). */
export async function ejecutarExportacion(
  client: CompraAgilClient,
  f: Filtros,
  opciones: { formato: Formato; maxPaginas: number; carpeta?: string; alAvanzar?: (a: Avance) => void },
): Promise<ResultadoExportacion> {
  const items: CompraAgilItem[] = [];
  let totalPaginas = 0;
  let totalResultados = 0;
  let leidas = 0;
  let consultas = 0;
  let falla: { pagina: number; motivo: string } | undefined;

  for (let pagina = 1; pagina <= opciones.maxPaginas; pagina++) {
    const params: BuscarParams = {
      q: f.q, id: f.id, estado: f.estado, region: f.region,
      publicado_desde: f.publicado_desde, publicado_hasta: f.publicado_hasta,
      ordenar_por: f.ordenar_por ?? 'FechaPublicacion', tamano_pagina: TAMANO_PAGINA_SEGURO, numero_pagina: pagina,
    };
    try {
      if (!client.busquedaEnCache(params)) consultas++;
      const r = await client.buscar(params);
      leidas++;
      items.push(...r.items);
      totalPaginas = r.paginacion.total_paginas;
      totalResultados = r.paginacion.total_resultados;
      opciones.alAvanzar?.({ paginas_leidas: leidas, total_paginas: totalPaginas });
      if (totalPaginas <= 0 || pagina >= totalPaginas) break;
    } catch (error) {
      if (pagina === 1) throw error;
      falla = { pagina, motivo: error instanceof CompraAgilApiError ? error.actionableMessage : safeError(error) };
      break;
    }
  }

  const truncado = !falla && totalPaginas > leidas;
  const porPublicacion = (f.ordenar_por ?? 'FechaPublicacion') === 'FechaPublicacion';
  const masAntigua = Math.min(...items.map((i) => parsearFechaApi(i.fechas.fecha_publicacion)?.getTime() ?? Infinity));
  const { items: filtrados, descartados } = filtrarPorPalabras(items, f);
  const filas = filtrados.map(fila);
  const carpeta = opciones.carpeta ?? rutaDeDatos('exportaciones');
  fs.mkdirSync(carpeta, { recursive: true });
  const ruta = path.join(carpeta, nombreArchivo(opciones.formato));
  const tabla = filas.map((x) => COLUMNAS.map((c) => x[c]));
  escribir(ruta, opciones.formato === 'xlsx' ? xlsxDeTabla('Procesos', [...COLUMNAS], tabla)
    : opciones.formato === 'csv' ? csvDeTabla([...COLUMNAS], tabla)
      : JSON.stringify(filas, null, 2));

  return {
    archivo: ruta,
    formato: opciones.formato,
    filas: filas.length,
    total_en_la_api: totalResultados,
    paginas_leidas: leidas,
    paginas_totales: totalPaginas,
    consultas_api: consultas,
    truncado,
    parcial: !!falla,
    ...(falla ? { falta_desde_pagina: falla.pagina, motivo_parcial: falla.motivo } : {}),
    ...(truncado && porPublicacion && Number.isFinite(masAntigua) ? { siguiente_tramo: { publicado_hasta: aFormatoApi(new Date(masAntigua)) } } : {}),
    descartados_por_palabras: descartados,
    agregados: agregar(filas),
  };
}

interface Trabajo {
  avance: Avance;
  promesa: Promise<void>;
  resultado?: ResultadoExportacion;
  error?: string;
  terminado?: number;
}

const VIDA_TERMINADO_MS = 60 * 60_000;

function texto(datos: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(datos, null, 2) }], ...(isError ? { isError } : {}) };
}

export function registerExportar(
  server: McpServer,
  client: CompraAgilClient,
  opciones: { esperaMs?: number; carpeta?: string } = {},
): void {
  const trabajos = new Map<string, Trabajo>();
  const esperaMs = opciones.esperaMs ?? 35_000;

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Exportar procesos',
      description: TOOL_DESCRIPTION,
      annotations: { readOnlyHint: false, openWorldHint: true },
      inputSchema,
    },
    async (args) => {
      if (!tieneFiltroDeApi(args)) {
        return { content: [{ type: 'text' as const, text: errorDeValidacion('Indica al menos uno de estos filtros: estado, region, q, id, publicado_desde o publicado_hasta') }], isError: true };
      }
      if (args.q && args.id) {
        return { content: [{ type: 'text' as const, text: errorDeValidacion('"q" e "id" no se pueden usar juntos. Usa solo uno') }], isError: true };
      }

      for (const [k, t] of trabajos) if (t.terminado && ahora() - t.terminado > VIDA_TERMINADO_MS) trabajos.delete(k);

      const clave = JSON.stringify(Object.keys(args).sort().map((k) => [k, (args as Record<string, unknown>)[k]]));
      let trabajo = trabajos.get(clave);
      if (!trabajo) {
        const nuevo: Trabajo = { avance: { paginas_leidas: 0, total_paginas: null }, promesa: Promise.resolve() };
        nuevo.promesa = fueraDeLaHerramienta(() => ejecutarExportacion(client, args, {
          formato: args.formato, maxPaginas: args.max_paginas, carpeta: opciones.carpeta,
          alAvanzar: (a) => { nuevo.avance = a; },
        }).then(
          (r) => { nuevo.resultado = r; nuevo.terminado = ahora(); },
          (e) => {
            nuevo.error = e instanceof CompraAgilApiError ? e.actionableMessage : `Error inesperado: ${safeError(e)}`;
            trabajos.delete(clave); // un fallo no se guarda: la próxima llamada reintenta
          },
        ));
        trabajos.set(clave, nuevo);
        trabajo = nuevo;
      }

      let reloj: NodeJS.Timeout | undefined;
      await Promise.race([trabajo.promesa, new Promise<void>((r) => { reloj = setTimeout(r, esperaMs); reloj.unref?.(); })]);
      clearTimeout(reloj);

      if (trabajo.error) return { content: [{ type: 'text' as const, text: trabajo.error }], isError: true };
      if (!trabajo.resultado) {
        return texto({
          estado: 'en_curso',
          ...trabajo.avance,
          siguiente_paso: 'Sigue en segundo plano. Vuelve a llamar exportar_procesos con los mismos filtros para obtener el archivo.',
        });
      }
      const r = trabajo.resultado;
      return texto(conNotaHoraria({
        estado: 'listo',
        ...r,
        ...(r.truncado ? { _aviso_truncado: `La búsqueda tiene ${r.paginas_totales} páginas y se exportaron ${r.paginas_leidas}, las más recientes. ${r.siguiente_tramo ? `Para seguir con las anteriores, repite la llamada con publicado_hasta = ${r.siguiente_tramo.publicado_hasta}.` : 'Acota los filtros para exportar el resto.'}` } : {}),
        ...(r.parcial ? { _aviso_parcial: `Falló la página ${r.falta_desde_pagina}: el archivo tiene solo lo leído antes.` } : {}),
      }));
    },
  );
}
