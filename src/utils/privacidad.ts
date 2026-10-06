/**
 * Quita datos de contacto personales de texto libre antes de imprimirlo.
 *
 * ⚠ E8 (enjambre contra la API real, 6-oct): el informe de competencia copiaba
 *   la descripción libre de cada cotización, y una traía el WhatsApp y el
 *   correo personal del proveedor. Son datos públicos de la API, pero un
 *   informe se imprime y se reenvía: no hacen falta para comparar ofertas.
 *
 * Conservador a propósito: solo correos y teléfonos chilenos con forma
 * reconocible (móvil 9 XXXX XXXX, con o sin +56; fijo con +56). No toca montos
 * ("1.234.567"), códigos de proceso ni RUT.
 */

const CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const MOVIL = /(?:\+?\s?56[\s.-]?)?\b9[\s.-]?\d{4}[\s.-]?\d{4}\b/g;
const FIJO_CON_PREFIJO = /\+\s?56[\s.-]?\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{4}\b/g;
/** «Wsp», «WhatsApp», «Fono», «Tel.» que quedan colgando antes del número. */
const ETIQUETA = /\b(?:wsp|whatsapp|wasap|fono|tel[eé]fono|tel|cel(?:ular)?)\.?:?\s*(?=\[tel)/gi;

export function sinContactos(texto: string): string {
  return texto
    .replace(CORREO, '[correo omitido]')
    .replace(FIJO_CON_PREFIJO, '[teléfono omitido]')
    .replace(MOVIL, '[teléfono omitido]')
    .replace(ETIQUETA, '');
}
