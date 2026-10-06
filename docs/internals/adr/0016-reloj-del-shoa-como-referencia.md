# 0016. El reloj del SHOA como referencia del «ahora»

- **Estado:** aceptada
- **Origen:** 2.8.0 (`9154cac`)

**Contexto:** los plazos (`horas_restantes`, la urgencia del radar, las ventanas del monitoreo y del daemon) restan «ahora». Era `Date.now()` sin contrastar, y el chequeo contra `ntp.shoa.cl` vivía aislado en una herramienta.

**Decisión:** `ahora()` aplica el desfase medido contra el SHOA al arrancar y cada 30 min, en segundo plano. Si el UDP 123 está bloqueado, sigue con el reloj local y lo dice; si el desfase pasa de un minuto, `_aviso_reloj` aparece en toda respuesta con fechas. `COMPRA_AGIL_NTP=off` lo desactiva.

**Lo que el NTP no resuelve:** da la hora UTC exacta, no la zona. El paso a UTC-3/UTC-4 sale de la base de zonas de Node, y Chile cambia sus reglas por decreto: `verificar_hora_oficial` informa la versión de la base y advierte si es anterior a la 2025b.

**Por qué en segundo plano:** un servidor stdio no puede esperar al NTP para arrancar, y muchas redes corporativas bloquean el UDP 123.

**Dónde:** `src/utils/reloj.ts`, `src/tools/verificar-hora.ts`.
