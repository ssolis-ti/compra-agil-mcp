import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CompraAgilClient, type BuscarResponse, type CompraAgilItem } from '../src/api/compra-agil-client.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';
import { registerExportar, agregar } from '../src/tools/exportar.js';
import { leerXlsx } from '../src/documentos/ooxml.js';
import { csvDeTabla } from '../src/documentos/escribir.js';

/** exportar_procesos (2.10.0, E1–E6). */

function item(n: number, organismo = 'Municipalidad de Coyhaique', monto: number | null = 1000 * n): CompraAgilItem {
  return {
    codigo: `${n}-1-COT26`,
    nombre: n % 2 ? `Resmas de papel ${n}` : `Servicio de aseo ${n}`,
    estado: { codigo: 2, glosa: 'Publicada' },
    convocatoria: { descripcion: 'Primer llamado', estado_convocatoria: 1 },
    montos: { monto_disponible_clp: monto, moneda: 'CLP' },
    institucion: { organismo_comprador: organismo, rut: '69.240.300-8', nombre_region: 'Región de Aysén' },
    fechas: { fecha_publicacion: '2026-10-01T10:00:00', fecha_cierre: '2026-10-05T15:00:00', fecha_ultimo_cambio: '2026-10-01T10:05:00' },
    resumen: { total_ofertas_recibidas: 0 },
    motivos: {},
  } as unknown as CompraAgilItem;
}

function respuesta(pagina: number, totalPaginas: number, total: number): BuscarResponse {
  const desde = (pagina - 1) * 10 + 1;
  const n = Math.max(0, Math.min(10, total - (pagina - 1) * 10));
  return {
    items: Array.from({ length: n }, (_, i) => item(desde + i)),
    paginacion: { total_paginas: totalPaginas, numero_pagina: pagina, tamano_pagina: 10, total_resultados: total },
  };
}

let carpeta: string;
let pedidas: number[];

async function montar(buscar: (p: number) => Promise<BuscarResponse>, esperaMs = 2000) {
  const api = new CompraAgilClient('ticket-de-prueba', 'https://api.invalid', { persistir: false });
  pedidas = [];
  api.buscar = async (params) => { pedidas.push(params.numero_pagina ?? 1); return buscar(params.numero_pagina ?? 1); };
  api.busquedaEnCache = () => false;
  const server = new McpServer({ name: 'prueba', version: '0' });
  registerExportar(server, api, { esperaMs, carpeta });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const cliente = new Client({ name: 'c', version: '0' });
  await cliente.connect(b);
  return async (args: Record<string, unknown>) => {
    const r = await cliente.callTool({ name: 'exportar_procesos', arguments: args });
    const t = (r.content as Array<{ text: string }>)[0].text;
    let j: Record<string, any> = {};
    try { j = JSON.parse(t); } catch { /* texto plano */ }
    return { t, j, error: !!r.isError };
  };
}

beforeEach(() => { carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'exportar-')); });

describe('exportar_procesos', () => {
  it('sin filtro de la API no consulta', async () => {
    const llamar = await montar(async (p) => respuesta(p, 1, 1));
    const r = await llamar({ palabras_clave_requeridas: 'resmas' });
    expect(r.error).toBe(true);
    expect(r.t).toMatch(/^Error de validación:.*No se consultó la API\.$/);
    expect(pedidas).toEqual([]);
  });

  it('0 resultados: un archivo vacío y una consulta', async () => {
    const llamar = await montar(async (p) => respuesta(p, 0, 0));
    const { j } = await llamar({ region: '11', estado: 'publicada', formato: 'csv' });
    expect(j.estado).toBe('listo');
    expect(j.filas).toBe(0);
    expect(j.consultas_api).toBe(1);
    expect(j.truncado).toBe(false);
    expect(fs.readFileSync(j.archivo, 'utf8').startsWith('﻿codigo;nombre')).toBe(true);
  });

  it('3 páginas en xlsx: se relee con el lector propio y trae agregados', async () => {
    const llamar = await montar(async (p) => respuesta(p, 3, 25));
    const { j } = await llamar({ region: '11', estado: 'publicada' });
    expect(pedidas).toEqual([1, 2, 3]);
    expect(j.filas).toBe(25);
    expect(j.consultas_api).toBe(3);
    expect(j.agregados.cantidad).toBe(25);
    expect(j.agregados.monto_total_clp).toBe(1000 * (25 * 26) / 2);
    expect(j.agregados.mediana_clp).toBe(13000);
    expect(j.agregados.por_region[0]).toMatchObject({ nombre: 'Región de Aysén', cantidad: 25 });
    expect(j).not.toHaveProperty('resultados');
    const [hoja] = leerXlsx(fs.readFileSync(j.archivo));
    expect(hoja.filas).toHaveLength(26);
    expect(hoja.filas[0][0]).toBe('codigo');
    expect(hoja.filas[1][0]).toBe('1-1-COT26');
    expect(hoja.filas[1][6]).toBe('1000');
  });

  it('25 páginas con tope 5: truncado, con el total que existe (E3)', async () => {
    const llamar = await montar(async (p) => respuesta(p, 25, 250));
    const { j } = await llamar({ region: '11', max_paginas: 5, formato: 'json' });
    expect(pedidas).toEqual([1, 2, 3, 4, 5]);
    expect(j.truncado).toBe(true);
    expect(j.paginas_totales).toBe(25);
    expect(j._aviso_truncado).toMatch(/25 páginas.*5/);
    expect(j.siguiente_tramo).toEqual({ publicado_hasta: '2026-10-01T10:00:00Z' });
    expect(j._aviso_truncado).toContain('publicado_hasta = 2026-10-01T10:00:00Z');
    expect(JSON.parse(fs.readFileSync(j.archivo, 'utf8'))).toHaveLength(50);
  });

  it('504 en la página 3: exporta lo leído, parcial, desde qué página falta (E4)', async () => {
    const llamar = await montar(async (p) => {
      if (p === 3) throw new CompraAgilApiError(504);
      return respuesta(p, 6, 60);
    });
    const { j } = await llamar({ region: '11' });
    expect(j.parcial).toBe(true);
    expect(j.truncado).toBe(false);
    expect(j.falta_desde_pagina).toBe(3);
    expect(j.filas).toBe(20);
    expect(j._aviso_parcial).toMatch(/página 3/);
  });

  it('si falla la primera página no escribe archivo y la próxima llamada reintenta', async () => {
    let falla = true;
    const llamar = await montar(async (p) => {
      if (falla) throw new CompraAgilApiError(503);
      return respuesta(p, 1, 3);
    });
    const r = await llamar({ region: '11' });
    expect(r.error).toBe(true);
    expect(r.t).toMatch(/503|no responde|disponible/i);
    expect(fs.readdirSync(carpeta)).toEqual([]);
    falla = false;
    expect((await llamar({ region: '11' })).j.filas).toBe(3);
  });

  it('las palabras clave se aplican después y se informan los descartados', async () => {
    const llamar = await montar(async (p) => respuesta(p, 1, 10));
    const { j } = await llamar({ region: '11', palabras_clave_requeridas: 'resmas' });
    expect(j.filas).toBe(5);
    expect(j.descartados_por_palabras).toBe(5);
  });

  it('lenta: responde el avance y la misma llamada entrega el resultado sin repetir consultas (E6)', async () => {
    let soltar!: () => void;
    const pausa = new Promise<void>((r) => { soltar = r; });
    const llamar = await montar(async (p) => {
      if (p === 2) await pausa;
      return respuesta(p, 2, 15);
    }, 50);
    const primera = await llamar({ region: '11' });
    expect(primera.j.estado).toBe('en_curso');
    expect(primera.j.paginas_leidas).toBe(1);
    expect(primera.j.total_paginas).toBe(2);
    expect(primera.j.siguiente_paso).toMatch(/mismos filtros/);
    soltar();
    await new Promise((r) => setTimeout(r, 20));
    const segunda = await llamar({ region: '11' });
    expect(segunda.j.estado).toBe('listo');
    expect(segunda.j.filas).toBe(15);
    expect(pedidas).toEqual([1, 2]);
  });
});

describe('escritores', () => {
  it('csv: «;», comillas y fórmulas neutralizadas', () => {
    const s = csvDeTabla(['a', 'b'], [['=1+1', 'x;y'], [3, 'di "hola"']]);
    expect(s).toBe('﻿a;b\r\n\'=1+1;"x;y"\r\n3;"di ""hola"""\r\n');
  });

  it('agregados sin montos: mediana nula', () => {
    expect(agregar([{ presupuesto_clp: null }]).mediana_clp).toBeNull();
  });
});
