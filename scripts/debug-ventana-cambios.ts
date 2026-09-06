/**
 * ¿La API acepta de verdad `cambio_desde`/`cambio_hasta` (Grupo 1, opción B)?
 *
 * La guía oficial lo afirma y le dedica el Ejemplo 8.2, pero este proyecto ya
 * encontró varias afirmaciones de la documentación que no se sostienen contra
 * el servicio real. Se comprueba antes de exponer la capacidad como herramienta.
 *
 * Verifica además que combinar ambas opciones de ventana sea efectivamente un
 * error, que es lo que asume la validación local de `monitorear_cambios_recientes`.
 */

import { loadEnvManual } from '../src/utils/env-loader.js';
import { registrarSecreto, redact, safeError } from '../src/utils/redact.js';

loadEnvManual();
const TICKET = process.env.COMPRA_AGIL_TICKET!;
registrarSecreto(TICKET);
const BASE = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';

const log = (s: string) => console.log(redact(s));

async function probar(nombre: string, params: Record<string, string>): Promise<void> {
  const url = new URL('/v2/compra-agil', BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const r = await fetch(url.toString(), { headers: { ticket: TICKET } });
    const j: any = await r.json();
    if (j.success === 'OK') {
      const p = j.payload?.paginacion;
      const items = j.payload?.items ?? [];
      const cambios = items
        .map((i: any) => i.fechas?.fecha_ultimo_cambio)
        .filter(Boolean)
        .sort();
      log(`✅ ${nombre}`);
      log(`     total=${p?.total_resultados} items=${items.length}`);
      if (cambios.length) {
        log(`     ultimo_cambio observado: ${cambios[0]} → ${cambios[cambios.length - 1]}`);
      }
    } else {
      log(`❌ ${nombre}`);
      log(`     ${j.errors?.[0]?.codigo}: ${j.errors?.[0]?.mensaje}`);
    }
  } catch (e) {
    log(`💥 ${nombre} → ${safeError(e)}`);
  }
}

async function main(): Promise<void> {
  const ahora = new Date();
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const hace48h = iso(new Date(ahora.getTime() - 48 * 3600_000));
  const hace24h = iso(new Date(ahora.getTime() - 24 * 3600_000));

  log('\n¿Funciona la ventana de cambios por rango de fechas (opción B)?\n');

  await probar(`rango cerrado [${hace48h} → ${hace24h}]`, {
    cambio_desde: hace48h,
    cambio_hasta: hace24h,
    tamano_pagina: '10',
  });
  await new Promise((r) => setTimeout(r, 500));

  await probar(`rango abierto [desde ${hace24h}]`, {
    cambio_desde: hace24h,
    tamano_pagina: '10',
  });
  await new Promise((r) => setTimeout(r, 500));

  await probar('CONTROL — ttl_cambio_ms + cambio_desde juntos (se espera rechazo)', {
    ttl_cambio_ms: '3600000',
    cambio_desde: hace24h,
    tamano_pagina: '10',
  });
}

main().catch((e) => log('💥 ' + safeError(e)));
