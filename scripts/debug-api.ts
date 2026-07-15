/**
 * Harness de depuración contra la API real.
 *
 * DISEÑO DE SEGURIDAD:
 * - La respuesta CRUDA se escribe en debug/ (gitignored) → para los ojos del usuario.
 * - A consola solo va un resumen REDACTADO → seguro de compartir/pegar.
 * - Todo texto impreso pasa por redact(), así que ni un error imprevisto filtra el ticket.
 *
 * Uso: npx tsx scripts/debug-api.ts
 */

import fs from 'fs';
import path from 'path';
import { loadEnvManual } from '../src/utils/env-loader.js';
import { registrarSecreto, redact, safeError } from '../src/utils/redact.js';

loadEnvManual();

const TICKET = process.env.COMPRA_AGIL_TICKET;
registrarSecreto(TICKET);

if (!TICKET) {
  console.error('No hay COMPRA_AGIL_TICKET en .env');
  process.exit(1);
}

const BASE = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';
const DEBUG_DIR = path.resolve(process.cwd(), 'debug');
fs.mkdirSync(DEBUG_DIR, { recursive: true });

/** Imprime siempre redactado. */
function log(...partes: unknown[]): void {
  console.log(redact(partes.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')));
}

interface Caso {
  nombre: string;
  path: string;
  params: Record<string, string | number>;
}

/**
 * Prueba una combinación de parámetros y reporta el resultado.
 * Guarda la respuesta cruda en debug/ para inspección humana.
 */
async function probar(caso: Caso): Promise<void> {
  const url = new URL(caso.path, BASE);
  for (const [k, v] of Object.entries(caso.params)) {
    url.searchParams.set(k, String(v));
  }

  const inicio = Date.now();
  try {
    const resp = await fetch(url.toString(), { headers: { ticket: TICKET! } });
    const ms = Date.now() - inicio;
    const texto = await resp.text();

    // Crudo a disco — para el usuario, no para el LLM
    const archivo = path.join(DEBUG_DIR, `${caso.nombre.replace(/[^a-z0-9]+/gi, '-')}.json`);
    fs.writeFileSync(archivo, texto, 'utf8');

    let resumen: string;
    try {
      const j = JSON.parse(texto);
      if (j.success === 'OK' && j.payload) {
        const p = j.payload;
        const n = p.items?.length ?? (p.codigo ? 1 : 0);
        const total = p.paginacion?.total_resultados;
        resumen = `OK · items=${n}${total !== undefined ? ` · total=${total}` : ''}`;
      } else if (j.success === 'NOK') {
        resumen = `NOK · ${j.errors?.[0]?.codigo}: ${j.errors?.[0]?.mensaje}`;
      } else if (j.Cantidad !== undefined) {
        resumen = `OK (legacy) · Cantidad=${j.Cantidad}`;
      } else {
        resumen = `respuesta inesperada: ${texto.slice(0, 120)}`;
      }
    } catch {
      resumen = `no-JSON (${texto.length}b): ${texto.slice(0, 120)}`;
    }

    const icono = resp.ok ? '✅' : '❌';
    log(`${icono} [${resp.status}] ${caso.nombre.padEnd(42)} ${String(ms).padStart(5)}ms  ${resumen}`);
  } catch (e) {
    log(`💥 ${caso.nombre.padEnd(42)}  ${safeError(e)}`);
  }
}

const CASOS: Caso[] = [
  // ¿La API acepta una consulta sin ningún filtro?
  { nombre: 'sin filtros (solo paginacion)', path: '/v2/compra-agil', params: { tamano_pagina: 10, numero_pagina: 1 } },
  { nombre: 'sin filtros ni paginacion', path: '/v2/compra-agil', params: {} },
  // Los ejemplos oficiales siempre llevan al menos un filtro
  { nombre: 'ttl_cambio_ms 1h (ejemplo 8.1)', path: '/v2/compra-agil', params: { ttl_cambio_ms: 3600000 } },
  { nombre: 'ttl_cambio_ms 24h', path: '/v2/compra-agil', params: { ttl_cambio_ms: 86400000 } },
  { nombre: 'estado=publicada', path: '/v2/compra-agil', params: { estado: 'publicada', tamano_pagina: 10 } },
  { nombre: 'estado=publicada + region=13', path: '/v2/compra-agil', params: { estado: 'publicada', region: 13, tamano_pagina: 10 } },
  { nombre: 'q=software', path: '/v2/compra-agil', params: { q: 'software', tamano_pagina: 10 } },
  // ¿Es cierto el mínimo de 10 en tamano_pagina?
  { nombre: 'tamano_pagina=1 (probar minimo)', path: '/v2/compra-agil', params: { estado: 'publicada', tamano_pagina: 1 } },
  { nombre: 'tamano_pagina=5', path: '/v2/compra-agil', params: { estado: 'publicada', tamano_pagina: 5 } },
  { nombre: 'tamano_pagina=50 (maximo)', path: '/v2/compra-agil', params: { estado: 'publicada', tamano_pagina: 50 } },
];

async function main() {
  log(`\nDepuración API Compra Ágil — base: ${BASE}`);
  log(`Crudo en: ${DEBUG_DIR}  (gitignored, para inspección humana)\n`);

  for (const caso of CASOS) {
    await probar(caso);
    await new Promise((r) => setTimeout(r, 400)); // no atropellar la API
  }

  log('\nRevisa los .json en debug/ para ver las respuestas completas.');
}

main();
