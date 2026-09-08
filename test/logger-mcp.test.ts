import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, setMcpServer } from '../src/utils/logger.js';
import { registrarSecreto, _resetSecretos } from '../src/utils/redact.js';

/**
 * Los logs de este servidor NO se quedan en la consola: viajan al cliente MCP
 * por `notifications/message`, es decir, al contexto del modelo y a la
 * transcripción. Por eso lo que se envía tiene que ir redactado siempre.
 *
 * Durante meses esto fue inofensivo por accidente: el servidor no declaraba la
 * capacidad `logging`, el SDK rechazaba cada envío y un `.catch()` mudo lo
 * ocultaba, así que no llegaba ningún log. Corregido en la 2.4.1 — y desde que
 * los logs SÍ llegan, esta redacción dejó de ser teórica.
 */

const TICKET_FALSO = 'TICKET-DE-PRUEBA-NO-REAL-abc123';

let enviados: any[];

beforeEach(() => {
  _resetSecretos();
  enviados = [];
  setMcpServer({
    sendLoggingMessage: async (m: any) => { enviados.push(m); },
  });
  // El logger escribe también a stderr; se silencia para no ensuciar la salida.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setMcpServer(null as any);
  vi.restoreAllMocks();
});

describe('logger — lo que se envía al cliente MCP', () => {
  it('envía el log como notificación con su nivel', () => {
    logger.info('servidor listo');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ level: 'info', logger: 'mcp-compra-agil' });
    expect(enviados[0].data).toContain('servidor listo');
  });

  it('respeta el nivel de cada método', () => {
    logger.warn('cuidado');
    logger.error('falló');
    expect(enviados.map((e) => e.level)).toEqual(['warn', 'error']);
  });
});

describe('logger — 🔒 el ticket nunca viaja al contexto del modelo', () => {
  it('redacta el secreto dentro del mensaje', () => {
    registrarSecreto(TICKET_FALSO);
    logger.info(`consultando con ticket ${TICKET_FALSO}`);

    expect(enviados[0].data).not.toContain(TICKET_FALSO);
    expect(enviados[0].data).toContain('[REDACTED]');
  });

  it('redacta el secreto dentro de una URL, que es el caso real de riesgo', () => {
    // El endpoint legado de Órdenes de Compra lleva el ticket en el query string.
    registrarSecreto(TICKET_FALSO);
    logger.debug(`API Request: GET https://api.mercadopublico.cl/servicios/v1/publico/OrdenCompra.json?ticket=${TICKET_FALSO}&codigo=123`);

    const enviado = enviados.find((e) => String(e.data).includes('OrdenCompra'));
    if (enviado) {
      expect(enviado.data).not.toContain(TICKET_FALSO);
      expect(enviado.data).toContain('ticket=[REDACTED]');
    }
  });

  it('redacta también los datos adjuntos, no solo el texto', () => {
    registrarSecreto(TICKET_FALSO);
    logger.error('fallo de autenticación', { ticket: TICKET_FALSO, intento: 2 });

    expect(enviados[0].data).not.toContain(TICKET_FALSO);
  });

  it('sin servidor registrado no se envía nada (no revienta)', () => {
    setMcpServer(null as any);
    expect(() => logger.info('sin cliente')).not.toThrow();
    expect(enviados).toHaveLength(0);
  });
});
