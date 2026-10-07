# 0026. Un núcleo, dos modos: el gateway entrega, el daemon vigila solo

- **Estado:** propuesta
- **Origen:** 2.9.0, fase 0 ([diseño §2 y §8](../specs/2.9.0-vigilancia-y-avisos/diseno.md#2-módulos-nuevos-y-capas))

**Contexto:** el servidor MCP corre por stdio y vive mientras su cliente lo tiene abierto: no puede vigilar por su cuenta. Los gateways como OpenClaw o Hermes ya están siempre encendidos, programan tareas y tienen Telegram. Quien no usa un gateway necesita un proceso propio que se mantenga encendido.

**Decisión:** la vigilancia y los avisos viven en un núcleo (`src/vigilancia/`, `src/avisos/`) que no lee el entorno, no usa `Date.now()` ni arranca temporizadores. Recibe el cliente, el reloj y el estado como parámetros, como el ciclo actual ([0019](0019-servidor-construido-aparte-del-arranque.md)). Hay dos entradas:
- **Gateway:** la tarea programada del gateway llama `obtener_alertas_nuevas` (que ejecuta el ciclo si corresponde, dentro de los 45 s de presupuesto), envía por su canal y llama `confirmar_alertas`.
- **Daemon:** `mcp-compra-agil --vigilar` ejecuta el ciclo con su temporizador y envía por los canales propios. Se instala como tarea programada o servicio.

Un bloqueo de vigilante con latido impide que los dos modos revisen a la vez.

**Consecuencias:** el mismo código se prueba una vez y sirve a los dos modos. El gateway no necesita conocer la API de Mercado Público ni guardar estado. El servidor pasa de 16 a 21 herramientas.
