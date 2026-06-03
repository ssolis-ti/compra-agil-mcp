/**
 * Resource: compra-agil://regiones
 *
 * Catálogo de las 16 regiones de Chile con sus códigos numéricos
 * para usar como filtro en la API de Compra Ágil.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const REGIONES = [
  { codigo: 1, nombre: 'Tarapacá' },
  { codigo: 2, nombre: 'Antofagasta' },
  { codigo: 3, nombre: 'Atacama' },
  { codigo: 4, nombre: 'Coquimbo' },
  { codigo: 5, nombre: 'Valparaíso' },
  { codigo: 6, nombre: "O'Higgins" },
  { codigo: 7, nombre: 'Maule' },
  { codigo: 8, nombre: 'Biobío' },
  { codigo: 9, nombre: 'Araucanía' },
  { codigo: 10, nombre: 'Los Lagos' },
  { codigo: 11, nombre: 'Aysén' },
  { codigo: 12, nombre: 'Magallanes y Antártica' },
  { codigo: 13, nombre: 'Metropolitana' },
  { codigo: 14, nombre: 'Los Ríos' },
  { codigo: 15, nombre: 'Arica y Parinacota' },
  { codigo: 16, nombre: 'Ñuble' },
];

export function registerRegionesResource(server: McpServer): void {
  server.registerResource(
    'regiones',
    'compra-agil://regiones',
    {
      description: 'Catálogo de las 16 regiones de Chile con sus códigos numéricos. Usa estos códigos en el parámetro "region" de las herramientas de búsqueda. Ej: Metropolitana = 13, Valparaíso = 5.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'compra-agil://regiones',
        mimeType: 'application/json',
        text: JSON.stringify(REGIONES, null, 2),
      }],
    })
  );
}
