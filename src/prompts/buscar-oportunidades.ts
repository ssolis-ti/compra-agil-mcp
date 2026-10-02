/**
 * Prompt: buscar_oportunidades_proveedor
 *
 * Plantilla guiada para que la IA ayude a un proveedor
 * a encontrar oportunidades de negocio en Compra Ágil.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** El código 1–16 ya está resuelto. Un nombre sigue yendo al catálogo de regiones. */
export function textoPromptOportunidades(rubro: string, region: string): string {
  const codigo = region.trim();
  const yaEsCodigo = /^([1-9]|1[0-6])$/.test(codigo);
  const pasoRegion = yaEsCodigo
    ? `1. **Región ya resuelta:** "${codigo}" es un código del 1 al 16. Úsalo tal cual. No busques el nombre "${codigo}".`
    : `1. **Resolver la región:** Consulta el recurso "compra-agil://regiones" para obtener el código numérico de la región "${region}" si es que proporcioné el nombre.`;

  return `Soy un proveedor del rubro "${rubro}" y me interesa encontrar oportunidades de Compra Ágil en la región "${region}".

Por favor, sigue estos pasos:

${pasoRegion}

2. **Buscar oportunidades abiertas:** Usa la herramienta "buscar_compras_agiles" con:
   - estado: "publicada" (solo procesos abiertos recibiendo cotizaciones)
   - region: ${yaEsCodigo ? `"${codigo}"` : 'el código numérico resuelto'}
   - q: "${rubro}" como palabras clave
   - tamano_pagina: 10
   No pidas 50: una página de ese tamaño sobre un filtro amplio responde HTTP 504.

3. **Analizar los resultados:** Para los 5 procesos más relevantes (por presupuesto o afinidad), usa "obtener_detalle_compra" para obtener:
   - Productos solicitados con cantidades
   - Presupuesto disponible
   - Fecha de cierre (plazo para cotizar)
   - Dirección y plazo de entrega
   - Número de competidores (ofertas recibidas)

4. **Generar resumen ejecutivo:** Presenta una tabla con:
   | Código | Nombre | Presupuesto CLP | Cierre | Productos | Competidores |
   Y una recomendación sobre las mejores oportunidades considerando presupuesto alto, pocos competidores y afinidad con mi rubro.`;
}

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
            text: textoPromptOportunidades(args.rubro, args.region),
          },
        },
      ],
    })
  );
}
