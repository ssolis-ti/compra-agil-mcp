/**
 * Busca procesos que EXPONGAN cotizaciones (proveedores_cotizando no vacío).
 *
 * Es la pregunta de la que depende toda la lógica de esGanador():
 * si la API nunca expone las cotizaciones, las tools analíticas no son reparables
 * — habría que replantearlas.
 *
 * La doc (§5.2) dice: "El detalle completo de cotizaciones se muestra desde
 * estado Cerrada en segundo llamado en adelante."
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

const log = (s: string) => console.log(redact(s));

async function get(pathname: string, params: Record<string, string | number> = {}): Promise<any> {
  const url = new URL(pathname, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString(), { headers: { ticket: TICKET } });
  return r.json();
}

async function main() {
  const estados = ['cerrada', 'desierta'];
  let encontrado = false;

  for (const estado of estados) {
    log(`\n═══ Escaneando estado="${estado}" ═══`);
    const busq = await get('/v2/compra-agil', { estado, tamano_pagina: 50 });
    const items = busq.payload?.items ?? [];
    log(`${items.length} procesos a inspeccionar...\n`);

    let conCotizaciones = 0;
    let conOC = 0;
    const porLlamado = new Map<number, number>();

    for (const item of items.slice(0, 20)) {
      const det = await get(`/v2/compra-agil/${encodeURIComponent(item.codigo)}`);
      if (det.success !== 'OK') continue;
      const p = det.payload;

      const llamado = p.convocatoria?.estado_convocatoria;
      porLlamado.set(llamado, (porLlamado.get(llamado) ?? 0) + 1);

      const nProv = p.proveedores_cotizando?.length ?? 0;
      const idOC = p.id_orden_compra;
      if (idOC != null) conOC++;

      if (nProv > 0) {
        conCotizaciones++;
        if (!encontrado) {
          encontrado = true;
          fs.writeFileSync(path.join(DEBUG_DIR, 'detalle-CON-COTIZACIONES.json'), JSON.stringify(det, null, 2));
          log(`\n🎯 ¡ENCONTRADO! ${item.codigo} — llamado ${llamado} — ${nProv} cotizaciones, ofertas=${p.resumen?.total_ofertas_recibidas}\n`);
          const pr = p.proveedores_cotizando[0];
          log('   ★ CLAVES REALES de proveedores_cotizando[0]:');
          log('     ' + Object.keys(pr).join(', '));
          log('');
          log('   ★ CAMPOS DE DETECCIÓN DEL GANADOR:');
          log('     proveedor_seleccionado :', JSON.stringify(pr.proveedor_seleccionado));
          log('     seleccion              :', JSON.stringify(pr.seleccion));
          log('     estado_por_comprador   :', JSON.stringify(pr.estado_por_comprador));
          log('     estado_cotizacion      :', JSON.stringify(pr.estado_cotizacion));
          log('     activo                 :', JSON.stringify(pr.activo));
          log('     valor_neto             :', JSON.stringify(pr.valor_neto));
          log('     monto_total            :', JSON.stringify(pr.monto_total));
          log('     productos_cotizados    :', pr.productos_cotizados ? `${pr.productos_cotizados.length}` : 'ausente');
          if (pr.productos_cotizados?.[0]) {
            log('     prod[0] claves         :', Object.keys(pr.productos_cotizados[0]).join(', '));
            log('     prod[0].precio_unitario:', JSON.stringify(pr.productos_cotizados[0].precio_unitario));
          }
          log('\n   ★ TODOS los proveedores:');
          p.proveedores_cotizando.forEach((x: any, i: number) => {
            log(`     [${i}] ${String(x.razon_social ?? '?').slice(0, 26).padEnd(26)} sel=${JSON.stringify(x.proveedor_seleccionado)} estComp=${JSON.stringify(x.estado_por_comprador)} neto=${JSON.stringify(x.valor_neto)} total=${JSON.stringify(x.monto_total)}`);
          });
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    log(`\n   Resumen "${estado}" (20 muestras):`);
    log(`     con proveedores_cotizando : ${conCotizaciones}`);
    log(`     con id_orden_compra       : ${conOC}`);
    log(`     por estado_convocatoria   : ${JSON.stringify(Object.fromEntries(porLlamado))}`);
  }

  if (!encontrado) {
    log('\n⚠️  NINGÚN proceso de la muestra expuso cotizaciones.');
  }
}

main().catch((e) => log('💥 ' + safeError(e)));
