/**
 * Estado de la vigilancia, versión 2 (`.vigilancia.json`; diseño §3).
 *
 * Reemplaza a `.monitor-state.json` de la 2.8.0, que solo guardaba los códigos
 * ya alertados: la migración los conserva (NF6). Se escribe completo, de forma
 * atómica y bajo candado, porque lo tocan el daemon y el servidor MCP (R1.8).
 * Solo guarda datos públicos de los procesos y metadatos: nunca secretos.
 */

import fs from 'fs';
import { conBloqueo } from '../utils/bloqueo.js';
import { escribirAtomico, leerJsonSeguro } from '../utils/archivo-atomico.js';
import type { Bandeja } from '../avisos/bandeja.js';

export interface LotePendiente { lote: string; intentos: number; ultimoError?: string }
export interface LoteIncompleto { lote: string; total: number; leidos: number; registrado: number }
export interface Hueco { desde: string; hasta: string; registrado: number }

export interface EstadoVigilancia {
  version: 2;
  /** Instante UTC (ISO) del último lote leído completo, contiguo desde el principio. */
  marca: string | null;
  /** Lotes ya leídos después de la marca (hay uno pendiente antes que ellos). */
  leidos: string[];
  /** Lotes que fallaron; la marca no los pasa (R1.6). */
  pendientes: LotePendiente[];
  incompletos: LoteIncompleto[];
  huecos: Hueco[];
  /** Código → epoch ms de la alerta (deduplicación, R1.9). */
  alertados: Record<string, number>;
  salud: {
    ultimoCicloBueno: string | null;
    fallosSeguidos: number;
    /** Día UTC → consultas de la vigilancia. */
    consultasPorDia: Record<string, number>;
  };
  /** Fase 8 (alertas para el gateway). Se conserva tal cual. */
  alertas: Record<string, unknown>;
  /** Avisos por canal (fase 3, ADR 0022). */
  bandeja: Bandeja;
}

export function estadoVacio(): EstadoVigilancia {
  return {
    version: 2, marca: null, leidos: [], pendientes: [], incompletos: [], huecos: [], alertados: {},
    salud: { ultimoCicloBueno: null, fallosSeguidos: 0, consultasPorDia: {} },
    alertas: {}, bandeja: {},
  };
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const esFecha = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const esNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numeros = (v: unknown) => Object.fromEntries(Object.entries(esObjeto(v) ? v : {}).filter(([, n]) => esNumero(n))) as Record<string, number>;

/** Toma lo válido de un JSON cualquiera y descarta el resto, campo por campo. */
export function parsearEstado(crudo: unknown): EstadoVigilancia {
  const e = estadoVacio();
  if (!esObjeto(crudo)) return e;
  if (esFecha(crudo.marca)) e.marca = crudo.marca;
  if (Array.isArray(crudo.leidos)) e.leidos = crudo.leidos.filter(esFecha);
  if (Array.isArray(crudo.pendientes)) {
    e.pendientes = crudo.pendientes.filter((p): p is LotePendiente => esObjeto(p) && esFecha(p.lote) && esNumero(p.intentos));
  }
  if (Array.isArray(crudo.incompletos)) {
    e.incompletos = crudo.incompletos.filter((p): p is LoteIncompleto =>
      esObjeto(p) && esFecha(p.lote) && esNumero(p.total) && esNumero(p.leidos) && esNumero(p.registrado));
  }
  if (Array.isArray(crudo.huecos)) {
    e.huecos = crudo.huecos.filter((h): h is Hueco => esObjeto(h) && esFecha(h.desde) && esFecha(h.hasta) && esNumero(h.registrado));
  }
  e.alertados = numeros(crudo.alertados);
  if (esObjeto(crudo.salud)) {
    if (esFecha(crudo.salud.ultimoCicloBueno)) e.salud.ultimoCicloBueno = crudo.salud.ultimoCicloBueno;
    if (esNumero(crudo.salud.fallosSeguidos)) e.salud.fallosSeguidos = crudo.salud.fallosSeguidos;
    e.salud.consultasPorDia = numeros(crudo.salud.consultasPorDia);
  }
  if (esObjeto(crudo.alertas)) e.alertas = crudo.alertas;
  if (esObjeto(crudo.bandeja)) {
    // Un aviso ilegible se descarta: reintentarlo enviaría basura.
    e.bandeja = Object.fromEntries(Object.entries(crudo.bandeja).filter(([, a]) =>
      esObjeto(a) && typeof a.id === 'string' && ['telegram', 'webhook', 'correo'].includes(a.canal as string) &&
      ['pendiente', 'entregado', 'fallido'].includes(a.estado as string) && esObjeto(a.alerta) && typeof a.alerta.codigo === 'string' &&
      esNumero(a.intentos) && esNumero(a.proximoIntento) && esNumero(a.creado))) as Bandeja;
  }
  return e;
}

/** Los códigos alertados del `.monitor-state.json` de la 2.8.0 (sus dos formatos). */
function alertadosDeLa280(crudo: unknown, ahoraMs: number): Record<string, number> {
  if (!esObjeto(crudo)) return {};
  const alertados = numeros(crudo.alertados);
  if (Array.isArray(crudo.alerted)) {
    for (const codigo of crudo.alerted) if (typeof codigo === 'string' && !(codigo in alertados)) alertados[codigo] = ahoraMs;
  }
  return alertados;
}

/**
 * Carga el estado. Si no existe y hay un `.monitor-state.json` de la 2.8.0, lo
 * migra y lo renombra a `.migrado`. Nunca lanza: lo que no se pudo leer va en
 * `avisos`, para que la entrada lo informe.
 */
export function cargarEstado(ruta: string, rutaVieja: string, ahoraMs: number): { estado: EstadoVigilancia; avisos: string[] } {
  if (fs.existsSync(ruta)) {
    const crudo = leerJsonSeguro(ruta);
    if (crudo === null) {
      return { estado: estadoVacio(), avisos: [`No se pudo leer ${ruta}: se empieza con un estado vacío (la última hora).`] };
    }
    return { estado: parsearEstado(crudo), avisos: [] };
  }
  if (fs.existsSync(rutaVieja)) {
    const estado = estadoVacio();
    estado.alertados = alertadosDeLa280(leerJsonSeguro(rutaVieja), ahoraMs);
    try { fs.renameSync(rutaVieja, `${rutaVieja}.migrado`); } catch { /* se intentará en el próximo arranque */ }
    return { estado, avisos: [`Se migró ${rutaVieja} (${Object.keys(estado.alertados).length} procesos ya alertados).`] };
  }
  return { estado: estadoVacio(), avisos: [] };
}

const DIA = 24 * 3600_000;

/** Quita lo viejo para que el archivo no crezca para siempre. */
export function podarEstado(e: EstadoVigilancia, ahoraMs: number): void {
  e.alertados = Object.fromEntries(Object.entries(e.alertados).filter(([, t]) => t >= ahoraMs - 30 * DIA));
  const desdeDia = new Date(ahoraMs - 14 * DIA).toISOString().slice(0, 10);
  e.salud.consultasPorDia = Object.fromEntries(Object.entries(e.salud.consultasPorDia).filter(([d]) => d >= desdeDia));
  e.huecos = e.huecos.filter((h) => h.registrado >= ahoraMs - 7 * DIA);
  e.incompletos = e.incompletos.filter((i) => i.registrado >= ahoraMs - 7 * DIA);
}

/** Poda y guarda, atómico y bajo candado. Devuelve false si el disco no dejó. */
export function guardarEstado(ruta: string, e: EstadoVigilancia, ahoraMs: number): boolean {
  podarEstado(e, ahoraMs);
  return conBloqueo(ruta, () => escribirAtomico(ruta, JSON.stringify(e, null, 2)));
}
