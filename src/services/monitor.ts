/**
 * Daemon: monitor
 *
 * Servicio en segundo plano que vigila de forma periódica las Compras Públicas.
 * Busca oportunidades vigentes (publicada), con 0 ofertas, que superen un presupuesto mínimo
 * y que contengan palabras clave específicas. Guarda las alertas en alerts.log.
 */
import fs from 'fs';
import { loadEnvManual } from '../utils/env-loader.js';
import { rutaDeDatos } from '../utils/rutas.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { CompraAgilApiError } from '../utils/error-handler.js';
import { safeError, registrarSecreto } from '../utils/redact.js';
import { ejecutarCiclo } from './ciclo-monitor.js';
import { ahora, iniciarRelojOficial } from '../utils/reloj.js';
import { leerEstadoMonitor, podarEstado, serializarEstado } from '../utils/estado-monitor.js';

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
    // El ciclo vive en ciclo-monitor.ts para poder probarlo (fase 1.6). La
    // ventana se calcula con la hora del SHOA (ahora()), no solo con el reloj local.
    const { revisados, alertas } = await ejecutarCiclo(
      client,
      { intervaloMinutos: INTERVAL_MINUTES, presupuestoMinimo: MIN_BUDGET, palabrasClave: KEYWORDS },
      alertedCodes,
      ahora(),
    );
    console.log(`[${timestamp}] Se encontraron ${revisados} procesos modificados/creados recientemente.`);

    for (const alerta of alertas) {
      fs.appendFileSync(ALERTS_LOG_PATH, alerta.linea, 'utf8');
      console.log(`\x1b[33m${alerta.linea.trim()}\x1b[0m`);
    }
    if (alertas.length > 0) persistAlertedCodes();

    console.log(`[${timestamp}] Ciclo completado. Alertas nuevas en este ciclo: ${alertas.length}\n`);

  } catch (error) {
    const errorMsg = error instanceof CompraAgilApiError ? error.actionableMessage : safeError(error);
    console.error(`[${timestamp}] [ERROR] Falló el ciclo de monitoreo: ${errorMsg}\n`);

    // ⚠ Fase 1.5: con `error: any` esta rama comparaba `error?.status` (el campo
    //   es `httpStatus`) y buscaba un texto que los mensajes ya no traen: nunca
    //   se ejecutaba. El lint la destapó al quitar el `any`.
    if (error instanceof CompraAgilApiError && error.httpStatus === 429) {
      console.warn(`[${timestamp}] [ADVERTENCIA] Rate limit detectado. El servicio reintentará en el próximo ciclo.`);
    }
  }
}

// Ejecución inicial inmediata. runCheck captura sus propios errores; `void`
// declara que no se espera a propósito.
void runCheck();

// Agendar ejecuciones periódicas
setInterval(runCheck, INTERVAL_MINUTES * 60 * 1000);
