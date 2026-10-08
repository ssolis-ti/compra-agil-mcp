/**
 * Lectura de PDF, cargada solo cuando hace falta.
 *
 * ⚠ POR QUÉ NO SE IMPORTA ARRIBA: `pdf-parse` carga al importarse
 *   `@napi-rs/canvas`, un módulo nativo (.node). Instalado como extensión de
 *   Claude Desktop, el servidor corre con el Node que trae Claude, y el
 *   proceso moría al arrancar sin escribir nada (prueba real del 8-oct): ni
 *   la primera línea del log. Cargarlo al leer el primer PDF deja arrancar el
 *   servidor siempre; si el módulo no carga, solo falla la lectura de PDF, y
 *   lo dice.
 */

/** Texto de un PDF. Lanza un error legible si la librería no se puede cargar. */
export async function textoDePdf(datos: Buffer | Uint8Array): Promise<string> {
  let PDFParse: typeof import('pdf-parse').PDFParse;
  try {
    ({ PDFParse } = await import('pdf-parse'));
  } catch (error) {
    throw new Error(`No se pudo cargar el lector de PDF en este equipo (${error instanceof Error ? error.message : String(error)}). El resto del servidor funciona.`, { cause: error });
  }
  const parser = new PDFParse({ data: datos });
  return (await parser.getText()).text || '';
}
