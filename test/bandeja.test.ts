import { describe, it, expect } from 'vitest';
import { encolar, enviarPendientes, idDeAviso, podarBandeja, enSilencio, ESPERAS_MS, MAX_INTENTOS, type Bandeja } from '../src/avisos/bandeja.js';
import type { Canal, LoteDeAvisos, ResultadoEnvio } from '../src/avisos/canal.js';
import type { Alerta } from '../src/avisos/mensaje.js';

/**
 * Bandeja de salida (T3.3 de la 2.9.0; R3.1–R3.5, ADR 0022): cada alerta se
 * convierte en un aviso por canal, que sobrevive a fallos y reinicios porque
 * vive en el estado guardado en disco.
 */
const T = Date.parse('2026-10-07T15:00:00Z'); // 12:00 de Chile
const alerta = (codigo: string, creada = T): Alerta => ({
  codigo, nombre: `Proceso ${codigo}`, organismo: 'Organismo', region: 'Metropolitana', presupuestoClp: 300_000,
  cierreHoraChile: '2026-10-09 12:00', cierreUtc: '2026-10-09T15:00:00.000Z', coincidencia: 'resmas',
  ficha: `https://buscador.mercadopublico.cl/ficha?code=${codigo}`, creada,
});

/** Canal que devuelve, en orden, los resultados pedidos (y luego ok). */
function canalFalso(nombre: Canal['nombre'], resultados: ResultadoEnvio[] = []): Canal & { lotes: LoteDeAvisos[] } {
  const lotes: LoteDeAvisos[] = [];
  return {
    nombre, lotes,
    async enviar(lote) { lotes.push(lote); return resultados.shift() ?? { ok: true }; },
    async probar() { return { ok: true }; },
  };
}

describe('encolar', () => {
  it('un aviso por canal activo, con id estable; repetir no duplica (R3.1)', () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A-1-COT26'), alerta('B-2-COT26')], ['telegram', 'correo'], T);
    expect(Object.keys(b)).toHaveLength(4);
    encolar(b, [alerta('A-1-COT26')], ['telegram', 'correo'], T + 60_000);
    expect(Object.keys(b)).toHaveLength(4);
    expect(idDeAviso('telegram', 'A-1-COT26', T)).toBe(idDeAviso('telegram', 'A-1-COT26', T + 3600_000));
    expect(idDeAviso('telegram', 'A-1-COT26', T)).not.toBe(idDeAviso('correo', 'A-1-COT26', T));
    expect(idDeAviso('telegram', 'A-1-COT26', T)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('enviarPendientes', () => {
  it('agrupa los avisos de un canal en un lote y los marca entregados', async () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A'), alerta('B'), alerta('C')], ['telegram'], T);
    const tg = canalFalso('telegram');
    const r = await enviarPendientes(b, [tg], T);
    expect(tg.lotes).toHaveLength(1);
    expect(tg.lotes[0].avisos.map((a) => a.alerta.codigo)).toEqual(['A', 'B', 'C']);
    expect(r.entregados).toBe(3);
    expect(Object.values(b).every((a) => a.estado === 'entregado')).toBe(true);
    expect((await enviarPendientes(b, [tg], T + 1)).entregados).toBe(0);
  });

  it('un error transitorio reintenta con espera creciente y entrega después (R3.2)', async () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A')], ['webhook'], T);
    const wh = canalFalso('webhook', [{ ok: false, tipo: 'transitorio', motivo: '503' }, { ok: false, tipo: 'transitorio', motivo: '503' }]);
    await enviarPendientes(b, [wh], T);
    const aviso = Object.values(b)[0];
    expect(aviso).toMatchObject({ estado: 'pendiente', intentos: 1, proximoIntento: T + ESPERAS_MS[0], ultimoError: '503' });
    await enviarPendientes(b, [wh], T + 1000); // antes de la espera: no se envía
    expect(wh.lotes).toHaveLength(1);
    await enviarPendientes(b, [wh], T + ESPERAS_MS[0]);
    expect(aviso.proximoIntento).toBe(T + ESPERAS_MS[0] + ESPERAS_MS[1]);
    await enviarPendientes(b, [wh], aviso.proximoIntento);
    expect(aviso.estado).toBe('entregado');
    expect(wh.lotes).toHaveLength(3);
  });

  it('respeta reintentarEnMs del canal (retry_after de Telegram)', async () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A')], ['telegram'], T);
    await enviarPendientes(b, [canalFalso('telegram', [{ ok: false, tipo: 'transitorio', motivo: '429', reintentarEnMs: 7000 }])], T);
    expect(Object.values(b)[0].proximoIntento).toBe(T + 7000);
  });

  it('un error permanente marca fallido sin reintentar; 8 transitorios también', async () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A')], ['correo'], T);
    const correo = canalFalso('correo', [{ ok: false, tipo: 'permanente', motivo: 'credenciales rechazadas' }]);
    await enviarPendientes(b, [correo], T);
    expect(Object.values(b)[0]).toMatchObject({ estado: 'fallido', intentos: 1 });
    await enviarPendientes(b, [correo], T + 3600_000);
    expect(correo.lotes).toHaveLength(1);

    const b2: Bandeja = {};
    encolar(b2, [alerta('B')], ['webhook'], T);
    const siempre = canalFalso('webhook', Array.from({ length: 20 }, () => ({ ok: false as const, tipo: 'transitorio' as const, motivo: '503' })));
    for (let t = T, i = 0; i < 20; i++, t += 2 * 3600_000) await enviarPendientes(b2, [siempre], t);
    expect(Object.values(b2)[0]).toMatchObject({ estado: 'fallido', intentos: MAX_INTENTOS });
    expect(siempre.lotes).toHaveLength(MAX_INTENTOS);
  });

  it('un canal que falla no frena a otro (R3.2)', async () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A')], ['telegram', 'correo'], T);
    const r = await enviarPendientes(b, [canalFalso('telegram', [{ ok: false, tipo: 'permanente', motivo: '403' }]), canalFalso('correo')], T);
    expect(r.porCanal).toEqual({ telegram: { entregados: 0, fallidos: 1, reintentos: 0 }, correo: { entregados: 1, fallidos: 0, reintentos: 0 } });
  });

  it('un canal que lanza (defecto propio) cuenta como transitorio, sin romper la ronda', async () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A')], ['webhook'], T);
    const roto: Canal = { nombre: 'webhook', enviar: async () => { throw new Error('bug'); }, probar: async () => ({ ok: true }) };
    const r = await enviarPendientes(b, [roto], T);
    expect(r.porCanal.webhook.reintentos).toBe(1);
  });

  it('divide en lotes por el tope del canal', async () => {
    const b: Bandeja = {};
    encolar(b, Array.from({ length: 120 }, (_, i) => alerta(`P-${i}`)), ['webhook'], T);
    const wh = canalFalso('webhook');
    await enviarPendientes(b, [wh], T);
    expect(wh.lotes.map((l) => l.avisos.length)).toEqual([100, 20]);
    expect(new Set(wh.lotes.map((l) => l.id)).size).toBe(2);
  });

  it('reinicio con avisos pendientes: la bandeja es JSON y se retoma igual (R3.5)', async () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A')], ['telegram'], T);
    const recargada = JSON.parse(JSON.stringify(b)) as Bandeja;
    const tg = canalFalso('telegram');
    await enviarPendientes(recargada, [tg], T);
    expect(tg.lotes).toHaveLength(1);
  });
});

describe('horario de silencio (R3.4)', () => {
  const silencio = { desde: '22:00', hasta: '07:00' };

  it('en silencio no se envía; al terminar sale todo junto, marcado como resumen', async () => {
    const noche = Date.parse('2026-10-08T02:30:00Z'); // 23:30 de Chile
    const b: Bandeja = {};
    encolar(b, [alerta('A', noche), alerta('B', noche + 3600_000)], ['telegram'], noche);
    const tg = canalFalso('telegram');
    await enviarPendientes(b, [tg], noche + 3600_000, { silencio });
    expect(tg.lotes).toHaveLength(0);
    const manana = Date.parse('2026-10-08T10:05:00Z'); // 07:05 de Chile
    await enviarPendientes(b, [tg], manana, { silencio });
    expect(tg.lotes).toHaveLength(1);
    expect(tg.lotes[0].resumenDeSilencio).toBe(true);
  });

  it('cruza la medianoche y respeta la hora de Chile también en el cambio de horario de septiembre', () => {
    expect(enSilencio(Date.parse('2026-10-08T01:00:00Z'), silencio)).toBe(true); // 22:00
    expect(enSilencio(Date.parse('2026-10-08T09:59:00Z'), silencio)).toBe(true); // 06:59
    expect(enSilencio(Date.parse('2026-10-08T10:00:00Z'), silencio)).toBe(false); // 07:00
    expect(enSilencio(Date.parse('2026-10-08T15:00:00Z'), silencio)).toBe(false); // 12:00
    // 6-sep-2026: a las 00:00 de Chile se adelanta a la 01:00 (UTC-4 → UTC-3).
    expect(enSilencio(Date.parse('2026-09-06T09:30:00Z'), silencio)).toBe(true); // 06:30, UTC-3
    expect(enSilencio(Date.parse('2026-09-06T10:30:00Z'), silencio)).toBe(false); // 07:30, UTC-3
    expect(enSilencio(T, undefined)).toBe(false);
  });
});

describe('podarBandeja', () => {
  it('quita entregados y fallidos de más de 7 días; conserva los pendientes', async () => {
    const b: Bandeja = {};
    encolar(b, [alerta('A'), alerta('B')], ['telegram'], T);
    await enviarPendientes(b, [canalFalso('telegram', [{ ok: true }])], T);
    encolar(b, [alerta('C')], ['telegram'], T);
    podarBandeja(b, T + 8 * 24 * 3600_000);
    expect(Object.values(b).map((a) => a.alerta.codigo)).toEqual(['C']);
  });
});
