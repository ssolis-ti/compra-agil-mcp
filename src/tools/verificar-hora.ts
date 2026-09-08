/**
 * Tool: verificar_hora_oficial
 *
 * Compara el reloj de esta máquina con la hora oficial de Chile, que fija el
 * SHOA (Servicio Hidrográfico y Oceanográfico de la Armada).
 *
 * Existe porque los plazos de este servidor se calculan restando la hora local:
 * si el reloj está desviado, `horas_restantes` y el puntaje de urgencia del
 * radar quedan mal aunque la fecha de la API se interprete perfectamente.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  consultarHoraOficial, interpretarDesfase, SERVIDOR_NTP_CHILE, DESFASE_PREOCUPANTE_MS,
} from '../utils/ntp.js';
import { NOTA_ZONA_HORARIA } from '../utils/fechas.js';
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'verificar_hora_oficial';

const TOOL_DESCRIPTION = `Compara el reloj de esta máquina con la hora oficial de Chile (${SERVIDOR_NTP_CHILE}, del SHOA).
Úsala cuando los plazos no cuadren o antes de decidir sobre un cierre ajustado: "horas_restantes" y el puntaje de urgencia del radar se calculan restando la hora local, así que un reloj desviado los falsea aunque los datos de la API sean correctos.
No consume cuota de la API de Mercado Público. Si la red bloquea el puerto UDP 123 —habitual en redes corporativas— lo informa sin fallar.`;

export function registerVerificarHora(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Verificar la hora oficial de Chile',
      description: TOOL_DESCRIPTION,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const r = await consultarHoraOficial();

        if (!r.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                sincronizado: null,
                servidor_consultado: r.servidor,
                motivo: r.motivo,
                que_significa: 'No se pudo comprobar el reloj, lo que NO implica que esté mal: solo que no se pudo verificar. Los plazos siguen calculándose con la hora local de esta máquina.',
                alternativa: 'Compara manualmente el reloj del sistema con https://www.horaoficial.cl (SHOA).',
              }, null, 2),
            }],
          };
        }

        const preocupante = Math.abs(r.desfaseMs) >= DESFASE_PREOCUPANTE_MS;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              sincronizado: !preocupante,
              servidor_consultado: r.servidor,
              hora_oficial_chile_utc: r.horaOficial,
              hora_de_esta_maquina_utc: r.horaLocal,
              desfase_ms: r.desfaseMs,
              demora_consulta_ms: r.demoraMs,
              diagnostico: interpretarDesfase(r.desfaseMs),
              _nota_horaria: NOTA_ZONA_HORARIA,
            }, null, 2),
          }],
          // Un reloj desviado más de un minuto puede costar una licitación:
          // se marca como error para que el modelo no lo pase por alto.
          isError: preocupante,
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `No se pudo verificar la hora oficial: ${safeError(error)}. Los plazos siguen usando el reloj local de esta máquina.`,
          }],
          isError: true,
        };
      }
    }
  );
}
