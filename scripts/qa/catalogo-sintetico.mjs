/**
 * Catálogo sintético para simulaciones de uso (CATALOGO=sintetico en mock-api.mjs).
 *
 * Determinístico (semilla fija) para que dos corridas sean comparables. Las
 * fechas son relativas al momento de arrancar, en el formato real de la API:
 * "YYYY-MM-DD HH:MM" SIN zona en fecha_cierre / fecha_publicacion.
 *
 * Datos ficticios: no corresponden a procesos ni proveedores reales.
 */

function semilla(n) {
  return () => {
    n = (n * 1664525 + 1013904223) % 4294967296;
    return n / 4294967296;
  };
}
const azar = semilla(20261006);
const elegir = (xs) => xs[Math.floor(azar() * xs.length)];
const entre = (a, b) => Math.round(a + azar() * (b - a));

const RUBROS = [
  { nombre: 'Resmas de papel carta', unidad: 'Resma', precio: 4200, producto: 14111507 },
  { nombre: 'Licencias de software de ofimática', unidad: 'Licencia', precio: 95000, producto: 43231513 },
  { nombre: 'Servicio de mantención de equipos computacionales', unidad: 'Servicio', precio: 450000, producto: 81111812 },
  { nombre: 'Insumos de aseo para dependencias municipales', unidad: 'Kit', precio: 38000, producto: 47131700 },
  { nombre: 'Guantes de nitrilo talla M', unidad: 'Caja', precio: 6900, producto: 42132203 },
  { nombre: 'Computadores portátiles para docentes', unidad: 'Unidad', precio: 520000, producto: 43211503 },
  { nombre: 'Alimentos no perecibles para programa social', unidad: 'Canasta', precio: 27000, producto: 50000000 },
  { nombre: 'Tóner para impresoras láser', unidad: 'Unidad', precio: 58000, producto: 44103103 },
];
const ORGANISMOS = [
  ['Municipalidad de Puente Alto', 13, 'Metropolitana de Santiago'],
  ['Hospital Regional de Antofagasta', 2, 'Antofagasta'],
  ['Servicio de Salud Valparaíso San Antonio', 5, 'Valparaíso'],
  ['Municipalidad de Temuco', 9, 'La Araucanía'],
  ['Universidad de Concepción — compras públicas', 8, 'Biobío'],
  ['Gobierno Regional de Los Lagos', 10, 'Los Lagos'],
];
const PROVEEDORES = [
  ['76.111.222-3', 'Comercial Andes SpA', true],
  ['77.333.444-5', 'Distribuidora del Sur Ltda.', true],
  ['78.555.666-7', 'Soluciones Integrales Norte SpA', false],
  ['76.777.888-9', 'Importadora Pacífico S.A.', false],
  ['77.999.000-K', 'Servicios Técnicos Biobío SpA', true],
];

const pad = (n) => String(n).padStart(2, '0');
/** Formato de la API: sin zona, se interpreta como UTC. */
const sinZona = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

export function crearCatalogo(ahora = Date.now()) {
  const procesos = [];
  let correlativo = 100;
  for (let i = 0; i < 42; i++) {
    const rubro = RUBROS[i % RUBROS.length];
    const [organismo, region, nombreRegion] = elegir(ORGANISMOS);
    const tipo = i % 3 === 0 ? 'desierta' : i % 7 === 0 ? 'cerrada' : 'publicada';
    const cantidad = rubro.precio > 300000 ? entre(1, 12) : entre(20, 400);
    const presupuesto = Math.round(rubro.precio * cantidad * (0.8 + azar() * 0.5) / 1000) * 1000;
    const publicada = new Date(ahora - entre(1, 5) * 86_400_000);
    const cierre = tipo === 'publicada'
      ? new Date(ahora + entre(2, 96) * 3_600_000)
      : new Date(ahora - entre(1, 40) * 86_400_000);
    const codigo = `${entre(1000, 5999)}-${correlativo++}-COT26`;
    const segundoLlamado = tipo === 'publicada' && i % 5 === 0;
    const ofertas = tipo === 'publicada' ? (azar() < 0.35 ? 0 : entre(1, 6)) : tipo === 'desierta' ? entre(2, 5) : entre(1, 4);

    const cotizantes = tipo === 'desierta'
      ? PROVEEDORES.slice(0, ofertas).map(([rut, razon, emt], k) => {
        const unitario = Math.round(rubro.precio * (0.85 + azar() * 0.6));
        const neto = unitario * cantidad;
        const inadmisible = k === ofertas - 1 && azar() < 0.5;
        return {
          rut_proveedor: rut, razon_social: razon, es_emt: emt ? 1 : 0,
          valor_neto: neto, total_impuesto: Math.round(neto * 0.19), monto_total: Math.round(neto * 1.19),
          justificacion_inadmisibilidad: inadmisible ? 'No adjunta ficha técnica solicitada' : null,
          productos_cotizados: [{
            codigo_producto: rubro.producto, nombre_producto: rubro.nombre, descripcion: null,
            cantidad, precio_unitario: unitario, monto_total_producto: neto,
          }],
        };
      })
      : [];

    procesos.push({
      item: {
        codigo,
        nombre: `${rubro.nombre}${i % 2 ? '' : ` — ${nombreRegion}`}`,
        estado: { id_estado: tipo === 'publicada' ? 1 : tipo === 'desierta' ? 5 : 3, codigo: tipo, glosa: tipo[0].toUpperCase() + tipo.slice(1) },
        convocatoria: { estado_convocatoria: segundoLlamado ? 2 : 1, descripcion: segundoLlamado ? 'Segundo llamado' : 'Primer llamado' },
        documentos: [{ id: String(1800000 + i), nombre: 'Bases técnicas.pdf' }],
        fechas: {
          fecha_publicacion: sinZona(publicada),
          fecha_cierre: sinZona(cierre),
          fecha_ultimo_cambio: new Date(ahora - entre(5, 300) * 60_000).toISOString(),
          fecha_cancelacion: null,
        },
        montos: { moneda: 'CLP', monto_disponible: presupuesto, monto_disponible_clp: presupuesto },
        institucion: { organismo_comprador: organismo, rut: '69.000.000-0', unidad_compra: 'Adquisiciones', region, nombre_region: nombreRegion },
        resumen: { total_ofertas_recibidas: ofertas },
        motivos: {
          motivo_cancelacion: null,
          motivo_desierta: tipo === 'desierta' ? elegir(['Ofertas sobre el presupuesto disponible', 'Ofertas no cumplen requisitos técnicos']) : null,
          motivo_seleccion: null,
        },
        links: { detalle: `/v2/compra-agil/${codigo}` },
      },
      detalle: {
        descripcion: `Se requiere ${rubro.nombre.toLowerCase()} según bases técnicas adjuntas.`,
        convocatoria: {
          estado_convocatoria: segundoLlamado ? 2 : 1, descripcion: segundoLlamado ? 'Segundo llamado' : 'Primer llamado',
          fecha_cierre_primer_llamado: `${sinZona(cierre).replace(' ', 'T')}:00Z`, fecha_cierre_segundo_llamado: null,
        },
        entrega: { direccion_entrega: `${organismo}, bodega central`, plazo_entrega_dias: entre(3, 20) },
        presupuesto: {
          tipo_presupuesto: 'Disponible', moneda: 'CLP', presupuesto_estimado: presupuesto,
          monto_disponible: presupuesto, monto_disponible_clp: presupuesto, valor_cambio_moneda: null, fecha_cambio_moneda: null,
        },
        productos_solicitados: [{ codigo_producto: rubro.producto, nombre: rubro.nombre, descripcion: null, cantidad, unidad_medida: rubro.unidad }],
        proveedores_cotizando: cotizantes,
        resumen: { multa_sancion: null, total_ofertas_recibidas: ofertas, total_demandas: 0 },
        flags: { considera_requisitos_medioambientales: false, considera_requisitos_impacto_social_economico: false },
      },
    });
  }
  return procesos;
}

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Aplica los filtros de GET /v2/compra-agil que importan para simular. */
export function buscarEnCatalogo(procesos, params) {
  const q = params.get('q');
  const estados = (params.get('estado') ?? '').split(',').filter(Boolean);
  const region = params.get('region');
  const id = params.get('id');
  let r = procesos.map((p) => p.item);
  if (id) r = r.filter((i) => i.codigo === id);
  if (q) {
    const terminos = sinAcentos(q).split(/\s+/).filter(Boolean);
    r = r.filter((i) => terminos.every((t) => sinAcentos(i.nombre).includes(t)));
  }
  if (estados.length) r = r.filter((i) => estados.includes(i.estado.codigo));
  if (region) r = r.filter((i) => String(i.institucion.region) === region);
  const tam = Number(params.get('tamano_pagina')) || 10;
  const pag = Number(params.get('numero_pagina')) || 1;
  const total = r.length;
  return {
    items: r.slice((pag - 1) * tam, pag * tam),
    paginacion: { total_paginas: Math.ceil(total / tam), numero_pagina: pag, tamano_pagina: tam, total_resultados: total },
  };
}
