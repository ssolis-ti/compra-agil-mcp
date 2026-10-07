import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { crearAlerta, horasRestantes } from '../src/avisos/mensaje.js';

/**
 * La alerta que viaja a los canales (T3.1 de la 2.9.0; R4.1, R4.2, R4.6).
 * Se arma una vez, ya limpia: ningún canal recibe datos de contacto ni la
 * descripción libre del proceso.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listado = JSON.parse(fs.readFileSync(path.join(RAIZ, 'test', 'fixtures', 'compra-agil-listado.json'), 'utf8'));
const real = listado.payload.items[0];
const CUANDO = Date.parse('2026-10-07T22:00:00Z');

describe('crearAlerta', () => {
  it('con un proceso real del listado: los campos de R4.1 y la ficha pública', () => {
    const a = crearAlerta(real, 'licencias', CUANDO);
    expect(a).toMatchObject({
      codigo: real.codigo,
      nombre: real.nombre,
      organismo: real.institucion.organismo_comprador,
      presupuestoClp: real.montos.monto_disponible_clp,
      coincidencia: 'licencias',
      ficha: `https://buscador.mercadopublico.cl/ficha?code=${real.codigo}`,
      creada: CUANDO,
    });
    expect(a.cierreHoraChile).toBe('2026-07-15 15:00');
    expect(a.cierreUtc).toBe('2026-07-15T19:00:00.000Z');
  });

  it('recorta nombres largos a 160 caracteres y quita contactos de nombre y organismo (R4.2)', () => {
    const a = crearAlerta({
      ...real,
      nombre: `Compra urgente, llamar al +56 9 8765 4321 o escribir a jefe@municipio.cl ${'x'.repeat(300)}`,
      institucion: { ...real.institucion, organismo_comprador: 'Atención: Julio Sepúlveda Cataldo' },
    }, 'compra', CUANDO);
    expect(a.nombre.length).toBeLessThanOrEqual(160);
    expect(a.nombre).not.toMatch(/8765|jefe@/);
    expect(a.organismo).not.toMatch(/Sepúlveda/);
  });

  it('no lleva descripción ni proveedores, y no afirma ganadores (R4.6)', () => {
    const a = crearAlerta({ ...real, descripcion: 'Contacto: 22 345 6789' } as typeof real, 'x', CUANDO);
    expect(JSON.stringify(a)).not.toMatch(/descripcion|6789|ganador|adjudic/i);
  });

  it('sin monto ni cierre, los deja en null en vez de inventarlos', () => {
    const a = crearAlerta({ ...real, montos: null, fechas: { ...real.fechas, fecha_cierre: null } } as unknown as typeof real, 'x', CUANDO);
    expect(a.presupuestoClp).toBeNull();
    expect(a.cierreHoraChile).toBeNull();
    expect(horasRestantes(a, CUANDO)).toBeNull();
  });

  it('horas restantes hasta el cierre, redondeadas hacia abajo', () => {
    const a = crearAlerta(real, 'x', CUANDO);
    expect(horasRestantes(a, Date.parse('2026-07-14T09:30:00Z'))).toBe(33);
  });
});
