import { describe, it, expect } from 'vitest';
import { sinContactos } from '../src/utils/privacidad.js';

/** E8 (enjambre, 6-oct): el informe de competencia copiaba el WhatsApp y el correo del proveedor. */
describe('sinContactos', () => {
  it('el caso real del enjambre', () => {
    expect(sinContactos('Entrega inmediata. Wsp+569 61985601, pprovepro@gmail.com'))
      .toBe('Entrega inmediata. [teléfono omitido], [correo omitido]');
  });

  it('móviles con y sin prefijo, y fijos con +56', () => {
    expect(sinContactos('Llamar al 9 8765 4321')).toBe('Llamar al [teléfono omitido]');
    expect(sinContactos('cel: +56 9 8765-4321')).toBe('[teléfono omitido]');
    expect(sinContactos('Fono +56 2 2345 6789')).toBe('[teléfono omitido]');
  });

  it('no toca montos, RUT ni códigos de proceso', () => {
    const texto = 'Neto $1.234.567, RUT 76.543.210-K, proceso 1057539-228-COT26, 185 unidades';
    expect(sinContactos(texto)).toBe(texto);
  });
});
