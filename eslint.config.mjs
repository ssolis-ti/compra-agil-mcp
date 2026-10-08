// @ts-check
/**
 * Lint del servidor (fase 1.5 del plan 2.8.0): reglas recomendadas de ESLint y
 * de typescript-eslint, más `no-floating-promises`, que necesita información
 * de tipos. Una promesa sin esperar ni capturar es justo el tipo de fallo que
 * en un servidor stdio se pierde sin dejar rastro.
 *
 * Solo `src/`: es lo que compila el tsconfig. Los tests se verifican al correr.
 */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'test/**', 'informes/**', 'docs/**', 'coverage/**', 'graphify-out/**', 'extension/**', '*.config.*'] },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
);
