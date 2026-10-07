/**
 * Mediciones de la fase 0 de la 2.9.0 (tareas T0.2–T0.4 de
 * docs/internals/specs/2.9.0-vigilancia-y-avisos/tareas.md), contra la API real.
 *
 * Uso (desde la raíz, con `npm run build` hecho y el ticket en .env):
 *   node scripts/qa/medir-ventanas.mjs bordes     (~8 consultas)  T0.2
 *   node scripts/qa/medir-ventanas.mjs retraso    (~2 consultas)  T0.3; repetir a los +5 y +15 min
 *   node scripts/qa/medir-ventanas.mjs volumen    (~24 consultas) T0.4
 *   node scripts/qa/medir-ventanas.mjs presupuestos (~5 consultas) T0.4
 *
 * Imprime solo conteos y fechas públicas. El ticket se lee del .env por el
 * mismo camino que el servidor y se registra en la redacción.
 * Los resultados se acumulan en .medicion-ventanas.json (carpeta del proyecto,
 * ignorado por git), para comparar corridas.
 */
import fs from 'node:fs';
import { loadEnvManual } from '../../dist/utils/env-loader.js';
import { registrarSecreto, safeError } from '../../dist/utils/redact.js';
import { CompraAgilClient } from '../../dist/api/compra-agil-client.js';
import { aFormatoApi } from '../../dist/utils/fechas.js';

loadEnvManual();
const TICKET = process.env.COMPRA_AGIL_TICKET;
registrarSecreto(TICKET);
if (!TICKET) { console.error('Falta COMPRA_AGIL_TICKET en .env'); process.exit(1); }

const ARCHIVO = '.medicion-ventanas.json';
const registro = fs.existsSync(ARCHIVO) ? JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')) : {};
const guardar = (clave, valor) => {
  (registro[clave] ??= []).push({ medido_utc: new Date().toISOString(), ...valor });
  fs.writeFileSync(ARCHIVO, JSON.stringify(registro, null, 2));
};

// Un cliente nuevo por consulta: la caché en memoria (5 min) falsearía las repeticiones.
const cliente = () => new CompraAgilClient(TICKET, process.env.COMPRA_AGIL_BASE_URL, { persistir: false });
const MIN = 60_000;

async function total(desdeMs, hastaMs, extra = {}) {
  const r = await cliente().buscar({
    cambio_desde: aFormatoApi(new Date(desdeMs)),
    cambio_hasta: aFormatoApi(new Date(hastaMs)),
    tamano_pagina: 10,
    numero_pagina: 1,
    ...extra,
  });
  return { total: r.paginacion.total_resultados, items: r.items };
}

/** Redondea hacia abajo a múltiplo de 5 min, en UTC (Chile tiene desfase de horas enteras). */
const al5 = (ms) => Math.floor(ms / (5 * MIN)) * 5 * MIN;

async function bordes() {
  // Ventana cerrada hace ≥ 40 min, alineada a 5 min, de 30 min.
  const fin = al5(Date.now() - 40 * MIN);
  const ini = fin - 30 * MIN;
  const entera = await total(ini, fin);
  const partes = [];
  for (let i = 0; i < 3; i++) partes.push((await total(ini + i * 10 * MIN, ini + (i + 1) * 10 * MIN)).total);
  // Resolución: las marcas de 10 ítems de un tramo de 5 min, y una ventana de 1 min.
  const cinco = await total(ini, ini + 5 * MIN);
  const marcas = cinco.items.map((it) => it.fechas?.fecha_ultimo_cambio).filter(Boolean);
  const unMin = (await total(ini + 2 * MIN, ini + 3 * MIN)).total;
  const borde = (await total(ini + 5 * MIN, ini + 5 * MIN)).total; // ventana de ancho cero en un borde de ciclo
  const res = {
    ventana_hora_chile: [aFormatoApi(new Date(ini)), aFormatoApi(new Date(fin))],
    total_entera: entera.total, partes_de_10_min: partes, suma_partes: partes.reduce((a, b) => a + b, 0),
    total_primeros_5_min: cinco.total, marcas_muestra: marcas,
    total_1_min_interior: unMin, total_ancho_cero_en_borde: borde,
  };
  console.log(JSON.stringify(res, null, 2));
  guardar('bordes', res);
}

async function retraso() {
  // Primera corrida fija la ventana; las siguientes la repiten.
  const previa = registro.retraso?.[0];
  const [ini, fin] = previa ? previa.ventana_ms : [al5(Date.now()) - 10 * MIN, al5(Date.now())];
  const a = await total(ini, fin);
  const p = await total(ini, fin, { estado: 'publicada' });
  const res = { ventana_ms: [ini, fin], ventana_hora_chile: [aFormatoApi(new Date(ini)), aFormatoApi(new Date(fin))],
    minutos_desde_el_fin: Math.round((Date.now() - fin) / MIN), total: a.total, total_publicada: p.total };
  console.log(JSON.stringify(res, null, 2));
  guardar('retraso', res);
}

async function volumen() {
  // Las 24 horas del día anterior en Chile (día hábil si hoy es martes a sábado).
  const hoy = new Date(aFormatoApi(new Date()).slice(0, 10) + 'T00:00:00Z'); // medianoche de Chile como "pared"
  const filas = [];
  for (let h = 0; h < 24; h++) {
    // La pared de Chile del día anterior, a la hora h; se convierte con el desfase vigente (−3 h en primavera).
    const desdePared = new Date(hoy.getTime() - 24 * 60 * MIN + h * 60 * MIN);
    const desde = desdePared.toISOString().slice(0, 19) + 'Z';
    const hasta = new Date(desdePared.getTime() + 60 * MIN).toISOString().slice(0, 19) + 'Z';
    try {
      const r = await cliente().buscar({ cambio_desde: desde, cambio_hasta: hasta, estado: 'publicada', tamano_pagina: 10, numero_pagina: 1 });
      filas.push({ hora_chile: desde.slice(11, 16), publicadas: r.paginacion.total_resultados });
    } catch (e) {
      filas.push({ hora_chile: desde.slice(11, 16), error: safeError(e).slice(0, 80) });
    }
    console.log(JSON.stringify(filas.at(-1)));
  }
  guardar('volumen', { dia_chile: new Date(hoy.getTime() - 24 * 60 * MIN).toISOString().slice(0, 10), filas });
}

async function presupuestos() {
  const montos = [];
  for (let pag = 1; pag <= 5; pag++) {
    const r = await cliente().buscar({ estado: 'publicada', tamano_pagina: 10, numero_pagina: pag, ordenar_por: 'FechaPublicacion' });
    for (const it of r.items) if (typeof it.montos?.monto_disponible_clp === 'number') montos.push(it.montos.monto_disponible_clp);
  }
  montos.sort((a, b) => a - b);
  const p = (q) => montos[Math.min(montos.length - 1, Math.floor(q * montos.length))];
  const res = { muestra: montos.length, p10: p(0.1), p25: p(0.25), mediana: p(0.5), p75: p(0.75), p90: p(0.9), max: montos.at(-1),
    sobre_5_millones: montos.filter((m) => m >= 5_000_000).length };
  console.log(JSON.stringify(res, null, 2));
  guardar('presupuestos', res);
}

const modos = { bordes, retraso, volumen, presupuestos };
const modo = modos[process.argv[2]];
if (!modo) { console.error('Modo: bordes | retraso | volumen | presupuestos'); process.exit(1); }
modo().catch((e) => { console.error(safeError(e)); process.exit(1); });
