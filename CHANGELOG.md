# Historial de Cambios (CHANGELOG)

Todos los cambios notables realizados en este proyecto se registrarán en este archivo. El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere a [SemVer (Versionado Semántico)](https://semver.org/lang/es/).

---

## [1.3.0] - 2026-07-15

### Seguridad
* **Redactor de secretos (`utils/redact.ts`) — punto único de estrangulamiento.** Todo texto que sale del proceso (logs, errores, respuestas de tools) pasa por `redact()`, que borra el ticket de acceso. Motivación verificada empíricamente: algunos errores de `fetch` incluyen la URL completa en su mensaje (`TypeError: Failed to parse URL from http://host/x?ticket=SECRETO`), y ese texto termina en el contexto del LLM, la transcripción y las capturas de pantalla. Auditar caso por caso cada ruta de error es inviable; el chokepoint cubre también las rutas imprevistas.
  * Defensa en dos capas: coincidencia exacta de secretos registrados + patrón `ticket=` en query strings y pares JSON/header, por si el secreto aún no se registró.
  * Registra también la variante URL-encodeada del secreto.
  * Longitud mínima de 8 caracteres para no redactar texto legítimo por coincidencia.
* **`String(error)` → `safeError(error)` en 22 sitios de 14 archivos.** Todos los catch de tools, recursos y el daemon ahora sanitizan antes de devolver el mensaje al LLM.
* **El logger redacta en el punto de salida.** Es especialmente relevante porque `sendLoggingMessage` envía los logs de forma nativa al cliente MCP — es decir, directo al contexto del modelo.
* **El error-handler redacta el mensaje de la API.** Ese texto no está bajo nuestro control y podría hacer eco de la URL solicitada (que en el endpoint legado lleva el ticket en la query string).
* **El cliente HTTP se auto-protege:** `CompraAgilClient` registra el ticket como secreto en su constructor, cubriendo a cualquier consumidor (servidor MCP, daemon, scripts, tests) sin que tenga que acordarse.

### Añadido
* **Tool `verificar_ticket`:** valida la credencial contra la API real sin revelarla — solo muestra una pista (`••••2345`). Permite hacer el primer diagnóstico end-to-end sin imprimir, pegar ni compartir el ticket.
* **Tests E2E con fixtures (`test/e2e-informe.test.ts`):** ejercitan por primera vez el camino completo cliente HTTP → `recolectarDatosRadar` → plantilla, sustituyendo `fetch` por una respuesta grabada y sanitizada (`test/fixtures/`). Se prueba el código real (incluido `handleApiResponse` y el parseo del envoltorio `payload`) **sin que exista credencial alguna**.
* **21 tests nuevos** (86 en total) cubriendo la redacción — incluida la fuga concreta demostrada — y el camino E2E.

### Notas
* La ruta con datos productivos reales sigue sin ejercitarse (requiere ticket). Los fixtures replican la forma documentada de la respuesta, pero no sustituyen una verificación contra el servicio real; `verificar_ticket` está pensada precisamente para hacerla de forma segura.

---

## [1.2.0] - 2026-07-15

### Añadido
* **Capa de informes (`src/reports/`):** Nueva arquitectura para generar informes profesionales imprimibles en HTML autocontenido (sin scripts ni recursos externos).
  * `theme.ts`: design system print-first — tokens de color/tipografía/espaciado y CSS de impresión como fuente única de verdad.
  * `components.ts`: componentes puros (`portada`, `kpiRow`, `tabla`, `badge`, `callout`, `barChartSVG`, `pieDoc`) con escapado HTML obligatorio.
  * `format.ts`: localización chilena centralizada (CLP, fechas, RUT, horas).
  * `render.ts` / `export.ts`: shell del documento y escritura a disco.
  * `templates/radar-oportunidades.ts`: primera plantilla — KPIs, gráfico de puntuación, fichas destacadas y listado completo.
* **Tool `generar_informe`:** Genera el informe y devuelve la RUTA del archivo, nunca su contenido — un informe pesa decenas de KB y retornarlo consumiría miles de tokens de contexto por llamada.
* **Formatos de papel chilenos:** `carta` (216×279mm, **por defecto**, estándar de oficina en Chile), `oficio`/folio (216×330mm, documentos oficiales) y `a4` (210×297mm, ISO). El Oficio se declara con dimensiones explícitas porque **no** equivale al `legal` de CSS (216×356mm, US Legal) — hay un test de regresión que lo blinda.
* **Gráficos en SVG inline generados a mano:** vectoriales, imprimen nítidos a cualquier DPI y no requieren JS ni librerías de charting.
* **`scripts/preview-informe.ts`:** Vista previa con datos de muestra para iterar el diseño sin consumir cuota de la API ni requerir ticket. Genera los tres formatos de papel.
* **34 tests nuevos** cubriendo formato chileno, escapado anti-inyección (incluido dentro del SVG), medidas de papel y render del informe. Total: 65 tests.

### Modificado
* **`radar_oportunidades_calientes` refactorizado:** se extrajo `recolectarDatosRadar()` como función pura de datos. La tool JSON y el informe HTML consumen el mismo dataset, garantizando que no puedan divergir.
* La vista previa en pantalla (`@media screen`) sigue al formato de papel real, para que lo que se ve coincida con lo impreso.

### Corregido
* **Gráfico "Top N" desordenado:** el template asumía que su entrada venía rankeada. Ahora ordena defensivamente — un gráfico Top N desordenado es un error visible y silencioso. Cubierto por test.
* **Regex de diacríticos ilegible en `slug()`:** se reemplazaron los caracteres combinantes crudos (invisibles en el código fuente) por escapes `\u0300-\u036f`.

### Notas
* Actualmente solo está implementada la plantilla `radar`. Las plantillas `cotizacion`, `competencia`, `precio` y `auditoria` están planificadas.
* La ruta `API real → recolectarDatosRadar → plantilla` aún no se ha ejercitado con datos productivos (requiere un ticket válido). La plantilla se validó con fixtures.

---

## [1.1.0] - 2026-07-15

### Corregido
* **Detección del proveedor ganador centralizada (`utils/quotation.ts`):** Se unificó en una sola función `esGanador()` la heurística de adjudicación, combinando todas las señales conocidas (`proveedor_seleccionado`, `seleccion.proveedor_seleccionado`, `estado_por_comprador`, `motivo/criterio_seleccion`). Antes, `recomendar_precio_ganador`, `auditar_compras_desiertas` y `generar_borrador_cotizacion` solo miraban campos marcados como "no confirmados en la respuesta real" por la API, provocando resultados vacíos con datos reales.
* **`recomendar_precio_ganador` — mezcla de precios corregida:** Ya no se combinan precios unitarios y montos totales en la misma distribución estadística. Ahora se reportan por separado (`estadisticas_precio_unitario` y `estadisticas_monto_neto_total`), evitando recomendaciones sin sentido.
* **Versionado coherente:** La versión del servidor MCP se lee dinámicamente desde `package.json` en lugar de estar hardcodeada (`index.ts` reportaba `1.0.0`). Se corrigió el orden de las entradas de este CHANGELOG.
* **Manejo defensivo de `TotalLnea`/`TotalLinea`:** `obtener_detalle_orden_compra` tolera ambas variantes del campo de total de línea de la API legada.

### Añadido
* **Rate limiter proactivo (throttle):** El `RateLimiter` ahora espacia las solicitudes por debajo de un máximo por minuto (configurable) antes de enviarlas, además de reaccionar al 429. Alinea el comportamiento con lo documentado.
* **`radar_oportunidades_calientes` con auto-paginación:** Escanea más allá de la primera página para no perder oportunidades relevantes.
* **Daemon de monitoreo con deduplicación:** Las alertas ya no se repiten entre ciclos gracias a un archivo de estado (`.monitor-state.json`).
* **Advertencias en `generar_borrador_cotizacion`:** El borrador marca explícitamente los campos placeholder (RUT, razón social, precio por defecto) y ya no asume `es_emt: true`.
* **Suite de tests (Vitest):** Cobertura unitaria de `error-handler`, `quotation`, `rate-limiter` y el scoring del radar. Nuevo script `npm test`.

### Modificado
* **Utilidad compartida `utils/docs-locator.ts`:** Se centralizó la lógica de localización de documentos locales, antes duplicada e inconsistente entre `tools/documentos.ts` y `resources/documentacion.ts`.
* **Conteo dinámico de capacidades:** Los logs de arranque derivan la cantidad de tools/recursos/prompts de listas en lugar de números hardcodeados.

---

## [1.0.3] - 2026-06-10

### Corregido
* **Manejo de respuestas legacy en `error-handler.ts`:** La función `handleApiResponse` ahora soporta endpoints heredados (como `OrdenCompra.json`) que retornan el payload directamente en la raíz del JSON, sin envolverlo en la propiedad `payload`. Esto prevenía un `TypeError` silencioso en `obtener_detalle_orden_compra`.
* **Mensaje de error 404 genérico:** El mensaje de error HTTP 404 ahora cubre tanto búsquedas de Compras Ágiles como de Órdenes de Compra, evitando mensajes confusos al usuario.
* **Seguridad de documentos adjuntos (UUID):** Las herramientas `obtener_enlace_documento` y `descargar_y_leer_documento` ya no retornan enlaces de descarga directa protegidos por Clave Única que generaban el error `Authentication parameters missing`. Ahora redirigen al usuario exclusivamente a la ficha pública del proceso en el buscador de Mercado Público (`https://buscador.mercadopublico.cl/ficha?code={codigo}`).
* **Robustez en búsquedas históricas de `recomendar_precio_ganador`:** El filtro de estado en la búsqueda de procesos históricos se amplió de `proveedor_seleccionado` a `cerrada,proveedor_seleccionado`, resolviendo el problema donde la API retornaba 0 resultados con el filtro estricto.

### Modificado
* **`obtener_enlace_documento`:** El parámetro `codigo_compra` pasó de ser opcional a requerido para garantizar la generación del enlace público alternativo.
* **README.md:** Se reemplazó el término "demonio" por "Daemon" en todas las referencias al servicio de monitoreo en segundo plano. Se añadió documentación de la característica de manejo seguro de documentos UUID en la sección de Características Clave.
* **Redacción de logs del ticket:** El cliente HTTP `compra-agil-client.ts` enmascara el valor del ticket de acceso como `REDACTED` en los mensajes de log de depuración para prevenir filtraciones de credenciales.

---

## [1.0.1] - 2026-06-03

> Nota: esta entrada estaba erróneamente etiquetada como `1.1.0` y fechada fuera de orden. Se renumeró a `1.0.1` para respetar el orden cronológico y SemVer (precede a `1.0.3`).

### Añadido
* **Integración de Órdenes de Compra (OC API):**
  * Nuevas interfaces TypeScript (`OrdenCompraDetalle`, `OrdenCompraResponse`) para modelar las respuestas legadas de ChileCompra.
  * Implementación del método `obtenerDetalleOC(idOC)` en el cliente HTTP.
  * Nueva herramienta MCP **`obtener_detalle_orden_compra`** para interrogar la API de OC por código o ID numérico.
* **Servicio de Alertas Autónomo (Daemon):**
  * Script de servicio en segundo plano ([monitor.ts](src/services/monitor.ts)) para polling incremental y reactivo de oportunidades de negocio.
  * Filtro inteligente en memoria: vigila cotizaciones abiertas con **0 ofertas**, de alto presupuesto y que coincidan con palabras clave configurables.
  * Generación persistente de alertas en un archivo estructurado `alerts.log`.
  * Incorporación del script `"monitor": "node dist/services/monitor.js"` a `package.json`.

### Modificado
* **Mejora en `verificar_orden_compra`:** Se adaptó la herramienta para consultar en caliente la API de OC y adjuntar el desglose detallado de los productos y el proveedor ganador directamente al payload de verificación.

### Corregido
* **Manejo de Respuestas de OC en `verificar-oc.ts`:** Corrección de fallbacks para soportar lectura de `id_orden_compra` y `proveedor_seleccionado` tanto a nivel raíz como anidados dentro de objetos JSON devueltos por la API de Mercado Público.

---

## [1.0.0] - 2026-06-03

### Añadido
* **Migración SDK MCP v1.12+:**
  * Actualización de registros de herramientas para utilizar `server.registerTool` en lugar del método deprecado `server.tool`.
  * Actualización de registros de recursos para utilizar `server.registerResource` en lugar del deprecado `server.resource`.
  * Actualización de registros de prompts para utilizar `server.registerPrompt`.
* **Herramientas MCP Core:**
  * `buscar_compras_agiles`: Búsqueda multi-filtro (palabras clave, región, estado, fechas).
  * `obtener_detalle_compra`: Ficha completa y confidencialidad en período de ofertas abiertas.
  * `monitorear_cambios_recientes`: Sincronización incremental en ventanas temporales.
  * `obtener_estadisticas_uso`: Consumo y reporte local de cuotas de red.
* **Recursos MCP:**
  * Recurso dinámico `compra-agil://compras/{codigo}` para lectura directa en JSON.
  * Catálogos estáticos: `compra-agil://regiones`, `compra-agil://estados`, `compra-agil://glosario`.
* **Prompts de Asistencia:**
  * `buscar_oportunidades_proveedor`: Flujo guiado de prospección.
  * `analizar_competencia`: Plantilla de spreads y adjudicaciones.
* **Manejo de Errores e Infraestructura:**
  * Logger nativo del protocolo mediante inyección de `McpServer` y emisión de `sendLoggingMessage`.
  * Control de tráfico de red implementado con limitador de velocidad *Token Bucket* (40 reqs/min).
  * Manejo del error 429 (Too Many Requests) adaptando pausas dinámicas.
