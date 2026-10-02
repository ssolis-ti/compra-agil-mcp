import { describe, it, expect } from 'vitest';
import { textoVerificacionSinCache } from '../src/tools/verificar-oc.js';

describe('verificar_orden_compra sin caché', () => {
  it('no inventa un corte reciente ni pide repetir el detalle', () => {
    const texto = textoVerificacionSinCache();
    expect(texto).not.toMatch(/504 reciente/);
    expect(texto).not.toContain('obtener_detalle_compra en ráfaga');
    expect(texto).toContain('no hubo un corte');
  });
});
