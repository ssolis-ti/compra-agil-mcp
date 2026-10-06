import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CompraAgilDetalle } from '../src/api/compra-agil-client.js';
import { recolectarDatosPrecios } from '../src/tools/analizar-precios-mercado.js';
import { extraerLineaCotizada } from '../src/utils/quotation.js';
import { recolectarDatosAuditoria, categoriaInadmisibilidad } from '../src/tools/auditar-desiertas.js';

/**
 * Segundo enjambre de agentes contra la API real (6-oct, 2.8.0): el analista
 * encontró que «nitrilo» promediaba precios de carpas y de depósitos químicos
 * como si fueran guantes, con la muestra declarada homogénea, y que «resmas»
 * sugería un precio sin advertir que las 10 cotizaciones fueron rechazadas por
 * sobrepasar el presupuesto. Estos tests usan esas respuestas REALES de la API.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { detalles } = JSON.parse(fs.readFileSync(path.join(RAIZ, 'test', 'fixtures', 'enjambre2-detalles.json'), 'utf8')) as {
  detalles: Record<string, CompraAgilDetalle>;
};

function cliente(codigos: string[]) {
  return {
    buscar: async () => ({
      items: codigos.map((codigo) => ({ codigo, nombre: detalles[codigo].nombre, institucion: detalles[codigo].institucion, fechas: {} })),
      paginacion: { total_paginas: 1, numero_pagina: 1, tamano_pagina: 10, total_resultados: codigos.length },
    }),
    detalle: async (c: string) => detalles[c],
    detallesEnParalelo: async (cs: string[]) => cs.map((c) => detalles[c]),
  };
}

describe('la línea cotizada correcta (datos reales)', () => {
  const guantes = detalles['2048-540-COT26'].proveedores_cotizando[0];

  it('entre varias líneas, «nitrilo» no coincide con ninguna: no se toma la primera (depósitos químicos)', () => {
    expect(extraerLineaCotizada(guantes, 'nitrilo')).toEqual({ precio: null, producto: null });
  });

  it('«guantes de nitrilo» encuentra «Guantes médicos…», sin tildes ni plurales', () => {
    const l = extraerLineaCotizada(guantes, 'guantes de nitrilo');
    expect(l.producto).toMatch(/^Guantes médicos/);
    expect(l.precio).toBe(1970);
  });
});

describe('auditar_compras_desiertas sobre 2440-1659-COT26 (dato real de la auditora)', () => {
  // 11 cotizaciones contra $1.000.000: 4 rechazadas por precio, una de ellas de
  // $957.980 neto ($1.139.996 con IVA); 6 por especificaciones; 1 por cobrar
  // despacho. La 2.8.0 previa decía «Presupuesto en rango» y recomendaba revisar
  // certificaciones, que ningún motivo mencionaba.
  async function auditar() {
    const c = { ...cliente(['2440-1659-COT26']), buscar: async () => ({ items: [] }), detallesEnParalelo: async () => [] };
    const rec = await recolectarDatosAuditoria(c as never, { codigo_compra: '2440-1659-COT26' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    return rec.datos;
  }

  it('clasifica los motivos reales por categoría', () => {
    expect(categoriaInadmisibilidad('El valor ofertado sobrepasa el monto máximo disponible para la compra.')).toBe('precio');
    expect(categoriaInadmisibilidad(' COBRA  DESPACHO ')).toBe('entrega');
    expect(categoriaInadmisibilidad(' NO CORRESPONDE MODELO DE  PROCESADOR ')).toBe('especificaciones');
    expect(categoriaInadmisibilidad(' LICENCIA NO CORRESPONDE  A LO SOLICITADO')).toBe('especificaciones');
  });

  it('infiere que el comprador aplicó el presupuesto con IVA y lo marca como insuficiente', async () => {
    const d = await auditar();
    expect(d.evidencia_del_proceso_auditado).toMatchObject({
      presupuesto_aplicado_con_iva: true,
      cotizaciones_sobre_presupuesto: 5,
      cotizaciones_sobre_presupuesto_con_iva: 7,
      inadmisibilidad_por_categoria: { precio: 4, especificaciones: 6, entrega: 1, documentos: 0, otra: 0 },
    });
    expect(d.analisis_de_brechas.presupuesto_insuficiente).toBe(true);
    expect(d.recomendaciones_de_optimizacion.join(' ')).toMatch(/4 de 11 cotizaciones fueron rechazadas por sobrepasar.*aplicó el presupuesto con IVA: con IVA, 7 de 11/);
  });

  it('recomienda según los motivos que hubo, sin inventar certificaciones', async () => {
    const texto = (await auditar()).recomendaciones_de_optimizacion.join(' ');
    expect(texto).toMatch(/6 por especificaciones, 1 por condiciones de entrega o despacho, 4 por precio/);
    expect(texto).toMatch(/si el despacho va incluido/);
    expect(texto).not.toMatch(/certificaciones/);
  });
});

describe('analizar_precios_mercado sobre las muestras reales del enjambre', () => {
  it('«nitrilo»: avisa que la muestra mezcla productos y nombra cuáles', async () => {
    const rec = await recolectarDatosPrecios(cliente(['744835-588-COT26', '2048-540-COT26']) as never, { q: 'nitrilo', limite_analisis: 2 });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    const d = rec.datos;
    // Los depósitos químicos ya no entran: solo quedan las carpas (la única línea de su proceso).
    expect(d.productos_en_la_muestra).toEqual({ Carpas: 5 });
    expect(d.cotizaciones_observadas.some((c) => c.producto_cotizado?.startsWith('Depósitos'))).toBe(false);
  });

  it('«guantes de nitrilo»: carpas y guantes en la misma muestra → no homogénea, con advertencia', async () => {
    const rec = await recolectarDatosPrecios(cliente(['744835-588-COT26', '2048-540-COT26']) as never, { q: 'guantes de nitrilo', limite_analisis: 2 });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    const d = rec.datos;
    expect(Object.keys(d.productos_en_la_muestra ?? {}).sort()).toEqual(['Carpas', 'Guantes médicos de examen o para usos no quirúrgicos']);
    expect(d.muestra_homogenea).toBe(false);
    expect(d._advertencia_productos).toMatch(/LA MUESTRA MEZCLA PRODUCTOS: .*«Carpas» \(5\)/);
    expect(d.criterio_sugerencia).toMatch(/Mezcla productos distintos/);
  });

  it('«resmas»: un solo producto, homogénea, pero sesgada hacia arriba (10 de 10 rechazadas por precio)', async () => {
    const rec = await recolectarDatosPrecios(cliente(['1391-601-COT26']) as never, { q: 'resmas', limite_analisis: 1 });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    const d = rec.datos;
    expect(d.productos_en_la_muestra).toEqual({ 'Papel para fotocopiadora o impresora': 10 });
    expect(d.muestra_homogenea).toBe(true);
    expect(d._advertencia_sesgo).toMatch(/^⚠ 10 de 10 cotizaciones fueron rechazadas por sobrepasar el presupuesto/);
    // Las estadísticas no cambian: siguen siendo las verificadas a mano contra la API real.
    expect(d.estadisticas_precio_unitario).toMatchObject({ minimo: 2805, maximo: 8549, mediana: 3563, p25: 3409, promedio: 4018 });
  });

  it('los motivos de inadmisibilidad no se duplican por un espacio final', async () => {
    const rec = await recolectarDatosPrecios(cliente(['744835-588-COT26']) as never, { q: 'nitrilo', limite_analisis: 1 });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    const motivos = rec.datos.cobertura.motivos_de_inadmisibilidad;
    expect(new Set(motivos.map((m) => m.trim())).size).toBe(motivos.length);
    expect(motivos.every((m) => m === m.trim())).toBe(true);
  });
});
