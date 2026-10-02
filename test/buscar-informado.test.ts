import { describe, expect, it } from 'vitest';
import { CompraAgilClient, type BuscarResponse, type CompraAgilItem } from '../src/api/compra-agil-client.js';

function pagina(numero: number, totalPaginas: number, total = 631): BuscarResponse {
  return {
    items: [{ codigo: `p${numero}` } as CompraAgilItem],
    paginacion: {
      total_paginas: totalPaginas,
      numero_pagina: numero,
      tamano_pagina: 10,
      total_resultados: total,
    },
  };
}

describe('buscarInformado — páginas leídas', () => {
  it('con maxPages 1 no cuenta la página siguiente que no pidió', async () => {
    const client = new CompraAgilClient('ticket-de-prueba', 'https://api.invalid');
    const pedidas: number[] = [];
    client.buscar = async (params) => {
      const numero = params.numero_pagina ?? 1;
      pedidas.push(numero);
      return pagina(numero, 64);
    };

    const r = await client.buscarInformado({ estado: 'publicada', region: '13', tamano_pagina: 10 }, 1);

    expect(pedidas).toEqual([1]);
    expect(r.paginasLeidas).toBe(1);
    expect(r.totalResultados).toBe(631);
    expect(r.items).toHaveLength(1);
  });

  it('corta al llegar a la última página que existe', async () => {
    const client = new CompraAgilClient('ticket-de-prueba', 'https://api.invalid');
    const pedidas: number[] = [];
    client.buscar = async (params) => {
      const numero = params.numero_pagina ?? 1;
      pedidas.push(numero);
      return pagina(numero, 2, 15);
    };

    const r = await client.buscarInformado({ estado: 'publicada', tamano_pagina: 10 }, 5);

    expect(pedidas).toEqual([1, 2]);
    expect(r.paginasLeidas).toBe(2);
  });

  it('una ventana vacía cuenta la única página consultada', async () => {
    const client = new CompraAgilClient('ticket-de-prueba', 'https://api.invalid');
    let llamadas = 0;
    client.buscar = async (params) => {
      llamadas++;
      return pagina(params.numero_pagina ?? 1, 0, 0);
    };

    const r = await client.buscarInformado({ estado: 'publicada', tamano_pagina: 10 }, 3);

    expect(llamadas).toBe(1);
    expect(r.paginasLeidas).toBe(1);
    expect(r.totalPaginas).toBe(0);
  });
});
