import { describe, it, expect } from 'vitest';
import { estadoVacio, type EstadoVigilancia } from '../src/vigilancia/estado.js';
import { notificacionesPendientes, marcarNotificadas, registrarRonda, configSaludDesdeEntorno, proyeccionConsultasDia, type ConfigSalud } from '../src/vigilancia/salud.js';
import type { ResultadoCiclo } from '../src/vigilancia/ciclo.js';

/**
 * Salud de la vigilancia (T7.1–T7.4 de la 2.9.0; R8.1–R8.5). Funciones puras
 * sobre el estado: deciden qué avisar y cuándo; enviarlo es trabajo de la
 * ronda. Una notificación solo se marca como hecha si algún canal la entregó.
 */
const MIN = 60_000;
const HORA = 60 * MIN;
const T0 = Date.parse('2026-10-07T15:00:00Z'); // 12:00 de Chile
const cfg: ConfigSalud = { umbralCegueraMs: 120 * MIN, resumenHora: '08:00', presupuestoConsultasDia: 1500, canales: ['telegram', 'correo'], intervaloMs: 15 * MIN };

const ciclo = (over: Partial<ResultadoCiclo> = {}): ResultadoCiclo => ({
  alertas: [], revisados: 10, lotesLeidos: 3, lotesFallidos: 0, incompletosNuevos: 0, relecturas: 0,
  consultas: 3, parcial: false, cuotaAgotada: false, hueco: null, ...over,
});
const conBueno = (ms: number): EstadoVigilancia => {
  const e = estadoVacio();
  e.salud.ultimoCicloBueno = new Date(ms).toISOString();
  e.salud.ultimoResumen = '2026-10-07';
  return e;
};
const eventos = (e: EstadoVigilancia, ahora: number) => notificacionesPendientes(e, ahora, cfg).map((n) => n.evento);

describe('ceguera y recuperación (R8.1, R8.2)', () => {
  it('3 h sin un ciclo bueno: un solo aviso de ceguera, y uno de recuperación al volver', () => {
    const e = conBueno(T0);
    e.pendientes = [{ lote: new Date(T0 + 5 * MIN).toISOString(), intentos: 8, ultimoError: 'HTTP 504' }];
    e.salud.fallosSeguidos = 8;
    expect(eventos(e, T0 + 119 * MIN)).toEqual([]);
    const [ceguera] = notificacionesPendientes(e, T0 + 121 * MIN, cfg);
    expect(ceguera.evento).toBe('ceguera');
    expect(ceguera.lineas.join(' ')).toMatch(/12:00/);
    expect(ceguera.lineas.join(' ')).toMatch(/504/);
    marcarNotificadas(e, [ceguera.clave], T0 + 121 * MIN);
    expect(eventos(e, T0 + 150 * MIN)).toEqual([]);
    expect(eventos(e, T0 + 179 * MIN)).toEqual([]);
    // Vuelve: un ciclo bueno.
    registrarRonda(e, ciclo(), undefined, T0 + 180 * MIN, cfg);
    e.salud.ultimoCicloBueno = new Date(T0 + 180 * MIN).toISOString();
    e.salud.fallosSeguidos = 0;
    const [vuelta] = notificacionesPendientes(e, T0 + 180 * MIN, cfg);
    expect(vuelta.evento).toBe('recuperacion');
    marcarNotificadas(e, [vuelta.clave], T0 + 180 * MIN);
    expect(eventos(e, T0 + 200 * MIN)).toEqual([]);
  });

  it('atrasada sin fallos (rondas parciales): se avisa como ciega y no «vuelve» hasta una revisión completa', () => {
    const e = conBueno(T0);
    e.salud.fallosSeguidos = 0; // ninguna ronda falla: solo no alcanzan
    const [ceguera] = notificacionesPendientes(e, T0 + 121 * MIN, cfg);
    expect(ceguera.evento).toBe('ceguera');
    marcarNotificadas(e, [ceguera.clave], T0 + 121 * MIN);
    // Sigue atrasada: sin fallos, pero tampoco una revisión completa nueva.
    expect(eventos(e, T0 + 150 * MIN)).toEqual([]);
    e.salud.ultimoCicloBueno = new Date(T0 + 200 * MIN).toISOString();
    expect(eventos(e, T0 + 200 * MIN)).toEqual(['recuperacion']);
  });

  it('si ningún canal la entregó, la ceguera se vuelve a intentar en la ronda siguiente', () => {
    const e = conBueno(T0);
    e.salud.fallosSeguidos = 9;
    expect(eventos(e, T0 + 3 * HORA)).toEqual(['ceguera']);
    marcarNotificadas(e, [], T0 + 3 * HORA);
    expect(eventos(e, T0 + 3 * HORA + 15 * MIN)).toEqual(['ceguera']);
  });

  it('nunca hubo un ciclo bueno: cuenta desde la primera ronda', () => {
    const e = estadoVacio();
    e.salud.ultimoResumen = '2026-10-07';
    registrarRonda(e, ciclo({ lotesFallidos: 3, lotesLeidos: 0 }), undefined, T0, cfg);
    expect(eventos(e, T0 + 2 * HORA + MIN)).toEqual(['ceguera']);
  });
});

describe('resumen diario (R8.3)', () => {
  it('a las 08:00 de Chile, una vez por día, con lo acumulado desde el anterior', () => {
    const e = conBueno(T0);
    e.salud.ultimoResumen = '2026-10-07';
    registrarRonda(e, ciclo({ revisados: 40, alertas: [{} as never, {} as never], consultas: 12 }), { entregados: 2, fallidos: 0, reintentos: 0, porCanal: { telegram: { entregados: 2, fallidos: 0, reintentos: 0 } } }, T0, cfg);
    registrarRonda(e, ciclo({ revisados: 10, lotesFallidos: 1, consultas: 4 }), undefined, T0 + HORA, cfg);
    const antes = Date.parse('2026-10-08T10:59:00Z'); // 07:59 de Chile
    expect(eventos(e, antes).filter((x) => x === 'resumen')).toEqual([]);
    const ocho = Date.parse('2026-10-08T11:05:00Z'); // 08:05 de Chile
    const resumen = notificacionesPendientes(e, ocho, cfg).find((n) => n.evento === 'resumen')!;
    // En palabras del dueño (2.9.1): sin lotes, consultas ni jerga.
    expect(resumen.titulo).toBe('Resumen del día');
    expect(resumen.lineas.join('\n')).toMatch(/Revisó 50 compras y te avisó de 2\./);
    expect(resumen.lineas.join('\n')).not.toMatch(/lote|consulta|API/);
    expect(resumen.lineas.join('\n')).not.toMatch(/no llegaron/); // todo se entregó
    expect(resumen.lineas.join('\n')).toMatch(/la vigilancia está apagada/);
    marcarNotificadas(e, [resumen.clave], ocho);
    expect(eventos(e, Date.parse('2026-10-08T20:00:00Z')).filter((x) => x === 'resumen')).toEqual([]);
    expect(e.salud.acumulado.revisados).toBe(0);
  });

  it('el primer arranque no manda un resumen vacío: fija el día y espera al siguiente', () => {
    const e = estadoVacio();
    e.salud.ultimoCicloBueno = new Date(T0).toISOString();
    expect(eventos(e, T0)).not.toContain('resumen');
    expect(e.salud.ultimoResumen).toBe('2026-10-07');
  });

  it('respeta la hora de Chile en el cambio de horario de septiembre', () => {
    const e = conBueno(Date.parse('2026-09-06T10:00:00Z'));
    e.salud.ultimoResumen = '2026-09-05';
    // 6-sep: desde las 00:00 rige UTC-3. Las 08:00 de Chile son las 11:00Z.
    expect(eventos(e, Date.parse('2026-09-06T10:30:00Z'))).not.toContain('resumen'); // 07:30
    expect(eventos(e, Date.parse('2026-09-06T11:00:00Z'))).toContain('resumen'); // 08:00
  });
});

describe('fallo de un canal avisado por otro (R8.4)', () => {
  it('a los 3 fallos seguidos de Telegram, un aviso que excluye a Telegram; se rearma cuando vuelve', () => {
    const e = conBueno(T0);
    const fallo = { entregados: 0, fallidos: 0, reintentos: 1, porCanal: { telegram: { entregados: 0, fallidos: 0, reintentos: 1 }, correo: { entregados: 1, fallidos: 0, reintentos: 0 } } };
    for (let i = 0; i < 2; i++) registrarRonda(e, ciclo(), fallo, T0 + i * 15 * MIN, cfg);
    expect(eventos(e, T0 + 30 * MIN)).toEqual([]);
    registrarRonda(e, ciclo(), fallo, T0 + 30 * MIN, cfg);
    const [caido] = notificacionesPendientes(e, T0 + 30 * MIN, cfg);
    expect(caido).toMatchObject({ evento: 'canal_caido', excluirCanal: 'telegram' });
    marcarNotificadas(e, [caido.clave], T0 + 30 * MIN);
    registrarRonda(e, ciclo(), fallo, T0 + 45 * MIN, cfg);
    expect(eventos(e, T0 + 45 * MIN)).toEqual([]);
    registrarRonda(e, ciclo(), { entregados: 1, fallidos: 0, reintentos: 0, porCanal: { telegram: { entregados: 1, fallidos: 0, reintentos: 0 } } }, T0 + HORA, cfg);
    expect(e.salud.fallosPorCanal.telegram).toBe(0);
    expect(e.salud.canalesCaidosAvisados).toEqual([]);
  });
});

describe('cuota (R8.5)', () => {
  it('un 429 duplica el intervalo (hasta 8×), fija la próxima ronda y avisa una vez al día', () => {
    const e = conBueno(T0);
    registrarRonda(e, ciclo({ cuotaAgotada: true }), undefined, T0, cfg);
    expect(e.salud.factorIntervalo).toBe(2);
    expect(e.salud.proximaRonda).toBe(new Date(T0 + 30 * MIN).toISOString());
    const avisos = notificacionesPendientes(e, T0, cfg).filter((n) => n.evento === 'cuota');
    expect(avisos).toHaveLength(1);
    marcarNotificadas(e, avisos.map((n) => n.clave), T0);
    for (let i = 0; i < 5; i++) registrarRonda(e, ciclo({ cuotaAgotada: true }), undefined, T0 + i * HORA, cfg);
    expect(e.salud.factorIntervalo).toBe(8);
    expect(eventos(e, T0 + 5 * HORA)).not.toContain('cuota');
  });

  it('sin 429 y con la proyección holgada, el intervalo vuelve a la normalidad de a poco', () => {
    const e = conBueno(T0);
    e.salud.factorIntervalo = 4;
    registrarRonda(e, ciclo(), undefined, T0, cfg);
    expect(e.salud.factorIntervalo).toBe(2);
    registrarRonda(e, ciclo(), undefined, T0 + HORA, cfg);
    expect(e.salud.factorIntervalo).toBe(1);
    expect(e.salud.proximaRonda).toBeNull();
  });

  it('una proyección sobre el presupuesto se avisa, sin espaciar: con lotes, espaciar no ahorra cuota', () => {
    const e = conBueno(T0);
    e.salud.consultasPorDia['2026-10-07'] = 1400; // a las 15:00Z ya van 1.400
    expect(proyeccionConsultasDia(e, T0)).toBeGreaterThan(1500);
    registrarRonda(e, ciclo(), undefined, T0, cfg);
    expect(e.salud.factorIntervalo).toBe(1);
    expect(notificacionesPendientes(e, T0, cfg).find((n) => n.evento === 'cuota')?.lineas.join(' ')).toMatch(/1\.500/);
  });
});

describe('configSaludDesdeEntorno', () => {
  it('lee el umbral de ceguera y el presupuesto, con sus valores por defecto', () => {
    expect(configSaludDesdeEntorno({}, ['telegram'], 15 * MIN, '08:00')).toMatchObject({ umbralCegueraMs: 120 * MIN, presupuestoConsultasDia: 1500 });
    expect(configSaludDesdeEntorno({ COMPRA_AGIL_AVISOS_CEGUERA_MIN: '60', COMPRA_AGIL_VIGILANCIA_CONSULTAS_DIA: '900' }, [], 15 * MIN, '08:00'))
      .toMatchObject({ umbralCegueraMs: 60 * MIN, presupuestoConsultasDia: 900 });
  });
});
