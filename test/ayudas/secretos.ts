/**
 * Valores de prueba para cada secreto de la 2.9.0 y la búsqueda de sus
 * apariciones (T1.3, requisito R4.2/R4.5). Ninguno es real.
 *
 * Cada fase que agrega un camino de salida (avisos, estado, canales) suma ese
 * camino a test/secretos.test.ts, con estos mismos valores.
 */
import fs from 'fs';
import path from 'path';

export const SECRETOS_DE_PRUEBA = {
  ticket: 'TICKET-DE-PRUEBA-NO-REAL-5ECRET0',
  telegramToken: '123456789:AAprueba-no-real-TOKEN-telegram',
  webhookSecreto: 'secreto-webhook-de-prueba-no-real',
  webhookUrl: 'https://hooks.ejemplo.test/recibir/tok-no-real-en-la-ruta',
  smtpClave: 'clave-smtp-de-prueba-no-real',
} as const;

/** Las formas en que un secreto puede escaparse: tal cual y codificado para URL. */
function formas(valor: string): string[] {
  return [...new Set([valor, encodeURIComponent(valor)])];
}

/** Nombre del secreto por cada aparición en el texto. */
export function secretosEn(texto: string): string[] {
  return Object.entries(SECRETOS_DE_PRUEBA)
    .filter(([, v]) => formas(v).some((f) => texto.includes(f)))
    .map(([k]) => k);
}

/** Todo el texto de los archivos de una carpeta, recursivo. */
export function textoDeCarpeta(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? textoDeCarpeta(p) : `\n--- ${e.name}\n${fs.readFileSync(p, 'utf8')}`;
  }).join('');
}
