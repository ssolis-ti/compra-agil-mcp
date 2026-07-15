/**
 * Control inteligente de rate limiting para la API de Compra Ágil.
 *
 * La API usa cuota por día calendario (se resetea a medianoche UTC).
 * Este módulo lleva un contador local de requests para advertir
 * proactivamente antes de alcanzar el límite.
 */

import { logger } from './logger.js';

export class RateLimiter {
  private requestCount = 0;
  private currentDay: string;
  private isLimited = false;
  private limitResetTime: Date | null = null;

  // Throttle proactivo por minuto (ventana deslizante de timestamps).
  private readonly maxPerMinute: number;
  private requestTimestamps: number[] = [];

  constructor(maxPerMinute = 40) {
    this.currentDay = this.getTodayUTC();
    this.maxPerMinute = maxPerMinute;
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
    logger.debug(`Rate limiter: request #${this.requestCount} del día.`);
  }

  /**
   * Marca que se recibió un error 429.
   */
  markLimited(): void {
    this.isLimited = true;
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 1, 0, 0);
    this.limitResetTime = tomorrow;
    logger.warn(`Rate limiter: cuota agotada. Reset estimado: ${tomorrow.toISOString()}`);
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
      return { limited: false };
    }

    const waitMs = this.limitResetTime
      ? this.limitResetTime.getTime() - now.getTime()
      : 0;
    const waitHours = Math.ceil(waitMs / (1000 * 60 * 60));

    return {
      limited: true,
      resetIn: `aproximadamente ${waitHours} hora(s)`,
    };
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
