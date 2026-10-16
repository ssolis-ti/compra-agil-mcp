/** Límites al leer archivos de terceros (2.10.0, S3). */
export const LIMITES = {
  /** Lo que se descarga o lee de un archivo. */
  archivoMaxBytes: 20 * 1024 * 1024,
  /** Lo descomprimido de un .docx, .xlsx o .zip, sumado. */
  descomprimidoMaxBytes: 100 * 1024 * 1024,
  /** Archivos que se leen dentro de un .zip. */
  archivosEnZip: 50,
  /** Filas por hoja de Excel o CSV. */
  filasPorHoja: 5000,
};
