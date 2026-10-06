import { describe, it, expect, vi } from 'vitest';
import type { BuscarParams } from '../src/api/compra-agil-client.js';
import { recolectarDatosPrecios } from '../src/tools/analizar-precios-mercado.js';

/**
 * S3 de la simulación con agentes (6-oct): con `codigo_compra`, el análisis se
 * limitaba en silencio a la región del comprador, respondía «quita el filtro
 * de región» (que el usuario no puso) y contradecía al borrador, que busca en
 * todo el país.
 */

const activa = {
  codigo: '4449-111-COT26',
  nombre: 'Insumos de aseo',
  institucion: { region: 5 },
  productos_solicitados: [{ nombre: 'Kit de aseo', cantidad: 185, unidad_medida: 'Kit' }],
};

const desierta = {
  codigo: '9-9-COT26',
  nombre: 'Kit de aseo',
  estado: { codigo: 'desierta', glosa: 'Desierta' },
  institucion: { region: 13, organismo_comprador: 'Municipalidad' },
  fechas: {},
  proveedores_cotizando: [
    { rut_proveedor: '1-9', razon_social: 'A', valor_neto: 7_400_000, productos_cotizados: [{ cantidad: 185, precio_unitario: 40_000 }] },
  ],
};

function cliente(hayResultados: boolean) {
  const buscar = vi.fn(async (_p: BuscarParams) => ({
    items: hayResultados ? [desierta] : [],
    paginacion: { total_paginas: hayResultados ? 1 : 0, numero_pagina: 1, tamano_pagina: 10, total_resultados: hayResultados ? 1 : 0 },
  }));
  return {
    buscar,
    detalle: async () => activa,
    detallesEnParalelo: async () => [desierta],
  };
}

describe('analizar_precios_mercado con codigo_compra (S3)', () => {
  it('no impone la región del comprador: busca en todo el país, como el borrador', async () => {
    const c = cliente(true);
    const rec = await recolectarDatosPrecios(c as never, { codigo_compra: '4449-111-COT26' });
    expect(c.buscar).toHaveBeenCalledTimes(1);
    expect(c.buscar.mock.calls[0][0].region).toBeUndefined();
    expect(rec.kind).toBe('datos');
    if (rec.kind !== 'datos') return;
    expect(rec.datos.region_analisis).toBe('Todas las regiones (el comprador es de la región 5; pasa "region": "5" para acotar)');
  });

  it('respeta una región pedida explícitamente', async () => {
    const c = cliente(true);
    await recolectarDatosPrecios(c as never, { codigo_compra: '4449-111-COT26', region: '5' });
    expect(c.buscar.mock.calls[0][0].region).toBe('5');
  });

  it('sin resultados nacionales no pide quitar un filtro que no existe', async () => {
    const rec = await recolectarDatosPrecios(cliente(false) as never, { codigo_compra: '4449-111-COT26' });
    expect(rec.kind).toBe('mensaje');
    if (rec.kind !== 'mensaje') return;
    expect(rec.texto).toContain('en todo el país');
    expect(rec.texto).not.toMatch(/quita el filtro de región/);
  });

  it('sin resultados en una región pedida, sugiere el análisis nacional', async () => {
    const rec = await recolectarDatosPrecios(cliente(false) as never, { q: 'kit de aseo', region: '5' });
    if (rec.kind !== 'mensaje') throw new Error('se esperaba mensaje');
    expect(rec.texto).toContain('en la región 5');
    expect(rec.texto).toContain('sin el parámetro "region"');
  });
});
