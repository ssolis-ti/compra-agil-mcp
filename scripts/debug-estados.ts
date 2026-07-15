/**
 * ¿Qué valores de `estado` devuelven datos de verdad?
 *
 * La documentación oficial ya advierte que `oc_emitida` "no aparece en la práctica".
 * Este script comprueba TODOS los estados documentados contra la API real,
 * porque de ello dependen recomendar_precio, auditar_desiertas y generar_borrador.
 */

import { loadEnvManual } from '../src/utils/env-loader.js';
import { registrarSecreto, redact, safeError } from '../src/utils/redact.js';

loadEnvManual();
const TICKET = process.env.COMPRA_AGIL_TICKET!;
registrarSecreto(TICKET);
const BASE = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';

const log = (s: string) => console.log(redact(s));

const ESTADOS = [
  'publicada',
  'cerrada',
  'desierta',
  'cancelada',
  'proveedor_seleccionado',
  'oc_emitida',
  'adjudicada',       // no documentado — probar por si acaso
  'seleccionada',     // no documentado — probar por si acaso
];

async function probarEstado(estado: string): Promise<void> {
  const url = new URL('/v2/compra-agil', BASE);
  url.searchParams.set('estado', estado);
  url.searchParams.set('tamano_pagina', '10');
  try {
    const r = await fetch(url.toString(), { headers: { ticket: TICKET } });
    const j: any = await r.json();
    if (j.success === 'OK') {
      const total = j.payload?.paginacion?.total_resultados ?? 0;
      const n = j.payload?.items?.length ?? 0;
      const glosa = n > 0 ? ` · glosa real: "${j.payload.items[0].estado.glosa}" (id ${j.payload.items[0].estado.id_estado})` : '';
      log(`${total > 0 ? '✅' : '⚠️ '} ${estado.padEnd(24)} total=${String(total).padStart(6)} items=${n}${glosa}`);
    } else {
      log(`❌ ${estado.padEnd(24)} ${j.errors?.[0]?.codigo}: ${j.errors?.[0]?.mensaje}`);
    }
  } catch (e) {
    log(`💥 ${estado.padEnd(24)} ${safeError(e)}`);
  }
}

async function main() {
  log('\n¿Qué estados devuelven datos reales?\n');
  for (const e of ESTADOS) {
    await probarEstado(e);
    await new Promise((r) => setTimeout(r, 400));
  }

  // Sin filtro de estado: ¿qué glosas/ids aparecen realmente en la naturaleza?
  log('\nEstados presentes en una muestra sin filtrar (ttl 24h):');
  const url = new URL('/v2/compra-agil', BASE);
  url.searchParams.set('ttl_cambio_ms', '86400000');
  url.searchParams.set('tamano_pagina', '50');
  const r = await fetch(url.toString(), { headers: { ticket: TICKET } });
  const j: any = await r.json();
  const conteo = new Map<string, number>();
  for (const it of j.payload?.items ?? []) {
    const k = `${it.estado.codigo} (id=${it.estado.id_estado}, glosa="${it.estado.glosa}")`;
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...conteo.entries()].sort((a, b) => b[1] - a[1])) {
    log(`   ${String(v).padStart(3)} × ${k}`);
  }
}

main().catch((e) => log('💥 ' + safeError(e)));
