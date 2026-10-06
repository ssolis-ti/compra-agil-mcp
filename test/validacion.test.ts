import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import {
  errorDeValidacion, traducirRechazoDelEsquema, normalizarResultado, configurarMensajesZod,
  esquemaCodigoCompra, esquemaCodigoOC, esCodigoCompra,
} from '../src/utils/validacion.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';

const getActionableMessage = (status: number, errores: never[], consulta: string) =>
  new CompraAgilApiError(status, errores, consulta).actionableMessage;

/**
 * E5 (enjambre contra la API real, 6-oct): cuatro formatos de error para el
 * mismo tipo de problema, uno con mensajes de zod en inglés, y solo algunos
 * decían si se había gastado cuota. E4: un código imposible gastaba consulta.
 */

beforeAll(() => configurarMensajesZod());

describe('errorDeValidacion — un solo formato', () => {
  it('antepone el prefijo y agrega que no se consultó la API', () => {
    expect(errorDeValidacion('Falta "q"')).toBe('Error de validación: Falta "q". No se consultó la API.');
  });

  it('no duplica prefijo ni aclaración si ya venían', () => {
    expect(errorDeValidacion('Error de validación: Región inválida: "17". No se consultó la API.'))
      .toBe('Error de validación: Región inválida: "17". No se consultó la API.');
  });

  it('absorbe el «No se hizo la llamada» de la búsqueda sin filtros', () => {
    expect(errorDeValidacion('No se hizo la llamada. Indica al menos uno de estos filtros: estado.'))
      .toBe('Error de validación: Indica al menos uno de estos filtros: estado. No se consultó la API.');
  });
});

describe('traducirRechazoDelEsquema — el texto del SDK, en el formato del servidor', () => {
  it('quita el prefijo en inglés y el «at campo»', () => {
    const sdk = 'MCP error -32602: Input validation error: Invalid arguments for tool obtener_detalle_compra: "ABC" no tiene el formato de un código de Compra Ágil (ej: "1057539-228-COT26"). at codigo';
    expect(traducirRechazoDelEsquema(sdk)).toBe(
      'Error de validación: "ABC" no tiene el formato de un código de Compra Ágil (ej: "1057539-228-COT26"). No se consultó la API.',
    );
  });

  it('junta varias líneas en un solo mensaje', () => {
    const sdk = 'MCP error -32602: Input validation error: Invalid arguments for tool x: Falta "a", que es obligatorio. at a\nFalta "b", que es obligatorio. at b';
    expect(traducirRechazoDelEsquema(sdk)).toBe('Error de validación: Falta "a", que es obligatorio. Falta "b", que es obligatorio. No se consultó la API.');
  });
});

describe('normalizarResultado — los errores de los handlers', () => {
  it('normaliza un error de validación', () => {
    const r = normalizarResultado({ content: [{ type: 'text', text: 'Error de validación: "cambio_hasta" requiere también "cambio_desde".' }], isError: true });
    expect(r.content![0].text).toMatch(/No se consultó la API\.$/);
  });

  it('no toca un error de la API ni un resultado correcto', () => {
    const api = { content: [{ type: 'text', text: 'La pasarela de Mercado Público cortó la conexión (HTTP 504).' }], isError: true };
    expect(normalizarResultado(api)).toBe(api);
    const ok = { content: [{ type: 'text', text: 'Error de validación: esto es un dato, no un error' }] };
    expect(normalizarResultado(ok)).toBe(ok);
  });
});

describe('mensajes de zod en español', () => {
  it('parámetro faltante', () => {
    const r = z.object({ codigo_compra: z.string() }).safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe('Falta "codigo_compra", que es obligatorio.');
  });

  it('tipo y rango', () => {
    const r = z.object({ tamano_pagina: z.number().max(10) }).safeParse({ tamano_pagina: 500 });
    if (!r.success) expect(r.error.issues[0].message).toBe('"tamano_pagina" debe ser como máximo 10.');
    const t = z.object({ n: z.number() }).safeParse({ n: 'diez' });
    if (!t.success) expect(t.error.issues[0].message).toBe('"n" debe ser un número; llegó un texto.');
  });

  it('enum', () => {
    const r = z.object({ tipo: z.enum(['radar', 'precio']) }).safeParse({ tipo: 'otro' });
    if (!r.success) expect(r.error.issues[0].message).toBe('"tipo" debe ser uno de: "radar", "precio"; llegó "otro".');
  });
});

describe('códigos — E4: un formato imposible no gasta una consulta', () => {
  it('acepta los códigos reales vistos en la API', () => {
    for (const c of ['1057539-228-COT26', '5796-33-COT26', '1003473-4624-COT26', '742475-128-COT26', ' 1-2-COT26 ']) {
      expect(esquemaCodigoCompra().safeParse(c).success, c).toBe(true);
      expect(esCodigoCompra(c), c).toBe(true);
    }
  });

  it('rechaza lo que no puede ser un código', () => {
    for (const c of ['ABC', '', '1057539-228', '1057539-228-COT', 'COT26-1-2', '1057539 228 COT26']) {
      expect(esquemaCodigoCompra().safeParse(c).success, c).toBe(false);
    }
  });

  it('el mensaje dice qué llegó y muestra un ejemplo', () => {
    const r = esquemaCodigoCompra().safeParse('ABC');
    if (!r.success) expect(r.error.issues[0].message).toBe('"ABC" no tiene el formato de un código de Compra Ágil (ej: "1057539-228-COT26").');
  });

  it('código de OC', () => {
    expect(esquemaCodigoOC().safeParse('9999-99-SE99').success).toBe(true);
    expect(esquemaCodigoOC().safeParse('OC-123').success).toBe(false);
  });
});

describe('errores de la API que nombran lo que falló (E4, E11, S18)', () => {
  it('400 sobre un detalle habla del código, no de fechas ni regiones', () => {
    const m = getActionableMessage(400, [], 'GET /v2/compra-agil/ABC1-2-XX');
    expect(m).toMatch(/rechazó el código "ABC1-2-XX"/);
    expect(m).not.toMatch(/fechas|región/);
  });

  it('404 distingue una compra de una orden de compra', () => {
    expect(getActionableMessage(404, [], 'GET /v2/compra-agil/1-2-COT26')).toMatch(/No existe una Compra Ágil pública con el código "1-2-COT26".*ficha\?code=1-2-COT26/);
    expect(getActionableMessage(404, [], 'GET /servicios/v1/publico/OrdenCompra.json?codigo=9-9-SE99')).toMatch(/No se encontró la Orden de Compra/);
  });

  it('504 del detalle trae el enlace a la ficha', () => {
    expect(getActionableMessage(504, [], 'GET /v2/compra-agil/5627-283-COT26')).toMatch(/ficha\?code=5627-283-COT26/);
  });
});
