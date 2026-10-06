# Manual del Servidor MCP Compra Ágil v2

Servidor MCP (Model Context Protocol) que envuelve la API de Compra Ágil v2 y la API legada de Órdenes de Compra de Mercado Público. Paquete `@ssolis-ti/mcp-compra-agil` **2.7.0**. Transporte stdio. Node.js 20.16+ o 22.3+. Al conectar, el `initialize` entrega las reglas de uso: no mostrar el ticket, no declarar un ganador y no insistir ante un 429.

> La fuente autoritativa es el servidor vivo (`tools/list`), no este archivo. Este manual se publica como `compra-agil://documentacion/api/manual_servidor_mcp.md` y lo indexa `consultar_documentos_locales`. Si contradice al código, manda el código. La guía de ChileCompra (`Documentacion_API_Compra_Agil.md`) describe la API prometida. Donde la medición difiere, manda `docs/internals/hallazgos-api.md`, que este lector no indexa.

## Qué hace y qué no hace

Tres modos: servidor MCP, daemon `npm run monitor` e informes HTML (Carta, Oficio, A4).

La API real, medida en julio y reconfirmada en septiembre de 2026, no publica adjudicaciones. `estado=proveedor_seleccionado` devuelve 0 resultados. `estado=oc_emitida` responde HTTP 400. Ningún proceso de la muestra trajo `id_orden_compra`. Los precios que el servidor analiza son cotizados, y los que sí aparecen están en procesos `desierta`. Los adjuntos de Compra Ágil no se descargan por enlace directo: responden 404. La ficha pública sí los muestra, y la descarga la dispara JavaScript del portal.

Un 429 no bloquea hasta el día siguiente. El servicio volvió a responder 13 minutos después. El servidor honra `Retry-After` y, si no viene, espera 15, 30, 60 y hasta 120 minutos. Además espacia el tráfico a 15 solicitudes por minuto, en orden de llegada.

Cada llamada a una herramienta tiene 45 s (`COMPRA_AGIL_PRESUPUESTO_MS`), bajo el corte de ~60 s del cliente MCP. Si una consulta tendría que esperar más en ese límite de 15 por minuto, no se envía ni gasta cuota: la herramienta responde «habría tenido que esperar ~N s» o, si es de análisis, con lo que alcanzó, separando los detalles que fallaron en la API de los omitidos por tiempo. Cada consulta se corta a los 35 s (`COMPRA_AGIL_TIMEOUT_MS`), sobre los ~30 s en que la pasarela responde 504; un corte de red se reintenta una vez. Una respuesta sin la forma esperada se informa como tal y no se lee como «sin resultados».

## Herramientas (16)

| Tool | Qué hace de verdad |
| :--- | :--- |
| `buscar_compras_agiles` | `GET /v2/compra-agil`. `q` e `id` son excluyentes. Filtros: estado, región 1–16 (otra se rechaza sin consultar), `publicado_desde`/`publicado_hasta` en ISO-8601, orden y página. La ventana de cambios no está aquí. `fecha_cierre` llega sin zona: la respuesta trae `_nota_horaria` y `fecha_cierre_hora_chile`, asumiendo UTC. El plazo se confirma en la ficha. Cada ítem trae el RUT del organismo y `fecha_ultimo_cambio`. `motivo_seleccion` solo si la API lo envió con texto; no prueba una adjudicación. Sin resultados, `pagina` dice `sin resultados para estos filtros`. Sin filtro de API (estado, región, `q`, `id` o fechas de publicación) no consulta: esa llamada no se hizo. El listado trae `estado_codigo`, el número de llamado y, si la moneda es CLP, `tipo_cambio: null`. Sin `tamano_pagina` se piden 10, y 10 es el único tamaño que acepta. Si no hay páginas, `numero_pagina` y `total_paginas` van en 0. Una fila con `ofertas_recibidas` 0 trae `_nota_ofertas`: es dato del listado, no de la ficha. |
| `monitorear_cambios_recientes` | Ventana relativa (`minutos`, 1–1440, default 60) o absoluta (`cambio_desde` y `cambio_hasta`). No se combinan. Cada página trae 10 procesos: una de 50 cae en HTTP 504. El cierre trae la misma nota horaria. Si no hay resultados, `pagina` dice `sin resultados en esta ventana` y los números de página van en 0. La respuesta incluye `total_filtrados_en_pagina`. |
| `obtener_detalle_compra` | `GET /v2/compra-agil/{codigo}`. Devuelve un resumen con `estado_codigo`, el número de llamado (`estado_convocatoria`) y `fecha_ultimo_cambio`. Si la moneda no es CLP, incluye el tipo de cambio. Una cotización inadmisible trae su justificación. No afirma un proveedor adjudicado. `cierre` trae `cierre_hora_chile` y `_nota_horaria`, con la misma suposición UTC. |
| `verificar_orden_compra` | No llama a la API. Lee el detalle si ya está en caché y, si no hay `id_orden_compra`, indica la ficha pública. Un "sin OC" no prueba que la OC no exista. |
| `obtener_detalle_orden_compra` | API legada `OrdenCompra.json`. El código tiene que venir de otra fuente: la API de Compra Ágil no entrega códigos de OC. Sin verificar contra una OC real. |
| `obtener_estadisticas_uso` | Conteo local de esta instalación. No es el saldo del ticket. `cuota_agotada` se conserva. `vio_rechazo_temporal` dice lo mismo: esta instalación vio un 429. |
| `verificar_ticket` | Prueba el ticket contra la API y muestra solo `••••` más los últimos 4 caracteres. |
| `verificar_hora_oficial` | NTP de `ntp.shoa.cl`. No gasta cuota de Mercado Público. Si el desfase supera un minuto, la respuesta es un error. `desfase_chile_vigente` dice si ese instante es UTC-3 o UTC-4. |
| `obtener_enlace_documento` | Arma el enlace a la ficha pública. La descarga directa heredada se nombra como 404 y no se ofrece. |
| `descargar_y_leer_documento` | No puede bajar los adjuntos de Compra Ágil. Para un id numérico responde de inmediato con la ficha, sin intentar la descarga. |
| `consultar_documentos_locales` | Busca en los PDF, TXT y MD de `docs/`, excepto `README.md` y `docs/internals/`. Si este manual coincide con al menos dos términos de la consulta, sus fragmentos van primero. La respuesta incluye como máximo 3 archivos y nombra los que quedaron fuera. Esos archivos no viajan en el paquete npm. |
| `analizar_precios_mercado` | Distribución de precios cotizados en procesos `desierta`. No son precios adjudicados. Las inadmisibles entran en las estadísticas; `estadisticas_precio_unitario_solo_admisibles` las excluye. Trae `suficiencia_muestra`, los procesos sin detalle con su ficha y, si la búsqueda salió de la caché, `_frescura`. Con `codigo_compra` el análisis es nacional salvo que se pase `region`. |
| `auditar_compras_desiertas` | Parte del motivo oficial y de las cotizaciones del propio proceso frente a su presupuesto (en neto y con IVA); después compara con procesos del mismo rubro, por unidad cuando hay precio unitario. Una brecha sin datos para evaluarla vale `null`, no `false`. |
| `generar_borrador_cotizacion` | JSON de cotización con IVA 19 % y carta. Los placeholders van marcados. Si el total supera el presupuesto del comprador lo advierte, con el precio unitario máximo que cabe en neto y con IVA. |
| `radar_oportunidades_calientes` | Hot Score sobre procesos `publicada`, máximo 115. Incluye puntos por segundo llamado. Cada página pide 10 procesos: una de 50 cae en HTTP 504. Corta en `max_paginas` (default 3, hasta 30 procesos). |
| `generar_informe` | HTML imprimible en `carta`, `oficio` o `a4`. Devuelve la ruta, no el HTML. Tipos: `radar`, `cotizacion`, `precio`, `auditoria` y `competencia`. El de competencia no nombra un adjudicado. Se guarda en `informes/` de la carpeta de datos (o `COMPRA_AGIL_INFORMES_DIR`); `ruta_salida` solo acepta subcarpetas de ella. |

## Recursos y prompts

Recursos de código: `compra-agil://regiones`, `compra-agil://estados`, `compra-agil://glosario`, `compra-agil://compras/{codigo}`. Ese último trae `_nota_horaria` y `cierre_hora_chile`. Con el repositorio clonado también aparecen los documentos de `docs/` como `compra-agil://documentacion/{filename}`.

Prompts: `buscar_oportunidades_proveedor` y `analizar_competencia`. El segundo compara la oferta más barata y la más cara. No identifica un proveedor adjudicado ni pregunta si un seleccionado fue el más barato. Una marca en la cotización no es una adjudicación.

## Daemon

`src/services/monitor.ts` corre aparte del servidor MCP. Cada ciclo pide cambios con `ttl_cambio_ms` (intervalo más 5 minutos) y se queda con procesos `publicada`, con 0 ofertas, sobre `MONITOR_MIN_BUDGET_CLP` (default 5.000.000) y con alguna palabra de `MONITOR_KEYWORDS`. Appende a `alerts.log`. El intervalo es `MONITOR_INTERVAL_MINUTES` (default 60). Cada página pide 10 procesos y la auto-paginación corta a las 10 páginas, así que un ciclo mira como máximo 100 procesos. Una página de 50 cae en HTTP 504.

## Arranque

```bash
npm install
npm run build
npm start          # servidor MCP, stdio
npm run monitor    # daemon
npm run inspect    # inspector MCP
```

Variable obligatoria: `COMPRA_AGIL_TICKET`. La base por defecto es `https://api2.mercadopublico.cl`.

El servidor no depende de la carpeta desde la que lo lanza el cliente MCP. Busca `.env` en esa carpeta, en la del proyecto y en la carpeta de datos. La carpeta de datos (caché, estado de cuota, daemon e informes) es `COMPRA_AGIL_DATA_DIR`, o la del proyecto si es un clon del repositorio, o `%LOCALAPPDATA%\mcp-compra-agil` / `~/.local/state/mcp-compra-agil` si se instaló con `npx`.
