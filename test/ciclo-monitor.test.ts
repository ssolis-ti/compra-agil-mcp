import { describe, it, expect, vi } from 'vitest';
import type { CompraAgilItem } from '../src/api/compra-agil-client.js';
import { ejecutarCiclo, coincidenciaDeAlerta, MARGEN_CICLO_MINUTOS, type ConfigMonitor } from '../src/services/ciclo-monitor.js';

/**
 * El ciclo del daemon de monitoreo, separado del script (fase 1.6). Antes no
 * tenía ningún test: el daemon arrancaba un temporizador al cargarse.
 */

const AHORA = Date.parse('2026-10-06T18:42:00Z'); // 15:42 de Chile
const cfg: ConfigMonitor = { intervaloMinutos: 60, presupuestoMinimo: 5_000_000, palabrasClave: ['camión', 'aseo'] };

function item(over: Partial<CompraAgilItem> & { presupuesto?: number | null; ofertas?: number } = {}): CompraAgilItem {
  const { presupuesto = 6_900_000, ofertas = 0, ...resto } = over;
  return {
    codigo: '1-1-COT26',
    nombre: 'Arriendo de camion aljibe',
    estado: { codigo: 'publicada', glosa: 'Publicada' },
    convocatoria: {},
    documentos: [],
    fechas: { fecha_cierre: '2026-10-08 15:00' },
    montos: { moneda: 'CLP', monto_disponible_clp: presupuesto },
    institucion: { organismo_comprador: 'Municipalidad' },
    resumen: { total_ofertas_recibidas: ofertas },
    motivos: {},
    links: {},
    ...resto,
  };
}

describe('coincidenciaDeAlerta', () => {
  it('alerta un proceso publicado, sin ofertas, sobre el mínimo y con palabra clave (sin tildes)', () => {
    expect(coincidenciaDeAlerta(item(), cfg)).toBe('camión');
  });

  it('descarta lo que no cumple cada filtro', () => {
    expect(coincidenciaDeAlerta(item({ estado: { codigo: 'cerrada', glosa: 'Cerrada' } }), cfg)).toBeNull();
    expect(coincidenciaDeAlerta(item({ ofertas: 2 }), cfg)).toBeNull();
    expect(coincidenciaDeAlerta(item({ presupuesto: 1_000_000 }), cfg)).toBeNull();
    expect(coincidenciaDeAlerta(item({ presupuesto: null }), cfg)).toBeNull();
    expect(coincidenciaDeAlerta(item({ nombre: 'Compra de resmas' }), cfg)).toBeNull();
  });
});

describe('ejecutarCiclo', () => {
  it('pide la ventana del intervalo más el margen, en hora de Chile, y alerta una sola vez', async () => {
    const buscarTodo = vi.fn(async () => [item(), item({ codigo: '2-2-COT26', ofertas: 3 })]);
    const alertados = new Map<string, number>();

    const primero = await ejecutarCiclo({ buscarTodo } as never, cfg, alertados, AHORA);
    expect(buscarTodo).toHaveBeenCalledWith(expect.objectContaining({
      cambio_desde: `2026-10-06T${String(15 - 1).padStart(2, '0')}:${String(42 - MARGEN_CICLO_MINUTOS).padStart(2, '0')}:00Z`,
      estado: 'publicada',
      tamano_pagina: 10,
    }));
    expect(primero.revisados).toBe(2);
    expect(primero.alertas.map((a) => a.codigo)).toEqual(['1-1-COT26']);
    expect(primero.alertas[0].linea).toMatch(/Cierre: 2026-10-08 15:00 \(hora de Chile\)/);
    expect(primero.alertas[0].linea).toMatch(/Presupuesto: \$6\.900\.000 CLP/);
    expect(alertados.get('1-1-COT26')).toBe(AHORA);

    const segundo = await ejecutarCiclo({ buscarTodo } as never, cfg, alertados, AHORA + 60 * 60_000);
    expect(segundo.alertas).toEqual([]);
  });

  it('los errores de la API se propagan para que el daemon los informe', async () => {
    const buscarTodo = vi.fn(async () => { throw new Error('504'); });
    await expect(ejecutarCiclo({ buscarTodo } as never, cfg, new Map(), AHORA)).rejects.toThrow('504');
  });
});
