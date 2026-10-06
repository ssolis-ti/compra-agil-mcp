/**
 * Daemon: monitor
 *
 * Servicio en segundo plano que vigila de forma periódica las Compras Públicas.
 * Busca oportunidades vigentes (publicada), con 0 ofertas, que superen un presupuesto mínimo
 * y que contengan palabras clave específicas. Guarda las alertas en alerts.log.
 */
import fs from 'fs';
import path from 'path';
import { loadEnvManual } from '../utils/env-loader.js';
import { rutaDeDatos } from '../utils/rutas.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { safeError, registrarSecreto } from '../utils/redact.js';
import { enHoraDeChile, ventanaUltimosMinutos } from '../utils/fechas.js';
import { ahora, iniciarRelojOficial } from '../utils/reloj.js';
import { leerEstadoMonitor, podarEstado, serializarEstado } from '../utils/estado-monitor.js';
import { TAMANO_PAGINA_SEGURO } from '../utils/paginacion.js';

// Inicializar entorno
loadEnvManual();

const TICKET = process.env.COMPRA_AGIL_TICKET;
const BASE_URL = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';

// El daemon es un proceso independiente: debe registrar el secreto por su cuenta.
registrarSecreto(TICKET);

if (!TICKET) {
  console.error('[ERROR] Variable de entorno COMPRA_AGIL_TICKET no definida en .env');
  process.exit(1);
}

// Parámetros de monitoreo configurables por el usuario
const INTERVAL_MINUTES = parseInt(process.env.MONITOR_INTERVAL_MINUTES || '60', 10);
const MIN_BUDGET = parseFloat(process.env.MONITOR_MIN_BUDGET_CLP || '5000000');
const KEYWORDS_RAW = process.env.MONITOR_KEYWORDS || 'software, desarrollo, licencias, plataforma, sistema';
const KEYWORDS = KEYWORDS_RAW.split(',').map(kw => kw.trim().toLowerCase()).filter(Boolean);

const ALERTS_LOG_PATH = rutaDeDatos('alerts.log');
const STATE_PATH = rutaDeDatos('.monitor-state.json');

// ─── Deduplicación de alertas ──────────────────────────────────────────
// Evita re-alertar el mismo proceso en ciclos consecutivos. Se persiste en disco
// para sobrevivir reinicios del daemon. Cada código guarda cuándo se alertó y se
// podan los de más de 30 días (fase 1.7): antes la lista crecía para siempre.
function loadAlertedCodes(): Map<string, number> {
  try {
    if (fs.existsSync(STATE_PATH)) return leerEstadoMonitor(fs.readFileSync(STATE_PATH, 'utf8'), Date.now());
  } catch (e) {
    console.error(`[ADVERTENCIA] No se pudo leer el estado de deduplicación (${STATE_PATH}): ${safeError(e)}`);
  }
  return new Map();
}

const alertedCodes: Map<string, number> = loadAlertedCodes();

function persistAlertedCodes(): void {
  try {
    podarEstado(alertedCodes, Date.now());
    fs.writeFileSync(STATE_PATH, serializarEstado(alertedCodes), 'utf8');
  } catch (e) {
    console.error(`[ADVERTENCIA] No se pudo guardar el estado de deduplicación: ${safeError(e)}`);
  }
}

console.log('========================================================');
console.log('  INICIANDO DEMONIO DE MONITOREO DE COMPRA ÁGIL v2');
console.log('========================================================');
console.log(`Frecuencia de monitoreo: Cada ${INTERVAL_MINUTES} minutos`);
console.log(`Presupuesto mínimo      : $${MIN_BUDGET.toLocaleString('es-CL')} CLP`);
console.log(`Palabras clave a buscar: ${KEYWORDS.join(', ')}`);
console.log(`Destino de alertas     : ${ALERTS_LOG_PATH}`);
console.log('========================================================');

const client = new CompraAgilClient(TICKET, BASE_URL, { persistir: true });
// La ventana de cada ciclo se calcula con la hora del SHOA, no solo con el reloj local.
iniciarRelojOficial();

async function runCheck() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Iniciando ciclo de búsqueda de cambios...`);

  try {
    // Ventana = intervalo de ejecución + 5 minutos de solapamiento entre ciclos.
    // ⚠ Rango absoluto, no `ttl_cambio_ms`: la API compara sus marcas (hora de
    //   Chile con "Z") contra la hora UTC real, y el ttl dejaba fuera las tres
    //   horas más recientes. Ver utils/fechas.ts.
    const bufferMinutes = 5;

    // Hasta 10 páginas de 10. Una de 50 agota la pasarela (HTTP 504).
    // El ciclo cubre como máximo 100 procesos.
    const items = await client.buscarTodo({
      ...ventanaUltimosMinutos(INTERVAL_MINUTES + bufferMinutes, ahora()),
      estado: 'publicada',
      tamano_pagina: TAMANO_PAGINA_SEGURO,
    });

    console.log(`[${timestamp}] Se encontraron ${items.length} procesos modificados/creados recientemente.`);

    let alertCount = 0;

    for (const item of items) {
      // Filtro 1: Debe estar en estado "publicada"
      if (item.estado.codigo !== 'publicada') continue;

      // Filtro 2: Debe tener 0 ofertas recibidas
      if (item.resumen.total_ofertas_recibidas !== 0) continue;

      // Filtro 3: Debe superar el presupuesto mínimo
      // Sin monto publicado no se alerta: `undefined < MIN_BUDGET` es false y
      // dejaba pasar el proceso hasta un toLocaleString() sobre undefined.
      const presupuesto = item.montos.monto_disponible_clp;
      if (typeof presupuesto !== 'number' || presupuesto < MIN_BUDGET) continue;

      // Filtro 4: Coincidencia de palabras clave en el nombre
      const nameLower = item.nombre.toLowerCase();
      const matchedKeyword = KEYWORDS.find(kw => nameLower.includes(kw));

      if (matchedKeyword) {
        // Deduplicación: no re-alertar un proceso ya notificado en ciclos previos
        if (alertedCodes.has(item.codigo)) continue;
        alertedCodes.set(item.codigo, Date.now());

        alertCount++;
        // El cierre se informa declarando la zona: la API lo entrega en hora de
        // Chile sin decirlo (ver utils/fechas.ts). En una alerta cuyo propósito
        // es avisar a tiempo, una hora sin zona es justo la confusión a evitar.
        const cierreChile = enHoraDeChile(item.fechas.fecha_cierre);
        const cierreTexto = cierreChile
          ? `${cierreChile} (hora de Chile)`
          : String(item.fechas.fecha_cierre);
        const alertMsg = `[${new Date().toISOString()}] [ALERTA] Código: ${item.codigo} | Presupuesto: $${presupuesto.toLocaleString('es-CL')} CLP | Cierre: ${cierreTexto} | Institución: ${item.institucion.organismo_comprador} | Coincidencia: "${matchedKeyword}" | Nombre: ${item.nombre.trim()}\n`;

        // Escribir en alerts.log
        fs.appendFileSync(ALERTS_LOG_PATH, alertMsg, 'utf8');

        // Mostrar alerta en consola
        console.log(`\x1b[33m${alertMsg.trim()}\x1b[0m`);
      }
    }

    if (alertCount > 0) persistAlertedCodes();

    console.log(`[${timestamp}] Ciclo completado. Alertas nuevas en este ciclo: ${alertCount}\n`);

  } catch (error: any) {
    const errorMsg = error?.actionableMessage || safeError(error);
    console.error(`[${timestamp}] [ERROR] Falló el ciclo de monitoreo: ${errorMsg}\n`);
    
    // Si la cuota de la API se agotó, podemos dormir o pausar el demonio
    if (errorMsg.includes('Cuota diaria agotada') || error?.status === 429) {
      console.warn(`[${timestamp}] [ADVERTENCIA] Rate limit detectado. El servicio reintentará en el próximo ciclo.`);
    }
  }
}

// Ejecución inicial inmediata
runCheck();

// Agendar ejecuciones periódicas
setInterval(runCheck, INTERVAL_MINUTES * 60 * 1000);
