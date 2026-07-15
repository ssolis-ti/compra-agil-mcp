/**
 * Depuración del endpoint de detalle y de la detección del ganador.
 *
 * Responde la pregunta que la documentación deja abierta (§6.5):
 * ¿existen realmente `proveedor_seleccionado` / `seleccion.*` en la respuesta?
 * De eso depende toda la lógica de esGanador().
 *
 * Salida redactada; crudo a debug/.
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
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t, _status: r.status }; }
}

async function main() {
  // 1. Buscar procesos cerrados.
  //    `proveedor_seleccionado` devuelve 0 resultados en la práctica (verificado),
  //    así que los procesos adjudicados hay que buscarlos entre los `cerrada`.
  log('\n[1] Buscando procesos en estado cerrada...');
  const busq = await get('/v2/compra-agil', { estado: 'cerrada', tamano_pagina: 10 });
  fs.writeFileSync(path.join(DEBUG_DIR, 'busqueda-adjudicadas.json'), JSON.stringify(busq, null, 2));

  if (busq.success !== 'OK' || !busq.payload?.items?.length) {
    log('   ✗ No se obtuvieron procesos adjudicados:', JSON.stringify(busq.errors ?? busq).slice(0, 200));
    return;
  }
  const items = busq.payload.items;
  log(`   ✓ ${items.length} procesos (total ${busq.payload.paginacion.total_resultados})`);

  // 2. Traer el detalle de los primeros hasta encontrar uno con cotizaciones
  for (const item of items.slice(0, 4)) {
    log(`\n[2] Detalle de ${item.codigo} ...`);
    const det = await get(`/v2/compra-agil/${encodeURIComponent(item.codigo)}`);
    fs.writeFileSync(
      path.join(DEBUG_DIR, `detalle-${item.codigo.replace(/[^a-z0-9]+/gi, '-')}.json`),
      JSON.stringify(det, null, 2)
    );

    if (det.success !== 'OK') {
      log('   ✗ error:', JSON.stringify(det.errors ?? {}).slice(0, 150));
      continue;
    }
    const p = det.payload;
    log('   claves raíz:', Object.keys(p).join(', '));
    log('   id_orden_compra (raíz):', JSON.stringify(p.id_orden_compra));
    log('   orden_compra (sub-objeto):', JSON.stringify(p.orden_compra));

    const provs = p.proveedores_cotizando ?? [];
    log(`   proveedores_cotizando: ${provs.length}`);

    if (provs.length > 0) {
      const pr = provs[0];
      log('\n   ★ CLAVES REALES de proveedores_cotizando[0]:');
      log('     ' + Object.keys(pr).join(', '));
      log('\n   ★ CAMPOS CLAVE PARA DETECTAR AL GANADOR:');
      log('     proveedor_seleccionado :', JSON.stringify(pr.proveedor_seleccionado));
      log('     seleccion              :', JSON.stringify(pr.seleccion));
      log('     estado_por_comprador   :', JSON.stringify(pr.estado_por_comprador));
      log('     estado_cotizacion      :', JSON.stringify(pr.estado_cotizacion));
      log('     activo                 :', JSON.stringify(pr.activo));
      log('     valor_neto             :', JSON.stringify(pr.valor_neto));
      log('     monto_total            :', JSON.stringify(pr.monto_total));
      log('     productos_cotizados    :', pr.productos_cotizados ? `${pr.productos_cotizados.length} items` : 'ausente');
      if (pr.productos_cotizados?.[0]) {
        log('     productos_cotizados[0] claves:', Object.keys(pr.productos_cotizados[0]).join(', '));
        log('     precio_unitario        :', JSON.stringify(pr.productos_cotizados[0].precio_unitario));
      }

      log('\n   ★ Resumen de TODOS los proveedores (para ver quién gana):');
      provs.forEach((x: any, i: number) => {
        log(`     [${i}] ${String(x.razon_social).slice(0, 28).padEnd(28)} sel=${JSON.stringify(x.proveedor_seleccionado)} estado_comp=${JSON.stringify(x.estado_por_comprador)} neto=${JSON.stringify(x.valor_neto)}`);
      });
      return; // ya tenemos lo que buscábamos
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  log('\n   ⚠ Ningún proceso de la muestra traía proveedores_cotizando.');
}

main().catch((e) => log('💥', safeError(e)));
