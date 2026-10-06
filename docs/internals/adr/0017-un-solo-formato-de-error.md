# 0017. Un solo formato para los errores de validación

- **Estado:** aceptada
- **Origen:** 2.8.0 (`ed6dc18`)

**Contexto:** el mismo tipo de problema salía en cuatro formatos —texto plano, `MCP error -32602: Input validation error…`, «Error de validación:» y mensajes de zod en inglés—, y solo algunos decían si se había gastado cuota.

**Decisión:** todo rechazo de una entrada llega como `Error de validación: <qué corregir>. No se consultó la API.`, venga del esquema o del handler. Se instala en un solo punto al construir el servidor: mapa de errores de zod en español, traducción del rechazo del SDK y normalización de los resultados de cada herramienta.

**Riesgo aceptado:** la traducción del rechazo del esquema envuelve `validateToolInput`, un método interno del SDK 1.x. Si una versión lo quita, el servidor sigue funcionando con el formato del SDK, avisa en el log, y `test/protocolo.test.ts` falla, porque verifica el formato de punta a punta.

**Dónde:** `src/utils/validacion.ts`.
