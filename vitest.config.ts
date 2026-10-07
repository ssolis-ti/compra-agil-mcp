import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Puntos de entrada: solo leen el entorno y arrancan el proceso (stdio o
      // temporizador). Su lógica vive en servidor.ts y src/vigilancia/,
      // que sí se miden; test/protocolo.test.ts y test/rutas.test.ts los
      // ejecutan como proceso real, donde la cobertura no se mide.
      exclude: ['src/index.ts', 'src/services/monitor.ts', 'src/utils/env-loader.ts'],
      reporter: ['text-summary', 'json-summary'],
      // Fase 1.6 del plan 2.8.0: herramientas ≥ 80 % de líneas cada una;
      // global ≥ 75 %. La CI falla si bajan.
      thresholds: {
        lines: 75,
        'src/tools/**.ts': { lines: 80, perFile: true },
        // 2.9.0 (NF7): cada archivo del núcleo de vigilancia y avisos.
        'src/vigilancia/**.ts': { lines: 80, perFile: true },
        'src/avisos/**/*.ts': { lines: 80, perFile: true },
      },
    },
  },
});
