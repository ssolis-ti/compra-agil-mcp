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
import { NOTA_ZONA_HORARIA, desfaseChileEn } from '../utils/fechas.js';
import { registrarMedicion, estadoReloj } from '../utils/reloj.js';

/**
 * Versión mínima de la base de zonas horarias (IANA tz) que conoce las reglas
 * vigentes de Chile. La 2025b separó Aysén (America/Coyhaique, UTC-3 todo el
 * año) de America/Santiago. Chile cambia su horario por decreto: una base
 * anterior puede equivocar el desfase en las semanas del cambio.
 */
export const TZ_MINIMA = '2025b';

/** ¿La base de zonas de este Node es igual o posterior a la mínima? "2026a" > "2025b". */
export function baseDeZonasAlDia(version: string | undefined = process.versions.tz): boolean | null {
  if (!version || !/^\d{4}[a-z]$/.test(version)) return null;
  return version >= TZ_MINIMA;
}

function infoZonas() {
  const alDia = baseDeZonasAlDia();
  return {
    base_zonas_horarias: process.versions.tz ?? null,
    base_zonas_al_dia: alDia,
    ...(alDia === false
      ? { aviso_zonas: `La base de zonas horarias de este Node (${process.versions.tz}) es anterior a la ${TZ_MINIMA}: el paso a UTC-3/UTC-4 puede equivocarse cerca de los cambios de horario de Chile. Actualiza Node.` }
      : {}),
  };
}
import { safeError } from '../utils/redact.js';

const TOOL_NAME = 'verificar_hora_oficial';

const TOOL_DESCRIPTION = `Compara el reloj de esta máquina con la hora oficial de Chile (${SERVIDOR_NTP_CHILE}, del SHOA).
Úsala cuando los plazos no cuadren o antes de decidir sobre un cierre ajustado. El servidor ya corrige sus plazos con la hora del SHOA cuando puede medirla; esta herramienta muestra el desfase, si la corrección está activa y la versión de la base de zonas horarias que da el paso a UTC-3/UTC-4.
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
        // La misma medición corrige el "ahora" de todo el servidor.
        registrarMedicion(r);

        if (!r.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                sincronizado: null,
                servidor_consultado: r.servidor,
                motivo: r.motivo,
                que_significa: 'No se pudo comprobar el reloj, lo que NO implica que esté mal: solo que no se pudo verificar.',
                reloj_que_usa_el_servidor: estadoReloj(),
                ...infoZonas(),
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
              desfase_chile_vigente: desfaseChileEn(new Date(r.horaOficial)),
              reloj_que_usa_el_servidor: estadoReloj(),
              ...infoZonas(),
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
