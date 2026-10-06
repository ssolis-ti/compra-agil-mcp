# 0011. Rate limiter proactivo, no solo reactivo

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** `throttle()` espacia las solicitudes bajo un máximo por minuto
**antes** de enviarlas, además de reaccionar al 429.

**Por qué:** la versión previa solo contaba requests y reaccionaba *después* de
recibir un 429 — pero el CHANGELOG afirmaba "Token Bucket, 40 req/min". La
descripción no coincidía con el comportamiento. Se implementó el throttle real en
vez de corregir la documentación a la baja.

## Actualizaciones

- **2.2.0:** el límite bajó de 40 a 15 consultas por minuto: la ráfaga de las herramientas de análisis vaciaba el balde de tokens y provocaba el 429. Y un 429 dejó de bloquear hasta el día siguiente: se honra `Retry-After` o se espera de forma creciente (medido: la API volvió a responder 13 min después).
- **Sprint 0 / 2.7.0:** si la espera en el freno no cabe en el presupuesto de tiempo de la herramienta, la consulta no se envía y la herramienta responde con lo que tenga (`src/utils/presupuesto.ts`).
