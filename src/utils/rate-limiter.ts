/**
 * Control inteligente de rate limiting para la API de Compra Ágil.
 *
 * La API usa cuota por día calendario (se resetea a medianoche UTC).
 * Este módulo lleva un contador local de requests para advertir
 * proactivamente antes de alcanzar el límite.
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
    try {
      if (!fs.existsSync(this.statePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as EstadoPersistido;
      if (raw.day !== this.currentDay) return;
      this.requestCount = raw.requestCount ?? 0;
      this.isLimited = raw.isLimited ?? false;
      this.limitResetTime = raw.limitResetTime ? new Date(raw.limitResetTime) : null;
      if (this.isLimited) {
        logger.info('Rate limiter: se recuperó un estado de cuota agotada de esta misma jornada UTC.');
      }
    } catch {
      // Un estado ilegible no debe impedir arrancar: se sigue en memoria.
    }
  }

  private guardarEstado(): void {
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

  private getTodayUTC(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Espera (si es necesario) hasta que haya cupo dentro de la ventana de 1 minuto,
   * de forma proactiva, ANTES de enviar la solicitud. Evita gatillar 429 por ráfagas.
   */
  async throttle(): Promise<void> {
    // Purgar timestamps con más de 60s de antigüedad
    const cutoff = Date.now() - 60_000;
    this.requestTimestamps = this.requestTimestamps.filter((t) => t > cutoff);

    if (this.requestTimestamps.length >= this.maxPerMinute) {
      // Esperar hasta que el request más antiguo salga de la ventana
      const oldest = this.requestTimestamps[0];
      const waitMs = Math.max(0, oldest + 60_000 - Date.now()) + 5;
      logger.debug(`Rate limiter: throttling ${waitMs}ms (${this.requestTimestamps.length}/${this.maxPerMinute} req/min).`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Repurgar tras la espera
      const cutoff2 = Date.now() - 60_000;
      this.requestTimestamps = this.requestTimestamps.filter((t) => t > cutoff2);
    }

    this.requestTimestamps.push(Date.now());
  }

  /**
   * Registra un request exitoso. Resetea el contador si cambió el día.
   */
  recordRequest(): void {
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
    this.guardarEstado();
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
    this.isLimited = true;
    this.consecutive429++;

    const esperaSegundos = retryAfterSeconds && retryAfterSeconds > 0
      ? retryAfterSeconds
      : this.esperaPorDefecto();

    this.limitResetTime = new Date(Date.now() + esperaSegundos * 1000);
    const origen = retryAfterSeconds && retryAfterSeconds > 0 ? 'header Retry-After' : 'espera progresiva local';
    logger.warn(
      `Rate limiter: 429 recibido (#${this.consecutive429} consecutivo). ` +
      `Reintentable a partir de ${this.limitResetTime.toISOString()} (${origen}).`
    );
    this.guardarEstado();
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
      this.isLimited = false;
      this.limitResetTime = null;
      this.requestCount = 0;
      this.currentDay = this.getTodayUTC();
      this.guardarEstado();
      return { limited: false };
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
