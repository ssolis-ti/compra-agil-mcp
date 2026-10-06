import fs from 'fs';
import path from 'path';
import { carpetaDatos, raizPaquete } from './rutas.js';

/**
 * Carga variables de un `.env` en el orden en que se buscan:
 *   1. el directorio de trabajo (compatibilidad con el uso anterior),
 *   2. la raíz del paquete,
 *   3. la carpeta de datos (ver utils/rutas.ts).
 * Una variable ya definida —en el entorno o en un `.env` anterior— no se pisa.
 *
 * ⚠ Antes solo se buscaba en el directorio de trabajo, y un cliente MCP lanza
 *   el servidor desde el suyo: sin el ticket en la config del cliente, el
 *   servidor terminaba al arrancar (fase 1.0 del roadmap).
 *
 * La carpeta de datos se calcula DESPUÉS de leer los dos primeros, porque
 * `COMPRA_AGIL_DATA_DIR` puede venir en el `.env` del proyecto.
 *
 * Devuelve los archivos leídos, para diagnóstico.
 */
export function loadEnvManual(): string[] {
  const leidos: string[] = [];
  const vistos = new Set<string>();
  const cargar = (dir: string) => {
    const envPath = path.resolve(dir, '.env');
    if (vistos.has(envPath)) return;
    vistos.add(envPath);
    if (cargarArchivo(envPath)) leidos.push(envPath);
  };
  cargar(process.cwd());
  cargar(raizPaquete());
  cargar(carpetaDatos());
  return leidos;
}

function cargarArchivo(envPath: string): boolean {
  try {
    if (!fs.existsSync(envPath)) return false;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Ignorar líneas vacías y comentarios
      if (trimmed && !trimmed.startsWith('#')) {
        const parts = trimmed.split('=');
        const key = parts[0]?.trim();
        const value = parts.slice(1).join('=').trim();
        if (key && value) {
          // Eliminar comillas dobles o simples que encierran el valor
          const cleanValue = value.replace(/^['"]|['"]$/g, '');

          // Solo asignar si no está definida previamente a nivel de sistema para respetar prioridades
          if (process.env[key] === undefined) {
            process.env[key] = cleanValue;
          }
        }
      }
    }
    return true;
  } catch (e) {
    console.error(`Error al parsear el archivo .env (${envPath}):`, e);
    return false;
  }
}
