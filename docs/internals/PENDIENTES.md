# Pendientes

Estado al **15 de julio de 2026** · versión actual: **2.0.0**

Priorizado. Cada ítem incluye contexto suficiente para retomarlo sin memoria previa.

---

## 🔴 Prioridad alta

### 1. Registrar el MCP en un cliente

**Estado:** no hecho. El servidor nunca ha corrido dentro de un cliente MCP real.

Se verificó que `claude_desktop_config.json` y `.cursor/mcp.json` **no referencian**
este servidor. Todo el testing se hizo por JSON-RPC directo contra `dist/index.js`.

**Qué falta:** añadir el bloque de configuración (hay ejemplos para cada cliente en
el [README](../../README.md#-integración-con-clientes-mcp-y-agentes)) y comprobar
que las 15 herramientas aparecen y se invocan desde el chat.

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

**Estado:** solo existe `radar`. Faltan 4.

La capa de informes (`src/reports/`) está terminada: design system, componentes,
formatos de papel y el shell del documento. Añadir una plantilla es escribir un
archivo en `src/reports/templates/` y sumar el tipo al enum de
[`generar-informe.ts`](../../src/tools/generar-informe.ts).

| Plantilla | Fuente de datos | Notas |
| :--- | :--- | :--- |
| `cotizacion` | `generar_borrador_cotizacion` | **La de mayor valor comercial**: un PDF de cotización presentable para un proveedor |
| `precio` | `analizar_precios_mercado` | Aprovechar `barChartSVG` para la distribución de precios |
| `auditoria` | `auditar_compras_desiertas` | Brechas de presupuesto/plazo y recomendaciones |
| `competencia` | `obtener_detalle_compra` | Tabla comparativa de cotizantes y spread |

**Prerequisito por plantilla:** extraer la recolección de datos a una función pura
reutilizable, como se hizo con `recolectarDatosRadar()`. Así la tool JSON y el
informe consumen el mismo dataset y no pueden divergir.

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

**Medido:** entre 1 y 14 segundos por consulta según el tamaño de página.

`radar_oportunidades_calientes` con `max_paginas=3` puede tardar **más de 45
segundos**, lo que podría superar el timeout de algún cliente MCP.

**Ideas:** caché en memoria por código de proceso (los detalles no cambian una vez
cerrados), o reducir el `max_paginas` por defecto.

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

* **`tamano_pagina` mínimo 10** — verificado: `1` y `5` devuelven HTTP 400. El
  comentario original del código tenía razón.
* **La API no publica adjudicaciones** — 45 procesos, 52 cotizaciones,
  `proveedor_seleccionado = 0` en el 100 %. No es reparable desde el código.
  Ver [hallazgos-api.md](hallazgos-api.md).
