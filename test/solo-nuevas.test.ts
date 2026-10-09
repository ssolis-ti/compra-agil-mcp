import { describe, it, expect } from 'vitest';
import type { CompraAgilItem } from '../src/api/compra-agil-client.js';
import { criteriosDesdeEntorno, esNueva } from '../src/vigilancia/criterios.js';
import { criteriosEfectivos } from '../src/vigilancia/gateway.js';
import { crearAlerta } from '../src/avisos/mensaje.js';
import { formatearTelegram } from '../src/avisos/formato/telegram.js';
import type { EstadoVigilancia } from '../src/vigilancia/estado.js';

/**
 * Solo compras nuevas (prueba real del 8-oct): la API entrega lo que cambió
 * en cada lote. De 22 avisos de Aysén, 6 eran procesos de días atrás que
 * pasaron a segundo llamado o recibieron ofertas (5254-466 publicada el 07-10,
 * 4066-416 el 05-10, 1691-1839 con 4 ofertas).
 */

// Lote de las 12:05 de Chile (15:05 UTC, horario de verano).
const LOTE = Date.parse('2026-10-08T15:05:00Z');

function item(over: { publicada?: string | null; llamado?: number; ofertas?: number } = {}): CompraAgilItem {
  const { publicada = '2026-10-08 12:03', llamado = 1, ofertas = 0 } = over;
  return {
    codigo: '1-1-COT26', nombre: 'Botiquín primeros auxilios',
    estado: { codigo: 'publicada', glosa: 'Publicada' },
    convocatoria: { estado_convocatoria: llamado }, documentos: [],
    fechas: { fecha_publicacion: publicada, fecha_cierre: '2026-10-09 16:00' },
    montos: { monto_disponible_clp: 400_000 },
    institucion: { organismo_comprador: 'Delegación', region: 11 },
    resumen: { total_ofertas_recibidas: ofertas }, motivos: {}, links: {},
  } as CompraAgilItem;
}

describe('esNueva', () => {
  it('publicada hoy: sí', () => {
    expect(esNueva(item(), LOTE)).toBe(true);
  });

  it('publicada hace 3 días y modificada hoy: no (4066-416)', () => {
    expect(esNueva(item({ publicada: '2026-10-05 21:53' }), LOTE)).toBe(false);
  });

  it('el borde es de 24 h antes del lote', () => {
    expect(esNueva(item({ publicada: '2026-10-07 12:06' }), LOTE)).toBe(true);
    expect(esNueva(item({ publicada: '2026-10-07 12:04' }), LOTE)).toBe(false);
  });

  it('segundo llamado sin ofertas: sí, aunque la publicación sea antigua (5254-466)', () => {
    expect(esNueva(item({ publicada: '2026-10-07 09:25', llamado: 2 }), LOTE)).toBe(true);
  });

  it('segundo llamado con ofertas: no (1691-1839)', () => {
    expect(esNueva(item({ publicada: '2026-10-07 09:04', llamado: 2, ofertas: 4 }), LOTE)).toBe(false);
  });

  it('sin fecha de publicación: se avisa (no se puede saber, y perder una nueva es peor)', () => {
    expect(esNueva(item({ publicada: null }), LOTE)).toBe(true);
  });
});

describe('criterio soloNuevas', () => {
  it('activado por defecto; MONITOR_SOLO_NUEVAS=false lo apaga', () => {
    expect(criteriosDesdeEntorno({}).soloNuevas).toBe(true);
    expect(criteriosDesdeEntorno({ MONITOR_SOLO_NUEVAS: 'false' }).soloNuevas).toBe(false);
  });

  it('criterios guardados antes de existir el campo lo leen activado', () => {
    const e = { criterios: { palabras: [], excluidas: [], regiones: [11], presupuestoMinimo: 0, soloSinOfertas: false, cambiadoEn: '2026-10-08T15:30:00.000Z' } } as unknown as EstadoVigilancia;
    expect(criteriosEfectivos(e, criteriosDesdeEntorno({})).soloNuevas).toBe(true);
  });
});

describe('aviso de segundo llamado', () => {
  it('Telegram lo marca, en el bloque completo y en la línea breve', () => {
    const a = crearAlerta(item({ publicada: '2026-10-07 09:25', llamado: 2 }), '(cualquier proceso)', LOTE);
    expect(a.segundoLlamado).toBe(true);
    const lote = { id: 'x', canal: 'telegram' as const, resumenDeSilencio: false,
      avisos: [{ id: '1', canal: 'telegram' as const, alerta: a, estado: 'pendiente' as const, intentos: 0, proximoIntento: 0, creado: LOTE }] };
    const [m] = formatearTelegram(lote, LOTE);
    expect(m).toContain('🔁 <b>Segundo llamado</b>');
    expect(m).toContain('🗓 Publicada: mié 07-10 09:25');
    const region = formatearTelegram({ ...lote, avisos: [{ ...lote.avisos[0], alerta: { ...a, nivel: 'region' as const } }] }, LOTE)[0];
    expect(region).toMatch(/1\. 🔁 <a /);
  });

  it('una compra de primer llamado no lo dice', () => {
    expect(crearAlerta(item(), 'x', LOTE).segundoLlamado).toBe(false);
  });
});

describe('el ciclo aplica soloNuevas (catálogo de lotes)', () => {
  it('de un lote con una nueva y una de hace 3 días que cambió, avisa solo la nueva; apagado, las dos', async () => {
    const { ejecutarCiclo } = await import('../src/vigilancia/ciclo.js');
    const { estadoVacio } = await import('../src/vigilancia/estado.js');
    const { aFormatoApi } = await import('../src/utils/fechas.js');
    const { nuevoCatalogo, clienteFalso } = await import('./ayudas/api-cambios.js');
    const T0 = Date.parse('2026-10-08T15:00:00Z');
    const pared = (utc: number) => Date.parse(aFormatoApi(new Date(utc)));
    const c = nuevoCatalogo();
    const [nueva] = c.agregar(pared(T0), 1);
    const [vieja] = c.agregar(pared(T0 - 3 * 24 * 3600_000), 1);
    c.mover(vieja, pared(T0));
    const base = { ...criteriosDesdeEntorno({ MONITOR_KEYWORDS: '' }), soloSinOfertas: false };
    const correr = async (soloNuevas: boolean) => {
      const estado = { ...estadoVacio(), marca: new Date(T0 - 5 * 60_000).toISOString() };
      const r = await ejecutarCiclo({ api: clienteFalso(c), ahora: () => T0 + 2 * 60_000, criterios: { ...base, soloNuevas } }, estado);
      return r.alertas.map((a) => a.codigo).sort();
    };
    expect(await correr(true)).toEqual([nueva]);
    expect(await correr(false)).toEqual([nueva, vieja].sort());
  });
});

describe('segundo llamado de un proceso ya avisado', () => {
  it('se avisa de nuevo al reabrirse (con 🔁), y no se repite después', async () => {
    const { ejecutarCiclo } = await import('../src/vigilancia/ciclo.js');
    const { estadoVacio } = await import('../src/vigilancia/estado.js');
    const { aFormatoApi } = await import('../src/utils/fechas.js');
    const { nuevoCatalogo, clienteFalso } = await import('./ayudas/api-cambios.js');
    const T0 = Date.parse('2026-10-08T15:00:00Z');
    const pared = (utc: number) => Date.parse(aFormatoApi(new Date(utc)));
    const c = nuevoCatalogo();
    const [codigo] = c.agregar(pared(T0), 1);
    const criterios = { ...criteriosDesdeEntorno({ MONITOR_KEYWORDS: '' }), soloSinOfertas: false };
    const estado = { ...estadoVacio(), marca: new Date(T0 - 5 * 60_000).toISOString() };
    const correr = (ahora: number) => ejecutarCiclo({ api: clienteFalso(c), ahora: () => ahora, criterios }, estado);
    expect((await correr(T0 + 2 * 60_000)).alertas.map((a) => a.codigo)).toEqual([codigo]);
    // Dos días después pasa a segundo llamado, sin ofertas.
    const p = c.procesos().find((x) => x.codigo === codigo) as unknown as { convocatoria: { estado_convocatoria: number } };
    p.convocatoria.estado_convocatoria = 2;
    const T2 = T0 + 2 * 24 * 3600_000;
    c.mover(codigo, pared(T2));
    estado.marca = new Date(T2 - 5 * 60_000).toISOString();
    expect((await correr(T2 + 2 * 60_000)).alertas.map((a) => a.codigo)).toEqual([codigo]);
    // Otro cambio en el mismo segundo llamado: ya avisado.
    c.mover(codigo, pared(T2 + 5 * 60_000));
    expect((await correr(T2 + 7 * 60_000)).alertas).toEqual([]);
  });
});
