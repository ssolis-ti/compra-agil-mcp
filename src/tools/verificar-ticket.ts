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
import { ventanaUltimosMinutos } from '../utils/fechas.js';
import { ahora } from '../utils/reloj.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { safeError, pista } from '../utils/redact.js';

const TOOL_NAME = 'verificar_ticket';

const TOOL_DESCRIPTION = `Verifica que el ticket de acceso a la API de Mercado Público esté configurado y sea válido, realizando una consulta mínima de prueba.
NUNCA revela el valor del ticket: solo informa si funciona y muestra los últimos 4 caracteres como referencia.
Úsala como primer diagnóstico cuando otras herramientas fallen con errores de autenticación.`;

export function registerVerificarTicket(server: McpServer, client: CompraAgilClient): void {
  server.registerTool(
    TOOL_NAME,
    { title: "Verificar el ticket de acceso", description: TOOL_DESCRIPTION, annotations: { readOnlyHint: true, openWorldHint: true } },
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
        // Consulta de humo mínima: cambios de los últimos 10 minutos.
        //
        // IMPORTANTE: la API NO acepta consultas sin filtros — devuelve HTTP 500
        // (verificado contra el servicio real). Debe enviarse al menos un filtro.
        //
        // ⚠ Hasta la 2.7.0 se usaba `ttl_cambio_ms` de 1 hora, "el más liviano:
        //   ~1 s". Lo era porque volvía siempre vacío: la API compara sus marcas
        //   (hora de Chile con "Z") contra la hora UTC real. Informaba "0 cambios
        //   en la última hora" en pleno horario hábil. Ver utils/fechas.ts.
        const resp = await client.buscar({ ...ventanaUltimosMinutos(10, ahora()), tamano_pagina: 10, numero_pagina: 1 });
        return {
          content: [{
            type: 'text' as const,
            text: [
              '✅ Ticket válido y operativo.',
              '',
              `Ticket configurado: ${referencia}`,
              `Consulta de prueba: cambios en los últimos 10 minutos → ${resp.paginacion.total_resultados} resultado(s).`,
              `Conteo local del día UTC, compartido por todos los procesos de esta instalación: ${client.getRateLimitStats().requestsToday} request(s). No es el saldo del ticket ni la cuota de este chat.`,
              '',
              'Nota: fuera del horario hábil un total de 0 es normal;',
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
