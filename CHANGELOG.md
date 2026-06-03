# Historial de Cambios (CHANGELOG)

Todos los cambios notables realizados en este proyecto se registrarán en este archivo. El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere a [SemVer (Versionado Semántico)](https://semver.org/lang/es/).

---

## [1.1.0] - 2026-06-03

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
