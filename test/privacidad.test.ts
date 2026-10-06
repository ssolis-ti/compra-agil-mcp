import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sinContactos } from '../src/utils/privacidad.js';
import { compararCotizantes } from '../src/utils/competencia.js';
import type { CompraAgilDetalle } from '../src/api/compra-agil-client.js';

/**
 * E8 (enjambre, 6-oct): el informe de competencia copiaba el WhatsApp y el
 * correo del proveedor. El segundo enjambre encontró además un sitio web
 * personal, nombres de contacto rotulados y el RUT de una persona natural
 * dentro de la descripción libre.
 */
describe('sinContactos', () => {
  it('el caso real del primer enjambre', () => {
    expect(sinContactos('Entrega inmediata. Wsp+569 61985601, pprovepro@gmail.com'))
      .toBe('Entrega inmediata. [teléfono omitido], [correo omitido]');
  });

  it('móviles con y sin prefijo, y fijos con +56', () => {
    expect(sinContactos('Llamar al 9 8765 4321')).toBe('Llamar al [teléfono omitido]');
    expect(sinContactos('cel: +56 9 8765-4321')).toBe('[teléfono omitido]');
    expect(sinContactos('Fono +56 2 2345 6789')).toBe('[teléfono omitido]');
  });

  it('sitios web, contactos rotulados y RUT dentro del texto (segundo enjambre)', () => {
    expect(sinContactos('Ver catálogo en www.mitienda.cl o https://mitienda.cl/ofertas')).toBe('Ver catálogo en [sitio omitido] o [sitio omitido]');
    expect(sinContactos('NOMBRE: DEISY CONTRERAS, cargo ventas')).toBe('NOMBRE: [contacto omitido], cargo ventas');
    expect(sinContactos('Atención: Julio Sepúlveda Cataldo')).toBe('Atención: [contacto omitido]');
    expect(sinContactos('CÉSAR RODRIGO ORTEGA AGUILERA 16.508.086-6')).toBe('CÉSAR RODRIGO ORTEGA AGUILERA [RUT omitido]');
  });

  it('no toca montos ni códigos de proceso', () => {
    const texto = 'Neto $1.234.567, proceso 1057539-228-COT26, 185 unidades';
    expect(sinContactos(texto)).toBe(texto);
  });
});

describe('competencia sobre 2440-1659-COT26 (dato real del segundo enjambre)', () => {
  const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const detalle = (JSON.parse(fs.readFileSync(path.join(RAIZ, 'test', 'fixtures', 'enjambre2-detalles.json'), 'utf8')) as {
    detalles: Record<string, CompraAgilDetalle>;
  }).detalles['2440-1659-COT26'];

  it('advierte que la brecha compara solo ofertas rechazadas', () => {
    const d = compararCotizantes(detalle);
    expect(d.spread.admisibles).toBe(0);
    expect(d._aviso_brecha).toMatch(/Todas las cotizaciones fueron declaradas inadmisibles/);
  });

  it('cuenta las cotizaciones repetidas del mismo proveedor y monto', () => {
    expect(compararCotizantes(detalle).spread.duplicadas).toBeGreaterThanOrEqual(1);
  });
});
