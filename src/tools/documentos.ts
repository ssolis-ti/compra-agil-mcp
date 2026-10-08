import { z } from 'zod';
import { esquemaCodigoCompra } from '../utils/validacion.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs';
import path from 'path';
import { textoDePdf } from '../utils/pdf.js';
import { leerTextoLocal } from '../utils/texto-local.js';
import { resolveDocsDir, listSupportedDocs } from '../utils/docs-locator.js';
import { agruparCatalogo, anteponerManualServidor, anteponerSanciones, buscarEnTexto, consultaSensible, consultaTecnica, deduplicarDocumentos, marcarSiEsGuiaOficial, recortarArchivos, recortarEnPalabra, relegarDocumentosTecnicos } from '../utils/doc-search.js';
import { safeError } from '../utils/redact.js';

const DOCS_DIR = resolveDocsDir();

/** Corte de la descarga de un adjunto. Sin él, un portal que no responde colgaba la herramienta. */
const TIMEOUT_DESCARGA_MS = 30_000;
/** Un PDF de bases rara vez pasa de unos MB; más que esto no cabe en el contexto de todos modos. */
const MAX_BYTES_ADJUNTO = 20 * 1024 * 1024;

/** La ficha es el camino. La descarga heredada responde 404 y no se ofrece. */
export function textoEnlaceAdjunto(idDocumento: string, codigoCompra: string): string {
  const fichaUrl = `https://buscador.mercadopublico.cl/ficha?code=${codigoCompra}`;
  return `Para acceder al adjunto ${idDocumento}, abre la ficha pública del proceso (no requiere iniciar sesión):\n${fichaUrl}\n\nLa descarga directa heredada responde 404 para los adjuntos de Compra Ágil. No la abras.`;
}

/**
 * Registra las herramientas relacionadas con documentos y especificaciones en el servidor MCP.
 */
export function registerDocumentosTools(server: McpServer): void {
  
  // ─── 1. OBTENER ENLACE DE DOCUMENTO DE PROCESO ───────────────────────
  server.registerTool(
    'obtener_enlace_documento',
    {
      title: "Enlace a un adjunto del proceso",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Entrega la ficha pública del proceso, que es donde se abre el adjunto. No hay un enlace de descarga que funcione: el enlace heredado responde 404. No requiere iniciar sesión para ver la ficha.',
      inputSchema: {
        id_documento: z.string().describe('ID único del documento. Ej: "123456" o un UUID como "5f47e991-c525-40a0-b36c-44d53e538ae5".'),
        codigo_compra: esquemaCodigoCompra().describe('Código de la Compra Ágil asociada (Ej: "2494-141-COT26"). Requerido para generar el enlace de la ficha pública.'),
      },
    },
    async (args) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.id_documento);
      const fichaUrl = `https://buscador.mercadopublico.cl/ficha?code=${args.codigo_compra}`;

      if (isUuid) {
        return {
          content: [{
            type: 'text' as const,
            text: `El documento solicitado (${args.id_documento}) corresponde a un archivo adjunto de Compra Ágil. Debido a las políticas de seguridad del portal, los enlaces de descarga directa requieren autenticación activa (Clave Única) y arrojan error si se abren directamente.\n\nPara acceder y descargar el archivo de forma pública y sin iniciar sesión, visita la ficha del proceso en el buscador de Mercado Público:\n${fichaUrl}`,
          }],
        };
      } else {
        // Medido en septiembre 2026: el endpoint heredado responde 404
        // para los adjuntos de Compra Ágil, aun con IDs numéricos válidos.
        return {
          content: [{
            type: 'text' as const,
            text: textoEnlaceAdjunto(args.id_documento, args.codigo_compra),
          }],
        };
      }
    }
  );

  // ─── 2. DESCARGAR Y LEER DOCUMENTO DE PROCESO (REMOTO) ───────────────
  server.registerTool(
    'descargar_y_leer_documento',
    {
      title: "Leer un adjunto del proceso",
      annotations: { readOnlyHint: true, openWorldHint: true },
      description: `Intenta descargar un adjunto de Compra Ágil (bases técnicas/administrativas) y extraer su texto.
⚠ IMPORTANTE: para los IDs numéricos —que son los que entrega esta API— el portal ya NO sirve el archivo, así que la herramienta responde de inmediato con el enlace a la ficha pública en vez de intentar una descarga que se sabe fallida. Si necesitas las especificaciones para cotizar, tendrás que abrir esa ficha en un navegador: el enlace del adjunto lo genera JavaScript y no existe una URL que un programa pueda pedir.`,
      inputSchema: {
        id_documento: z.string().describe('ID único del documento. Ej: "123456" o un UUID.'),
        codigo_compra: esquemaCodigoCompra().optional().describe('Código de la Compra Ágil asociada (Ej: "2494-141-COT26"). Permite guiar al usuario a la ficha pública en caso de fallar la descarga.'),
        query: z.string().optional().describe('Si se proporciona, busca y retorna solo fragmentos que contengan este término (case-insensitive).'),
        max_caracteres: z.number().min(500).max(15000).default(5000).optional().describe('Límite de caracteres a retornar (default 5000) para evitar saturar el contexto de la IA.'),
      },
    },
    async (args) => {
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.id_documento);

        // ⚠ NO se intenta la descarga de IDs numéricos: se comprobó que el
        //   endpoint heredado responde 404 para todos los adjuntos de Compra
        //   Ágil (IDs 1855508 y 1854909, de procesos distintos), y la causa es
        //   estructural — en la ficha el enlace es un <a> con href vacío, la
        //   descarga la dispara JavaScript y no hay URL estática que pedir.
        //   Gastar una petición y esperar su timeout para confirmar un fallo
        //   conocido solo retrasa la única respuesta útil, que es el enlace.
        //
        //   Los UUID SÍ se intentan: usan otro endpoint (adjunto.mercadopublico.cl)
        //   que nunca se pudo ejercitar, así que no se da por muerto sin prueba.
        //   Si algún día vuelven a servirse los numéricos, esta guarda es el
        //   punto por donde revertirlo.
        if (!isUuid) {
          const ficha = args.codigo_compra
            ? `\n\nÁbrelo desde la ficha pública del proceso (en un navegador, sin iniciar sesión):\nhttps://buscador.mercadopublico.cl/ficha?code=${args.codigo_compra}`
            : '\n\nBusca el código de la compra en https://buscador.mercadopublico.cl y abre su ficha para ver el adjunto.';
          return {
            content: [{
              type: 'text' as const,
              text: `El adjunto ${args.id_documento} no se puede descargar por programa: Mercado Público dejó de servir los adjuntos de Compra Ágil por enlace directo, y en la ficha el archivo se descarga mediante JavaScript, sin una URL que se pueda pedir.${ficha}\n\nSi necesitas las especificaciones técnicas para cotizar, suelen estar solo en ese adjunto, así que conviene abrirlo ahí.`,
            }],
          };
        }

        const url = `https://adjunto.mercadopublico.cl/adjunto-compra-agil/descargar/${args.id_documento}`;

        // Descargar PDF
        let response: Response;
        try {
          response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(TIMEOUT_DESCARGA_MS),
          });
        } catch (e) {
          if ((e as { name?: string } | null)?.name !== 'TimeoutError') throw e;
          const ficha = args.codigo_compra
            ? ` Ábrelo desde la ficha pública: https://buscador.mercadopublico.cl/ficha?code=${args.codigo_compra}`
            : '';
          return {
            content: [{
              type: 'text' as const,
              text: `El portal no entregó el adjunto ${args.id_documento} en ${TIMEOUT_DESCARGA_MS / 1000} s y la descarga se canceló.${ficha}`,
            }],
            isError: true,
          };
        }
 
        // ⚠ 404 se trata igual que 401/403 y no como un fallo inesperado:
        //   verificado contra el servicio real (septiembre 2026) que el endpoint
        //   heredado RetornaDocumento.aspx responde 404 para los adjuntos de
        //   Compra Ágil, incluso con IDs numéricos entregados por la propia API
        //   (probados 1855508 y 1854909, de procesos distintos). Para el usuario
        //   la situación práctica es la misma que un bloqueo: hay que ir a la
        //   ficha. Devolver un "Error HTTP 404" pelado hacía que el modelo
        //   informara una falla técnica en vez de la vía alternativa que sí sirve.
        if (!response.ok) {
          const fichaMsg = args.codigo_compra
            ? `\n\nDescarga el archivo desde la ficha pública del proceso (se abre en el navegador, sin iniciar sesión):\nhttps://buscador.mercadopublico.cl/ficha?code=${args.codigo_compra}`
            : '\n\nBusca el código de la compra en https://buscador.mercadopublico.cl para descargar el archivo desde su ficha.';

          const causa = response.status === 404
            ? `el portal ya no expone este adjunto por descarga directa (HTTP 404). Es el comportamiento observado para los adjuntos de Compra Ágil, no un error de tu consulta`
            : `el servidor de Mercado Público requiere autenticación (Clave Única) o bloquea las solicitudes programáticas (HTTP ${response.status})`;

          return {
            content: [{
              type: 'text' as const,
              text: `No fue posible descargar el documento ${args.id_documento} automáticamente: ${causa}.${fichaMsg}\n\nSi necesitas las especificaciones técnicas para cotizar, ábrelo desde ese enlace: suelen estar solo en el adjunto.`,
            }],
          };
        }
        
        const declarado = Number(response.headers.get('content-length'));
        if (Number.isFinite(declarado) && declarado > MAX_BYTES_ADJUNTO) {
          return {
            content: [{
              type: 'text' as const,
              text: `El adjunto ${args.id_documento} pesa ${(declarado / 1024 / 1024).toFixed(1)} MB, sobre el máximo de ${MAX_BYTES_ADJUNTO / 1024 / 1024} MB que se procesa. Ábrelo desde la ficha pública del proceso.`,
            }],
            isError: true,
          };
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Parsear PDF
        const text = await textoDePdf(buffer);
        
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
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error al procesar el documento remoto: ${safeError(error)}`,
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
      title: "Consultar las guías locales",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Busca en los manuales y guías locales de docs/ (.pdf, .txt, .md). Devuelve como máximo 3 archivos y nombra los que quedaron fuera. En preguntas sobre este servidor o la API, el manual del servidor va primero: describe el comportamiento medido. En preguntas de negocio (plazos, multas, requisitos) mandan las guías. La guía oficial de ChileCompra describe la API prometida y puede contradecir al manual. Si ningún fragmento reúne al menos la mitad de los términos buscados, lo advierte.',
      inputSchema: {
        query: z.string().optional().describe('Qué buscar. Admite tanto un término suelto ("multas", "garantía") como una pregunta en lenguaje natural ("¿qué multas me pueden aplicar?"): la consulta se descompone en términos y se ignoran acentos y palabras vacías. Si se omite, lista los documentos disponibles.'),
        max_caracteres: z.number().min(500).max(15000).default(3000).optional().describe('Cantidad máxima de texto a retornar de cada coincidencia.'),
      },
    },
    async (args) => {
      try {
        if (!fs.existsSync(DOCS_DIR)) {
          fs.mkdirSync(DOCS_DIR, { recursive: true });
        }

        const files = listSupportedDocs(DOCS_DIR);

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
          const fileList = agruparCatalogo(files).map((grupo) => {
            const detalle = grupo.archivos.map((file) => {
              const stats = fs.statSync(path.join(DOCS_DIR, file));
              return `${file} (${(stats.size / 1024).toFixed(1)} KB)`;
            }).join(' y ');
            const mismo = grupo.archivos.length > 1 ? ' — el mismo documento en más de un formato' : '';
            return `- ${detalle}${mismo}`;
          }).join('\n');

          return {
            content: [{
              type: 'text' as const,
              text: `Documentos locales de ayuda disponibles en "docs/":\n\n${fileList}\n\nEl comportamiento medido de este servidor está en api/manual_servidor_mcp.md.\n\nPara buscar dentro de ellos, ejecuta esta herramienta especificando el parámetro "query".`,
            }],
          };
        }

        const coincidencias: { archivo: string; mejorPuntaje: number; texto: string }[] = [];
        const errores: string[] = [];
        // Términos que sí aparecieron en algún documento, para poder explicar
        // un resultado vacío en vez de afirmar que no existe información.
        const terminosEncontrados = new Set<string>();
        let terminosConsulta: string[] = [];
        let mejorCobertura = 0;

        for (const file of files) {
          const filePath = path.join(DOCS_DIR, file);

          try {
            // Memorizado por archivo (fase 1.3): antes se extraían los 7 PDF en cada consulta.
            const fileText = await leerTextoLocal(filePath);

            const hallazgo = buscarEnTexto(fileText, args.query);
            terminosConsulta = hallazgo.terminos;
            for (const f of hallazgo.fragmentos) {
              for (const t of f.terminos) terminosEncontrados.add(t);
              mejorCobertura = Math.max(mejorCobertura, f.terminos.length);
            }

            if (hallazgo.fragmentos.length > 0) {
              const limit = args.max_caracteres || 3000;
              const matchesText = hallazgo.fragmentos.map((f) => f.texto).join('\n\n---\n\n');
              const truncated = recortarEnPalabra(matchesText, limit);
              const cubiertos = [...new Set(hallazgo.fragmentos.flatMap((f) => f.terminos))];
              const cuerpo = `### Archivo: ${file}\n(términos encontrados aquí: ${cubiertos.join(', ')})\n\n${truncated}`;
              coincidencias.push({
                archivo: file,
                mejorPuntaje: hallazgo.fragmentos[0]?.puntaje ?? 0,
                texto: marcarSiEsGuiaOficial(file, cuerpo),
              });
            }
          } catch (e) {
            errores.push(`### Archivo: ${file}\nError al leer o parsear: ${safeError(e)}`);
          }
        }

        const unicos = deduplicarDocumentos(coincidencias);
        const orden = consultaTecnica(args.query)
          ? anteponerManualServidor(unicos, terminosConsulta.length, consultaSensible(args.query))
          : { resultados: relegarDocumentosTecnicos(unicos), manualPrimero: false };
        const conSanciones = anteponerSanciones(orden.resultados, args.query, orden.manualPrimero);
        const recorte = recortarArchivos(conSanciones, orden.manualPrimero);
        const results = [...recorte.resultados.map((r) => r.texto), ...errores];

        if (results.length === 0) {
          const detalle = terminosConsulta.length > 0
            ? `\n\nLa consulta se buscó como los términos: ${terminosConsulta.join(', ')}. Ninguno aparece en los documentos. Prueba con sinónimos o con un término más general.`
            : '';
          return {
            content: [{
              type: 'text' as const,
              text: `No se encontraron coincidencias para "${args.query}" en ninguno de los ${files.length} documentos locales en "docs/".${detalle}`,
            }],
          };
        }

        const aviso = orden.manualPrimero
          ? '\n\nEl primer archivo es el manual de este servidor. Describe el comportamiento medido. Los otros archivos describen la API o las guías prometidas y pueden contradecirlo.'
          : '';
        // E6: «¿Cuántos días tengo para cotizar?» devolvía fragmentos de otros
        // temas sin advertir que ninguno respondía la pregunta.
        // Solo con menos de la mitad: no se puede saber si un texto responde,
        // y un aviso que salta siempre (probado: saltaba en la de multas, bien
        // respondida) deja de leerse.
        const avisoCobertura = terminosConsulta.length >= 2 && mejorCobertura * 2 < terminosConsulta.length
          ? `\n\nNingún fragmento reúne todos los términos buscados (${terminosConsulta.join(', ')}): el mejor reúne ${mejorCobertura} de ${terminosConsulta.length}. Puede que los documentos no respondan esta pregunta de forma directa.`
          : '';
        const nombresOmitidos = recorte.omitidos.map((r) => r.archivo).join(', ');
        const avisoTope = recorte.omitidos.length === 0
          ? ''
          : recorte.omitidos.length === 1
            ? `\n\nQuedó fuera 1 archivo: ${nombresOmitidos}. Acota la consulta para traerlo.`
            : `\n\nQuedaron fuera ${recorte.omitidos.length} archivos: ${nombresOmitidos}. Acota la consulta para traer uno de ellos.`;

        return {
          content: [{
            type: 'text' as const,
            text: `Resultados de búsqueda para "${args.query}" en documentos locales:${aviso}${avisoCobertura}${avisoTope}\n\n${results.join('\n\n====================\n\n')}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error al consultar documentos locales: ${safeError(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}
