/**
 * Escritura de informes a disco.
 *
 * DECISIÓN CLAVE DE DISEÑO: el HTML NUNCA se devuelve al LLM.
 * Un informe pesa decenas de KB; retornarlo como texto consumiría miles de
 * tokens de contexto por cada llamada. La tool escribe el archivo y devuelve
 * solo la ruta más un resumen breve.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { carpetaDatos } from '../utils/rutas.js';

/** Directorio de salida por defecto: informes/ en la carpeta de datos (ver utils/rutas.ts). */
export function defaultOutputDir(): string {
  return path.join(carpetaDatos(), 'informes');
}

/**
 * Carpeta raíz de los informes: `COMPRA_AGIL_INFORMES_DIR` o `./informes`.
 *
 * ⚠ POR QUÉ HAY UNA RAÍZ: `ruta_salida` la elige el modelo, y el modelo lee
 *   textos que escribe cualquiera (nombres de procesos, razones sociales).
 *   Antes se aceptaba cualquier carpeta del disco: una instrucción inyectada
 *   en un dato de la API podía hacer escribir archivos donde quisiera
 *   (verificado en la auditoría QA, octubre 2026). Quien quiera otra carpeta
 *   la configura en el entorno, que el modelo no controla.
 */
export function raizInformes(): string {
  const configurada = process.env.COMPRA_AGIL_INFORMES_DIR?.trim();
  return configurada ? path.resolve(configurada) : defaultOutputDir();
}

/** `ruta_salida` apunta fuera de la raíz de informes. */
export class RutaSalidaError extends Error {
  constructor(public readonly pedida: string, public readonly raiz: string) {
    super(
      `La carpeta "${pedida}" queda fuera de la carpeta de informes (${raiz}). ` +
      `"ruta_salida" solo acepta una subcarpeta dentro de ella, por ejemplo "radar/octubre". ` +
      `Para guardar en otra parte, configura la variable de entorno COMPRA_AGIL_INFORMES_DIR.`
    );
    this.name = 'RutaSalidaError';
  }
}

function dentroDe(raiz: string, destino: string): boolean {
  const rel = path.relative(raiz, destino);
  // Otra unidad en Windows da una ruta absoluta; subir da "..".
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

/**
 * Resuelve la carpeta de destino DENTRO de la raíz de informes.
 * Una ruta relativa cuelga de la raíz; una absoluta se acepta solo si cae
 * dentro de ella. Lanza `RutaSalidaError` si no.
 */
export function resolverDirectorioSalida(dir?: string): string {
  const raiz = raizInformes();
  if (!dir || !dir.trim()) return raiz;
  let pedido = dir.trim();
  if (process.platform !== 'win32') {
    // ⚠ En Linux/macOS `path` no reconoce `C:\…` ni `\\servidor\…` como
    //   absolutas: en la simulación con agentes (6-oct) «C:\Users\…\Desktop»
    //   creó una carpeta con ese nombre literal dentro de informes/ y la
    //   herramienta respondió ✅. Una ruta de Windows es siempre externa.
    if (/^[a-zA-Z]:[\\/]/.test(pedido) || pedido.startsWith('\\\\')) throw new RutaSalidaError(dir, raiz);
    // Una subcarpeta escrita con barras de Windows («radar\octubre») es una
    // subcarpeta, no un nombre con barras invertidas.
    pedido = pedido.replace(/\\/g, '/');
  }
  const destino = path.resolve(raiz, pedido);
  if (!dentroDe(raiz, destino)) throw new RutaSalidaError(dir, raiz);
  return destino;
}

/**
 * Convierte un texto en un fragmento seguro para nombre de archivo.
 * Ej: "Radar RM / julio" → "radar-rm-julio"
 */
export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar diacríticos combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'informe';
}

/** Marca temporal compacta para nombres de archivo: 20260715-0930 */
export function stamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export interface EscrituraResultado {
  ruta: string;
  bytes: number;
}

/**
 * Escribe el HTML en disco creando el directorio si no existe.
 * Retorna la ruta absoluta y el tamaño resultante.
 */
export function escribirInforme(html: string, nombreArchivo: string, dir?: string): EscrituraResultado {
  const destinoDir = resolverDirectorioSalida(dir);
  fs.mkdirSync(destinoDir, { recursive: true });

  // Un enlace simbólico dentro de la raíz podría apuntar afuera: se compara
  // la ruta real, ya creada.
  const raizReal = fs.realpathSync(raizInformes());
  if (!dentroDe(raizReal, fs.realpathSync(destinoDir))) {
    throw new RutaSalidaError(dir ?? '', raizInformes());
  }

  // El nombre lo arma el servidor, pero nunca debe poder salir de la carpeta.
  const ruta = path.join(destinoDir, path.basename(nombreArchivo));
  fs.writeFileSync(ruta, html, 'utf8');

  const bytes = Buffer.byteLength(html, 'utf8');
  logger.info(`Informe generado: ${ruta} (${(bytes / 1024).toFixed(1)} KB)`);
  return { ruta, bytes };
}
