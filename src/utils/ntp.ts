/**
 * Consulta la hora oficial de Chile contra el SHOA (Servicio Hidrográfico y
 * Oceanográfico de la Armada), que es el organismo que la fija legalmente.
 *
 * ⚠ QUÉ PROBLEMA RESUELVE Y CUÁL NO: no dice nada sobre cómo interpretar las
 *   fechas ambiguas que entrega la API —de eso se encarga `utils/fechas.ts`—.
 *   Resuelve algo distinto y anterior: si el reloj de esta máquina está
 *   desviado, entonces `horas_restantes` y el puntaje de urgencia del radar
 *   están mal aunque la interpretación de la fecha sea perfecta, porque ambos
 *   se calculan restando la hora local. Un reloj adelantado media hora hace
 *   creer que un plazo está más cerca de lo que está; uno atrasado, lo
 *   contrario, y eso sí cuesta una licitación.
 *
 * Implementa lo mínimo de NTP (RFC 5905) sobre `dgram`, sin dependencias. El
 * desfase se calcula con la fórmula del protocolo, que descuenta el viaje de
 * ida y vuelta en vez de atribuirlo todo al reloj:
 *
 *     desfase = ((T2 − T1) + (T3 − T4)) / 2
 *     demora  = (T4 − T1) − (T3 − T2)
 *
 *   T1 salida del cliente · T2 llegada al servidor
 *   T3 salida del servidor · T4 llegada al cliente
 */

import dgram from 'dgram';

/** Servidor oficial de la hora en Chile. */
export const SERVIDOR_NTP_CHILE = 'ntp.shoa.cl';

/** Segundos entre la época NTP (1900) y la de Unix (1970). */
const EPOCA_NTP_A_UNIX = 2_208_988_800;

export interface ResultadoNtp {
  ok: true;
  servidor: string;
  /** Diferencia del reloj local respecto del oficial, en ms. Positivo = local atrasado. */
  desfaseMs: number;
  /** Ida y vuelta de la consulta, en ms. Una demora alta resta precisión al desfase. */
  demoraMs: number;
  horaOficial: string;
  horaLocal: string;
}

export interface FalloNtp {
  ok: false;
  servidor: string;
  motivo: string;
}

/** Lee un timestamp NTP de 64 bits (32 de segundos + 32 de fracción) como ms Unix. */
function leerTimestamp(buf: Buffer, offset: number): number {
  const segundos = buf.readUInt32BE(offset);
  const fraccion = buf.readUInt32BE(offset + 4);
  return (segundos - EPOCA_NTP_A_UNIX) * 1000 + Math.round((fraccion / 4_294_967_296) * 1000);
}

/**
 * Pregunta la hora al SHOA. Nunca lanza: un fallo de red se devuelve como
 * `{ ok: false }` porque muchas redes corporativas bloquean el UDP 123, y eso
 * no debe impedir que el servidor MCP funcione.
 */
export function consultarHoraOficial(
  servidor: string = SERVIDOR_NTP_CHILE,
  timeoutMs = 5000
): Promise<ResultadoNtp | FalloNtp> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let resuelto = false;

    const terminar = (r: ResultadoNtp | FalloNtp) => {
      if (resuelto) return;
      resuelto = true;
      try { socket.close(); } catch { /* ya cerrado */ }
      resolve(r);
    };

    const temporizador = setTimeout(
      () => terminar({
        ok: false,
        servidor,
        motivo: `El servidor no respondió en ${timeoutMs} ms. Muchas redes corporativas bloquean el puerto UDP 123, que es el que usa NTP.`,
      }),
      timeoutMs
    );

    socket.on('message', (msg) => {
      clearTimeout(temporizador);
      const t4 = Date.now();
      if (msg.length < 48) {
        return terminar({ ok: false, servidor, motivo: 'La respuesta no tiene el tamaño de un paquete NTP.' });
      }
      try {
        const t1 = leerTimestamp(msg, 24); // Originate: el T1 que enviamos, devuelto por el servidor
        const t2 = leerTimestamp(msg, 32); // Receive
        const t3 = leerTimestamp(msg, 40); // Transmit
        const desfaseMs = Math.round(((t2 - t1) + (t3 - t4)) / 2);
        const demoraMs = Math.max(0, Math.round((t4 - t1) - (t3 - t2)));
        terminar({
          ok: true,
          servidor,
          desfaseMs,
          demoraMs,
          horaOficial: new Date(t4 + desfaseMs).toISOString(),
          horaLocal: new Date(t4).toISOString(),
        });
      } catch (e) {
        terminar({ ok: false, servidor, motivo: `No se pudo leer la respuesta: ${String(e)}` });
      }
    });

    socket.on('error', (e) => {
      clearTimeout(temporizador);
      terminar({ ok: false, servidor, motivo: `Error de red: ${e.message}` });
    });

    // Paquete de consulta: LI=0, VN=4, Mode=3 (cliente). El resto en cero.
    const paquete = Buffer.alloc(48);
    paquete[0] = 0x23;
    // Se escribe T1 en Originate para que el servidor lo devuelva y el cálculo
    // del desfase no dependa del reloj local más de lo imprescindible.
    const t1 = Date.now();
    paquete.writeUInt32BE(Math.floor(t1 / 1000) + EPOCA_NTP_A_UNIX, 40);
    paquete.writeUInt32BE(Math.round(((t1 % 1000) / 1000) * 4_294_967_296), 44);

    socket.send(paquete, 0, 48, 123, servidor, (e) => {
      if (e) {
        clearTimeout(temporizador);
        terminar({ ok: false, servidor, motivo: `No se pudo enviar la consulta: ${e.message}` });
      }
    });
  });
}

/** Umbral a partir del cual el desfase puede alterar una decisión de plazo. */
export const DESFASE_PREOCUPANTE_MS = 60_000;

/** Traduce el desfase a lo que significa para quien va a cotizar. */
export function interpretarDesfase(desfaseMs: number): string {
  const abs = Math.abs(desfaseMs);
  if (abs < 1000) return 'El reloj de esta máquina está sincronizado con la hora oficial de Chile.';
  if (abs < DESFASE_PREOCUPANTE_MS) {
    return `El reloj está desviado ${(abs / 1000).toFixed(1)} s respecto de la hora oficial. Es una diferencia irrelevante para calcular plazos de cierre.`;
  }
  const minutos = (abs / 60_000).toFixed(1);
  const sentido = desfaseMs > 0 ? 'atrasado' : 'adelantado';
  const consecuencia = desfaseMs > 0
    ? 'las horas restantes que informa el radar son MAYORES que las reales, así que un plazo puede vencer antes de lo que parece'
    : 'las horas restantes que informa el radar son MENORES que las reales';
  return `⚠ El reloj de esta máquina está ${sentido} ${minutos} min respecto de la hora oficial de Chile. Como los plazos se calculan restando la hora local, ${consecuencia}. Conviene sincronizar el reloj del sistema antes de fiarse de "horas_restantes".`;
}
