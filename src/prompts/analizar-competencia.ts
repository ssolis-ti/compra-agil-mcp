/**
 * Prompt: analizar_competencia
 *
 * Plantilla guiada para que la IA analice la competencia
 * en un proceso de Compra Ágil específico.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

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
            text: `Necesito un análisis competitivo del proceso de Compra Ágil con código "${args.codigo}".

Por favor, sigue estos pasos:

1. **Obtener el detalle completo:** Usa "obtener_detalle_compra" con el código "${args.codigo}".

2. **Verificar estado de OC:** Usa "verificar_orden_compra" para saber si ya se emitió una Orden de Compra.

3. **Analizar los proveedores cotizando:**
   - Lista todos los proveedores con sus montos totales, valores netos y costos de despacho.
   - Identifica cuáles son Empresa de Menor Tamaño (EMT).
   - Si hay productos cotizados, compara los precios unitarios entre proveedores.

4. **Generar análisis comparativo:**
   - Tabla comparativa de todos los proveedores:
     | Proveedor | RUT | EMT | Valor Neto | Impuesto | Despacho | Total |
   - Identifica al proveedor más económico y al más caro.
   - Calcula el spread (diferencia porcentual entre el más barato y el más caro).
   - Si hay precios unitarios, identifica en qué productos hay mayor diferencia de precio.

5. **Conclusiones:**
   - ¿El proceso es muy competitivo (muchos proveedores) o poco competitivo?
   - ¿El presupuesto disponible es coherente con las ofertas recibidas?
   - ¿Qué proveedor tiene la mejor relación precio-completitud?
   - Si se seleccionó un proveedor, ¿fue el más barato o hay otros criterios?`,
          },
        },
      ],
    })
  );
}
