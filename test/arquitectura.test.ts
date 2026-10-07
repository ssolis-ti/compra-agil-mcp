import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Reglas de capas de src/ (T1.2 de la 2.9.0, requisito NF4; diseño §2).
 *
 * El grafo de graphify las muestra, pero solo si alguien lo mira: este test
 * las hace cumplir en cada corrida. Las dependencias cruzadas que ya existían
 * al escribirlo (7-oct-2026) quedan como excepciones con nombre, para que no
 * crezcan sin que nadie lo decida.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(RAIZ, 'src');

/** Archivo relativo a src/ ('tools/x.ts') → archivos que importa, relativos a src/. */
function grafoDeImports(soloValores = false): Map<string, string[]> {
  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (p.endsWith('.ts')) archivos.push(path.relative(SRC, p).split(path.sep).join('/'));
    }
  };
  recorrer(SRC);
  const grafo = new Map<string, string[]>();
  for (const f of archivos) {
    const texto = fs.readFileSync(path.join(SRC, f), 'utf8');
    // Un `import type` se borra al compilar: cuenta para las capas, no para los ciclos.
    const patron = soloValores
      ? /^(?:import|export)\s+(?!type\b)[^;]*?from\s*'(\.{1,2}\/[^']+)'/gm
      : /(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g;
    const destinos = [...texto.matchAll(patron)].map((m) =>
      path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])).replace(/\.js$/, '.ts'),
    );
    grafo.set(f, destinos);
  }
  return grafo;
}

/** 'tools/x.ts' → 'tools'; 'servidor.ts' → 'servidor.ts'. */
const capa = (f: string) => (f.includes('/') ? f.split('/')[0] : f);

const ENTRADAS = ['index.ts', 'cli', 'servidor.ts'];

/** Lo que cada capa NO puede importar. */
const PROHIBIDO: Record<string, string[]> = {
  api: ['tools', 'reports', 'resources', 'prompts', 'services', 'vigilancia', 'avisos', ...ENTRADAS],
  utils: ['api', 'tools', 'reports', 'resources', 'prompts', 'services', 'vigilancia', 'avisos', ...ENTRADAS],
  reports: ['tools', 'resources', 'prompts', 'services', 'vigilancia', 'avisos', ...ENTRADAS],
  tools: ['tools', 'services', 'index.ts', 'cli', 'servidor.ts'],
  vigilancia: ['tools', 'reports', 'resources', 'prompts', 'services', ...ENTRADAS],
  avisos: ['api', 'vigilancia', 'tools', 'reports', 'resources', 'prompts', 'services', ...ENTRADAS],
};

/** Deudas registradas en el diseño §1. Agregar una aquí es una decisión, no un arreglo. */
const EXCEPCIONES = new Set([
  'tools/generar-informe.ts -> tools/radar-oportunidades.ts',
  'tools/generar-informe.ts -> tools/generar-borrador.ts',
  'tools/generar-informe.ts -> tools/analizar-precios-mercado.ts',
  'tools/generar-informe.ts -> tools/auditar-desiertas.ts',
  'reports/templates/auditoria.ts -> tools/auditar-desiertas.ts',
  'reports/templates/cotizacion.ts -> tools/generar-borrador.ts',
  'reports/templates/precio.ts -> tools/analizar-precios-mercado.ts',
  'utils/competencia.ts -> api/compra-agil-client.ts',
  'utils/quotation.ts -> api/compra-agil-client.ts',
]);

/** Mismo archivo de capa con sí mismo: tools → tools sí está prohibido; el resto, no. */
function violaciones(grafo: Map<string, string[]>): string[] {
  const fuera: string[] = [];
  for (const [origen, destinos] of grafo) {
    const prohibidas = PROHIBIDO[capa(origen)] ?? [];
    for (const destino of destinos) {
      const arista = `${origen} -> ${destino}`;
      if (prohibidas.includes(capa(destino)) && !EXCEPCIONES.has(arista)) fuera.push(arista);
    }
  }
  return fuera;
}

function ciclos(grafo: Map<string, string[]>): string[][] {
  const encontrados: string[][] = [];
  const estado = new Map<string, 'visitando' | 'listo'>();
  const pila: string[] = [];
  const visitar = (n: string) => {
    estado.set(n, 'visitando');
    pila.push(n);
    for (const m of grafo.get(n) ?? []) {
      if (!grafo.has(m)) continue;
      if (estado.get(m) === 'visitando') encontrados.push([...pila.slice(pila.indexOf(m)), m]);
      else if (!estado.has(m)) visitar(m);
    }
    pila.pop();
    estado.set(n, 'listo');
  };
  for (const n of grafo.keys()) if (!estado.has(n)) visitar(n);
  return encontrados;
}

describe('arquitectura de src/', () => {
  const grafo = grafoDeImports();

  it('ninguna capa importa de otra que no le corresponde', () => {
    expect(violaciones(grafo)).toEqual([]);
  });

  it('no hay ciclos de importación en tiempo de ejecución', () => {
    expect(ciclos(grafoDeImports(true))).toEqual([]);
  });

  it('las excepciones registradas siguen existiendo (si una se arregla, se borra de la lista)', () => {
    const aristas = new Set([...grafo].flatMap(([o, ds]) => ds.map((d) => `${o} -> ${d}`)));
    expect([...EXCEPCIONES].filter((e) => !aristas.has(e))).toEqual([]);
  });

  it('el núcleo (vigilancia/ y avisos/) no lee el entorno, no usa Date.now() ni arranca temporizadores (NF5)', () => {
    // Los canales hacen I/O real y la configuración lee el entorno: son la frontera.
    const frontera = (f: string) => f.startsWith('avisos/canales/') || f === 'avisos/config.ts';
    const impuros = [...grafo.keys()]
      .filter((f) => (capa(f) === 'vigilancia' || capa(f) === 'avisos') && !frontera(f))
      .filter((f) => /process\.env|Date\.now\(|setInterval\(|setTimeout\(/.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
    expect(impuros).toEqual([]);
  });

  it('la regla detecta una violación (control del propio test)', () => {
    const falso = new Map(grafo);
    falso.set('api/falso.ts', ['tools/buscar-compras.ts']);
    expect(violaciones(falso)).toEqual(['api/falso.ts -> tools/buscar-compras.ts']);
    expect(ciclos(new Map([['a.ts', ['b.ts']], ['b.ts', ['a.ts']]]))).toHaveLength(1);
  });
});
