import fs from 'fs';
import path from 'path';

/**
 * Carga de forma manual las variables de entorno de un archivo `.env` local.
 * Útil para entornos MCP que no soportan dotenv nativamente o se ejecutan sin variables externas predefinidas.
 */
export function loadEnvManual(): void {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
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
    }
  } catch (e) {
    console.error('Error al parsear el archivo .env de forma manual:', e);
  }
}
