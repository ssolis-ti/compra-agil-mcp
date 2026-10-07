import { describe, it, expect } from 'vitest';
import type { CompraAgilItem } from '../src/api/compra-agil-client.js';
import { coincidencia, criteriosDesdeEntorno, lineaDeAlerta, CRITERIOS_POR_DEFECTO, type Criterios } from '../src/vigilancia/criterios.js';

/**
 * Criterios de alerta de la vigilancia (T2.3 de la 2.9.0; R2.1, R2.3, R2.4).
 * Los casos de la 2.8.0 (test/ciclo-monitor.test.ts) siguen valiendo.
 */

const base: Criterios = { palabras: ['camión', 'aseo'], excluidas: [], regiones: [], presupuestoMinimo: 5_000_000, soloSinOfertas: true };

function item(over: Partial<CompraAgilItem> & { presupuesto?: number | null; ofertas?: number; region?: number } = {}): CompraAgilItem {
  const { presupuesto = 6_900_000, ofertas = 0, region = 13, ...resto } = over;
  return {
    codigo: '1-1-COT26',
    nombre: 'Arriendo de camion aljibe',
    estado: { codigo: 'publicada', glosa: 'Publicada' },
    convocatoria: {},
    documentos: [],
    fechas: { fecha_cierre: '2026-10-08 15:00' },
    montos: { moneda: 'CLP', monto_disponible_clp: presupuesto },
    institucion: { organismo_comprador: 'Municipalidad', region },
    resumen: { total_ofertas_recibidas: ofertas },
    motivos: {},
    links: {},
    ...resto,
  } as CompraAgilItem;
}

describe('coincidencia (casos de la 2.8.0)', () => {
  it('alerta un proceso publicado, sin ofertas, sobre el mínimo y con palabra clave (sin tildes)', () => {
    expect(coincidencia(item(), base)).toBe('camión');
  });

  it('descarta lo que no cumple cada filtro', () => {
    expect(coincidencia(item({ estado: { codigo: 'cerrada', glosa: 'Cerrada' } }), base)).toBeNull();
    expect(coincidencia(item({ ofertas: 2 }), base)).toBeNull();
    expect(coincidencia(item({ presupuesto: 1_000_000 }), base)).toBeNull();
    expect(coincidencia(item({ presupuesto: null }), base)).toBeNull();
    expect(coincidencia(item({ nombre: 'Compra de resmas' }), base)).toBeNull();
  });
});

describe('coincidencia (criterios nuevos de la 2.9.0)', () => {
  it('las palabras excluidas descartan aunque haya una palabra clave', () => {
    expect(coincidencia(item({ nombre: 'Arriendo de camión para aseo de playa' }), { ...base, excluidas: ['PLAYA'] })).toBeNull();
  });

  it('filtra por región cuando se piden regiones', () => {
    expect(coincidencia(item({ region: 5 }), { ...base, regiones: [13] })).toBeNull();
    expect(coincidencia(item({ region: 13 }), { ...base, regiones: [5, 13] })).toBe('camión');
  });

  it('con «solo sin ofertas» apagado, alerta aunque haya ofertas', () => {
    expect(coincidencia(item({ ofertas: 3 }), { ...base, soloSinOfertas: false })).toBe('camión');
  });

  it('sin palabras clave alerta todo lo que pase los demás filtros', () => {
    expect(coincidencia(item({ nombre: 'Lo que sea' }), { ...base, palabras: [] })).toBe('(cualquier proceso)');
  });

  it('con mínimo 0 no exige monto publicado; con mínimo > 0 sí', () => {
    expect(coincidencia(item({ presupuesto: null }), { ...base, presupuestoMinimo: 0 })).toBe('camión');
    expect(coincidencia(item({ presupuesto: null }), base)).toBeNull();
  });
});

describe('criteriosDesdeEntorno', () => {
  it('las variables de la 2.8.0 siguen funcionando (R2.4)', () => {
    const c = criteriosDesdeEntorno({ MONITOR_KEYWORDS: 'resmas, papel', MONITOR_MIN_BUDGET_CLP: '300000' });
    expect(c.palabras).toEqual(['resmas', 'papel']);
    expect(c.presupuestoMinimo).toBe(300_000);
  });

  it('las nuevas: exclusiones, regiones y solo sin ofertas', () => {
    const c = criteriosDesdeEntorno({ MONITOR_EXCLUIR: 'toner', MONITOR_REGIONES: '13, 5,99,x', MONITOR_SOLO_SIN_OFERTAS: 'false' });
    expect(c.excluidas).toEqual(['toner']);
    expect(c.regiones).toEqual([13, 5]);
    expect(c.soloSinOfertas).toBe(false);
  });

  it('el presupuesto mínimo por defecto es 0: el de $5.000.000 dejaba fuera el 84 % (R2.3)', () => {
    expect(criteriosDesdeEntorno({}).presupuestoMinimo).toBe(0);
    expect(CRITERIOS_POR_DEFECTO.presupuestoMinimo).toBe(0);
  });
});

describe('lineaDeAlerta', () => {
  it('declara la hora de Chile del cierre y el presupuesto', () => {
    const l = lineaDeAlerta(item(), 'camión', new Date('2026-10-06T18:42:00Z'));
    expect(l).toMatch(/Cierre: 2026-10-08 15:00 \(hora de Chile\)/);
    expect(l).toMatch(/Presupuesto: \$6\.900\.000 CLP/);
    expect(l).toMatch(/Coincidencia: "camión"/);
  });
});
