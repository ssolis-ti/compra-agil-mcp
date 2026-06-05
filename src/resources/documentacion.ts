import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
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
 * Registra el recurso dinámico para consultar manuales y guías locales (PDF/TXT/MD).
 */
export function registerDocumentacionResource(server: McpServer): void {
  // Crear plantilla de URI para compra-agil://documentacion/{filename}
  const template = new ResourceTemplate('compra-agil://documentacion/{filename}', {
    list: async () => {
      try {
        if (!fs.existsSync(DOCS_DIR)) {
          fs.mkdirSync(DOCS_DIR, { recursive: true });
        }

        const files = getRelativeFilesRecursively(DOCS_DIR).filter(file => {
          const ext = path.extname(file).toLowerCase();
          const name = path.basename(file).toLowerCase();
          return (ext === '.pdf' || ext === '.txt' || ext === '.md') && name !== 'readme.md';
        });

        return {
          resources: files.map(file => ({
            uri: `compra-agil://documentacion/${encodeURIComponent(file)}`,
            name: file,
            mimeType: 'text/plain', // Indicamos que el contenido entregado es de texto plano para que el LLM lo interprete
            description: `Manual o Guía de Compra Ágil: ${file}`,
          })),
        };
      } catch (error) {
        console.error('Error al listar recursos de documentación:', error);
        return { resources: [] };
      }
    },
  });

  server.registerResource(
    'documentacion-ayuda',
    template,
    {
      description: 'Obtiene el contenido textual completo de una guía o manual local sobre Compra Ágil usando su nombre de archivo.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      try {
        const filename = decodeURIComponent(variables.filename as string);
        const filePath = path.join(DOCS_DIR, filename);

        if (!fs.existsSync(filePath)) {
          throw new Error(`El archivo ${filename} no existe en la carpeta docs/.`);
        }

        const ext = path.extname(filename).toLowerCase();
        let text = '';

        if (ext === '.pdf') {
          const buffer = fs.readFileSync(filePath);
          const parser = new PDFParse({ data: buffer });
          const pdfData = await parser.getText();
          text = pdfData.text || '';
        } else {
          text = fs.readFileSync(filePath, 'utf8');
        }

        return {
          contents: [{
            uri: uri.toString(),
            mimeType: 'text/plain',
            text: text,
          }],
        };
      } catch (error: any) {
        throw new Error(`Error al leer el manual local: ${error.message || String(error)}`);
      }
    }
  );
}
