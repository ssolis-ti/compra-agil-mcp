/**
 * Control inteligente de rate limiting para la API de Compra Ágil.
 *
 * Espacia el tráfico a 40 solicitudes por minuto y reacciona a un 429
 * honrando Retry-After o una espera creciente. No bloquea hasta el día
 * siguiente: la cuota se comporta como un token bucket. El contador local
 * sí se reinicia al cambiar el día UTC, solo para la estadística.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

/** Archivo donde el servidor recuerda la cuota entre reinicios. */
export const RUTA_ESTADO_POR_DEFECTO = path.resolve(process.cwd(), '.rate-limit-state.json');

interface EstadoPersistido {
  day: string;
  requestCount: number;
  isLimited: boolean;
  limitResetTime: string | null;
}

export class RateLimiter {
  private requestCount = 0;
  private currentDay: string;
  private isLimited = false;
  private limitResetTime: Date | null = null;
  /** 429 seguidos sin una consulta exitosa en medio; gradúa la espera. */
  private consecutive429 = 0;

  // Throttle proactivo por minuto (ventana deslizante de timestamps).
  private readonly maxPerMinute: number;
  private requestTimestamps: number[] = [];

  /**
   * Ruta de persistencia, o `null` para operar solo en memoria.
   *
   * ⚠ POR QUÉ SE PERSISTE: el contador vivía únicamente en memoria, así que
   *   cada arranque del servidor empezaba en cero. Como un servidor MCP se
   *   reinicia cada vez que el usuario reinicia su cliente, `obtener_estadisticas_uso`
   *   informaba `isLimited: false` incluso segundos después de que la API
   *   hubiera respondido 429 por cuota agotada, y el throttle preventivo
   *   disparaba peticiones contra un muro. Detectado en auditoría.
   */
  private readonly statePath: string | null;

  constructor(maxPerMinute = 40, statePath: string | null = null) {
    this.currentDay = this.getTodayUTC();
    this.maxPerMinute = maxPerMinute;
    this.statePath = statePath;
    this.cargarEstado();
  }

  /** Lee el estado del día en curso. Un estado de otro día se descarta. */
  private cargarEstado(): void {
    if (!this.statePath) return;
    this.aplicarDisco();
    if (this.isLimited) {
      logger.info('Rate limiter: se recuperó un estado de cuota agotada de esta misma jornada UTC.');
    }
  }

  /**
   * Trae a memoria lo que hay en disco para el día UTC en curso.
   * Se llama con el candado ya tomado, antes de sumar o de marcar un 429.
   */
  private aplicarDisco(): void {
    if (!this.statePath || !fs.existsSync(this.statePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as EstadoPersistido;
      if (raw.day !== this.getTodayUTC()) return;
      this.currentDay = raw.day;
      this.requestCount = raw.requestCount ?? 0;
      if (raw.isLimited && raw.limitResetTime && new Date(raw.limitResetTime).getTime() > Date.now()) {
        this.isLimited = true;
        const disco = new Date(raw.limitResetTime);
        if (!this.limitResetTime || disco.getTime() > this.limitResetTime.getTime()) {
          this.limitResetTime = disco;
        }
      }
    } catch {
      // Un estado ilegible no debe impedir arrancar: se sigue en memoria.
    }
  }

  private escribirEstado(): void {
    if (!this.statePath) return;
    try {
      const estado: EstadoPersistido = {
        day: this.currentDay,
        requestCount: this.requestCount,
        isLimited: this.isLimited,
        limitResetTime: this.limitResetTime?.toISOString() ?? null,
      };
      fs.writeFileSync(this.statePath, JSON.stringify(estado), 'utf8');
    } catch {
      // Persistir es una mejora, no un requisito: si el disco no deja, se sigue.
    }
  }

  /**
   * Un solo escritor a la vez. Sin candado, dos procesos leían el mismo
   * número, sumaban en memoria y el último en escribir borraba al otro.
   */
  private conBloqueo(fn: () => void): void {
    if (!this.statePath) {
      fn();
      return;
    }
    const lockPath = `${this.statePath}.lock`;
    const inicio = Date.now();
    let fd: number | undefined;
    while (fd === undefined && Date.now() - inicio < 2000) {
      try {
        fd = fs.openSync(lockPath, 'wx');
      } catch {
        try {
          const edad = Date.now() - fs.statSync(lockPath).mtimeMs;
          if (edad > 5000) fs.unlinkSync(lockPath);
        } catch {
          // Otro proceso soltó el candado entre el fallo y el stat.
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      }
    }
    try {
      fn();
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
        try { fs.unlinkSync(lockPath); } catch { /* ya no está */ }
      }
    }
  }

  private getTodayUTC(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Turno que le tocaría a una consulta nueva, como instante (epoch ms).
   *
   * Los turnos se guardan en orden y nunca hay más de `maxPerMinute` en una
   * ventana de 60 s. Un turno nuevo va después del último reservado (orden de
   * llegada) y, si la ventana está llena, cuando salga de ella el más antiguo
   * de los últimos `maxPerMinute`.
   */
  private proximoTurno(ahora: number): number {
    this.requestTimestamps = this.requestTimestamps.filter((t) => t > ahora - 60_000);
    const n = this.requestTimestamps.length;
    let turno = Math.max(ahora, this.requestTimestamps[n - 1] ?? ahora);
    if (n >= this.maxPerMinute) {
      turno = Math.max(turno, this.requestTimestamps[n - this.maxPerMinute] + 60_000 + 5);
    }
    return turno;
  }

  /** Milisegundos que esperaría una consulta nueva, sin reservar turno. */
  esperaPrevista(): number {
    const ahora = Date.now();
    return this.proximoTurno(ahora) - ahora;
  }

  /**
   * Reserva el próximo turno y devuelve cuánto esperar. Es síncrono: dos
   * llamadas seguidas nunca reciben el mismo turno.
   */
  reservarTurno(): number {
    const ahora = Date.now();
    const turno = this.proximoTurno(ahora);
    this.requestTimestamps.push(turno);
    return turno - ahora;
  }

  /**
   * Espera, si hace falta, hasta el turno reservado: así el tráfico queda bajo
   * el máximo por minuto y no gatilla 429 por ráfagas.
   *
   * ⚠ Antes comprobaba el cupo, esperaba a que saliera el más antiguo y al
   *   despertar anotaba la hora sin volver a mirar: varias consultas que
   *   esperaban a la vez despertaban juntas y salían en ráfaga, por encima
   *   del máximo. Reservar el turno antes de esperar lo impide.
   */
  async throttle(): Promise<void> {
    const espera = this.reservarTurno();
    if (espera > 0) {
      logger.debug(`Rate limiter: turno en ${espera} ms (${this.requestTimestamps.length}/${this.maxPerMinute} en la ventana).`);
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
  }

  /**
   * Registra un request exitoso. Resetea el contador si cambió el día.
   */
  recordRequest(): void {
    this.conBloqueo(() => {
      this.aplicarDisco();
      const today = this.getTodayUTC();
      if (today !== this.currentDay) {
        this.requestCount = 0;
        this.currentDay = today;
        this.isLimited = false;
        this.limitResetTime = null;
        logger.info('Rate limiter: contador diario reseteado (nuevo día calendario UTC).');
      }
      this.requestCount++;
      // Una consulta exitosa prueba que el balde volvió a tener fichas.
      if (this.consecutive429 > 0 || this.isLimited) {
        this.consecutive429 = 0;
        this.isLimited = false;
        this.limitResetTime = null;
      }
      logger.debug(`Rate limiter: request #${this.requestCount} del día.`);
      this.escribirEstado();
    });
  }

  /**
   * Marca que se recibió un error 429.
   *
   * ⚠ POR QUÉ NO SE BLOQUEA HASTA MAÑANA: antes, un solo 429 fijaba el reset
   *   en las 00:01 UTC del día siguiente y `checkLimit()` rechazaba localmente
   *   TODA consulta posterior — el MCP quedaba inutilizable durante horas sin
   *   siquiera intentar llegar a la API. Medido en auditoría: tras un 429, la
   *   API volvió a responder con normalidad 13 minutos después. La propia guía
   *   oficial describe la cuota como un *token bucket* que "se recarga
   *   automáticamente" (glosario) y manda esperar el header `Retry-After`
   *   (§7), aunque su §4 diga que el límite es por día calendario.
   *
   *   Ahora se espera lo que indique `Retry-After`; si no viene, se aplica una
   *   espera creciente (15 → 30 → 60 min, tope 2 h) que se reinicia con la
   *   primera consulta exitosa.
   *
   * @param retryAfterSeconds Valor del header `Retry-After`, si la API lo envió.
   */
  markLimited(retryAfterSeconds?: number): void {
    this.conBloqueo(() => {
      this.aplicarDisco();
      this.isLimited = true;
      this.consecutive429++;

      const esperaSegundos = retryAfterSeconds && retryAfterSeconds > 0
        ? retryAfterSeconds
        : this.esperaPorDefecto();

      const propuesto = new Date(Date.now() + esperaSegundos * 1000);
      if (!this.limitResetTime || propuesto.getTime() > this.limitResetTime.getTime()) {
        this.limitResetTime = propuesto;
      }
      const origen = retryAfterSeconds && retryAfterSeconds > 0 ? 'header Retry-After' : 'espera progresiva local';
      logger.warn(
        `Rate limiter: 429 recibido (#${this.consecutive429} consecutivo). ` +
        `Reintentable a partir de ${this.limitResetTime.toISOString()} (${origen}).`
      );
      this.escribirEstado();
    });
  }

  /** Espera creciente ante 429 sucesivos, para no martillar la API. */
  private esperaPorDefecto(): number {
    const escala = [15, 30, 60, 120]; // minutos
    const i = Math.min(this.consecutive429 - 1, escala.length - 1);
    return escala[Math.max(0, i)] * 60;
  }

  /**
   * Verifica si estamos actualmente limitados.
   */
  checkLimit(): { limited: boolean; resetIn?: string } {
    if (!this.isLimited) {
      return { limited: false };
    }

    const now = new Date();
    if (this.limitResetTime && now >= this.limitResetTime) {
      this.conBloqueo(() => {
        this.aplicarDisco();
        if (this.limitResetTime && new Date() >= this.limitResetTime) {
          this.isLimited = false;
          this.limitResetTime = null;
          this.requestCount = 0;
          this.currentDay = this.getTodayUTC();
          this.escribirEstado();
        }
      });
      if (!this.isLimited) return { limited: false };
    }

    const waitMs = this.limitResetTime
      ? this.limitResetTime.getTime() - now.getTime()
      : 0;
    const waitMin = Math.max(1, Math.ceil(waitMs / 60_000));
    const resetIn = waitMin >= 60
      ? `aproximadamente ${Math.ceil(waitMin / 60)} hora(s)`
      : `aproximadamente ${waitMin} minuto(s)`;

    return { limited: true, resetIn };
  }

  /**
   * Obtiene estadísticas del uso actual.
   */
  getStats(): { requestsToday: number; isLimited: boolean; resetTime: string | null } {
    return {
      requestsToday: this.requestCount,
      isLimited: this.isLimited,
      resetTime: this.limitResetTime?.toISOString() ?? null,
    };
  }
}
