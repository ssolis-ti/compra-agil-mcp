/**
 * Daemon: monitor
 *
 * Servicio en segundo plano que vigila de forma periódica las Compras Públicas.
 * Busca oportunidades vigentes (publicada), con 0 ofertas, que superen un presupuesto mínimo
 * y que contengan palabras clave específicas. Guarda las alertas en alerts.log.
 */

import fs from 'fs';
import path from 'path';
import { CompraAgilClient } from '../api/compra-agil-client.js';

// Cargar variables de entorno manualmente como fallback de robustez
function loadEnvManual() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const parts = trimmed.split('=');
          const key = parts[0]?.trim();
          const value = parts.slice(1).join('=').trim();
          if (key && value) {
            // Eliminar comillas si las hay
            const cleanValue = value.replace(/^['"]|['"]$/g, '');
            process.env[key] = cleanValue;
          }
        }
      }
    }
  } catch (e) {
    console.error('Error al parsear el archivo .env de forma manual:', e);
  }
}

// Inicializar entorno
loadEnvManual();

const TICKET = process.env.COMPRA_AGIL_TICKET;
const BASE_URL = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';

if (!TICKET) {
  console.error('[ERROR] Variable de entorno COMPRA_AGIL_TICKET no definida en .env');
  process.exit(1);
}

// Parámetros de monitoreo configurables por el usuario
const INTERVAL_MINUTES = parseInt(process.env.MONITOR_INTERVAL_MINUTES || '60', 10);
const MIN_BUDGET = parseFloat(process.env.MONITOR_MIN_BUDGET_CLP || '5000000');
const KEYWORDS_RAW = process.env.MONITOR_KEYWORDS || 'software, desarrollo, licencias, plataforma, sistema';
const KEYWORDS = KEYWORDS_RAW.split(',').map(kw => kw.trim().toLowerCase()).filter(Boolean);

const ALERTS_LOG_PATH = path.resolve(process.cwd(), 'alerts.log');

console.log('========================================================');
console.log('  INICIANDO DEMONIO DE MONITOREO DE COMPRA ÁGIL v2');
console.log('========================================================');
console.log(`Frecuencia de monitoreo: Cada ${INTERVAL_MINUTES} minutos`);
console.log(`Presupuesto mínimo      : $${MIN_BUDGET.toLocaleString('es-CL')} CLP`);
console.log(`Palabras clave a buscar: ${KEYWORDS.join(', ')}`);
console.log(`Destino de alertas     : ${ALERTS_LOG_PATH}`);
console.log('========================================================');

const client = new CompraAgilClient(TICKET, BASE_URL);

async function runCheck() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Iniciando ciclo de búsqueda de cambios...`);

  try {
    // Definir ttl en base al intervalo de ejecución + un margen de 5 minutos por solapamiento de APIs
    const bufferMinutes = 5;
    const ttlMs = (INTERVAL_MINUTES + bufferMinutes) * 60 * 1000;

    // Buscar cambios recientes en todo el país
    const response = await client.cambiosRecientes(ttlMs, {
      estado: 'publicada',
      tamano_pagina: 50
    });

    console.log(`[${timestamp}] Se encontraron ${response.items.length} procesos modificados/creados recientemente.`);

    let alertCount = 0;

    for (const item of response.items) {
      // Filtro 1: Debe estar en estado "publicada"
      if (item.estado.codigo !== 'publicada') continue;

      // Filtro 2: Debe tener 0 ofertas recibidas
      if (item.resumen.total_ofertas_recibidas !== 0) continue;

      // Filtro 3: Debe superar el presupuesto mínimo
      if (item.montos.monto_disponible_clp < MIN_BUDGET) continue;

      // Filtro 4: Coincidencia de palabras clave en el nombre
      const nameLower = item.nombre.toLowerCase();
      const matchedKeyword = KEYWORDS.find(kw => nameLower.includes(kw));

      if (matchedKeyword) {
        alertCount++;
        const alertMsg = `[${new Date().toISOString()}] [ALERTA] Código: ${item.codigo} | Presupuesto: $${item.montos.monto_disponible_clp.toLocaleString('es-CL')} CLP | Cierre: ${item.fechas.fecha_cierre} | Institución: ${item.institucion.organismo_comprador} | Coincidencia: "${matchedKeyword}" | Nombre: ${item.nombre.trim()}\n`;
        
        // Escribir en alerts.log
        fs.appendFileSync(ALERTS_LOG_PATH, alertMsg, 'utf8');
        
        // Mostrar alerta en consola
        console.log(`\x1b[33m${alertMsg.trim()}\x1b[0m`);
      }
    }

    console.log(`[${timestamp}] Ciclo completado. Alertas generadas en este ciclo: ${alertCount}\n`);

  } catch (error: any) {
    const errorMsg = error?.actionableMessage || String(error);
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
