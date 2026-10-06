import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { recolectarDatosPrecios } from '../src/tools/analizar-precios-mercado.js';

/**
 * S4 de la simulación con agentes (6-oct): la descripción decía que las
 * inadmisibles «se excluyen de las estadísticas»; la respuesta y el código las
 * incluían. El analista recalculó: las cifras eran las que las incluyen.
 */

const cot = (unitario: number, inadmisible = false) => ({
  rut_proveedor: '1-9', razon_social: `Prov ${unitario}`, es_emt: false,
  valor_neto: unitario * 10, monto_total: unitario * 12,
  justificacion_inadmisibilidad: inadmisible ? 'No adjunta ficha técnica' : null,
  productos_cotizados: [{ nombre_producto: 'Guantes', cantidad: 10, precio_unitario: unitario }],
});

const desierta = {
  codigo: '1-1-COT26',
  estado: { codigo: 'desierta', glosa: 'Desierta' },
  institucion: { organismo_comprador: 'Hospital', region: 5 },
  proveedores_cotizando: [cot(100), cot(200), cot(300), cot(400, true)],
};

const cliente = {
  buscar: async () => ({ items: [desierta], paginacion: { total_paginas: 1, numero_pagina: 1, tamano_pagina: 10, total_resultados: 1 } }),
  detalle: async () => desierta,
  detallesEnParalelo: async () => [desierta],
};

describe('analizar_precios_mercado: inadmisibles (S4)', () => {
  it('la descripción dice lo que hace el código: las inadmisibles entran', () => {
    const src = readFileSync(new URL('../src/tools/analizar-precios-mercado.ts', import.meta.url), 'utf8');
    const descripcion = src.slice(src.indexOf('const TOOL_DESCRIPTION'), src.indexOf('const inputSchema'));
    expect(descripcion).not.toMatch(/se excluyen de las estadísticas/);
    expect(descripcion).toMatch(/SÍ entran en las estadísticas principales/);
  });

  it('las estadísticas principales incluyen las inadmisibles; las «solo admisibles» no', async () => {
    const rec = await recolectarDatosPrecios(cliente as never, { q: 'guantes' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos.estadisticas_precio_unitario).toMatchObject({ muestras: 4, minimo: 100, maximo: 400 });
    expect(rec.datos.estadisticas_precio_unitario_solo_admisibles).toMatchObject({ muestras: 3, minimo: 100, maximo: 300 });
  });

  it('la nota cuenta las inadmisibles de esta muestra en vez de afirmar «casi todas»', async () => {
    const rec = await recolectarDatosPrecios(cliente as never, { q: 'guantes' });
    if (rec.kind !== 'datos') throw new Error('se esperaban datos');
    expect(rec.datos._nota_metodologica).toContain('en esta muestra, 1 de 4');
    expect(rec.datos._nota_metodologica).not.toMatch(/casi todas lo son/);
  });
});
