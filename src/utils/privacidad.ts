/**
 * Quita datos de contacto personales de texto libre antes de imprimirlo.
 *
 * ⚠ E8 (enjambre contra la API real, 6-oct): el informe de competencia copiaba
 *   la descripción libre de cada cotización, y una traía el WhatsApp y el
 *   correo personal del proveedor. Son datos públicos de la API, pero un
 *   informe se imprime y se reenvía: no hacen falta para comparar ofertas.
 *
 * Conservador a propósito: correos, sitios web, teléfonos chilenos con forma
 * reconocible (móvil 9 XXXX XXXX, con o sin +56; fijo con +56), RUT escritos en
 * el texto y nombres precedidos de un rótulo («Nombre:», «Contacto:»). Un nombre
 * suelto no se puede reconocer sin inventar. No toca montos ("1.234.567") ni
 * códigos de proceso.
 */

const CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Sitios web: «www.algo.cl», «https://…». Segundo enjambre: aparecía el sitio personal de un oferente. */
const SITIO = /\b(?:https?:\/\/|www\.)[^\s,;)]+/gi;
/** RUT escrito en el texto libre (no la columna del cotizante, que identifica la oferta). */
const RUT_EN_TEXTO = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
/** «NOMBRE: DEISY CONTRERAS», «Contacto: Julio Sepúlveda»: el nombre hasta el próximo separador. */
const CONTACTO_ROTULADO = /\b(nombre|contacto|atenci[oó]n|vendedor|ejecutiv[oa]|encargad[oa])\s*:\s*[^,;.\n|]+/gi;
const MOVIL = /(?:\+?\s?56[\s.-]?)?\b9[\s.-]?\d{4}[\s.-]?\d{4}\b/g;
const FIJO_CON_PREFIJO = /\+\s?56[\s.-]?\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{4}\b/g;
/** «Wsp», «WhatsApp», «Fono», «Tel.» que quedan colgando antes del número. */
const ETIQUETA = /\b(?:wsp|whatsapp|wasap|fono|tel[eé]fono|tel|cel(?:ular)?)\.?:?\s*(?=\[tel)/gi;

export function sinContactos(texto: string): string {
  return texto
    .replace(CORREO, '[correo omitido]')
    .replace(SITIO, '[sitio omitido]')
    .replace(CONTACTO_ROTULADO, (_m, rotulo: string) => `${rotulo}: [contacto omitido]`)
    .replace(RUT_EN_TEXTO, '[RUT omitido]')
    .replace(FIJO_CON_PREFIJO, '[teléfono omitido]')
    .replace(MOVIL, '[teléfono omitido]')
    .replace(ETIQUETA, '');
}
