# 0019. Construir el servidor aparte de su arranque

- **Estado:** aceptada
- **Origen:** 2.8.0 (fase 1.6, `de30ed0`)

**Contexto:** la única prueba completa levantaba el servidor como proceso aparte por stdio. Funcionaba, pero su cobertura no se medía: varias herramientas figuraban con 0 %, y el daemon, que arranca un temporizador al cargarse, no tenía ningún test.

**Decisión:** `servidor.ts` construye el servidor (capacidades, formatos, herramientas, recursos, prompts); `index.ts` solo lee el entorno, valida el ticket y conecta stdio. El ciclo del daemon vive en `services/ciclo-monitor.ts`. Los tests levantan el servidor real en el mismo proceso, con el transporte en memoria del SDK, el `CompraAgilClient` de verdad y la API simulada de `scripts/qa/`.

**Por qué no un cliente simulado a mano:** se perdería justo lo que más se rompe —el cliente HTTP, el normalizador, la caché, los formatos de error—. La prueba por proceso real se conserva para lo que solo ella ve (stdio, rutas, el `.env`).

**Resultado:** cobertura de 77 % a 93 %, con umbral en `npm run test:coverage`.
