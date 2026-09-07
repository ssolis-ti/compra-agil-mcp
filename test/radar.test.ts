import { describe, it, expect } from 'vitest';
import { evaluarOportunidad } from '../src/tools/radar-oportunidades.js';
import type { CompraAgilItem } from '../src/api/compra-agil-client.js';

const NOW = new Date('2026-07-15T12:00:00Z').getTime();

function item(overrides: Partial<CompraAgilItem> = {}): CompraAgilItem {
  const base: CompraAgilItem = {
    codigo: '1234-56-COT26',
    nombre: 'Compra de prueba',
    estado: { id_estado: 1, codigo: 'publicada', glosa: 'Publicada' },
    convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado' },
    documentos: [],
    fechas: {
      fecha_publicacion: '2026-07-14T12:00:00Z',
      fecha_cierre: '2026-07-16T12:00:00Z', // 24h después de NOW
      fecha_ultimo_cambio: '2026-07-15T00:00:00Z',
      fecha_cancelacion: null,
    },
    montos: { moneda: 'CLP', monto_disponible: 1000000, monto_disponible_clp: 1000000 },
    institucion: { organismo_comprador: 'Municipalidad X', rut: '69.000.000-0', unidad_compra: 'Abastecimiento', region: 13, nombre_region: 'Metropolitana' },
    resumen: { total_ofertas_recibidas: 0 },
    motivos: { motivo_cancelacion: null, motivo_desierta: null, motivo_seleccion: null },
    links: { detalle: '/v2/compra-agil/1234-56-COT26' },
  };
  return { ...base, ...overrides };
}

describe('evaluarOportunidad', () => {
  it('omite procesos ya cerrados (horas restantes <= 0)', () => {
    const cerrado = item({ fechas: { ...item().fechas, fecha_cierre: '2026-07-14T00:00:00Z' } });
    expect(evaluarOportunidad(cerrado, NOW)).toBeNull();
  });

  it('omite procesos bajo el presupuesto mínimo', () => {
    expect(evaluarOportunidad(item({ montos: { moneda: 'CLP', monto_disponible: 100, monto_disponible_clp: 100 } }), NOW, 500000)).toBeNull();
  });

  it('da máxima puntuación a un proceso sin oferentes, urgente, alto presupuesto y sin docs', () => {
    const hot = item({
      resumen: { total_ofertas_recibidas: 0 },
      fechas: { ...item().fechas, fecha_cierre: '2026-07-15T14:00:00Z' }, // 2h → urgencia crítica
      montos: { moneda: 'CLP', monto_disponible: 6000000, monto_disponible_clp: 6000000 },
      documentos: [],
    });
    const r = evaluarOportunidad(hot, NOW)!;
    // 50 (sin oferentes) + 30 (urgencia) + 20 (presupuesto) + 5 (sin docs) = 105
    expect(r.puntuacion_caliente).toBe(105);
  });

  it('penaliza mayor competencia y presupuesto bajo', () => {
    const tibia = item({
      resumen: { total_ofertas_recibidas: 2 }, // +15
      fechas: { ...item().fechas, fecha_cierre: '2026-07-17T12:00:00Z' }, // 48h → 0 pts urgencia
      montos: { moneda: 'CLP', monto_disponible: 100000, monto_disponible_clp: 100000 }, // +5
      documentos: [{ id: 'a', nombre: 'bases.pdf' }], // 0
    });
    const r = evaluarOportunidad(tibia, NOW)!;
    // 15 + 0 + 5 + 0 = 20
    expect(r.puntuacion_caliente).toBe(20);
  });

  it('expone los factores de calificación de forma legible', () => {
    const r = evaluarOportunidad(item(), NOW)!;
    expect(r.factores_calificacion.length).toBeGreaterThan(0);
    expect(r.factores_calificacion.some((f) => f.includes('oferentes'))).toBe(true);
  });
});

/**
 * El segundo llamado era el único campo que la API entrega en cada respuesta y
 * que ninguna herramienta usaba. Importa porque cambia el significado del resto
 * de la señal: "0 oferentes" en un primer llamado puede ser sólo que se publicó
 * hace horas; en un segundo llamado significa que el mercado ya lo dejó pasar.
 */
describe('evaluarOportunidad — segundo llamado', () => {
  it('un primer llamado no suma puntos por este factor', () => {
    const r = evaluarOportunidad(item({
      convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado' },
    }), NOW)!;
    expect(r.llamado).toBe(1);
    expect(r.factores_calificacion.join(' ')).not.toMatch(/Segundo llamado/);
  });

  it('un segundo llamado suma 15 puntos sobre el mismo proceso', () => {
    const primero = evaluarOportunidad(item({
      convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado' },
    }), NOW)!;
    const segundo = evaluarOportunidad(item({
      convocatoria: { estado_convocatoria: 2, descripcion: 'Segundo llamado' },
    }), NOW)!;

    expect(segundo.puntuacion_caliente - primero.puntuacion_caliente).toBe(10);
    expect(segundo.llamado).toBe(2);
  });

  it('el factor advierte que conviene revisar por qué falló el primero', () => {
    const r = evaluarOportunidad(item({
      convocatoria: { estado_convocatoria: 2, descripcion: 'Segundo llamado' },
    }), NOW)!;
    const texto = r.factores_calificacion.find((f) => f.includes('Segundo llamado'))!;
    expect(texto).toMatch(/no logró adjudicar/i);
    expect(texto).toMatch(/averigua por qué falló/i);
  });

  it('si la convocatoria no viene, se asume primer llamado y no puntúa', () => {
    const r = evaluarOportunidad(item({ convocatoria: undefined as any }), NOW)!;
    expect(r.llamado).toBe(1);
    expect(r.factores_calificacion.join(' ')).not.toMatch(/Segundo llamado/);
  });

  it('un segundo llamado sin ofertas supera a un primero idéntico en el ranking', () => {
    const base = { resumen: { total_ofertas_recibidas: 0 } };
    const primero = evaluarOportunidad(item({
      ...base, convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado' },
    }), NOW)!;
    const segundo = evaluarOportunidad(item({
      ...base, convocatoria: { estado_convocatoria: 2, descripcion: 'Segundo llamado' },
    }), NOW)!;

    expect(segundo.puntuacion_caliente).toBeGreaterThan(primero.puntuacion_caliente);
  });
});
