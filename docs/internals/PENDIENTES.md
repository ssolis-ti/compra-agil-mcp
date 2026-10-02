# Pendientes

Revisado el **1 de octubre de 2026** · versión del paquete: **2.5.0**. Lo de abajo sigue abierto. Lo que el changelog ya cerró está al final.

Priorizado. Cada ítem incluye contexto suficiente para retomarlo sin memoria previa.

---

## 🔴 Prioridad alta

### 1. Registrar el MCP en un cliente

**Estado:** no hecho. El servidor nunca ha corrido dentro de un cliente MCP real.

Se verificó que `claude_desktop_config.json` y `.cursor/mcp.json` **no referencian**
este servidor. Todo el testing se hizo por JSON-RPC directo contra `dist/index.js`.

**Qué falta:** añadir el bloque de configuración (hay ejemplos para cada cliente en
el [README](../../README.md#-integración-con-clientes-mcp-y-agentes)) y comprobar
que las 16 herramientas aparecen y se invocan desde el chat.

**Por qué importa:** el transporte Stdio es sensible a que algo escriba en stdout.
El logger ya está blindado (todo va a stderr), pero eso solo se prueba de verdad
con un cliente real conectado.

---

### 2. Rotar el ticket de acceso

**Estado:** pendiente, decisión del usuario.

El ticket quedó expuesto en la transcripción de una sesión de trabajo con un
agente de IA. Es una credencial de solo lectura sobre datos públicos con cuota
diaria, así que el riesgo es acotado (consumo de cuota ajeno, consultas
atribuidas), pero conviene rotarla.

**Cómo:** solicitar uno nuevo en https://www.chilecompra.cl/api/ y reemplazarlo
en el `.env`. **No** pegarlo en ningún chat.

**Lección aplicada:** el `.env` **no debe crearlo un agente**. Si el agente lo crea,
el harness rastrea el archivo y le notifica los cambios posteriores — mostrándole
el contenido. La regla `Read(**/.env)` de `.claude/settings.json` no cubre esa vía,
porque no es una llamada a `Read`.

---

## 🟠 Prioridad media

### 3. Completar las plantillas de informe

**Estado:** hecho el 1 de octubre de 2026. Sigue sin publicar (el paquete sigue en 2.5.0).

`generar_informe` acepta `radar`, `cotizacion`, `precio`, `auditoria` y `competencia`. Cada una lee el mismo objeto que la herramienta JSON: `construirBorradorCotizacion`, `recolectarDatosPrecios` y `recolectarDatosAuditoria`. `competencia` arma la tabla con `compararCotizantes()` sobre el detalle. Ese bloque no se agregó al JSON de `obtener_detalle_compra` y no marca un adjudicado. El HTML sigue yéndose a disco. El PDF de la sección 4 sigue pendiente.

**Iterar el diseño sin gastar cuota:** `npx tsx scripts/preview-informe.ts`

---

### 4. Exportación directa a PDF

**Estado:** no implementado. Hoy el usuario abre el HTML y hace Ctrl+P.

**Propuesta:** `puppeteer-core` + el Chrome ya instalado (`channel: 'chrome'`),
para evitar la descarga de ~300 MB de Chromium.

**Detalle técnico ya resuelto:** Chrome soporta `@page { size, margin }` pero **no**
los *margin boxes* (`@top-center`, etc.). La numeración de páginas se hace con
`headerTemplate` / `footerTemplate` de Puppeteer, que exponen las clases especiales
`pageNumber`, `totalPages`, `date`, `title`. Requiere `printBackground: true`.

`PAPEL[x].mm` en [`theme.ts`](../../src/reports/theme.ts) ya expone las dimensiones
numéricas, porque Puppeteer tampoco tiene "oficio" entre sus formatos y hay que
pasarle `width`/`height` explícitos.

Alternativa si se quiere numeración imprimiendo con Ctrl+P: **Paged.js** (polyfill
de Paged Media), vendorizado en el HTML.

---

### 5. Escaneo de secretos pre-commit

**Estado:** no implementado (era la "capa 4" del plan de seguridad).

`.gitignore` protege el `.env`, pero no impide que un ticket termine pegado dentro
de un `.ts`. Un hook de pre-commit con `gitleaks` —o un grep del patrón UUID—
cerraría ese hueco.

---

## 🟡 Prioridad baja

### 6. Rendimiento: la API es lenta

**Medido el 8 de septiembre de 2026:** búsqueda simple 10–12 s, búsqueda con texto 13–17 s, detalle 21–25 s, con 504 intermitentes. La cifra vieja de 1–14 s ya no vale.

La 2.5.0 ya añadió caché en disco, detalles en paralelo y concurrencia adaptativa. Sigue abierto el riesgo de timeout del cliente MCP cuando el radar pide varias páginas.

---

### 7. `obtener_detalle_orden_compra` sin probar

**Estado:** imposible de probar hoy.

Requiere un `id_orden_compra` real, y **ningún proceso lo expone** (0 de 45
inspeccionados). El manejo defensivo de `TotalLnea` / `TotalLinea` sigue **sin
verificar** contra una respuesta real por el mismo motivo.

---

### 8. `estado_por_comprador` y `activo`: semántica desconocida

Ambos campos existen en la respuesta pero valieron `null` en toda la muestra.
`esGanador()` incluye una heurística sobre `estado_por_comprador === '1'` que
**nunca se ha visto activarse**. Si algún día aparecen con valor, hay que revisar
qué significan.

Lo mismo con `estado` (número) de cada cotización: valió `3` en las 52 observadas.
Se desconoce qué representa y qué otros valores admite.

---

## ✅ Cerrado — no reabrir sin datos nuevos

* **Plantillas de informe** — `cotizacion`, `precio`, `auditoria` y `competencia`, además del radar. El PDF directo sigue abierto en la §4.
* **`tamano_pagina` mínimo 10** — verificado: `1` y `5` devuelven HTTP 400. El
  comentario original del código tenía razón.
* **La API no publica adjudicaciones** — 45 procesos, 52 cotizaciones,
  `proveedor_seleccionado = 0` en el 100 %. No es reparable desde el código.
  Ver [hallazgos-api.md](hallazgos-api.md).
* **429 hasta el día siguiente, adjuntos por enlace directo, logs del protocolo y la hora oficial** — resueltos entre la 2.3.0 y la 2.5.0. Ver [CHANGELOG.md](../../CHANGELOG.md). No reimplementar el bloqueo hasta medianoche ni la descarga directa.
