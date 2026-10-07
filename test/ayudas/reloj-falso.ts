/**
 * Reloj controlable para los tests del núcleo de vigilancia y avisos (T1.5 de
 * la 2.9.0, NF5). El núcleo recibe `ahora: () => number` como parámetro; en
 * producción es `ahora()` de src/utils/reloj.ts (hora del SHOA) y aquí avanza
 * horas en microsegundos, sin esperar tiempo real.
 *
 * Los instantes son UTC reales (epoch ms), como los que entrega `ahora()`.
 */
export interface RelojFalso {
  ahora: () => number;
  avanzar(ms: number): void;
  fijar(ms: number): void;
}

export function relojFalso(inicio: number | string): RelojFalso {
  let t = typeof inicio === 'string' ? Date.parse(inicio) : inicio;
  return {
    ahora: () => t,
    avanzar(ms) { t += ms; },
    fijar(ms) { t = ms; },
  };
}
