/**
 * `mcp-compra-agil --check` y `--probar-avisos` (2.9.0; R10.1, R10.2).
 *
 * `--check` le dice a un agente (o al dueño) si la instalación quedó lista,
 * con una línea por punto y código de salida 0 (todo bien) o 1 (algo falla).
 * No envía mensajes ni muestra secretos. La hora del SHOA bloqueada es una
 * advertencia, no un fallo: el servidor sigue con el reloj local y lo dice.
 *
 * Devuelve el código de salida; la entrada (`index.ts`) termina el proceso.
 */

import fs from 'fs';
import path from 'path';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { carpetaDatos, rutaDeDatos } from '../utils/rutas.js';
import { consultarHoraOficial } from '../utils/ntp.js';
import { safeError, pista, registrarSecreto } from '../utils/redact.js';
import { ventanaUltimosMinutos } from '../utils/fechas.js';
import { configAvisosDelEquipo } from '../avisos/preferencias.js';
import { crearCanales } from '../avisos/canales/crear.js';
import { vigilanteActivo } from '../vigilancia/vigilante.js';

type Escribir = (linea: string) => void;
const OK = '✔', MAL = '✘', OJO = '⚠';

export async function comandoCheck(env: Record<string, string | undefined>, escribir: Escribir): Promise<number> {
  let fallos = 0;
  const mal = (l: string) => { fallos++; escribir(`${MAL} ${l}`); };

  const ticket = env.COMPRA_AGIL_TICKET?.trim();
  registrarSecreto(ticket);
  if (!ticket) mal('Ticket: falta COMPRA_AGIL_TICKET en el .env.');
  else {
    escribir(`${OK} Ticket configurado (${pista(ticket)}).`);
    try {
      const api = new CompraAgilClient(ticket, env.COMPRA_AGIL_BASE_URL || undefined, { persistir: false });
      const r = await api.buscarFresco({ ...ventanaUltimosMinutos(10, Date.now()), tamano_pagina: 10, numero_pagina: 1 });
      escribir(`${OK} API de Mercado Público: responde (${r.paginacion.total_resultados} cambios en los últimos 10 minutos).`);
    } catch (e) {
      mal(`API de Mercado Público: ${safeError(e).slice(0, 200)}`);
    }
  }

  const ntp = await consultarHoraOficial();
  if (ntp.ok) escribir(`${OK} Hora oficial del SHOA: desfase de ${ntp.desfaseMs} ms.`);
  else escribir(`${OJO} Hora oficial del SHOA no disponible (${ntp.motivo}); se usa el reloj de la máquina.`);

  const carpeta = carpetaDatos({ env });
  try {
    fs.mkdirSync(carpeta, { recursive: true });
    const prueba = path.join(carpeta, `.check-${process.pid}.tmp`);
    fs.writeFileSync(prueba, 'ok');
    fs.rmSync(prueba);
    escribir(`${OK} Carpeta de datos escribible: ${carpeta}`);
  } catch (e) {
    mal(`Carpeta de datos ${carpeta}: no se puede escribir (${safeError(e)}).`);
  }

  const avisos = configAvisosDelEquipo(env, rutaDeDatos('.preferencias.json'));
  for (const error of avisos.errores) mal(`Avisos: ${error}`);
  if (avisos.canales.length > 0) escribir(`${OK} Canales de aviso configurados: ${avisos.canales.join(', ')} (pruébalos con --probar-avisos).`);
  else if (avisos.errores.length === 0) escribir(`${OJO} Sin canales de aviso: las alertas solo quedan en alerts.log o en el modo gateway.`);

  const intervalo = (Number.parseInt(env.MONITOR_INTERVAL_MINUTES || '15', 10) || 15) * 60_000;
  const vig = vigilanteActivo(rutaDeDatos('.vigilante.lock'), Date.now(), 3 * intervalo);
  escribir(vig
    ? `${OK} Vigilancia activa (PID ${vig.pid}).`
    : `${OJO} Nadie está vigilando ahora: arranca el daemon (--vigilar) o usa el modo gateway.`);

  escribir(fallos === 0 ? 'Listo: la instalación funciona.' : `Hay ${fallos} problema(s) por resolver.`);
  return fallos === 0 ? 0 : 1;
}

export async function comandoProbarAvisos(env: Record<string, string | undefined>, escribir: Escribir): Promise<number> {
  const avisos = configAvisosDelEquipo(env, rutaDeDatos('.preferencias.json'));
  for (const error of avisos.errores) escribir(`${MAL} ${error}`);
  const canales = crearCanales(avisos);
  if (canales.length === 0) {
    escribir('No hay canales configurados: define COMPRA_AGIL_AVISOS y las variables de cada canal en el .env (ver .env.example).');
    return 1;
  }
  let fallos = avisos.errores.length;
  for (const c of canales) {
    const r = await c.probar(Date.now()).catch((e: unknown) => ({ ok: false as const, tipo: 'transitorio' as const, motivo: safeError(e) }));
    if (r.ok) escribir(`${OK} ${c.nombre}: mensaje de prueba entregado.`);
    else { fallos++; escribir(`${MAL} ${c.nombre}: ${r.motivo}`); }
  }
  return fallos === 0 ? 0 : 1;
}
