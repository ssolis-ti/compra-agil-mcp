import { z } from 'zod';

/**
 * Parámetro `region` validado en el servidor: códigos 1-16, uno o varios
 * separados por coma.
 *
 * ⚠ Antes era un `z.string()` libre. En la simulación con agentes (6-oct)
 *   `region="17"` gastó una consulta y volvió «sin resultados», indistinguible
 *   de «no hubo compras»: el modelo no podía saber que la región no existe.
 */
const CODIGO = /^(?:[1-9]|1[0-6])$/;

export function regionesInvalidas(valor: string): string[] {
  return valor.split(',').map((r) => r.trim()).filter((r) => !CODIGO.test(r));
}

export function esquemaRegion(descripcion: string, { multiple = false }: { multiple?: boolean } = {}) {
  return z.string()
    .refine((v) => (multiple || !v.includes(',')) && regionesInvalidas(v).length === 0, (v) => ({
      message:
        `Región inválida: "${v}". Usa ${multiple ? 'códigos' : 'un código'} del 1 al 16` +
        `${multiple ? ' separados por coma (ej: "13,5")' : ' (ej: "13" para Metropolitana)'}. ` +
        'El recurso compra-agil://regiones lista los códigos. No se consultó la API.',
    }))
    .optional()
    .describe(descripcion);
}
