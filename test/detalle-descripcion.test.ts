import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S11 de la segunda simulación con agentes (6-oct): la descripción decía que
 * las cotizaciones «solo se muestran desde el estado "Cerrada" en segundo
 * llamado», tomado de la guía oficial. Lo medido es otra cosa
 * (docs/internals/hallazgos-api.md §3): las traen los procesos desiertos, y
 * analizar_precios_mercado se apoya justamente en eso. Un modelo que creyera
 * la descripción descartaría los procesos útiles.
 */
describe('descripción de obtener_detalle_compra', () => {
  const src = readFileSync(new URL('../src/tools/detalle-compra.ts', import.meta.url), 'utf8');
  const descripcion = src.slice(src.indexOf('const TOOL_DESCRIPTION'), src.indexOf('const inputSchema'));

  it('no presenta como hecho lo que la guía promete y no se confirmó', () => {
    expect(descripcion).not.toMatch(/solo se muestran desde el estado "Cerrada"/);
  });

  it('dice lo medido: las cotizaciones vienen en los procesos desiertos', () => {
    expect(descripcion).toMatch(/vienen en los procesos "desierta"/);
    expect(descripcion).toMatch(/no significa que no haya ofertas/);
  });
});
