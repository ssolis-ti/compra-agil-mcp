import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ResponseCache } from '../src/utils/cache.js';

/**
 * La caché existe porque la cuota del ticket se agotaba en minutos: las tres
 * herramientas de análisis repiten la misma búsqueda y los mismos detalles
 * históricos, y no había ninguna reutilización.
 */

describe('ResponseCache.clave — identidad de una consulta', () => {
  it('el orden de los parámetros no cambia la clave', () => {
    const a = ResponseCache.clave('/v2/compra-agil', { q: 'pc', estado: 'desierta' });
    const b = ResponseCache.clave('/v2/compra-agil', { estado: 'desierta', q: 'pc' });
    expect(a).toBe(b);
  });

  it('parámetros distintos producen claves distintas', () => {
    const a = ResponseCache.clave('/v2/compra-agil', { q: 'pc' });
    const b = ResponseCache.clave('/v2/compra-agil', { q: 'sillas' });
    expect(a).not.toBe(b);
  });

  it('ignora vacíos, nulos e indefinidos', () => {
    const a = ResponseCache.clave('/x', { q: 'pc', region: undefined, estado: '' });
    expect(a).toBe('/x?q=pc');
  });

  it('🔒 EXCLUYE el ticket de la clave', () => {
    const clave = ResponseCache.clave('/servicios/v1/publico/OrdenCompra.json', {
      codigo: '123', ticket: 'SECRETO-NO-DEBE-APARECER',
    });
    expect(clave).not.toContain('SECRETO-NO-DEBE-APARECER');
    expect(clave).not.toContain('ticket');
  });
});

describe('ResponseCache — vigencia', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('devuelve lo guardado mientras esté vigente', () => {
    const c = new ResponseCache();
    c.guardar('k', { dato: 42 }, 60);
    expect(c.obtener('k')).toEqual({ dato: 42 });
  });

  it('deja de devolverlo una vez vencido', () => {
    const c = new ResponseCache();
    c.guardar('k', { dato: 42 }, 60);
    vi.advanceTimersByTime(61_000);
    expect(c.obtener('k')).toBeUndefined();
  });

  it('una clave desconocida no devuelve nada', () => {
    expect(new ResponseCache().obtener('jamas-guardada')).toBeUndefined();
  });

  it('un ttl de cero o negativo no guarda nada', () => {
    const c = new ResponseCache();
    c.guardar('k', 1, 0);
    expect(c.obtener('k')).toBeUndefined();
  });
});

describe('ResponseCache — límite de tamaño', () => {
  it('descarta las entradas más antiguas al superar el máximo', () => {
    const c = new ResponseCache({ maxEntradas: 3 });
    c.guardar('a', 1, 60);
    c.guardar('b', 2, 60);
    c.guardar('c', 3, 60);
    c.guardar('d', 4, 60);

    expect(c.obtener('a')).toBeUndefined();
    expect(c.obtener('d')).toBe(4);
    expect(c.estadisticas().entradas).toBeLessThanOrEqual(3);
  });
});

describe('ResponseCache — estadísticas de ahorro', () => {
  it('contabiliza aciertos y fallos', () => {
    const c = new ResponseCache();
    c.guardar('k', 1, 60);
    c.obtener('k');
    c.obtener('k');
    c.obtener('otra');

    const s = c.estadisticas();
    expect(s.aciertos).toBe(2);
    expect(s.fallos).toBe(1);
    expect(s.ahorroPorcentaje).toBe(67);
  });
});

describe('ResponseCache — persistencia entre reinicios', () => {
  const tmp = path.join(os.tmpdir(), `cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  afterEach(() => { try { fs.unlinkSync(tmp); } catch { /* no existía */ } });

  it('sin ruta no toca el disco (tests herméticos)', () => {
    const c = new ResponseCache();
    c.guardar('k', 1, 60);
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it('un proceso nuevo reutiliza lo guardado por el anterior', () => {
    new ResponseCache({ rutaEstado: tmp }).guardar('k', { dato: 'vale' }, 600);
    expect(new ResponseCache({ rutaEstado: tmp }).obtener('k')).toEqual({ dato: 'vale' });
  });

  it('no revive entradas ya vencidas al cargar', () => {
    const viejo = { k: { expira: Date.now() - 1000, valor: 'rancio' } };
    fs.writeFileSync(tmp, JSON.stringify(viejo), 'utf8');
    expect(new ResponseCache({ rutaEstado: tmp }).obtener('k')).toBeUndefined();
  });

  it('un archivo corrupto no impide arrancar', () => {
    fs.writeFileSync(tmp, 'no soy json', 'utf8');
    expect(() => new ResponseCache({ rutaEstado: tmp })).not.toThrow();
  });

  it('limpiar() vacía memoria y disco', () => {
    const c = new ResponseCache({ rutaEstado: tmp });
    c.guardar('k', 1, 600);
    c.limpiar();
    expect(new ResponseCache({ rutaEstado: tmp }).obtener('k')).toBeUndefined();
  });
});
