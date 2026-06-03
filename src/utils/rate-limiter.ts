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

  constructor() {
    this.currentDay = this.getTodayUTC();
  }

  private getTodayUTC(): string {
    return new Date().toISOString().split('T')[0];
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
