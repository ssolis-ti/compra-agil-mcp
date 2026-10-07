import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { escribirAtomico, leerJsonSeguro } from '../src/utils/archivo-atomico.js';

/**
 * T1.1 de la 2.9.0: la escritura atómica que vivía escondida en la caché pasa
 * a un módulo propio, porque el estado de la vigilancia y la bandeja de salida
 * la necesitan (R1.8: el estado en disco es el anterior o el siguiente, nunca
 * uno a medias).
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomico-'));
const ruta = path.join(dir, 'estado.json');

afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
});

describe('escribirAtomico', () => {
  it('escribe el contenido completo', () => {
    expect(escribirAtomico(ruta, '{"a":1}')).toBe(true);
    expect(fs.readFileSync(ruta, 'utf8')).toBe('{"a":1}');
  });

  it('un corte entre escribir y renombrar deja el archivo anterior intacto y sin temporales', () => {
    escribirAtomico(ruta, '{"version":1}');
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('corte'); });
    expect(escribirAtomico(ruta, '{"version":2}')).toBe(false);
    expect(fs.readFileSync(ruta, 'utf8')).toBe('{"version":1}');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('si el disco no deja escribir, devuelve false sin lanzar', () => {
    expect(escribirAtomico(path.join(dir, 'no', 'existe', 'x.json'), '{}')).toBe(false);
  });
});

describe('leerJsonSeguro', () => {
  it('lee un JSON válido', () => {
    fs.writeFileSync(ruta, '{"a":2}');
    expect(leerJsonSeguro(ruta)).toEqual({ a: 2 });
  });

  it('un archivo que no existe o está corrupto devuelve null, no lanza', () => {
    expect(leerJsonSeguro(path.join(dir, 'nada.json'))).toBeNull();
    fs.writeFileSync(ruta, '{"a":');
    expect(leerJsonSeguro(ruta)).toBeNull();
  });
});
