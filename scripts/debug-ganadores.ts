/**
 * ¿Existe ALGÚN proceso con un proveedor adjudicado (proveedor_seleccionado=1)?
 *
 * De esto depende que recomendar_precio_ganador, auditar_compras_desiertas y
 * generar_borrador_cotizacion puedan funcionar. Si la API nunca expone un
 * ganador, esas tools no son reparables — hay que replantearlas.
 */

import fs from 'fs';
import path from 'path';
import { loadEnvManual } from '../src/utils/env-loader.js';
import { registrarSecreto, redact, safeError } from '../src/utils/redact.js';

loadEnvManual();
const TICKET = process.env.COMPRA_AGIL_TICKET!;
registrarSecreto(TICKET);
const BASE = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';
const DEBUG_DIR = path.resolve(process.cwd(), 'debug');
fs.mkdirSync(DEBUG_DIR, { recursive: true });

const log = (...p: unknown[]) =>
  console.log(redact(p.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')));

async function get(pathname: string, params: Record<string, string | number> = {}): Promise<any> {
  const url = new URL(pathname, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString(), { headers: { ticket: TICKET } });
  return r.json();
}

async function main() {
  const stats = {
    inspeccionados: 0,
    conCotizaciones: 0,
    conGanador: 0,
    conIdOrdenCompra: 0,
    valoresSel: new Map<string, number>(),
    valoresEstadoCot: new Map<string, number>(),
    estadoConvocatoria: new Map<string, number>(),
  };

  // Muestrear en varios estados y páginas para maximizar diversidad
  const planes = [
    { estado: 'desierta', pagina: 1 },
    { estado: 'desierta', pagina: 3 },
    { estado: 'cerrada', pagina: 2 },
    { estado: 'cancelada', pagina: 1 },
  ];

  for (const plan of planes) {
    log(`\n═══ ${plan.estado} · página ${plan.pagina} ═══`);
    const busq = await get('/v2/compra-agil', {
      estado: plan.estado,
      tamano_pagina: 50,
      numero_pagina: plan.pagina,
    });
    const items = busq.payload?.items ?? [];
    if (items.length === 0) { log('  (sin items)'); continue; }

    for (const item of items.slice(0, 12)) {
      const det = await get(`/v2/compra-agil/${encodeURIComponent(item.codigo)}`);
      if (det.success !== 'OK') continue;
      const p = det.payload;
      stats.inspeccionados++;

      const conv = String(p.convocatoria?.estado_convocatoria);
      stats.estadoConvocatoria.set(conv, (stats.estadoConvocatoria.get(conv) ?? 0) + 1);
      if (p.id_orden_compra != null) stats.conIdOrdenCompra++;

      const provs = p.proveedores_cotizando ?? [];
      if (provs.length > 0) stats.conCotizaciones++;

      for (const pr of provs) {
        const sel = JSON.stringify(pr.proveedor_seleccionado);
        stats.valoresSel.set(sel, (stats.valoresSel.get(sel) ?? 0) + 1);
        const ec = JSON.stringify(pr.estado);
        stats.valoresEstadoCot.set(ec, (stats.valoresEstadoCot.get(ec) ?? 0) + 1);

        if (pr.proveedor_seleccionado === 1 || pr.proveedor_seleccionado === true) {
          stats.conGanador++;
          log(`\n  🏆 ¡GANADOR! ${item.codigo} (${p.estado.codigo})`);
          log(`     ${pr.razon_social} · neto=${pr.valor_neto} · total=${pr.monto_total}`);
          log(`     estado(cotiz)=${JSON.stringify(pr.estado)} estado_por_comprador=${JSON.stringify(pr.estado_por_comprador)} id_oc=${JSON.stringify(pr.id_oc)}`);
          log(`     id_orden_compra(proceso)=${JSON.stringify(p.id_orden_compra)}`);
          fs.writeFileSync(path.join(DEBUG_DIR, 'detalle-CON-GANADOR.json'), JSON.stringify(det, null, 2));
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    log(`  ...inspeccionados hasta ahora: ${stats.inspeccionados}`);
  }

  log('\n\n╔══════════════ RESUMEN ══════════════╗');
  log(`  procesos inspeccionados : ${stats.inspeccionados}`);
  log(`  con cotizaciones        : ${stats.conCotizaciones}`);
  log(`  CON GANADOR (sel=1)     : ${stats.conGanador}`);
  log(`  con id_orden_compra     : ${stats.conIdOrdenCompra}`);
  log(`  valores proveedor_seleccionado : ${JSON.stringify(Object.fromEntries(stats.valoresSel))}`);
  log(`  valores estado (cotización)    : ${JSON.stringify(Object.fromEntries(stats.valoresEstadoCot))}`);
  log(`  estado_convocatoria            : ${JSON.stringify(Object.fromEntries(stats.estadoConvocatoria))}`);
  log('╚═════════════════════════════════════╝');
}

main().catch((e) => log('💥 ' + safeError(e)));
