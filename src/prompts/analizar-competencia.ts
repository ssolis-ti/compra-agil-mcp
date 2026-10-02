/**
 * Prompt: analizar_competencia
 *
 * Plantilla guiada para que la IA analice la competencia
 * en un proceso de Compra Ágil específico.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** Texto que recibe el agente. La API no publica un adjudicado. */
export function textoPromptCompetencia(codigo: string): string {
  return `Necesito un análisis competitivo del proceso de Compra Ágil con código "${codigo}".

Por favor, sigue estos pasos:

1. **Obtener el detalle completo:** Usa "obtener_detalle_compra" con el código "${codigo}". Si esa llamada corta con HTTP 504, no la repitas en ráfaga.

2. **Orden de compra, solo si el detalle ya está en caché:** Usa "verificar_orden_compra" con el mismo código. Si el detalle no está en caché, la herramienta no consulta la API. Un id_orden_compra null no prueba que no exista una orden. No llames a "obtener_detalle_orden_compra" si no tienes un id real.

3. **Analizar las cotizaciones:**
   - Lista todos los proveedores con sus montos totales, valores netos y costos de despacho.
   - Identifica cuáles son Empresa de Menor Tamaño (EMT).
   - Si hay productos cotizados, compara los precios unitarios entre proveedores.
   - Una marca en una cotización no es una adjudicación. No declares un ganador ni un proveedor seleccionado.

4. **Generar el comparativo de ofertas:**
   - Tabla de todas las cotizaciones:
     | Proveedor | RUT | EMT | Valor Neto | Impuesto | Despacho | Total |
   - Identifica la oferta más económica y la más cara.
   - Calcula el spread (diferencia porcentual entre la más barata y la más cara).
   - Si hay precios unitarios, indica en qué productos hay mayor diferencia de precio.

5. **Conclusiones, sin adjudicar:**
   - ¿Hay muchas cotizaciones o pocas?
   - ¿El presupuesto disponible es coherente con las ofertas recibidas?
   - ¿Qué oferta tiene la mejor relación precio-completitud?
   - La API de Compra Ágil no publica qué oferta ganó. Cierra con la brecha entre cotizaciones, no con un proveedor adjudicado.`;
}

export function registerAnalizarCompetenciaPrompt(server: McpServer): void {
  server.registerPrompt(
    'analizar_competencia',
    {
      description: 'Analiza la competencia en un proceso de Compra Ágil específico. Compara proveedores, precios, y genera insights sobre la competitividad del proceso.',
      argsSchema: {
        codigo: z.string().describe('Código de la Compra Ágil a analizar. Ej: "1057539-228-COT26".'),
      },
    },
    async (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: textoPromptCompetencia(args.codigo),
          },
        },
      ],
    })
  );
}
