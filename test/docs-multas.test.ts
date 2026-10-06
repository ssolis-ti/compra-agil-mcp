import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocumentosTools } from '../src/tools/documentos.js';
import { tokenizar } from '../src/utils/doc-search.js';

/**
 * S6 de la simulación con agentes (6-oct): «¿qué multas me pueden aplicar…?»
 * devolvía los manuales de la API y dejaba fuera el PDF de multas. «compra» y
 * «ágil» aparecen en todos los documentos del corpus, así que sumaban puntaje a
 * cualquier archivo y desplazaban al que de verdad trata el tema.
 */

type Handler = (a: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function consultar() {
  const handlers: Record<string, Handler> = {};
  const server = { registerTool: (n: string, _c: unknown, h: Handler) => { handlers[n] = h; } };
  registerDocumentosTools(server as unknown as McpServer);
  return (query: string) => handlers.consultar_documentos_locales({ query }).then((r) => r.content[0].text);
}

describe('tokenizar: términos del dominio', () => {
  it('«compra» y «ágil» no cuentan cuando hay términos que sí distinguen', () => {
    expect(tokenizar('¿Qué multas me pueden aplicar por atrasos en una compra ágil?')).toEqual(['multas', 'aplicar', 'atrasos']);
    expect(tokenizar('garantías en Mercado Público')).toEqual(['garantias']);
  });

  it('si la consulta es solo del dominio, se busca igual', () => {
    expect(tokenizar('compra ágil')).toEqual(['compra', 'agil']);
  });
});

describe('consultar_documentos_locales: la pregunta de la simulación', () => {
  it('trae el PDF de multas ante una pregunta en lenguaje natural', async () => {
    const texto = await consultar()('¿Qué multas me pueden aplicar si me atraso en una compra ágil?');
    expect(texto).toContain('multas-sanciones-procedimientos.pdf');
    expect(texto).not.toMatch(/Quedaron? fuera[^\n]*multas-sanciones-procedimientos\.pdf/);
  }, 30_000);
});
