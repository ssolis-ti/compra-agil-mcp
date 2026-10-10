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

console.log('==================================');
console.log('  VIGILANCIA DE COMPRA ÁGIL');
console.log('==================================');
console.log(`Revisa cada      : ${intervaloDesdeEntorno(process.env) / 60_000} min`);
console.log(`Palabras         : ${criterios.palabras.join(', ') || 'cualquiera'}`);
if (criterios.excluidas.length > 0) console.log(`Excluidas        : ${criterios.excluidas.join(', ')}`);
console.log(`Regiones         : ${criterios.regiones.join(', ') || 'todas'}${criterios.todasEnRegion && criterios.regiones.length > 0 ? ' (todas sus compras)' : ''}`);
console.log(`Monto mínimo     : ${criterios.presupuestoMinimo > 0 ? `$${criterios.presupuestoMinimo.toLocaleString('es-CL')}` : 'sin mínimo'}`);
console.log(`Avisos por       : ${canales.map((c) => c.nombre).join(', ') || 'ninguno (solo alerts.log)'}`);
if (configAvisos.bandeja.silencio) console.log(`Silencio         : ${configAvisos.bandeja.silencio.desde}–${configAvisos.bandeja.silencio.hasta}`);
console.log(`Resumen diario   : ${salud.resumenHora}`);
for (const error of configAvisos.errores) console.warn(`[AVISO] ${error}`);
console.log('==================================');

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
