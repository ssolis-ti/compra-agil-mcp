/**
 * Daemon de vigilancia (2.9.0): `mcp-compra-agil --vigilar`.
 *
 * Lee los lotes de cambios nuevos de la API, sin huecos (src/vigilancia/), y
 * avisa por los canales configurados y en `alerts.log`. Es solo la entrada:
 * lee el entorno, deja todo en `vigilancia.log` y arranca el bucle de
 * `services/bucle-vigilancia.ts`, el mismo que usa el servidor en el modo «con
 * Claude».
 */
import { loadEnvManual } from '../utils/env-loader.js';
import { rutaDeDatos } from '../utils/rutas.js';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { registrarSecreto } from '../utils/redact.js';
import { iniciarRelojOficial } from '../utils/reloj.js';
import { criteriosDesdeEntorno } from '../vigilancia/criterios.js';
import { crearCanales } from '../avisos/canales/crear.js';
import { configAvisosDelEquipo } from '../avisos/preferencias.js';
import { configSaludDesdeEntorno } from '../vigilancia/salud.js';
import { crearLogRotativo } from '../utils/log-rotativo.js';
import { crearBucleVigilancia, intervaloDesdeEntorno } from './bucle-vigilancia.js';

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
const registrarEnArchivo = crearLogRotativo(rutaDeDatos('vigilancia.log'));
for (const nivel of ['log', 'warn', 'error'] as const) {
  const original = console[nivel].bind(console);
  console[nivel] = (...partes: unknown[]) => {
    original(...partes);
    // eslint-disable-next-line no-control-regex
    registrarEnArchivo(partes.map(String).join(' ').replace(/\u001b\[[0-9;]*m/g, ''));
  };
}

const criterios = criteriosDesdeEntorno(process.env);
const configAvisos = configAvisosDelEquipo(process.env, rutaDeDatos('.preferencias.json'));
const canales = crearCanales(configAvisos);
const salud = configSaludDesdeEntorno(process.env, canales.map((c) => c.nombre), intervaloDesdeEntorno(process.env), configAvisos.resumen);

console.log('========================================================');
console.log('  VIGILANCIA DE COMPRA ÁGIL (lote por lote, sin huecos)');
console.log('========================================================');
console.log(`Ronda cada            : ${intervaloDesdeEntorno(process.env) / 60_000} min`);
console.log(`Palabras clave        : ${criterios.palabras.join(', ') || '(cualquiera)'}`);
console.log(`Excluidas             : ${criterios.excluidas.join(', ') || '(ninguna)'}`);
console.log(`Regiones              : ${criterios.regiones.join(', ') || '(todas)'}`);
console.log(`Presupuesto mínimo    : ${criterios.presupuestoMinimo > 0 ? `$${criterios.presupuestoMinimo.toLocaleString('es-CL')} CLP` : 'sin mínimo'}`);
console.log(`Solo sin ofertas      : ${criterios.soloSinOfertas ? 'sí' : 'no'}`);
console.log(`Solo compras nuevas   : ${criterios.soloNuevas ? 'sí (publicadas en 24 h o en segundo llamado)' : 'no (también las modificadas)'}`);
console.log(`Todas en la región    : ${criterios.todasEnRegion ? (criterios.regiones.length > 0 ? 'sí' : 'sí, pero sin regiones no aplica') : 'no'}`);
console.log(`Alertas en            : ${rutaDeDatos('alerts.log')}`);
console.log(`Avisos por            : ${canales.map((c) => c.nombre).join(', ') || '(ningún canal: solo alerts.log)'}`);
if (configAvisos.bandeja.silencio) console.log(`Silencio              : ${configAvisos.bandeja.silencio.desde}–${configAvisos.bandeja.silencio.hasta} (hora de Chile)`);
for (const error of configAvisos.errores) console.warn(`[AVISO] ${error}`);
console.log(`Aviso de ceguera tras   : ${salud.umbralCegueraMs / 60_000} min sin una revisión completa`);
console.log(`Resumen diario         : ${salud.resumenHora} (hora de Chile)`);
console.log('========================================================');

iniciarRelojOficial();
crearBucleVigilancia({
  client: new CompraAgilClient(TICKET, BASE_URL, { persistir: true }),
  env: process.env,
  mantenerVivo: true,
  registrar: (nivel, mensaje) => {
    if (nivel === 'error') console.error(`[ERROR] ${mensaje}`);
    else if (nivel === 'aviso') console.warn(`[AVISO] ${mensaje}`);
    else console.log(mensaje);
  },
}).iniciar();
