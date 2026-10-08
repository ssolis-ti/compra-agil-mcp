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
import type { Alerta } from '../avisos/mensaje.js';
import type { Criterios } from './criterios.js';

export interface AlertaGateway {
  alerta: Alerta;
  /** Lote en que se ofreció por última vez, y cuándo (epoch ms). */
  lote: string | null;
  ofrecida: number | null;
  confirmada: number | null;
}

export type CriteriosGuardados = Criterios & { cambiadoEn: string };

/**
 * Solo los criterios guardados en disco, sin cargar ni migrar el resto del
 * estado: la ronda los consulta antes de cada lote y antes de avisar.
 */
export function leerCriteriosGuardados(ruta: string): CriteriosGuardados | null {
  try {
    const crudo = JSON.parse(fs.readFileSync(ruta, 'utf8')) as { criterios?: Record<string, unknown> };
    const c = crudo?.criterios;
    return c && Array.isArray(c.palabras) && typeof c.cambiadoEn === 'string' && !Number.isNaN(Date.parse(c.cambiadoEn))
      ? (c as unknown as CriteriosGuardados) : null;
  } catch {
    return null;
  }
}

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
    /** Primera ronda (para la ceguera cuando nunca hubo un ciclo bueno). */
    inicio: string | null;
    cegueraAvisada: boolean;
    cegueraDesde: string | null;
    /** Día de Chile del último resumen enviado (R8.3). */
    ultimoResumen: string | null;
    /** Lo ocurrido desde el último resumen. */
    acumulado: Acumulado;
    /** Rondas seguidas sin entregar nada, por canal (R8.4). */
    fallosPorCanal: Record<string, number>;
    canalesCaidosAvisados: string[];
    /** 1 normal; ×2 por cada 429, hasta 8 (R8.5). */
    factorIntervalo: number;
    proximaRonda: string | null;
    ultimo429: string | null;
    /** Día UTC del último aviso de cuota. */
    cuotaAvisada: string | null;
  };
  /** Cola del modo gateway (fase 8): alertas por ofrecer y confirmar (R9). */
  alertas: Record<string, AlertaGateway>;
  /** Criterios fijados por `configurar_criterios`; null: los del entorno (R2.2). */
  criterios: CriteriosGuardados | null;
  /** Avisos por canal (fase 3, ADR 0022). */
  bandeja: Bandeja;
}

export interface Acumulado {
  revisados: number; alertas: number; lotesLeidos: number; lotesFallidos: number;
  incompletos: number; huecos: number; consultas: number;
  entregados: Record<string, number>; fallidos: Record<string, number>;
}

const acumuladoVacio = (): Acumulado => ({
  revisados: 0, alertas: 0, lotesLeidos: 0, lotesFallidos: 0, incompletos: 0, huecos: 0, consultas: 0, entregados: {}, fallidos: {},
});

export function estadoVacio(): EstadoVigilancia {
  return {
    version: 2, marca: null, leidos: [], pendientes: [], incompletos: [], huecos: [], alertados: {},
    salud: {
      ultimoCicloBueno: null, fallosSeguidos: 0, consultasPorDia: {}, inicio: null,
      cegueraAvisada: false, cegueraDesde: null, ultimoResumen: null, acumulado: acumuladoVacio(),
      fallosPorCanal: {}, canalesCaidosAvisados: [], factorIntervalo: 1, proximaRonda: null, ultimo429: null, cuotaAvisada: null,
    },
    alertas: {}, criterios: null, bandeja: {},
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
    const s = crudo.salud;
    for (const k of ['inicio', 'cegueraDesde', 'proximaRonda', 'ultimo429'] as const) if (esFecha(s[k])) e.salud[k] = s[k];
    for (const k of ['ultimoResumen', 'cuotaAvisada'] as const) if (typeof s[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s[k])) e.salud[k] = s[k];
    if (typeof s.cegueraAvisada === 'boolean') e.salud.cegueraAvisada = s.cegueraAvisada;
    if (esNumero(s.factorIntervalo) && s.factorIntervalo >= 1) e.salud.factorIntervalo = s.factorIntervalo;
    e.salud.fallosPorCanal = numeros(s.fallosPorCanal);
    if (Array.isArray(s.canalesCaidosAvisados)) e.salud.canalesCaidosAvisados = s.canalesCaidosAvisados.filter((c): c is string => typeof c === 'string');
    if (esObjeto(s.acumulado)) {
      const a = s.acumulado;
      for (const k of ['revisados', 'alertas', 'lotesLeidos', 'lotesFallidos', 'incompletos', 'huecos', 'consultas'] as const) {
        if (esNumero(a[k])) e.salud.acumulado[k] = a[k];
      }
      e.salud.acumulado.entregados = numeros(a.entregados);
      e.salud.acumulado.fallidos = numeros(a.fallidos);
    }
  }
  if (esObjeto(crudo.alertas)) {
    e.alertas = Object.fromEntries(Object.entries(crudo.alertas).filter(([, a]) =>
      esObjeto(a) && esObjeto(a.alerta) && typeof a.alerta.codigo === 'string' && esNumero(a.alerta.creada))) as Record<string, AlertaGateway>;
  }
  if (esObjeto(crudo.criterios) && Array.isArray(crudo.criterios.palabras) && esFecha(crudo.criterios.cambiadoEn)) {
    e.criterios = crudo.criterios as unknown as CriteriosGuardados;
  }
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
/**
 * Lo que otro proceso escribió mientras esta ronda trabajaba: una herramienta
 * del modo gateway pudo confirmar alertas o cambiar los criterios. Una ronda
 * carga el estado, pasa segundos en la red y lo guarda entero; sin esto,
 * borraría esos cambios.
 */
function mezclarConDisco(e: EstadoVigilancia, disco: EstadoVigilancia): void {
  for (const [id, d] of Object.entries(disco.alertas)) {
    const propia = e.alertas[id];
    if (!propia) continue;
    propia.confirmada ??= d.confirmada;
    if ((d.ofrecida ?? 0) > (propia.ofrecida ?? 0)) { propia.ofrecida = d.ofrecida; propia.lote = d.lote; }
  }
  if (disco.criterios && (!e.criterios || disco.criterios.cambiadoEn > e.criterios.cambiadoEn)) e.criterios = disco.criterios;
}

/** Poda y guarda, atómico y bajo candado, mezclando lo que otro proceso cambió. */
export function guardarEstado(ruta: string, e: EstadoVigilancia, ahoraMs: number): boolean {
  podarEstado(e, ahoraMs);
  return conBloqueo(ruta, () => {
    const enDisco = leerJsonSeguro(ruta);
    if (enDisco) mezclarConDisco(e, parsearEstado(enDisco));
    return escribirAtomico(ruta, JSON.stringify(e, null, 2));
  });
}

/**
 * Leer, cambiar y guardar en una sola sección bajo candado: para las
 * herramientas (confirmar, configurar), que cambian poco y no salen a la red.
 */
export function actualizarEstado<T>(ruta: string, rutaVieja: string, ahoraMs: number, fn: (e: EstadoVigilancia) => T): T {
  return conBloqueo(ruta, () => {
    const { estado } = cargarEstado(ruta, rutaVieja, ahoraMs);
    const r = fn(estado);
    podarEstado(estado, ahoraMs);
    escribirAtomico(ruta, JSON.stringify(estado, null, 2));
    return r;
  });
}
