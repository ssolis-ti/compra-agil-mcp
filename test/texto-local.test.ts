import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { leerTextoLocal, extraccionesDePdf, olvidarTextosLocales } from '../src/utils/texto-local.js';

/**
 * Fase 1.3 (auditoría QA 2.6.1): consultar_documentos_locales extraía el texto
 * de los 7 PDF en cada consulta (0,8–1 s). Aceptación: la segunda lectura de un
 * PDF tarda < 100 ms y no lo vuelve a extraer.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PDF = path.join(RAIZ, 'docs', 'guias', 'multas-sanciones-procedimientos.pdf');

beforeEach(() => olvidarTextosLocales());

describe('leerTextoLocal', () => {
  it('la segunda lectura de un PDF real no lo vuelve a extraer y tarda < 100 ms', async () => {
    const primero = await leerTextoLocal(PDF);
    expect(primero.length).toBeGreaterThan(1000);
    expect(extraccionesDePdf()).toBe(1);
    const t0 = performance.now();
    const segundo = await leerTextoLocal(PDF);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(segundo).toBe(primero);
    expect(extraccionesDePdf()).toBe(1);
  }, 30_000);

  it('si el archivo cambia, se relee', async () => {
    const tmp = path.join(os.tmpdir(), `texto-local-${Date.now()}.md`);
    fs.writeFileSync(tmp, 'versión uno', 'utf8');
    expect(await leerTextoLocal(tmp)).toBe('versión uno');
    fs.writeFileSync(tmp, 'versión dos, más larga', 'utf8');
    expect(await leerTextoLocal(tmp)).toBe('versión dos, más larga');
    fs.rmSync(tmp, { force: true });
  });
});
