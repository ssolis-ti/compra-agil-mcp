import { describe, it, expect } from 'vitest';

/**
 * Instalado como extensión de Claude Desktop, el servidor corre con el Node
 * de Claude, y moría al arrancar sin escribir nada: `pdf-parse` carga al
 * importarse un módulo nativo (`@napi-rs/canvas`). Prueba real del 8-oct.
 * El arranque no debe cargar ningún .node; el lector de PDF se carga al usarse.
 */
describe('arranque sin módulos nativos', () => {
  it('construir el servidor no carga ningún .node', async () => {
    const cargados: string[] = [];
    const original = process.dlopen;
    process.dlopen = ((modulo: unknown, archivo: string, ...resto: unknown[]) => {
      cargados.push(archivo);
      return (original as (...a: unknown[]) => unknown)(modulo, archivo, ...resto);
    }) as typeof process.dlopen;
    try {
      await import('../src/servidor.js');
      await import('../src/services/control-vigilancia.js');
    } finally {
      process.dlopen = original;
    }
    expect(cargados).toEqual([]);
  });
});
