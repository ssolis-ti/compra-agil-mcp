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
        // Consulta mínima: una sola página con el tamaño más chico posible.
        const resp = await client.buscar({ tamano_pagina: 10, numero_pagina: 1 });
        return {
          content: [{
            type: 'text' as const,
            text: [
              '✅ Ticket válido y operativo.',
              '',
              `Ticket configurado: ${referencia}`,
              `Respuesta de la API: ${resp.paginacion.total_resultados} resultados disponibles.`,
              `Cuota consumida en esta sesión: ${client.getRateLimitStats().requestsToday} request(s).`,
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
