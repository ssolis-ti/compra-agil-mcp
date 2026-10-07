/**
 * Canal de webhook firmado (2.9.0; R6, ADR 0024). Contrato público en
 * docs/api/webhook-alertas.md: un test ejecuta sus ejemplos de verificación.
 *
 * - POST JSON con `X-Compra-Agil-Firma: t=<unix>,v1=<hex>`, un HMAC-SHA256 de
 *   `t.cuerpo`. La marca de tiempo deja al receptor rechazar repeticiones.
 * - `Idempotency-Key` con el id del lote: un reintento lleva el mismo.
 * - Corte a los 10 s. 2xx entregado; 408, 429, 5xx y red transitorios.
 *
 * La URL completa y el secreto se registran para la redacción en la
 * configuración: una URL de receptor puede llevar su propio token.
 */

import { createHmac } from 'crypto';
import { registrarSecreto } from '../../utils/redact.js';
import { clasificarErrorDeRed, clasificarHttp, type Canal, type LoteDeAvisos, type ResultadoEnvio } from '../canal.js';
import { cuerpoWebhook, AVISO_CONTENIDO_DE_TERCEROS } from '../formato/webhook.js';
import { sistemaWebhook } from '../formato/sistema.js';
import type { Notificacion } from '../notificacion.js';

const CORTE_MS = 10_000;

export function firmar(cuerpo: string, secreto: string, tSeg: number): string {
  return `t=${tSeg},v1=${createHmac('sha256', secreto).update(`${tSeg}.${cuerpo}`).digest('hex')}`;
}

export class CanalWebhook implements Canal {
  readonly nombre = 'webhook' as const;

  constructor(private readonly o: { url: string; secreto: string }) {
    registrarSecreto(o.url);
    registrarSecreto(o.secreto);
  }

  private async post(cuerpo: string, idempotencia: string, ahoraMs: number): Promise<ResultadoEnvio> {
    let r: Response;
    try {
      r = await fetch(this.o.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'mcp-compra-agil',
          'idempotency-key': idempotencia,
          'x-compra-agil-firma': firmar(cuerpo, this.o.secreto, Math.floor(ahoraMs / 1000)),
        },
        body: cuerpo,
        signal: AbortSignal.timeout(CORTE_MS),
      });
    } catch (e) {
      return { ok: false, ...clasificarErrorDeRed(e) };
    }
    await r.body?.cancel().catch(() => undefined);
    const c = clasificarHttp(r.status, r.headers.get('retry-after'), ahoraMs);
    if (c.tipo === 'ok') return { ok: true };
    const motivo = `El receptor respondió ${r.status}`;
    return c.tipo === 'transitorio' ? { ok: false, tipo: 'transitorio', motivo, reintentarEnMs: c.reintentarEnMs } : { ok: false, tipo: 'permanente', motivo };
  }

  enviar(lote: LoteDeAvisos, ahoraMs: number): Promise<ResultadoEnvio> {
    return this.post(JSON.stringify(cuerpoWebhook(lote, ahoraMs)), lote.id, ahoraMs);
  }

  notificar(n: Notificacion, ahoraMs: number): Promise<ResultadoEnvio> {
    const cuerpo = sistemaWebhook(n, ahoraMs);
    return this.post(JSON.stringify(cuerpo), cuerpo.id, ahoraMs);
  }

  probar(ahoraMs: number): Promise<ResultadoEnvio> {
    const id = `prueba-${ahoraMs}`;
    const cuerpo = { tipo: 'compra_agil.prueba', version: 1, id, enviado_en: new Date(ahoraMs).toISOString(), _aviso_contenido_de_terceros: AVISO_CONTENIDO_DE_TERCEROS, alertas: [] };
    return this.post(JSON.stringify(cuerpo), id, ahoraMs);
  }
}
