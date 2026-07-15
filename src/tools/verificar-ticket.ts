/**
 * Tool: verificar_ticket
 *
 * Comprueba que el ticket configurado funciona contra la API real,
 * SIN revelar su valor. Solo muestra una pista (últimos 4 caracteres).
 *
 * Existe para que la primera prueba end-to-end no obligue a nadie a imprimir,
 * pegar o compartir la credencial.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { safeError, pista } from '../utils/redact.js';

const TOOL_NAME = 'verificar_ticket';

const TOOL_DESCRIPTION = `Verifica que el ticket de acceso a la API de Mercado Público esté configurado y sea válido, realizando una consulta mínima de prueba.
NUNCA revela el valor del ticket: solo informa si funciona y muestra los últimos 4 caracteres como referencia.
Úsala como primer diagnóstico cuando otras herramientas fallen con errores de autenticación.`;

export function registerVerificarTicket(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    { description: TOOL_DESCRIPTION },
    async () => {
      const referencia = pista(process.env.COMPRA_AGIL_TICKET);

      if (!process.env.COMPRA_AGIL_TICKET) {
        return {
          content: [{
            type: 'text' as const,
            text: [
              '❌ No hay ticket configurado.',
              '',
              'Configura la variable de entorno COMPRA_AGIL_TICKET (por ejemplo, en un archivo .env).',
              'Obtén tu ticket en https://www.chilecompra.cl/api/ (requiere Clave Única).',
              '',
              '⚠ No pegues el ticket en el chat ni lo compartas: guárdalo solo en el .env,',
              '  que ya está protegido por .gitignore.',
            ].join('\n'),
          }],
          isError: true,
        };
      }

      try {
        // Consulta de humo mínima: ventana de cambios de 1 hora.
        //
        // IMPORTANTE: la API NO acepta consultas sin filtros — devuelve HTTP 500
        // (verificado contra el servicio real). Debe enviarse al menos un filtro.
        // `ttl_cambio_ms` es el más liviano: responde en ~1s aunque no haya
        // resultados, y un 200 basta para probar que el ticket es válido.
        const resp = await client.buscar({ ttl_cambio_ms: 3_600_000, tamano_pagina: 10, numero_pagina: 1 });
        return {
          content: [{
            type: 'text' as const,
            text: [
              '✅ Ticket válido y operativo.',
              '',
              `Ticket configurado: ${referencia}`,
              `Consulta de prueba: cambios en la última hora → ${resp.paginacion.total_resultados} resultado(s).`,
              `Cuota consumida en esta sesión: ${client.getRateLimitStats().requestsToday} request(s).`,
              '',
              'Nota: un total de 0 es normal si no hubo movimientos en la última hora;',
              'lo relevante es que la API respondió correctamente con este ticket.',
            ].join('\n'),
          }],
        };
      } catch (error) {
        const detalle = error instanceof CompraAgilApiError
          ? error.actionableMessage
          : safeError(error);
        return {
          content: [{
            type: 'text' as const,
            text: [
              '❌ El ticket está configurado pero la verificación falló.',
              '',
              `Ticket configurado: ${referencia}`,
              `Motivo: ${detalle}`,
            ].join('\n'),
          }],
          isError: true,
        };
      }
    }
  );
}
