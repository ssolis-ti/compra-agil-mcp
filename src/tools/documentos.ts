import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDocsDir = path.resolve(__dirname, '../../docs');
const cwdDocsDir = path.resolve(process.cwd(), 'docs');

let DOCS_DIR = cwdDocsDir;
if (fs.existsSync(packageDocsDir) && fs.readdirSync(packageDocsDir).some(f => f.toLowerCase().endsWith('.pdf'))) {
  DOCS_DIR = packageDocsDir;
}

/**
 * Obtiene de forma recursiva todos los archivos dentro de un directorio,
 * retornando sus rutas relativas formateadas con barras diagonales (/).
 */
function getRelativeFilesRecursively(dir: string, baseDir: string = dir): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getRelativeFilesRecursively(filePath, baseDir));
    } else {
      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
      results.push(relativePath);
    }
  }
  return results;
}

/**
 * Registra las herramientas relacionadas con documentos y especificaciones en el servidor MCP.
 */
export function registerDocumentosTools(server: McpServer): void {
  
  // ─── 1. OBTENER ENLACE DE DOCUMENTO DE PROCESO ───────────────────────
  server.registerTool(
    'obtener_enlace_documento',
    {
      description: 'Genera el enlace oficial de descarga pública en Mercado Público para un adjunto (bases, especificaciones o anexos) usando su ID de documento.',
      inputSchema: {
        id_documento: z.string().describe('ID único del documento. Ej: "123456" de la lista de documentos de una compra.'),
      },
    },
    async (args) => {
      const url = `https://www.mercadopublico.cl/FichaLicitacion/RetornaDocumento.aspx?id=${args.id_documento}`;
      return {
        content: [{
          type: 'text' as const,
          text: `Enlace de descarga oficial del documento:\n${url}\n\nNota: Este enlace es público y se puede abrir directamente en el navegador para descargar el archivo.`,
        }],
      };
    }
  );

  // ─── 2. DESCARGAR Y LEER DOCUMENTO DE PROCESO (REMOTO) ───────────────
  server.registerTool(
    'descargar_y_leer_documento',
    {
      description: 'Descarga un documento adjunto de Mercado Público (bases técnicas/administrativas) en formato PDF usando su ID, extrae su texto y lo retorna al LLM. Útil para auditar requisitos técnicos de una oferta.',
      inputSchema: {
        id_documento: z.string().describe('ID único del documento. Ej: "123456".'),
        query: z.string().optional().describe('Si se proporciona, busca y retorna solo fragmentos que contengan este término (case-insensitive).'),
        max_caracteres: z.number().min(500).max(15000).default(5000).optional().describe('Límite de caracteres a retornar (default 5000) para evitar saturar el contexto de la IA.'),
      },
    },
    async (args) => {
      try {
        const url = `https://www.mercadopublico.cl/FichaLicitacion/RetornaDocumento.aspx?id=${args.id_documento}`;
        
        // Descargar PDF
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Error HTTP al intentar descargar el documento: ${response.status} ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Parsear PDF
        const parser = new PDFParse({ data: buffer });
        const pdfData = await parser.getText();
        const text = pdfData.text || '';
        
        if (!text.trim()) {
          return {
            content: [{
              type: 'text' as const,
              text: `El documento con ID ${args.id_documento} se descargó pero parece estar vacío o no contiene texto legible (ej: escaneado sin OCR).`,
            }],
          };
        }

        // Si se provee una query, realizar filtrado local de coincidencias
        if (args.query) {
          const searchTerm = args.query.toLowerCase();
          const lines = text.split('\n');
          const matches: string[] = [];
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]?.trim();
            if (line && line.toLowerCase().includes(searchTerm)) {
              // Devolver la línea con algo de contexto (línea anterior y posterior)
              const context = [];
              if (i > 0 && lines[i-1]?.trim()) context.push(`[Anterior] ${lines[i-1]?.trim()}`);
              context.push(`[COINCIDENCIA] ${line}`);
              if (i < lines.length - 1 && lines[i+1]?.trim()) context.push(`[Siguiente] ${lines[i+1]?.trim()}`);
              matches.push(context.join('\n'));
            }
          }

          if (matches.length === 0) {
            return {
              content: [{
                type: 'text' as const,
                text: `No se encontraron coincidencias para "${args.query}" en el documento ID ${args.id_documento}. El texto inicial del documento es:\n\n${text.substring(0, 1000)}...`,
              }],
            };
          }

          return {
            content: [{
              type: 'text' as const,
              text: `Coincidencias encontradas para "${args.query}" en el documento (ID: ${args.id_documento}):\n\n${matches.slice(0, 15).join('\n\n--- \n\n')}`,
            }],
          };
        }

        // Si no hay query, retornar el texto inicial
        const limit = args.max_caracteres || 5000;
        const truncated = text.length > limit ? `${text.substring(0, limit)}\n\n[... TEXTO TRUNCADO POR LÍMITE DE CONTEXTO ...] Código de descarga del documento completo: ${url}` : text;
        
        return {
          content: [{
            type: 'text' as const,
            text: `Contenido extraído del documento (ID: ${args.id_documento}):\n\n${truncated}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error al procesar el documento remoto: ${error.message || String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // ─── 3. CONSULTAR DOCUMENTOS LOCALES (MANUALES/GUÍAS) ────────────────
  server.registerTool(
    'consultar_documentos_locales',
    {
      description: 'Busca y lee información dentro de los manuales, normativas o guías de Compra Ágil almacenados localmente en la carpeta docs/ (soporta formatos .pdf, .txt, .md).',
      inputSchema: {
        query: z.string().optional().describe('Término de búsqueda para filtrar fragmentos del documento (ej: "monto", "criterios"). Si se omite, lista los documentos disponibles.'),
        max_caracteres: z.number().min(500).max(15000).default(3000).optional().describe('Cantidad máxima de texto a retornar de cada coincidencia.'),
      },
    },
    async (args) => {
      try {
        if (!fs.existsSync(DOCS_DIR)) {
          fs.mkdirSync(DOCS_DIR, { recursive: true });
        }

        const files = getRelativeFilesRecursively(DOCS_DIR).filter(file => {
          const ext = path.extname(file).toLowerCase();
          const name = path.basename(file).toLowerCase();
          return (ext === '.pdf' || ext === '.txt' || ext === '.md') && name !== 'readme.md';
        });

        if (files.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `La carpeta local "docs/" está vacía. Guarda tus archivos PDF, TXT o MD de Compra Ágil allí para poder consultarlos con esta herramienta.\nRuta de la carpeta: ${DOCS_DIR}`,
            }],
          };
        }

        // Si no hay query, listar los archivos disponibles
        if (!args.query) {
          const fileList = files.map(file => {
            const stats = fs.statSync(path.join(DOCS_DIR, file));
            return `- ${file} (${(stats.size / 1024).toFixed(1)} KB)`;
          }).join('\n');

          return {
            content: [{
              type: 'text' as const,
              text: `Documentos locales de ayuda disponibles en "docs/":\n\n${fileList}\n\nPara buscar dentro de ellos, ejecuta esta herramienta especificando el parámetro "query".`,
            }],
          };
        }

        const searchTerm = args.query.toLowerCase();
        const results: string[] = [];

        for (const file of files) {
          const filePath = path.join(DOCS_DIR, file);
          const ext = path.extname(file).toLowerCase();
          let fileText = '';

          try {
            if (ext === '.pdf') {
              const buffer = fs.readFileSync(filePath);
              const parser = new PDFParse({ data: buffer });
              const pdfData = await parser.getText();
              fileText = pdfData.text || '';
            } else {
              fileText = fs.readFileSync(filePath, 'utf8');
            }

            if (fileText.toLowerCase().includes(searchTerm)) {
              // Buscar fragmentos relevantes
              const lines = fileText.split('\n');
              const fileMatches: string[] = [];
              
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i]?.trim();
                if (line && line.toLowerCase().includes(searchTerm)) {
                  const context = [];
                  if (i > 0 && lines[i-1]?.trim()) context.push(`[Anterior] ${lines[i-1]?.trim()}`);
                  context.push(`[COINCIDENCIA] ${line}`);
                  if (i < lines.length - 1 && lines[i+1]?.trim()) context.push(`[Siguiente] ${lines[i+1]?.trim()}`);
                  fileMatches.push(context.join('\n'));
                }
              }

              if (fileMatches.length > 0) {
                const limit = args.max_caracteres || 3000;
                const matchesText = fileMatches.join('\n\n---\n\n');
                const truncated = matchesText.length > limit ? `${matchesText.substring(0, limit)}... [TRUNCADO]` : matchesText;
                results.push(`### Archivo: ${file}\n\n${truncated}`);
              }
            }
          } catch (e: any) {
            results.push(`### Archivo: ${file}\nError al leer o parsear: ${e.message || String(e)}`);
          }
        }

        if (results.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No se encontraron coincidencias para "${args.query}" en ninguno de los ${files.length} documentos locales en "docs/".`,
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Resultados de búsqueda para "${args.query}" en documentos locales:\n\n${results.join('\n\n====================\n\n')}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error al consultar documentos locales: ${error.message || String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}
