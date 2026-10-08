/**
 * Daemon de vigilancia (2.9.0).
 *
 * Cada `MONITOR_INTERVAL_MINUTES` (15 por defecto) lee los lotes de cambios
 * nuevos de la API, lote por lote y sin huecos (src/vigilancia/), y escribe las
 * alertas en `alerts.log` de la carpeta de datos. Desde la fase 3 también las
 * enviará por los canales configurados.
 *
 * Es solo la entrada: lee el entorno, arma las piezas y programa las rondas.
 * La lógica vive en src/vigilancia/ y se prueba allí.
 */
import fs from 'fs';
import { loadEnvManual } from '../utils/env-loader.js';
import { rutaDeDatos } from '../utils/rutas.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { safeError, registrarSecreto } from '../utils/redact.js';
import { ahora, iniciarRelojOficial } from '../utils/reloj.js';
import { criteriosDesdeEntorno, lineaDeAlerta } from '../vigilancia/criterios.js';
import { rondaDeVigilancia } from '../vigilancia/ronda.js';
import { leerConfigAvisos } from '../avisos/config.js';
import { crearCanales } from '../avisos/canales/crear.js';
import { configSaludDesdeEntorno } from '../vigilancia/salud.js';
import { crearLogRotativo } from '../utils/log-rotativo.js';
import { recuperacionDesdeEntorno } from '../vigilancia/lotes.js';

loadEnvManual();

const TICKET = process.env.COMPRA_AGIL_TICKET;
const BASE_URL = process.env.COMPRA_AGIL_BASE_URL || 'https://api2.mercadopublico.cl';

// El daemon es un proceso independiente: debe registrar el secreto por su cuenta.
registrarSecreto(TICKET);

if (!TICKET) {
  console.error('[ERROR] Variable de entorno COMPRA_AGIL_TICKET no definida en .env');
  process.exit(1);
}

// Todo lo que el daemon escribe en consola queda también en vigilancia.log,
// rotado por tamaño (R10.4): instalado como tarea programada nadie mira la consola.
const registrar = crearLogRotativo(rutaDeDatos('vigilancia.log'));
for (const nivel of ['log', 'warn', 'error'] as const) {
  const original = console[nivel].bind(console);
  console[nivel] = (...partes: unknown[]) => {
    original(...partes);
    // eslint-disable-next-line no-control-regex
    registrar(partes.map(String).join(' ').replace(/\u001b\[[0-9;]*m/g, ''));
  };
}

const INTERVALO_MIN = Math.max(1, Number.parseInt(process.env.MONITOR_INTERVAL_MINUTES || '15', 10) || 15);
const criterios = criteriosDesdeEntorno(process.env);
const ALERTAS = rutaDeDatos('alerts.log');
const rutas = {
  estado: rutaDeDatos('.vigilancia.json'),
  estadoViejo: rutaDeDatos('.monitor-state.json'),
  vigilante: rutaDeDatos('.vigilante.lock'),
};

console.log('========================================================');
console.log('  VIGILANCIA DE COMPRA ÁGIL (lote por lote, sin huecos)');
console.log('========================================================');
console.log(`Ronda cada            : ${INTERVALO_MIN} min`);
console.log(`Palabras clave        : ${criterios.palabras.join(', ') || '(cualquiera)'}`);
console.log(`Excluidas             : ${criterios.excluidas.join(', ') || '(ninguna)'}`);
console.log(`Regiones              : ${criterios.regiones.join(', ') || '(todas)'}`);
console.log(`Presupuesto mínimo    : ${criterios.presupuestoMinimo > 0 ? `$${criterios.presupuestoMinimo.toLocaleString('es-CL')} CLP` : 'sin mínimo'}`);
console.log(`Solo sin ofertas      : ${criterios.soloSinOfertas ? 'sí' : 'no'}`);
// Canales de aviso: solo desde el entorno (ADR 0023). Los secretos quedan
// registrados para la redacción al leer la configuración.
const configAvisos = leerConfigAvisos(process.env);
const canales = crearCanales(configAvisos);

console.log(`Alertas en            : ${ALERTAS}`);
console.log(`Avisos por            : ${canales.map((c) => c.nombre).join(', ') || '(ningún canal: solo alerts.log)'}`);
if (configAvisos.bandeja.silencio) console.log(`Silencio              : ${configAvisos.bandeja.silencio.desde}–${configAvisos.bandeja.silencio.hasta} (hora de Chile)`);
for (const error of configAvisos.errores) console.warn(`[AVISO] ${error}`);
const salud = configSaludDesdeEntorno(process.env, canales.map((c) => c.nombre), INTERVALO_MIN * 60_000, configAvisos.resumen);
console.log(`Aviso de ceguera tras   : ${salud.umbralCegueraMs / 60_000} min sin una revisión completa`);
console.log(`Resumen diario         : ${salud.resumenHora} (hora de Chile)`);
console.log('========================================================');

const client = new CompraAgilClient(TICKET, BASE_URL, { persistir: true });
// La vigilancia necesita respuestas frescas: la comprobación de un lote vuelve
// a pedir la página 1, y desde la caché sería la misma respuesta.
const api = { buscar: client.buscarFresco.bind(client) };
iniciarRelojOficial();

let enCurso = false;

async function ronda(): Promise<void> {
  if (enCurso) return; // una ronda larga (recuperación) no se encima con la siguiente
  enCurso = true;
  const t = new Date(ahora()).toISOString();
  try {
    const r = await rondaDeVigilancia({
      api, ahora, criterios, rutas, pid: process.pid, intervaloMs: INTERVALO_MIN * 60_000,
      entregar: (alertas) => {
        for (const a of alertas) {
          const linea = lineaDeAlerta(a.item, a.coincidencia, new Date(a.cuando));
          fs.appendFileSync(ALERTAS, linea, 'utf8');
          console.log(`\x1b[33m${linea.trim()}\x1b[0m`);
        }
      },
      avisos: { canales, config: configAvisos.bandeja },
      salud,
    }, { recuperacionMs: recuperacionDesdeEntorno(process.env) });
    for (const aviso of r.avisos) console.warn(`[${t}] [AVISO] ${aviso}`);
    if (!r.tomada) {
      console.warn(`[${t}] Otro proceso (PID ${r.otroVigilante ?? '?'}) está vigilando: esta ronda no lee nada.`);
      return;
    }
    if (r.omitida) {
      console.warn(`[${t}] Ronda saltada: tras un 429 de la API, las rondas se espacian hasta que se normalice.`);
      return;
    }
    for (const n of r.notificaciones ?? []) {
      const por = n.entregadaPor.length > 0 ? ` (avisado por ${n.entregadaPor.join(', ')})` : '';
      console.warn(`[${t}] [${n.evento.toUpperCase()}] ${n.titulo}${por}: ${n.lineas.join(' ')}`);
    }
    const c = r.ciclo!;
    console.log(`[${t}] Lotes leídos: ${c.lotesLeidos}, fallidos: ${c.lotesFallidos}, incompletos: ${c.incompletosNuevos}, ` +
      `procesos revisados: ${c.revisados}, alertas nuevas: ${c.alertas.length}, consultas: ${c.consultas}`);
    if (r.envios) {
      for (const [canal, n] of Object.entries(r.envios.porCanal)) {
        if (n.entregados + n.fallidos + n.reintentos > 0) {
          console.log(`[${t}] Avisos por ${canal}: ${n.entregados} entregados, ${n.reintentos} por reintentar, ${n.fallidos} fallidos.`);
        }
      }
    }
    if (c.hueco) console.warn(`[${t}] [AVISO] Más de 48 h sin vigilar: no se revisó desde ${c.hueco.desde} hasta ${c.hueco.hasta}.`);
    if (c.lotesFallidos > 0) console.warn(`[${t}] [AVISO] ${c.lotesFallidos} lote(s) fallaron: se reintentan en la próxima ronda.`);
    if (c.cuotaAgotada) console.warn(`[${t}] [AVISO] La API respondió 429: la ronda se detuvo para no seguir gastando cuota.`);
  } catch (error) {
    console.error(`[${t}] [ERROR] Falló la ronda de vigilancia: ${safeError(error)}`);
  } finally {
    enCurso = false;
  }
}

// Primera ronda inmediata; `ronda` captura sus propios errores.
void ronda();
setInterval(() => void ronda(), INTERVALO_MIN * 60_000);
