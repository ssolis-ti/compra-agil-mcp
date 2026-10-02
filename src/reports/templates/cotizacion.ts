/**
 * Template: cotización presentable para un proveedor.
 *
 * Recibe el mismo borrador que devuelve `generar_borrador_cotizacion`.
 * No se envía a Mercado Público.
 */

import type { BorradorCotizacion } from '../../tools/generar-borrador.js';
import { renderDocumento } from '../render.js';
import { portada, kpiRow, tabla, callout, lista, pieDoc, esc } from '../components.js';
import { clp, numero, fecha, fechaLarga, rut } from '../format.js';
import { PAPEL, FORMATO_POR_DEFECTO, type FormatoPapel } from '../theme.js';

export interface CotizacionInformeData {
  borrador: BorradorCotizacion;
  generadoEn: Date;
  formato?: FormatoPapel;
}

function textoPlano(valor: string): string {
  return esc(valor).replace(/\n/g, '<br>');
}

export function renderCotizacionInforme(data: CotizacionInformeData): string {
  const b = data.borrador;
  const formato = data.formato ?? FORMATO_POR_DEFECTO;
  const revisar = b._campos_a_revisar;

  const cuerpo = `
${portada({
  eyebrow: 'Mercado Público · Compra Ágil',
  titulo: 'Cotización',
  subtitulo: b.nombre_compra,
  meta: [
    { label: 'Código', valor: b.codigo_compra },
    { label: 'Organismo', valor: b.organismo_comprador },
    { label: 'Generada', valor: fechaLarga(data.generadoEn) },
  ],
})}

${callout(
  'Borrador, no enviado',
  `<p style="margin:0">${esc(b._advertencia)}</p>`,
  'alerta',
)}

${revisar.length > 0 ? callout('Campos por revisar', lista(revisar), 'alerta') : ''}

${kpiRow([
  { label: 'Valor neto', valor: clp(b.valor_neto) },
  { label: 'IVA 19 %', valor: clp(b.total_impuesto), nota: b.nombre_impuesto },
  { label: 'Total', valor: clp(b.monto_total), nota: 'neto + IVA' },
  { label: 'Plazo', valor: `${numero(b.plazo_entrega_dias)} días`, nota: 'desde la OC' },
])}

<h2>Proveedor</h2>
<p>
  <b>${esc(b.razon_social)}</b><br>
  RUT ${esc(rut(b.rut_proveedor))}<br>
  <small>Empresa de menor tamaño: no se asume. Depende del Registro de Proveedores del RUT real.</small>
</p>

<h2>Ítems cotizados</h2>
${tabla(b.productos_cotizados, [
  { header: 'Código', ancho: '22mm', celda: (p) => `<span class="mono">${esc(p.codigo_producto)}</span>` },
  {
    header: 'Producto',
    celda: (p) => `${esc(p.nombre_producto)}<br><small>${esc(p.descripcion)}</small>`,
  },
  { header: 'Cant.', ancho: '16mm', numerica: true, celda: (p) => numero(p.cantidad) },
  { header: 'P. unitario', ancho: '28mm', numerica: true, celda: (p) => clp(p.precio_unitario) },
  { header: 'Total', ancho: '28mm', numerica: true, celda: (p) => clp(p.monto_total_producto) },
])}

<h2>Carta</h2>
<div class="callout"><div>${textoPlano(b.descripcion_cotizacion)}</div></div>

${callout(
  'De dónde sale el precio',
  `<p style="margin:0">${esc(b.metadata_estimacion.fuente_precio_unitario)} Precio unitario usado: <b>${clp(b.metadata_estimacion.precio_unitario_utilizado)}</b>.</p>`,
)}

${pieDoc(`Borrador generado por mcp-compra-agil el ${fecha(data.generadoEn.toISOString())}. No ha sido enviado a Mercado Público. Revisa los placeholders antes de presentar la cotización real. · Formato de impresión: ${PAPEL[formato].glosa}`)}
`.trim();

  return renderDocumento({
    titulo: `Cotización ${b.codigo_compra}`,
    cuerpo,
    formato,
  });
}
