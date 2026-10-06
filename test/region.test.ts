import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { esquemaRegion, regionesInvalidas } from '../src/utils/region.js';
import { inputSchema as buscar } from '../src/tools/buscar-compras.js';
import { inputSchema as monitor } from '../src/tools/monitorear-cambios.js';

/**
 * S7 de la simulación con agentes (6-oct): `region="17"` gastaba una consulta
 * y volvía «sin resultados», indistinguible de «no hubo compras».
 */

describe('esquemaRegion', () => {
  const una = z.object({ region: esquemaRegion('x') });
  const varias = z.object({ region: esquemaRegion('x', { multiple: true }) });

  it('acepta 1 a 16 y la ausencia del parámetro', () => {
    for (const r of ['1', '9', '10', '16']) expect(una.safeParse({ region: r }).success).toBe(true);
    expect(una.safeParse({}).success).toBe(true);
  });

  it('rechaza lo que no es una región, con un mensaje que dice qué hacer', () => {
    for (const r of ['0', '17', '99', 'Metropolitana', '', '13a', '01']) {
      const res = una.safeParse({ region: r });
      expect(res.success, r).toBe(false);
    }
    const res = una.safeParse({ region: '17' });
    if (res.success) throw new Error('debía fallar');
    expect(res.error.issues[0].message).toMatch(/^Región inválida: "17"\. Usa un código del 1 al 16/);
    expect(res.error.issues[0].message).toContain('No se consultó la API');
  });

  it('varias regiones separadas por coma solo donde la herramienta las admite', () => {
    expect(varias.safeParse({ region: '13, 5' }).success).toBe(true);
    expect(varias.safeParse({ region: '13,17' }).success).toBe(false);
    expect(una.safeParse({ region: '13,5' }).success).toBe(false);
    expect(regionesInvalidas('13,17,x')).toEqual(['17', 'x']);
  });
});

describe('herramientas con región', () => {
  it('buscar_compras_agiles y monitorear_cambios_recientes rechazan la región 17 sin consultar', () => {
    expect(z.object(buscar).safeParse({ region: '17' }).success).toBe(false);
    expect(z.object(monitor).safeParse({ region: '17' }).success).toBe(false);
    expect(z.object(buscar).safeParse({ region: '13,5' }).success).toBe(true);
  });
});
