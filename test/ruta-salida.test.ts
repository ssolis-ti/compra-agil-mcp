import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { escribirInforme, raizInformes, resolverDirectorioSalida, RutaSalidaError } from '../src/reports/export.js';
import { registerGenerarInforme } from '../src/tools/generar-informe.js';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';

/**
 * `ruta_salida` la elige el modelo, y el modelo lee textos de terceros. En la
 * auditoría QA (octubre 2026) se escribió un informe fuera del directorio de
 * trabajo con solo pedirlo. Ahora todo queda dentro de la raíz de informes.
 */

let base: string;
let raiz: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'informes-qa-'));
  raiz = path.join(base, 'raiz');
  vi.stubEnv('COMPRA_AGIL_INFORMES_DIR', raiz);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(base, { recursive: true, force: true });
});

describe('resolverDirectorioSalida', () => {
  it('sin ruta usa la raíz configurada', () => {
    expect(raizInformes()).toBe(path.resolve(raiz));
    expect(resolverDirectorioSalida()).toBe(path.resolve(raiz));
    expect(resolverDirectorioSalida('   ')).toBe(path.resolve(raiz));
  });

  it('una subcarpeta relativa cuelga de la raíz', () => {
    expect(resolverDirectorioSalida('radar/octubre')).toBe(path.join(raiz, 'radar', 'octubre'));
  });

  it('una ruta absoluta dentro de la raíz se acepta', () => {
    expect(resolverDirectorioSalida(path.join(raiz, 'x'))).toBe(path.join(raiz, 'x'));
  });

  it('rechaza subir con ..', () => {
    expect(() => resolverDirectorioSalida('../fuera')).toThrow(RutaSalidaError);
    expect(() => resolverDirectorioSalida('a/../../fuera')).toThrow(RutaSalidaError);
    expect(() => resolverDirectorioSalida('..')).toThrow(RutaSalidaError);
  });

  it('rechaza una ruta absoluta fuera de la raíz', () => {
    expect(() => resolverDirectorioSalida(base)).toThrow(RutaSalidaError);
    expect(() => resolverDirectorioSalida(os.tmpdir())).toThrow(RutaSalidaError);
  });

  it('no confunde una carpeta que empieza con ".." con subir de nivel', () => {
    expect(resolverDirectorioSalida('..borradores')).toBe(path.join(raiz, '..borradores'));
  });

  it('S8: una ruta de Windows es externa en cualquier sistema, no una carpeta con ese nombre', () => {
    // Simulación 6-oct: en Linux creó informes/C:\\Users\\funcionario\\Desktop/ y respondió ✅.
    for (const r of ['C:\\Users\\funcionario\\Desktop', 'C:\\\\Users\\\\funcionario', 'd:/informes', '\\\\servidor\\compartida']) {
      expect(() => resolverDirectorioSalida(r), r).toThrow(RutaSalidaError);
    }
  });

  it('S8: una subcarpeta con barras de Windows es una subcarpeta', () => {
    expect(resolverDirectorioSalida('radar\\octubre')).toBe(path.join(raiz, 'radar', 'octubre'));
  });

  it('el mensaje explica cómo guardar en otra parte', () => {
    expect(() => resolverDirectorioSalida('../x')).toThrow(/COMPRA_AGIL_INFORMES_DIR/);
  });
});

describe('escribirInforme', () => {
  it('escribe dentro de la raíz', () => {
    const { ruta } = escribirInforme('<html></html>', 'a.html', 'sub');
    expect(ruta).toBe(path.join(raiz, 'sub', 'a.html'));
    expect(fs.existsSync(ruta)).toBe(true);
  });

  it('no escribe nada fuera de la raíz', () => {
    expect(() => escribirInforme('<html></html>', 'a.html', '../fuera')).toThrow(RutaSalidaError);
    expect(fs.existsSync(path.join(base, 'fuera'))).toBe(false);
  });

  it('un nombre de archivo con ruta no sale de la carpeta', () => {
    const { ruta } = escribirInforme('<html></html>', '../../escape.html');
    expect(ruta).toBe(path.join(raiz, 'escape.html'));
  });

  it.skipIf(process.platform === 'win32')('un enlace simbólico dentro de la raíz que apunta afuera se rechaza', () => {
    fs.mkdirSync(raiz, { recursive: true });
    const afuera = path.join(base, 'afuera');
    fs.mkdirSync(afuera);
    fs.symlinkSync(afuera, path.join(raiz, 'enlace'));

    expect(() => escribirInforme('<html></html>', 'a.html', 'enlace')).toThrow(RutaSalidaError);
    expect(fs.readdirSync(afuera)).toEqual([]);
  });
});

describe('generar_informe con ruta_salida fuera de la raíz', () => {
  it('responde con el motivo y no gasta cuota', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const handlers: Record<string, (a: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>> = {};
    const server = { registerTool: (n: string, _c: unknown, h: typeof handlers[string]) => { handlers[n] = h; } };
    registerGenerarInforme(server as unknown as McpServer, new CompraAgilClient('TICKET-TEST'));

    const r = await handlers.generar_informe({ tipo: 'radar', ruta_salida: base });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('queda fuera de la carpeta de informes');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mensaje de ruta_salida rechazada (E10)', () => {
  it('no muestra la ruta absoluta de la carpeta de informes', () => {
    const e = new RutaSalidaError('../fuera', path.join('home', 'funcionario', 'proyecto', 'informes'));
    expect(e.message).toContain('"informes"');
    expect(e.message).not.toContain('funcionario');
    expect(e.message).toContain('COMPRA_AGIL_INFORMES_DIR');
  });
});
