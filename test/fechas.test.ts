import { describe, it, expect } from 'vitest';
import { parsearFechaApi, esFechaAmbigua, enHoraDeChile, NOTA_ZONA_HORARIA } from '../src/utils/fechas.js';
import { evaluarOportunidad } from '../src/tools/radar-oportunidades.js';
import type { CompraAgilItem } from '../src/api/compra-agil-client.js';

/**
 * La API mezcla dos formatos para el mismo instante: `fecha_cierre` viene como
 * "2026-09-11 12:00" (sin zona horaria) mientras que su hermano
 * `fecha_cierre_primer_llamado` trae "2026-09-11T12:00:00Z". Verificado en 8 de
 * 8 procesos: el valor es idéntico, solo uno declara su zona.
 *
 * El peligro no es solo la ambigüedad. Ante un string así, `new Date()` lo
 * interpreta en la zona DEL SERVIDOR: medido, el mismo dato daba 15:00Z
 * desplegado en Chile y 12:00Z en UTC. El radar calculaba `horas_restantes`
 * —y con ella hasta 30 puntos de urgencia— con tres horas de diferencia según
 * dónde corriera. Estos tests fijan que eso no vuelva a ocurrir.
 */

describe('parsearFechaApi — no depende de la zona del servidor', () => {
  it('interpreta como UTC el formato sin zona horaria', () => {
    expect(parsearFechaApi('2026-09-11 12:00')!.toISOString()).toBe('2026-09-11T12:00:00.000Z');
  });

  it('da el MISMO instante que `new Date()` solo si el servidor está en UTC', () => {
    // Esta es la diferencia que motiva el módulo: si coincidieran siempre, no
    // habría nada que arreglar.
    const nuestro = parsearFechaApi('2026-09-11 12:00')!.toISOString();
    const ingenuo = new Date('2026-09-11 12:00').toISOString();
    const servidorEnUTC = new Date().getTimezoneOffset() === 0;
    if (servidorEnUTC) expect(nuestro).toBe(ingenuo);
    else expect(nuestro).not.toBe(ingenuo);
  });

  it('acepta segundos opcionales', () => {
    expect(parsearFechaApi('2026-09-11 12:00:30')!.toISOString()).toBe('2026-09-11T12:00:30.000Z');
  });

  it('respeta la zona cuando el valor sí la declara', () => {
    expect(parsearFechaApi('2026-09-11T12:00:00Z')!.toISOString()).toBe('2026-09-11T12:00:00.000Z');
    expect(parsearFechaApi('2026-09-11T12:00:00-03:00')!.toISOString()).toBe('2026-09-11T15:00:00.000Z');
  });

  it('devuelve null ante ausencia o basura, para no confundirlo con medianoche', () => {
    expect(parsearFechaApi(null)).toBeNull();
    expect(parsearFechaApi(undefined)).toBeNull();
    expect(parsearFechaApi('')).toBeNull();
    expect(parsearFechaApi('no soy una fecha')).toBeNull();
  });
});

describe('esFechaAmbigua — distingue los dos formatos de la API', () => {
  it('marca como ambiguo el formato sin zona', () => {
    expect(esFechaAmbigua('2026-09-11 12:00')).toBe(true);
  });

  it('no marca los que declaran su zona', () => {
    expect(esFechaAmbigua('2026-09-11T12:00:00Z')).toBe(false);
    expect(esFechaAmbigua('2026-09-11T12:00:00-03:00')).toBe(false);
  });
});

describe('enHoraDeChile — evita que el usuario haga la resta', () => {
  it('convierte el cierre a hora local chilena', () => {
    // 12:00 UTC en septiembre son las 09:00 en Chile continental (UTC-3).
    expect(enHoraDeChile('2026-09-11 12:00')).toBe('2026-09-11 09:00');
  });

  it('cruza correctamente el cambio de día hacia atrás', () => {
    expect(enHoraDeChile('2026-09-11 01:00')).toBe('2026-09-10 22:00');
  });

  it('devuelve null si no hay fecha', () => {
    expect(enHoraDeChile(null)).toBeNull();
  });
});

describe('la nota advierte lo que hay que advertir', () => {
  it('menciona UTC, el desfase chileno y que hay que confirmar en la ficha', () => {
    expect(NOTA_ZONA_HORARIA).toMatch(/UTC/);
    expect(NOTA_ZONA_HORARIA).toMatch(/3 horas/);
    expect(NOTA_ZONA_HORARIA).toMatch(/ficha/i);
  });
});

// ─── El impacto real: la puntuación del radar ────────────────────────────

const AHORA = Date.parse('2026-09-11T06:00:00Z'); // 03:00 en Chile

function item(fechaCierre: string): CompraAgilItem {
  return {
    codigo: '1234-56-COT26',
    nombre: 'Compra de prueba',
    estado: { id_estado: 2, codigo: 'publicada', glosa: 'Publicada' },
    convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado' },
    documentos: [],
    fechas: {
      fecha_publicacion: '2026-09-10 09:00',
      fecha_cierre: fechaCierre,
      fecha_ultimo_cambio: '2026-09-10T09:00:00Z',
      fecha_cancelacion: null,
    },
    montos: { moneda: 'CLP', monto_disponible: 1_000_000, monto_disponible_clp: 1_000_000 },
    institucion: {
      organismo_comprador: 'ORGANISMO', rut: '60.000.000-0',
      unidad_compra: '', region: 13, nombre_region: 'RM',
    },
    resumen: { total_ofertas_recibidas: 0 },
    motivos: { motivo_cancelacion: null, motivo_desierta: null, motivo_seleccion: null },
    links: { detalle: '' },
  };
}

describe('radar — las horas restantes son las mismas en cualquier servidor', () => {
  it('calcula 6 horas para un cierre a las 12:00 UTC desde las 06:00 UTC', () => {
    const r = evaluarOportunidad(item('2026-09-11 12:00'), AHORA)!;
    expect(r.horas_restantes).toBe(6);
  });

  it('expone también el cierre en hora de Chile', () => {
    const r = evaluarOportunidad(item('2026-09-11 12:00'), AHORA)!;
    expect(r.fecha_cierre).toBe('2026-09-11 12:00');
    expect(r.fecha_cierre_hora_chile).toBe('2026-09-11 09:00');
  });

  it('el puntaje de urgencia no cambia por la zona del servidor', () => {
    // A 6 horas del cierre corresponden +20 pts ("cierre inminente", <12 h).
    // Con la interpretación ingenua en un servidor chileno serían 9 horas:
    // el mismo tramo aquí, pero la frontera de 4 y 12 h se cruzaría en otros
    // casos. Se fija el cálculo, que es lo que sostiene el puntaje.
    const r = evaluarOportunidad(item('2026-09-11 12:00'), AHORA)!;
    expect(r.factores_calificacion.join(' ')).toMatch(/menos de 12 horas/);
  });

  it('descarta un proceso ya cerrado según la interpretación UTC', () => {
    // 05:00 UTC ya pasó respecto de AHORA (06:00 UTC).
    expect(evaluarOportunidad(item('2026-09-11 05:00'), AHORA)).toBeNull();
  });

  it('un cierre sin fecha no se cuela como oportunidad vigente', () => {
    expect(evaluarOportunidad(item(''), AHORA)).toBeNull();
  });
});
