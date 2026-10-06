import { describe, it, expect, afterEach } from 'vitest';
import {
  parsearFechaApi, parsearFechaUsuario, enHoraDeChile, desfaseChileEn, NOTA_ZONA_HORARIA, conNotaHoraria,
  instanteDesdeParedDeChile, paredDeChile, aFormatoApi, ventanaUltimosMinutos,
} from '../src/utils/fechas.js';
import { cuerpoRecursoCompra } from '../src/resources/compras-template.js';
import { resumirCompraBusqueda } from '../src/tools/buscar-compras.js';
import { fechasDeDetalle } from '../src/tools/detalle-compra.js';
import { resumirCambio } from '../src/tools/monitorear-cambios.js';
import { evaluarOportunidad } from '../src/tools/radar-oportunidades.js';
import type { CompraAgilItem } from '../src/api/compra-agil-client.js';

/**
 * La API entrega hora de Chile continental (America/Santiago), aunque algunos
 * campos digan "Z": `fecha_cierre` llega como "2026-10-08 09:00" y
 * `fecha_ultimo_cambio` como "2026-10-06T15:05:00.583Z".
 *
 * Medido contra la API real el 6 de octubre de 2026, con el reloj verificado
 * contra el SHOA (docs/internals/qa/resultado-enjambre-api-real.md):
 * - 89 de 92 cierres caen en horario de oficina leídos como hora de Chile;
 * - a las 15:42 de Chile el cambio más reciente decía "15:40:00.903Z";
 * - el filtro `ttl_cambio_ms` de 60 min devolvía 0 en horario hábil.
 *
 * Hasta la 2.7.0 se leían como UTC: cada cierre se mostraba 3 h antes (4 en
 * invierno) y el radar ocultaba los que cerraban en las 3 h siguientes. Estos
 * tests fijan la lectura correcta y que no dependa de la zona del servidor.
 */

const TZ_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

describe('parsearFechaApi — el valor de la API es hora de Chile', () => {
  it('sin zona: hora de Chile (verano, UTC-3)', () => {
    expect(parsearFechaApi('2026-10-08 09:00')!.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });

  it('sin zona: hora de Chile (invierno, UTC-4)', () => {
    expect(parsearFechaApi('2026-07-15 09:00')!.toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });

  it('con "Z": también es hora de Chile; la Z de la API no es UTC', () => {
    expect(parsearFechaApi('2026-10-08T09:00:00Z')!.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });

  it('regresión medida: el último cambio visto a las 18:06 UTC era de hace ~1 minuto, no de hace 3 horas', () => {
    const cambio = parsearFechaApi('2026-10-06T15:05:00.583Z')!;
    const visto = Date.parse('2026-10-06T18:06:00Z');
    expect(cambio.toISOString()).toBe('2026-10-06T18:05:00.583Z');
    expect((visto - cambio.getTime()) / 60_000).toBeCloseTo(1, 0);
  });

  it('acepta segundos y milisegundos opcionales', () => {
    expect(parsearFechaApi('2026-10-08 09:00:30')!.toISOString()).toBe('2026-10-08T12:00:30.000Z');
    expect(parsearFechaApi('2026-10-06T15:40:00.903Z')!.toISOString()).toBe('2026-10-06T18:40:00.903Z');
  });

  it('un offset numérico explícito sí se respeta', () => {
    expect(parsearFechaApi('2026-09-11T12:00:00-03:00')!.toISOString()).toBe('2026-09-11T15:00:00.000Z');
    expect(parsearFechaApi('2026-09-11T12:00:00+00:00')!.toISOString()).toBe('2026-09-11T12:00:00.000Z');
  });

  it('devuelve null ante ausencia o basura, para no confundirlo con medianoche', () => {
    expect(parsearFechaApi(null)).toBeNull();
    expect(parsearFechaApi(undefined)).toBeNull();
    expect(parsearFechaApi('')).toBeNull();
    expect(parsearFechaApi('no soy una fecha')).toBeNull();
  });

  it('da el mismo instante en cualquier zona horaria del servidor', () => {
    const resultados = ['America/Santiago', 'UTC', 'Europe/Madrid', 'Asia/Tokyo'].map((tz) => {
      process.env.TZ = tz;
      return [parsearFechaApi('2026-10-08 09:00')!.toISOString(), parsearFechaApi('2026-07-15T09:00:00Z')!.toISOString()].join();
    });
    expect(new Set(resultados).size).toBe(1);
  });
});

describe('cambios de horario de Chile — sin saltos ni retrocesos', () => {
  it('el desfase sale de la fecha del valor: UTC-3 antes de abril y desde septiembre, UTC-4 entre medio', () => {
    expect(desfaseChileEn(parsearFechaApi('2026-04-01 12:00')!)).toBe('UTC-3');
    expect(desfaseChileEn(parsearFechaApi('2026-04-10 12:00')!)).toBe('UTC-4');
    expect(desfaseChileEn(parsearFechaApi('2026-09-01 12:00')!)).toBe('UTC-4');
    expect(desfaseChileEn(parsearFechaApi('2026-09-10 12:00')!)).toBe('UTC-3');
  });

  for (const [desde, hasta] of [['2026-04-03', '2026-04-07'], ['2026-09-04', '2026-09-08']] as const) {
    it(`hora por hora entre ${desde} y ${hasta}: toda hora se interpreta y el tiempo nunca retrocede`, () => {
      let anterior = -Infinity;
      const fin = Date.parse(`${hasta}T00:00:00Z`);
      for (let t = Date.parse(`${desde}T00:00:00Z`); t < fin; t += 3_600_000) {
        const pared = new Date(t).toISOString().slice(0, 16).replace('T', ' ');
        const d = parsearFechaApi(pared);
        expect(d, pared).not.toBeNull();
        expect(d!.getTime(), pared).toBeGreaterThanOrEqual(anterior);
        anterior = d!.getTime();
        // La ida y vuelta conserva la hora, salvo la hora que no existe en el salto
        // de septiembre, que se resuelve una hora adelante.
        const vuelta = paredDeChile(d!).slice(0, 16).replace('T', ' ');
        const diferencia = (Date.parse(vuelta.replace(' ', 'T') + 'Z') - t) / 3_600_000;
        expect([0, 1], `${pared} → ${vuelta}`).toContain(diferencia);
      }
    });
  }
});

describe('instanteDesdeParedDeChile y paredDeChile — ida y vuelta', () => {
  it('ida y vuelta en verano e invierno', () => {
    for (const [a, m, d, h] of [[2026, 1, 15, 13], [2026, 7, 15, 13], [2026, 10, 6, 15]]) {
      const i = instanteDesdeParedDeChile(a, m, d, h, 30);
      expect(paredDeChile(i)).toBe(`${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${h}:30:00`);
    }
  });
});

describe('parsearFechaUsuario — las fechas del usuario respetan su zona', () => {
  it('Z es UTC de verdad', () => {
    expect(parsearFechaUsuario('2026-10-06T12:00:00Z')!.toISOString()).toBe('2026-10-06T12:00:00.000Z');
  });

  it('un offset se respeta', () => {
    expect(parsearFechaUsuario('2026-10-06T09:00:00-03:00')!.toISOString()).toBe('2026-10-06T12:00:00.000Z');
  });

  it('sin zona se rechaza: no se adivina', () => {
    expect(parsearFechaUsuario('2026-10-06T09:00:00')).toBeNull();
    expect(parsearFechaUsuario('2026-10-06 09:00')).toBeNull();
  });
});

describe('aFormatoApi y ventanaUltimosMinutos — escribir como la API compara', () => {
  it('un instante se escribe como su hora de Chile con "Z"', () => {
    expect(aFormatoApi(new Date('2026-10-06T18:42:39Z'))).toBe('2026-10-06T15:42:39Z');
    expect(aFormatoApi(new Date('2026-07-15T16:00:00Z'))).toBe('2026-07-15T12:00:00Z');
  });

  it('la ida y vuelta API → instante → API conserva el texto', () => {
    expect(aFormatoApi(parsearFechaApi('2026-10-06T15:40:00Z')!)).toBe('2026-10-06T15:40:00Z');
  });

  it('últimos 60 minutos con 2 de margen hacia el futuro', () => {
    expect(ventanaUltimosMinutos(60, Date.parse('2026-10-06T18:42:39Z'))).toEqual({
      cambio_desde: '2026-10-06T14:42:39Z',
      cambio_hasta: '2026-10-06T15:44:39Z',
    });
  });
});

describe('enHoraDeChile — muestra el valor de la API, validado', () => {
  it('coincide con el texto de la API', () => {
    expect(enHoraDeChile('2026-10-08 09:00')).toBe('2026-10-08 09:00');
    expect(enHoraDeChile('2026-10-06T15:05:00.583Z')).toBe('2026-10-06 15:05');
  });

  it('un offset explícito sí se convierte', () => {
    expect(enHoraDeChile('2026-10-08T12:00:00+00:00')).toBe('2026-10-08 09:00');
  });

  it('devuelve null si no hay fecha', () => {
    expect(enHoraDeChile(null)).toBeNull();
  });
});

describe('desfaseChileEn', () => {
  it('octubre 2026 es horario de verano', () => {
    expect(desfaseChileEn(new Date('2026-10-02T15:00:00Z'))).toBe('UTC-3');
  });

  it('junio 2026 es horario de invierno', () => {
    expect(desfaseChileEn(new Date('2026-06-15T15:00:00Z'))).toBe('UTC-4');
  });
});

describe('la nota advierte lo que hay que advertir', () => {
  it('dice que es hora de Chile, que la Z no es UTC, desde cuándo y que se confirma en la ficha', () => {
    expect(NOTA_ZONA_HORARIA).toMatch(/hora de Chile/);
    expect(NOTA_ZONA_HORARIA).toMatch(/America\/Santiago/);
    expect(NOTA_ZONA_HORARIA).toMatch(/fecha_ultimo_cambio/);
    expect(NOTA_ZONA_HORARIA).toMatch(/"Z"/);
    expect(NOTA_ZONA_HORARIA).toMatch(/2\.7\.0/);
    expect(NOTA_ZONA_HORARIA).toMatch(/ficha/i);
  });

  it('ya no afirma que se interpretan como UTC', () => {
    expect(NOTA_ZONA_HORARIA).not.toMatch(/se interpretan como UTC/);
  });

  it('queda primera en el JSON, antes de las fechas', () => {
    const salida = conNotaHoraria({ fecha_cierre: '2026-09-11 12:00' });
    expect(Object.keys(salida)[0]).toBe('_nota_horaria');
    expect(salida._nota_horaria).toBe(NOTA_ZONA_HORARIA);
    expect(salida.fecha_cierre).toBe('2026-09-11 12:00');
  });
});

describe('recurso, búsqueda, detalle y monitoreo muestran la hora correcta', () => {
  it('el recurso de compra', () => {
    const cuerpo = cuerpoRecursoCompra({ fechas: { fecha_cierre: '2026-10-02 15:00' } } as never);
    expect(cuerpo._nota_horaria).toMatch(/ficha del proceso/);
    expect(cuerpo.cierre_hora_chile).toBe('2026-10-02 15:00');
  });

  it('el listado conserva el cierre crudo y su hora de Chile coincide', () => {
    const r = resumirCompraBusqueda(item('2026-09-11 12:00'));
    expect(r.fecha_cierre).toBe('2026-09-11 12:00');
    expect(r.fecha_cierre_hora_chile).toBe('2026-09-11 12:00');
  });

  it('el detalle: cierre, cierres de cada llamado y último cambio, todos en hora de Chile', () => {
    const base = item('2026-10-05 14:00');
    const r = fechasDeDetalle({
      fechas: base.fechas,
      convocatoria: {
        estado_convocatoria: 2,
        descripcion: 'Segundo llamado',
        fecha_cierre_primer_llamado: '2026-10-05T14:00:00Z',
        fecha_cierre_segundo_llamado: '2026-10-10T07:10:00Z',
      },
    });
    expect(r.cierre_hora_chile).toBe('2026-10-05 14:00');
    // La "Z" del primer llamado es la misma hora de Chile que el cierre sin zona.
    expect(r.cierre_primer_llamado_hora_chile).toBe('2026-10-05 14:00');
    expect(r.cierre_segundo_llamado_hora_chile).toBe('2026-10-10 07:10');
    expect(r.ultimo_cambio_hora_chile).toBe('2026-09-10 09:00');
  });

  it('el monitoreo trae el cierre y el último cambio en hora de Chile', () => {
    const r = resumirCambio(item('2026-09-11 12:00'));
    expect(r.fecha_cierre_hora_chile).toBe('2026-09-11 12:00');
    expect(r.ultimo_cambio).toBe('2026-09-10T09:00:00Z');
    expect(r.ultimo_cambio_hora_chile).toBe('2026-09-10 09:00');
  });
});

// ─── El impacto real: el radar ───────────────────────────────────────────

const AHORA = Date.parse('2026-09-11T09:00:00Z'); // 06:00 en Chile (UTC-3)

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

describe('radar — horas restantes en hora de Chile', () => {
  it('6 horas para un cierre a las 12:00 de Chile desde las 06:00 de Chile', () => {
    const r = evaluarOportunidad(item('2026-09-11 12:00'), AHORA)!;
    expect(r.horas_restantes).toBe(6);
    expect(r.fecha_cierre_hora_chile).toBe('2026-09-11 12:00');
  });

  it('regresión: un proceso que cierra en 2 horas ya NO se descarta como cerrado', () => {
    // Leído como UTC, "08:00" eran las 05:00 de Chile: ya pasado, y el radar lo ocultaba.
    const r = evaluarOportunidad(item('2026-09-11 08:00'), AHORA);
    expect(r).not.toBeNull();
    expect(r!.horas_restantes).toBe(2);
    expect(r!.factores_calificacion.join(' ')).toMatch(/menos de 4 horas/);
  });

  it('el texto de urgencia ya no habla de "lectura UTC"', () => {
    const r = evaluarOportunidad(item('2026-09-11 08:00'), AHORA)!;
    expect(r.factores_calificacion.join(' ')).not.toMatch(/UTC/);
  });

  it('descarta un proceso cuyo cierre ya pasó en hora de Chile', () => {
    expect(evaluarOportunidad(item('2026-09-11 05:59'), AHORA)).toBeNull();
  });

  it('un cierre sin fecha no se cuela como oportunidad vigente', () => {
    expect(evaluarOportunidad(item(''), AHORA)).toBeNull();
  });
});
