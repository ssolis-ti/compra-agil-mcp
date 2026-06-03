/**
 * Prompt: buscar_oportunidades_proveedor
 *
 * Plantilla guiada para que la IA ayude a un proveedor
 * a encontrar oportunidades de negocio en Compra Ágil.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerBuscarOportunidadesPrompt(server: McpServer): void {
  server.registerPrompt(
    'buscar_oportunidades_proveedor',
    {
      description: 'Ayuda a un proveedor a encontrar oportunidades de Compra Ágil relevantes para su rubro y región. Genera un resumen ejecutivo con las mejores oportunidades, presupuestos y plazos.',
      argsSchema: {
        rubro: z.string().describe('Rubro o tipo de productos/servicios del proveedor. Ej: "materiales eléctricos", "servicios de limpieza", "equipos médicos".'),
        region: z.string().describe('Región de interés del proveedor. Puede ser el nombre (ej: "Metropolitana") o el código numérico (ej: "13").'),
      },
    },
    async (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Soy un proveedor del rubro "${args.rubro}" y me interesa encontrar oportunidades de Compra Ágil en la región "${args.region}".

Por favor, sigue estos pasos:

1. **Resolver la región:** Consulta el recurso "compra-agil://regiones" para obtener el código numérico de la región "${args.region}" si es que proporcioné el nombre.

2. **Buscar oportunidades abiertas:** Usa la herramienta "buscar_compras_agiles" con:
   - estado: "publicada" (solo procesos abiertos recibiendo cotizaciones)
   - region: el código numérico resuelto
   - q: "${args.rubro}" como palabras clave
   - tamano_pagina: 50

3. **Analizar los resultados:** Para los 5 procesos más relevantes (por presupuesto o afinidad), usa "obtener_detalle_compra" para obtener:
   - Productos solicitados con cantidades
   - Presupuesto disponible
   - Fecha de cierre (plazo para cotizar)
   - Dirección y plazo de entrega
   - Número de competidores (ofertas recibidas)

4. **Generar resumen ejecutivo:** Presenta una tabla con:
   | Código | Nombre | Presupuesto CLP | Cierre | Productos | Competidores |
   Y una recomendación sobre las mejores oportunidades considerando presupuesto alto, pocos competidores y afinidad con mi rubro.`,
          },
        },
      ],
    })
  );
}
