/**
 * Un ciclo de vigilancia: lee los lotes nuevos de la API, uno por uno, y
 * devuelve las alertas (2.9.0; R1.1–R1.9; ADR 0021, diseño §4).
 *
 * - Un lote de hasta 10 publicadas se lee en una consulta, que no puede correrse.
 * - Uno de 11 a 100 se pagina y se comprueba al final (total y códigos). Si no
 *   cuadra, se relee una vez; si tampoco, se lee por región.
 * - Uno de más de 100 se lee por región. Lo que ni así cuadra queda como
 *   incompleto, a la vista.
 * - Un lote que falla queda pendiente y la marca no lo pasa. Los lotes
 *   siguientes se leen igual y no se repiten.
 *
 * No lee el entorno ni el reloj del sistema: el cliente, `ahora` y los
 * criterios llegan como parámetros (NF5). Modifica `estado`; guardarlo es
 * trabajo de quien llama.
 */

import type { BuscarParams, BuscarResponse, CompraAgilItem } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { safeError } from '../utils/redact.js';
import { TAMANO_PAGINA_SEGURO } from '../utils/paginacion.js';
import { coincidencia, type Criterios } from './criterios.js';
import type { EstadoVigilancia } from './estado.js';
import { PERIODO_LOTE_MS, lecturaConsistente, planificarLotes, ventanaDeLote, RECUPERACION_MS } from './lotes.js';

export interface DependenciasCiclo {
  api: { buscar(p: BuscarParams): Promise<BuscarResponse> };
  /** Instante UTC real (epoch ms): en producción, `ahora()` de utils/reloj.ts. */
  ahora: () => number;
  criterios: Criterios;
}

export interface LimitesCiclo {
  /** Instante (en la escala de `ahora`) a partir del cual no se empieza otro lote. */
  hastaMs?: number;
  maxConsultas?: number;
  recuperacionMs?: number;
}

export interface AlertaVigilancia { codigo: string; coincidencia: string; item: CompraAgilItem; cuando: number }

export interface ResultadoCiclo {
  alertas: AlertaVigilancia[];
  revisados: number;
  lotesLeidos: number;
  lotesFallidos: number;
  incompletosNuevos: number;
  relecturas: number;
  consultas: number;
  /** Quedaron lotes sin leer por tiempo o cuota del ciclo (R9.2). */
  parcial: boolean;
  /** La API respondió 429: el ciclo se detuvo para no seguir gastando. */
  cuotaAgotada: boolean;
  hueco: { desde: string; hasta: string } | null;
}

const MAX_PAGINAS = 10;
const REGIONES = Array.from({ length: 16 }, (_, i) => i + 1);
const iso = (ms: number) => new Date(ms).toISOString();

interface Lectura { items: Map<string, CompraAgilItem>; incompleto?: { total: number; leidos: number } }

export async function ejecutarCiclo(deps: DependenciasCiclo, estado: EstadoVigilancia, limites: LimitesCiclo = {}): Promise<ResultadoCiclo> {
  const r: ResultadoCiclo = {
    alertas: [], revisados: 0, lotesLeidos: 0, lotesFallidos: 0, incompletosNuevos: 0, relecturas: 0,
    consultas: 0, parcial: false, cuotaAgotada: false, hueco: null,
  };
  const buscar = (p: BuscarParams) => { r.consultas++; return deps.api.buscar(p); };

  /** Todas las páginas de una consulta de 11 a 100 resultados, con la comprobación final. */
  async function paginar(base: BuscarParams, primera: BuscarResponse): Promise<{ items: Map<string, CompraAgilItem>; consistente: boolean }> {
    const total = primera.paginacion.total_resultados;
    const items = new Map(primera.items.map((i) => [i.codigo, i]));
    const paginas = Math.min(Math.ceil(total / TAMANO_PAGINA_SEGURO), MAX_PAGINAS);
    for (let n = 2; n <= paginas; n++) for (const i of (await buscar({ ...base, numero_pagina: n })).items) items.set(i.codigo, i);
    const final = await buscar({ ...base, numero_pagina: 1 });
    for (const i of final.items) items.set(i.codigo, i);
    return { items, consistente: lecturaConsistente(total, final.paginacion.total_resultados, items.size) };
  }

  async function porRegion(base: BuscarParams, totalLote: number): Promise<Lectura> {
    const items = new Map<string, CompraAgilItem>();
    let completo = true;
    for (const region of REGIONES) {
      const q = { ...base, region: String(region) };
      const primera = await buscar({ ...q, numero_pagina: 1 });
      const total = primera.paginacion.total_resultados;
      if (total <= TAMANO_PAGINA_SEGURO) {
        for (const i of primera.items) items.set(i.codigo, i);
        continue;
      }
      const leida = await paginar(q, primera);
      for (const [c, i] of leida.items) items.set(c, i);
      if (!leida.consistente || total > MAX_PAGINAS * TAMANO_PAGINA_SEGURO) completo = false;
    }
    return completo ? { items } : { items, incompleto: { total: totalLote, leidos: items.size } };
  }

  async function leerLote(lote: number): Promise<Lectura> {
    const base: BuscarParams = { ...ventanaDeLote(lote), estado: 'publicada', tamano_pagina: TAMANO_PAGINA_SEGURO };
    const primera = await buscar({ ...base, numero_pagina: 1 });
    const total = primera.paginacion.total_resultados;
    if (total <= TAMANO_PAGINA_SEGURO) return { items: new Map(primera.items.map((i) => [i.codigo, i])) };
    if (total > MAX_PAGINAS * TAMANO_PAGINA_SEGURO) return porRegion(base, total);
    const leida = await paginar(base, primera);
    if (leida.consistente) return { items: leida.items };
    r.relecturas++;
    const otra = await paginar(base, await buscar({ ...base, numero_pagina: 1 }));
    for (const [c, i] of otra.items) leida.items.set(c, i);
    if (otra.consistente) return { items: leida.items };
    const regional = await porRegion(base, total);
    for (const [c, i] of leida.items) regional.items.set(c, i);
    return regional;
  }

  // ── Plan ─────────────────────────────────────────────────────────────
  const ahoraInicio = deps.ahora();
  const plan = planificarLotes(
    { marca: estado.marca ? Date.parse(estado.marca) : null, leidos: estado.leidos.map(Date.parse) },
    ahoraInicio,
    limites.recuperacionMs ?? RECUPERACION_MS,
  );
  if (plan.hueco) {
    r.hueco = { desde: iso(plan.hueco.desde), hasta: iso(plan.hueco.hasta) };
    estado.huecos.push({ ...r.hueco, registrado: ahoraInicio });
    estado.marca = iso(plan.hueco.hasta);
    estado.leidos = estado.leidos.filter((l) => Date.parse(l) > plan.hueco!.hasta);
    estado.pendientes = estado.pendientes.filter((p) => Date.parse(p.lote) > plan.hueco!.hasta);
  }
  if (estado.marca === null && plan.lotes.length > 0) estado.marca = iso(plan.lotes[0] - PERIODO_LOTE_MS);

  const leidos = new Set(estado.leidos.map(Date.parse));
  /** La marca avanza mientras el lote siguiente esté leído (R1.1). */
  const avanzarMarca = () => {
    let m = Date.parse(estado.marca!);
    while (leidos.has(m + PERIODO_LOTE_MS)) { m += PERIODO_LOTE_MS; leidos.delete(m); }
    estado.marca = iso(m);
  };

  // ── Lectura ──────────────────────────────────────────────────────────
  for (const lote of plan.lotes) {
    if ((limites.hastaMs !== undefined && deps.ahora() >= limites.hastaMs) ||
        (limites.maxConsultas !== undefined && r.consultas >= limites.maxConsultas)) {
      r.parcial = true;
      break;
    }
    let lectura: Lectura;
    try {
      lectura = await leerLote(lote);
    } catch (e) {
      r.lotesFallidos++;
      const previo = estado.pendientes.find((p) => p.lote === iso(lote));
      const ultimoError = safeError(e).slice(0, 200);
      if (previo) { previo.intentos++; previo.ultimoError = ultimoError; } else estado.pendientes.push({ lote: iso(lote), intentos: 1, ultimoError });
      if (e instanceof CompraAgilApiError && e.httpStatus === 429) { r.cuotaAgotada = true; break; }
      continue;
    }
    r.lotesLeidos++;
    estado.pendientes = estado.pendientes.filter((p) => p.lote !== iso(lote));
    if (lectura.incompleto) {
      r.incompletosNuevos++;
      estado.incompletos.push({ lote: iso(lote), ...lectura.incompleto, registrado: deps.ahora() });
    }
    leidos.add(lote);
    avanzarMarca();
    for (const item of lectura.items.values()) {
      r.revisados++;
      const palabra = coincidencia(item, deps.criterios);
      if (!palabra || item.codigo in estado.alertados) continue;
      const cuando = deps.ahora();
      estado.alertados[item.codigo] = cuando;
      r.alertas.push({ codigo: item.codigo, coincidencia: palabra, item, cuando });
    }
  }
  estado.leidos = [...leidos].sort((a, b) => a - b).map(iso);

  // ── Salud ────────────────────────────────────────────────────────────
  const dia = iso(ahoraInicio).slice(0, 10);
  estado.salud.consultasPorDia[dia] = (estado.salud.consultasPorDia[dia] ?? 0) + r.consultas;
  if (r.lotesFallidos === 0 && !r.cuotaAgotada) {
    estado.salud.ultimoCicloBueno = iso(deps.ahora());
    estado.salud.fallosSeguidos = 0;
  } else {
    estado.salud.fallosSeguidos++;
  }
  return r;
}
