/**
 * Catálogo de cambios por lotes, como los registra la API real (T1.4 de la
 * 2.9.0; medido el 7-oct-2026 en docs/internals/qa/medicion-ventanas.md):
 *
 *   - los cambios se registran en lotes cada 5 minutos; todos los del lote
 *     llevan la misma marca, `hh:m0:00.380` o `hh:m5:00.380`, en hora de Chile
 *     con «Z», y entre lotes no hay nada;
 *   - `cambio_desde` y `cambio_hasta` incluyen los dos bordes;
 *   - el listado viene ordenado del cambio más reciente al más antiguo;
 *   - `tamano_pagina` menor que 10 es un 400.
 *
 * Todas las horas van en «pared de Chile como Z» (ms de `Date.parse` sobre ese
 * texto), que es como la API compara. Lo usan los tests del núcleo de
 * vigilancia (como cliente falso) y scripts/qa/mock-api.mjs con
 * CATALOGO=cambios (por HTTP).
 */

const CINCO_MIN = 5 * 60_000;
const REGIONES = { 1: 'Tarapacá', 2: 'Antofagasta', 5: 'Valparaíso', 8: 'Biobío', 13: 'Metropolitana', 15: 'Arica y Parinacota' };

/** La marca del lote que contiene `ms`: múltiplo de 5 min, más 380 ms. */
export function marcaDeLote(ms) {
  return Math.floor(ms / CINCO_MIN) * CINCO_MIN + 380;
}

const iso = (ms) => new Date(ms).toISOString();

export function crearCatalogoCambios() {
  /** codigo → proceso en forma cruda de la API */
  const procesos = new Map();
  /** marca (ms) → cuántas veces más responder 504 si la ventana la incluye */
  const fallas = new Map();
  let secuencia = 0;
  let llamadas = 0;
  /** Gancho de los tests: se llama antes de responder cada búsqueda. */
  let alBuscar = null;

  function agregar(marcaMs, cantidad, opciones = {}) {
    const { region = 13, estado = 'publicada', monto = 500_000, ofertas = 0, nombre = 'Adquisición de resmas de papel' } = opciones;
    const marca = marcaDeLote(marcaMs);
    const codigos = [];
    for (let i = 0; i < cantidad; i++) {
      secuencia++;
      const codigo = `${1000 + region}-${secuencia}-COT26`;
      procesos.set(codigo, {
        codigo,
        nombre: `${nombre} ${secuencia}`,
        estado: { id_estado: 1, codigo: estado, glosa: estado[0].toUpperCase() + estado.slice(1) },
        convocatoria: { estado_convocatoria: 1, descripcion: 'Primer llamado' },
        documentos: [],
        fechas: { fecha_publicacion: iso(marca - 60 * 60_000), fecha_cierre: iso(marca + 48 * 60 * 60_000), fecha_ultimo_cambio: iso(marca), fecha_cancelacion: null },
        montos: { moneda: 'CLP', monto_disponible: monto, monto_disponible_clp: monto },
        institucion: { organismo_comprador: `Organismo ${region}`, rut: '61.000.000-0', unidad_compra: 'Abastecimiento', region, nombre_region: REGIONES[region] ?? `Región ${region}` },
        resumen: { total_ofertas_recibidas: ofertas },
        motivos: { motivo_cancelacion: null, motivo_desierta: null, motivo_seleccion: null },
        links: { detalle: `/v2/compra-agil/${codigo}` },
      });
      codigos.push(codigo);
    }
    return codigos;
  }

  /** El proceso vuelve a cambiar: deja su lote y pasa al de `nuevaMarcaMs`. */
  function mover(codigo, nuevaMarcaMs) {
    const p = procesos.get(codigo);
    if (p) p.fechas.fecha_ultimo_cambio = iso(marcaDeLote(nuevaMarcaMs));
  }

  function fallarLote(marcaMs, veces = 1) {
    fallas.set(marcaDeLote(marcaMs), veces);
  }

  /** Búsqueda con la semántica medida. Devuelve { status, body }. */
  function buscar(params) {
    llamadas++;
    const p = params instanceof URLSearchParams ? Object.fromEntries(params) : params;
    alBuscar?.(p, llamadas);
    const tamano = Number(p.tamano_pagina ?? 10);
    const pagina = Number(p.numero_pagina ?? 1);
    if (tamano < 10) return { status: 400, body: { success: 'NOK', errors: [{ codigo: '400', mensaje: 'tamano_pagina mínimo 10' }] } };
    const desde = p.cambio_desde ? Date.parse(p.cambio_desde) : -Infinity;
    const hasta = p.cambio_hasta ? Date.parse(p.cambio_hasta) : Infinity;
    for (const [marca, veces] of fallas) {
      if (veces > 0 && marca >= desde && marca <= hasta) {
        fallas.set(marca, veces - 1);
        return { status: 504, body: 'Gateway Timeout' };
      }
    }
    const estados = p.estado ? String(p.estado).split(',') : null;
    const regiones = p.region ? String(p.region).split(',').map(Number) : null;
    const filtrados = [...procesos.values()]
      .filter((x) => {
        const t = Date.parse(x.fechas.fecha_ultimo_cambio);
        return t >= desde && t <= hasta;
      })
      .filter((x) => !estados || estados.includes(x.estado.codigo))
      .filter((x) => !regiones || regiones.includes(x.institucion.region))
      .sort((a, b) => Date.parse(b.fechas.fecha_ultimo_cambio) - Date.parse(a.fechas.fecha_ultimo_cambio) || a.codigo.localeCompare(b.codigo));
    const total = filtrados.length;
    const items = filtrados.slice((pagina - 1) * tamano, pagina * tamano).map((x) => structuredClone(x));
    return {
      status: 200,
      body: {
        success: 'OK',
        payload: { items, paginacion: { total_resultados: total, total_paginas: Math.ceil(total / tamano), numero_pagina: pagina, tamano_pagina: tamano } },
      },
    };
  }

  return {
    agregar,
    mover,
    fallarLote,
    buscar,
    procesos: () => [...procesos.values()],
    llamadas: () => llamadas,
    alBuscar: (fn) => { alBuscar = fn; },
  };
}

/**
 * Llena el catálogo con lotes desde `desdeMs` hasta `hastaMs`, con
 * `porLote(marcaMs)` procesos cada uno, repartidos entre las regiones.
 */
export function poblarLotes(catalogo, desdeMs, hastaMs, porLote) {
  const regiones = [13, 13, 13, 5, 8, 2, 1, 15];
  for (let m = marcaDeLote(desdeMs); m <= hastaMs; m += CINCO_MIN) {
    const n = typeof porLote === 'function' ? porLote(m) : porLote;
    for (let i = 0; i < n; i++) catalogo.agregar(m, 1, { region: regiones[i % regiones.length] });
  }
}
