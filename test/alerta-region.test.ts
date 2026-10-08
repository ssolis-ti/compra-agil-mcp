import { describe, it, expect } from 'vitest';
import type { CompraAgilItem } from '../src/api/compra-agil-client.js';
import { coincidencia, criteriosDesdeEntorno, EN_TU_REGION, type Criterios } from '../src/vigilancia/criterios.js';
import { criteriosEfectivos } from '../src/vigilancia/gateway.js';
import { crearAlerta, type Alerta } from '../src/avisos/mensaje.js';
import { formatearTelegram, LIMITE_TELEGRAM } from '../src/avisos/formato/telegram.js';
import { formatearCorreo } from '../src/avisos/formato/correo.js';
import { cuerpoWebhook } from '../src/avisos/formato/webhook.js';
import type { LoteDeAvisos } from '../src/avisos/canal.js';
import type { EstadoVigilancia } from '../src/vigilancia/estado.js';

/**
 * Alerta total de la región (2.9.0, pedido del dueño del 8-oct): además de las
 * del rubro, toda compra publicada en las regiones elegidas, sin mirar
 * palabras ni monto. Va aparte y más breve, para que no tape las del rubro.
 */

const base: Criterios = {
  palabras: ['aseo'], excluidas: ['vehiculo'], regiones: [9], presupuestoMinimo: 1_000_000, soloSinOfertas: true, todasEnRegion: true,
};

function item(over: { nombre?: string; region?: number; presupuesto?: number | null; ofertas?: number; estado?: string } = {}): CompraAgilItem {
  const { nombre = 'Compra de resmas', region = 9, presupuesto = 300_000, ofertas = 0, estado = 'publicada' } = over;
  return {
    codigo: '1-1-COT26', nombre,
    estado: { codigo: estado, glosa: estado },
    convocatoria: {}, documentos: [],
    fechas: { fecha_cierre: '2026-10-09 15:00' },
    montos: { moneda: 'CLP', monto_disponible_clp: presupuesto },
    institucion: { organismo_comprador: 'Municipalidad de Temuco', region, nombre_region: 'Región de la Araucanía' },
    resumen: { total_ofertas_recibidas: ofertas }, motivos: {}, links: {},
  } as CompraAgilItem;
}

describe('criterio todas_en_region', () => {
  it('lo del rubro sigue entrando por su palabra, y lo demás de la región entra como «en tu región»', () => {
    expect(coincidencia(item({ nombre: 'Servicio de aseo', presupuesto: 2_000_000 }), base)).toBe('aseo');
    expect(coincidencia(item(), base)).toBe(EN_TU_REGION);
  });

  it('no mira el monto: una del rubro bajo el mínimo entra igual, como de la región', () => {
    expect(coincidencia(item({ nombre: 'Servicio de aseo', presupuesto: 200_000 }), base)).toBe(EN_TU_REGION);
    expect(coincidencia(item({ presupuesto: null }), base)).toBe(EN_TU_REGION);
  });

  it('respeta región, exclusiones, «solo sin ofertas» y el estado publicada', () => {
    expect(coincidencia(item({ region: 13 }), base)).toBeNull();
    expect(coincidencia(item({ nombre: 'Arriendo de vehículo' }), base)).toBeNull();
    expect(coincidencia(item({ ofertas: 1 }), base)).toBeNull();
    expect(coincidencia(item({ estado: 'cerrada' }), base)).toBeNull();
  });

  it('sin regiones no aplica: no se avisa todo el país', () => {
    expect(coincidencia(item(), { ...base, regiones: [] })).toBeNull();
  });

  it('apagado, se comporta como antes', () => {
    expect(coincidencia(item(), { ...base, todasEnRegion: false })).toBeNull();
  });

  it('se lee de MONITOR_TODAS_EN_REGION, apagado por defecto', () => {
    expect(criteriosDesdeEntorno({}).todasEnRegion).toBe(false);
    expect(criteriosDesdeEntorno({ MONITOR_TODAS_EN_REGION: ' TRUE ' }).todasEnRegion).toBe(true);
    expect(criteriosDesdeEntorno({ MONITOR_TODAS_EN_REGION: 'sí' }).todasEnRegion).toBe(false);
  });

  it('criterios guardados antes de existir el campo se leen con la alerta total apagada', () => {
    const { todasEnRegion: _, ...viejos } = base;
    const e = { criterios: { ...viejos, cambiadoEn: '2026-10-07T00:00:00.000Z' } } as unknown as EstadoVigilancia;
    expect(criteriosEfectivos(e, base).todasEnRegion).toBe(false);
  });
});

const AHORA = Date.parse('2026-10-08T15:00:00Z');
const alerta = (codigo: string, coincide: string): Alerta =>
  crearAlerta({ ...item({ nombre: `Proceso ${codigo}` }), codigo }, coincide, AHORA);
const lote = (alertas: Alerta[], canal: LoteDeAvisos['canal'] = 'telegram'): LoteDeAvisos => ({
  id: 'abc', canal, resumenDeSilencio: false,
  avisos: alertas.map((a, i) => ({ id: `id${i}`, canal, alerta: a, estado: 'pendiente', intentos: 0, proximoIntento: AHORA, creado: AHORA })),
});

describe('formato con alerta total de la región', () => {
  it('crearAlerta marca el nivel', () => {
    expect(alerta('A', 'aseo').nivel).toBe('rubro');
    expect(alerta('B', EN_TU_REGION).nivel).toBe('region');
  });

  it('Telegram: las del rubro primero y completas, las de la región después y en una línea', () => {
    const [m] = formatearTelegram(lote([alerta('R1', EN_TU_REGION), alerta('A1', 'aseo'), alerta('R2', EN_TU_REGION)]), AHORA);
    expect(m).toMatch(/^<b>1 de tu rubro y 2 compras más en tu región<\/b>/);
    const rubro = m.indexOf('🎯 <b>De tu rubro</b>');
    const region = m.indexOf('📍 <b>Otras en tu región</b>');
    expect(rubro).toBeGreaterThan(0);
    expect(region).toBeGreaterThan(m.indexOf('Proceso A1'));
    expect(m.indexOf('Proceso R1')).toBeGreaterThan(region);
    expect(m).toContain('• <a href="https://buscador.mercadopublico.cl/ficha?code=R2">Proceso R2</a>');
    expect(m).not.toContain(`«${EN_TU_REGION}»`);
  });

  it('Telegram: solo de la región, sin secciones', () => {
    const [m] = formatearTelegram(lote([alerta('R1', EN_TU_REGION)]), AHORA);
    expect(m).toMatch(/^<b>1 compra nueva en tu región<\/b>\n\n• /);
    expect(m).not.toContain('De tu rubro');
  });

  it('Telegram: sin alerta total, el mensaje es el de siempre', () => {
    const [m] = formatearTelegram(lote([alerta('A1', 'aseo')]), AHORA);
    expect(m).toMatch(/^<b>1 proceso nuevo calza con tus criterios<\/b>\n\n<b>Proceso A1<\/b>/);
  });

  it('Telegram: muchas de la región se parten en mensajes ≤ 4.096 sin perder ninguna', () => {
    const muchas = Array.from({ length: 50 }, (_, i) => alerta(`R${i}`, EN_TU_REGION));
    const ms = formatearTelegram(lote(muchas), AHORA);
    expect(ms.length).toBeGreaterThan(1);
    for (const m of ms) expect(m.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    for (let i = 0; i < 50; i++) expect(ms.join('\n')).toContain(`>Proceso R${i}<`);
  });

  it('correo: título aparte para las de la región; webhook: campo nivel', () => {
    const c = formatearCorreo(lote([alerta('R1', EN_TU_REGION), alerta('A1', 'aseo')], 'correo'), AHORA);
    expect(c.texto.indexOf('Proceso A1')).toBeLessThan(c.texto.indexOf('Otras compras en tu región:'));
    expect(c.html).toContain('<h3>Otras compras en tu región:</h3>');
    const w = cuerpoWebhook(lote([alerta('R1', EN_TU_REGION), alerta('A1', 'aseo')], 'webhook'), AHORA);
    expect(w.alertas.map((a) => a.nivel)).toEqual(['region', 'rubro']);
  });
});
