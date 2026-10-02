import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { TAMANO_PAGINA_SEGURO, camposPagina, textoPagina } from '../src/utils/paginacion.js';
import { inputSchema } from '../src/tools/monitorear-cambios.js';
import { CompraAgilClient } from '../src/api/compra-agil-client.js';

describe('textoPagina', () => {
  it('no dice "1 de 0" cuando la API no tiene páginas', () => {
    expect(textoPagina(1, 0)).toBe('sin resultados en esta ventana');
  });

  it('conserva una página real', () => {
    expect(textoPagina(1, 204)).toBe('1 de 204');
    expect(textoPagina(3, 10)).toBe('3 de 10');
  });
});

describe('camposPagina', () => {
  it('una ventana vacía no se puede leer como 1 de 0', () => {
    expect(camposPagina(1, 0, 0, 0)).toEqual({
      total_resultados: 0,
      total_filtrados_en_pagina: 0,
      numero_pagina: 0,
      total_paginas: 0,
      pagina: 'sin resultados en esta ventana',
    });
  });

  it('cuenta los filtrados de una página real', () => {
    expect(camposPagina(2, 4, 40, 3).total_filtrados_en_pagina).toBe(3);
    expect(camposPagina(2, 4, 40, 3).numero_pagina).toBe(2);
  });
});

describe('tamaño de página del monitoreo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('el default de monitorear es 10, no 50', () => {
    expect(TAMANO_PAGINA_SEGURO).toBe(10);
    const parsed = z.object(inputSchema).parse({});
    expect(parsed.tamano_pagina).toBe(10);
    expect(() => z.object(inputSchema).parse({ tamano_pagina: 50 })).toThrow();
  });

  it('buscarTodo sin tamaño pide 10', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: 'OK',
        payload: {
          items: [],
          paginacion: { total_paginas: 0, numero_pagina: 1, tamano_pagina: 10, total_resultados: 0 },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = new CompraAgilClient('TICKET-DE-PRUEBA-NO-REAL');
    await client.buscarTodo({ estado: 'publicada', ttl_cambio_ms: 3_600_000 });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('tamano_pagina=10');
    expect(url).not.toContain('tamano_pagina=50');
  });
});
