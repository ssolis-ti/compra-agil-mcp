# Requisitos — 2.9.0 Vigilancia confiable y avisos

Los criterios usan la forma EARS: **Cuando** (evento), **Mientras** (estado),
**Si** (condición no deseada), **Donde** (opción activada), y «el sistema
deberá». Cada uno tiene un identificador estable: las tareas y los tests lo
citan. Un criterio no se reescribe en silencio. Si cambia, se anota la fecha
y el motivo debajo.

«El sistema» es el núcleo de vigilancia y avisos, sea que lo ejecute el
daemon o una herramienta MCP llamada por un gateway.

## Punto de partida (medido el 7-oct-2026)

- El daemon escribe cada alerta en `alerts.log` y en la consola. No avisa por ningún canal.
- Revisa como máximo 10 páginas de 10 procesos (100) por ciclo, y no informa si cortó. `verificar_ticket` vio 99 cambios en 10 minutos.
- Cada ciclo revisa «la última hora + 5 min». Si un ciclo falla (504), esa ventana no se vuelve a revisar.
- El presupuesto mínimo por defecto es $5.000.000. El tope de Compra Ágil es 100 UTM (≈ $7 millones), así que casi nada pasa el filtro.
- El servidor MCP solo actúa cuando lo llaman, y el daemon hay que arrancarlo y mantenerlo a mano.

## Actores

- **Dueño:** configura los criterios y los canales y lee los avisos. No es programador.
- **Gateway:** un agente siempre encendido (OpenClaw, Hermes) con tareas programadas y su propio Telegram.
- **Daemon:** el proceso `mcp-compra-agil` en modo vigilancia, para quien no tiene gateway.
- **Modelo:** el LLM que usa las herramientas MCP. Lee texto de terceros (nombres y descripciones de procesos) y puede ser blanco de inyección de instrucciones.

## Historias

- **H1.** Como dueño, quiero enterarme de cada proceso que calza con mis criterios, aunque la API haya fallado un rato, para no perder oportunidades.
- **H2.** Como dueño, quiero recibir los avisos en Telegram o en el correo, sin tener que abrir un archivo.
- **H3.** Como dueño, quiero saber cuando la vigilancia no está viendo, porque el silencio no puede significar dos cosas.
- **H4.** Como dueño con gateway, quiero que mi agente instale todo, lo deje encendido y me confirme que quedó listo.
- **H5.** Como integrador, quiero recibir las alertas por webhook firmado, para conectarlas a n8n, Make o un sistema propio.

---

## R1 — Vigilancia completa (H1)

- **R1.1** Cuando un ciclo lea completos los lotes de la API que le tocan, el sistema deberá avanzar la marca hasta el último lote leído completo, sin pasar el primer lote pendiente.
- **R1.2** Cuando empiece un ciclo, el sistema deberá leer los lotes pendientes y todos los lotes desde el siguiente a la marca hasta el último con más de 2 minutos de asentamiento, no «ahora − intervalo».
- **R1.3** Si la ventana pendiente supera el tope de recuperación (por defecto 48 h), el sistema deberá revisar solo las últimas 48 h, registrar el resto como hueco con su rango y avisarlo (R8.2).
- **R1.4** Cuando un lote tenga más publicadas que una página, el sistema deberá leer todas sus páginas y comprobar al final que el total no cambió y que los códigos distintos leídos son tantos como el total. Si el lote tiene más de 100, deberá leerlo por región.
- **R1.5** Si la comprobación de R1.4 falla, el sistema deberá releer el lote una vez y luego por región. Si aun así no cuadra, lo deberá marcar como incompleto, con su marca, su total y los leídos.
- **R1.6** Si la lectura de un lote falla (504, timeout, 5xx o 429), el sistema deberá dejarlo pendiente y la marca no lo deberá pasar. El ciclo siguiente lo reintenta primero.
- **R1.7** Mientras un vigilante esté activo, otro proceso no deberá ejecutar ciclos. Un vigilante cuyo latido tenga más de 3 intervalos de antigüedad, o cuyo proceso ya no exista, se considera muerto.
- **R1.8** Si el proceso se corta a mitad de un ciclo, el sistema deberá retomarlo sin perder ni duplicar alertas. El estado en disco es siempre el anterior o el siguiente, nunca uno a medias.
- **R1.9** El sistema deberá alertar cada proceso una sola vez, salvo que vuelva a calzar con un criterio después de 30 días (la poda actual).
- **R1.10** Las ventanas se deberán expresar con `cambio_desde`/`cambio_hasta` como la API compara (hora de Chile con «Z», `aFormatoApi`) y el «ahora» con `ahora()` del reloj del SHOA, nunca con `ttl_cambio_ms` ni `Date.now()` (ADR 0015 y 0016).

## R2 — Criterios de alerta (H1)

- **R2.1** El sistema deberá filtrar por: palabras clave (en el nombre, sin tildes ni mayúsculas), palabras excluidas, regiones, presupuesto mínimo y, como opción activada por defecto, «solo con 0 ofertas».
- **R2.2** Cuando una herramienta MCP cambie los criterios, el sistema deberá avisar del cambio por todos los canales activos, con el antes y el después. Así una inyección que los silencie queda a la vista.
- **R2.3** El presupuesto mínimo por defecto será 0 (sin filtro): con $5.000.000 se perdía el 84 % de los procesos publicados (medición del 7-oct, T0.4).
- **R2.4** Las variables actuales (`MONITOR_KEYWORDS`, `MONITOR_MIN_BUDGET_CLP`, `MONITOR_INTERVAL_MINUTES`) deberán seguir funcionando.

## R3 — Bandeja de salida (H2)

- **R3.1** Cuando se genere una alerta, el sistema deberá crear un aviso por cada canal activo, con un id estable derivado del código del proceso y del canal.
- **R3.2** El sistema deberá entregar cada aviso al menos una vez:
  - un error transitorio (5xx, 429, timeout, red) se reintenta con espera creciente;
  - un error permanente (4xx salvo 429, credenciales malas, destinatario bloqueado) lo marca como fallido sin reintentar;
  - tras 8 intentos queda como fallido.
- **R3.3** El sistema deberá agrupar los avisos de un mismo ciclo en un mensaje por canal, y dividirlo si supera el tope del canal.
- **R3.4** Donde haya un horario de silencio configurado, el sistema deberá retener los avisos de ese horario y enviarlos en un solo resumen al terminar.
- **R3.5** Si el proceso se reinicia con avisos pendientes, el sistema deberá enviarlos en el ciclo siguiente.

## R4 — Contenido y seguridad (H2, H5)

- **R4.1** Cada aviso deberá incluir:
  - código, nombre (máximo 160 caracteres), organismo, región y presupuesto;
  - cierre en hora de Chile y horas restantes;
  - palabra que coincidió y enlace a la ficha pública.
- **R4.2** Ningún aviso, log, archivo de estado ni respuesta deberá contener el ticket ni las credenciales de los canales. Tampoco contactos personales (`sinContactos`).
- **R4.3** El texto que escribe el comprador se deberá escapar para el formato de cada canal: HTML de Telegram, HTML y texto del correo (sin saltos de línea en el asunto), JSON del webhook.
- **R4.4** Los destinos de los avisos (chat, URL, destinatarios, servidor de correo) se deberán configurar solo por variables de entorno. Ninguna herramienta MCP deberá aceptar ni cambiar un destino.
- **R4.5** Al arrancar, el sistema deberá registrar en la redacción el token de Telegram, el secreto y la URL completa del webhook, y la clave SMTP.
- **R4.6** Un aviso no deberá afirmar que un proveedor ganó ni que el proceso es una buena oportunidad. Informa que calza con los criterios.

## R5 — Telegram (H2)

- **R5.1** Donde Telegram esté activo, el sistema deberá enviar por `sendMessage` de la Bot API, con `parse_mode: HTML` y sin vista previa de enlaces.
- **R5.2** Si la Bot API responde 429, el sistema deberá esperar `parameters.retry_after` antes de reintentar.
- **R5.3** El sistema deberá enviar como máximo un mensaje por segundo al mismo chat.
- **R5.4** El CLI deberá poder mostrar el chat id del último mensaje enviado al bot, para configurarlo sin herramientas externas.

## R6 — Webhook (H5)

- **R6.1** Donde el webhook esté activo, el sistema deberá enviar un POST JSON con el esquema versionado `compra_agil.alertas` v1, publicado en `docs/api/`.
- **R6.2** Cada envío deberá llevar `X-Compra-Agil-Firma: t=<unix>,v1=<hex>`, un HMAC-SHA256 de `t + "." + cuerpo` con el secreto configurado, y `Idempotency-Key`.
- **R6.3** El sistema deberá aceptar solo URLs `https`, salvo `localhost` y `127.0.0.1`, y cortar cada envío a los 10 s.
- **R6.4** La documentación deberá incluir la verificación de la firma en Node y en Python, y el test la deberá ejecutar.

## R7 — Correo (H2)

- **R7.1** Donde el correo esté activo, el sistema deberá enviar por SMTP con TLS obligatorio, en texto plano y HTML simple.
- **R7.2** El asunto deberá decir la cantidad y la primera coincidencia, en una sola línea.
- **R7.3** Credenciales rechazadas: fallo permanente, informado una vez, sin repetir la clave en ningún texto.

## R8 — Salud (H3)

- **R8.1** Si no hay un ciclo bueno durante el umbral de ceguera (por defecto 120 min), el sistema deberá avisar una sola vez por episodio que la vigilancia está ciega, desde cuándo y por qué.
- **R8.2** Cuando la vigilancia se recupere, el sistema deberá avisarlo con el rango revisado y los huecos que no se pudieron cubrir.
- **R8.3** A la hora configurada, el sistema deberá enviar un resumen diario: procesos revisados, alertas, lotes incompletos, huecos, fallos por canal y consultas gastadas.
- **R8.4** Si un canal acumula 3 fallos seguidos, el sistema deberá avisarlo por los otros canales activos.
- **R8.5** El sistema deberá proyectar las consultas diarias.
  - Si llega un 429, deberá espaciar las rondas (×2 por cada 429, hasta ×8) y avisarlo una vez al día.
  - Si la proyección supera el presupuesto configurado, deberá avisarlo una vez al día, sin espaciar.

  *Cambio del 7-oct-2026 (fase 7):* con la lectura lote por lote cada lote se lee una vez, así que espaciar no ahorra consultas; solo atrasaría los avisos.

## R9 — Modo gateway (H4)

- **R9.1** La herramienta `obtener_alertas_nuevas` deberá ejecutar un ciclo si el último tiene más de un intervalo de antigüedad, y devolver las alertas no confirmadas con un `lote_id`.
- **R9.2** Si un ciclo no cabe en el presupuesto de tiempo de la herramienta (45 s), el sistema deberá guardar el avance de los lotes leídos completos y decir que quedó parcial.
- **R9.3** Cuando el gateway llame `confirmar_alertas(lote_id)`, el sistema deberá marcar el lote como entregado. Un lote sin confirmar en 30 minutos se vuelve a ofrecer.
- **R9.4** La herramienta `estado_vigilancia` deberá informar:
  - marca y último ciclo bueno, fallos seguidos, lotes pendientes e incompletos, huecos;
  - avisos por canal y estado;
  - proyección de cuota y si hay un vigilante vivo.

## R10 — Operación (H4)

- **R10.1** `mcp-compra-agil --check` deberá verificar el ticket, la API, la hora del SHOA, la carpeta de datos y cada canal activo, y terminar con código 0 si todo está bien o 1 si algo falla, con una línea por punto.
- **R10.2** `--probar-avisos` y la herramienta `probar_avisos` deberán enviar un mensaje de prueba a cada canal activo y decir cuál llegó, sin aceptar destino por parámetro.
- **R10.3** El daemon deberá poder instalarse como tarea programada de Windows y como servicio de usuario de systemd, con reinicio ante fallo, mediante scripts del repositorio.
- **R10.4** El log del daemon deberá rotar por tamaño (por defecto 5 MB, 3 archivos).
- **R10.5** Habrá una guía para OpenClaw y otra para Hermes que un agente pueda seguir sin ayuda, sin escribir secretos en la config del gateway.

---

## Requisitos no funcionales

| Id | Requisito | Cómo se verifica |
| :--- | :--- | :--- |
| NF1 | Una sola dependencia de producción nueva: `nodemailer`. Telegram y el webhook usan `fetch` nativo | `package.json` en la puerta de la fase 6 |
| NF2 | Latencia de aviso: un proceso que calza se avisa en ≤ intervalo + 2 min con la API sana | Simulación de la fase 10 |
| NF3 | Cuota: la vigilancia por defecto gasta ≤ 30 % del presupuesto diario configurado | Proyección de R8.5 con el volumen medido en T0.4 |
| NF4 | Capas: `api/` no importa de `services/` ni de `tools/`; `vigilancia/` y `avisos/` no importan de `tools/`, `reports/` ni `servidor.ts`; 0 ciclos | Test de arquitectura (T1.2) y reporte de graphify |
| NF5 | Determinismo: todo el núcleo recibe el reloj y el cliente como parámetros; ningún test espera tiempo real | Revisión del diseño y tiempo de la suite |
| NF6 | Compatibilidad: el `.monitor-state.json` actual se migra sin perder la deduplicación | Test de migración (T2.1) |
| NF7 | Cobertura ≥ 80 % de líneas en cada archivo nuevo de `vigilancia/` y `avisos/` | `test:coverage` con umbral por archivo |
| NF8 | Funciona en Windows y Linux, Node 20.16+ y 22.3+ | Matriz de la CI |

## Fuera de alcance de la 2.9.0

- WhatsApp: la API de Business exige verificación de empresa y tiene costo por mensaje.
- SMS y notificaciones push móviles.
- Varios perfiles de alerta con destinos distintos. El modelo de estado lo admite, pero no se expone.
- Corregir las dependencias entre herramientas (`generar-informe` importa de otras 4 herramientas). Se registra en el diseño como deuda; no se toca en esta versión.

## Decisiones del dueño (fase 0, 7-oct-2026)

| Id | Decisión | Resuelto (el dueño aceptó las propuestas) |
| :--- | :--- | :--- |
| D1 | Gateway que se usa: OpenClaw, Hermes o los dos | Las dos guías; OpenClaw primero |
| D2 | Telegram a un chat personal o a un grupo | Chat personal (límites más holgados) |
| D3 | Proveedor de correo | Gmail con contraseña de aplicación |
| D4 | Intervalo de revisión y presupuesto diario de consultas | 15 min; 1.500 consultas/día como techo (gasto esperado ≈ 470) |
| D5 | Horario de silencio y hora del resumen | 22:00–07:00 y 08:00, hora de Chile |
