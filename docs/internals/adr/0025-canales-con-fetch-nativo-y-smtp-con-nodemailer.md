# 0025. Telegram y webhook con `fetch` nativo; correo con `nodemailer`

- **Estado:** aceptada (7-oct-2026, fase 0)
- **Origen:** 2.9.0, fase 0 ([diseño §6](../specs/2.9.0-vigilancia-y-avisos/diseno.md#6-canales))

**Contexto:** cada dependencia de producción suma superficie de ataque y avisos de `npm audit` que detienen la CI (pasó con el SDK de MCP en la 2.8.0). La Bot API de Telegram y un webhook son un POST HTTP. SMTP es un protocolo con TLS, autenticación y codificación MIME.

**Decisión:** Telegram y el webhook usan `fetch` de Node, sin librerías de bots. El correo usa `nodemailer`, que no tiene dependencias propias y es el estándar de facto. Se descartan las API HTTP de proveedores de correo (Resend, SendGrid): atan a una cuenta externa, y SMTP sirve con Gmail, Microsoft 365 o el servidor de la oficina.

**Consecuencias:** `nodemailer` es la única dependencia nueva de producción de la 2.9.0 (NF1). El ritmo de 1 mensaje por segundo, `retry_after` y la clasificación de errores de Telegram se implementan a mano y se prueban contra una Bot API simulada.
