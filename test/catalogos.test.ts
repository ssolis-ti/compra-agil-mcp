import { describe, it, expect } from 'vitest';
import { GLOSARIO } from '../src/resources/glosario.js';
import { ESTADOS } from '../src/resources/estados.js';

describe('catálogos que el agente cita solos', () => {
  it('el glosario no ofrece 50 ítems ni un adjudicado', () => {
    const paginacion = GLOSARIO.find((e) => e.termino === 'Paginación');
    const oc = GLOSARIO.find((e) => e.termino === 'OC / Orden de Compra');
    expect(paginacion?.definicion).toContain('10');
    expect(paginacion?.definicion).not.toMatch(/máx\. 50/);
    expect(oc?.definicion).not.toMatch(/proveedor seleccionado/);
    expect(oc?.definicion).toMatch(/no publica al proveedor adjudicado/);
  });

  it('la frase corta de desierta no niega las ofertas', () => {
    const desierta = ESTADOS.find((e) => e.codigo === 'desierta');
    expect(desierta?.descripcion).not.toMatch(/no se recibieron ofertas/i);
    expect(desierta?.nota).toMatch(/suelen exponer las cotizaciones/i);
  });
});
