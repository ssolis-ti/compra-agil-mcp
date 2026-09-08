# Historial de Cambios (CHANGELOG)

Todos los cambios notables realizados en este proyecto se registrarán en este archivo. El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere a [SemVer (Versionado Semántico)](https://semver.org/lang/es/).

---

## [2.5.0] - 2026-09-08

QA de calidad de salida —no de "¿responde?" sino de "¿sirve lo que devuelve?"— sobre las herramientas de análisis. Las tres podían fallar por completo, y el motivo estaba en su propio código.

### Corregido
* **Las tres herramientas de análisis pedían 50 resultados y usaban 3 a 5.** `analizar_precios_mercado`, `auditar_compras_desiertas` y `generar_borrador_cotizacion` fijaban `tamano_pagina: 50` "para maximizar el material", pero solo examinan los primeros `limite_analisis` con un `slice()`. El resto era desperdicio — y desperdicio caro: medido en producción, `estado=desierta` con búsqueda de texto y `tamano_pagina=50` devuelve **HTTP 504 sistemáticamente** (la pasarela corta a los ~30 s), mientras que con 15 la misma consulta respondió en **9,9 s**. Ahora piden lo que van a usar, con el mínimo de 10 que exige la API.
* **Los detalles se consultaban en serie.** Son independientes entre sí, pero se pedían uno tras otro. Con la API tardando 20-30 s por consulta, una tanda de 4 tomaba **105,6 s** — más de lo que espera cualquier cliente MCP. En paralelo la misma tanda tardó **29,5 s: 3,6 veces más rápido**. Cada consulta conserva su propio manejo de error, así que un histórico que falla sigue sin invalidar la muestra.
* **HTTP 502 y 504 caían en "Error inesperado".** No están en la tabla de errores de la guía oficial, pero la API los devuelve — el 504 de arriba es un caso real y reproducible. El usuario recibía un mensaje que hacía parecer un fallo de sus parámetros lo que es una lentitud del servicio. Ahora se explican como corte de la pasarela y se sugiere reducir el trabajo por consulta.

**Efecto combinado:** la consulta que devolvía 504 dos veces seguidas, y que tras el primer arreglo aún excedía los 120 s, ahora completa en **52,7 s**.

### Corregido — un fallo de infraestructura se disfrazaba de conclusión de mercado
Al intentar capturar una muestra real de cotizaciones, las **6 consultas de detalle devolvieron HTTP 504**. Pero la herramienta seguía respondiendo *"Se revisaron 4 procesos históricos, pero ninguno expuso cotizaciones con precios"*: contaba los procesos que **pretendía** revisar, no los que logró. El usuario concluía que su rubro no tiene precios publicados —una afirmación sobre el mercado— cuando el hecho real era que la API no respondió.

Es el mismo defecto que la búsqueda documental de la 2.2.0: convertir un fallo en un negativo confiado. Ahora:
* `analizar_precios_mercado` distingue las dos causas. Si **todas** las consultas fallan devuelve un error explícito —*"esto NO significa que no haya precios publicados… la API no respondió"*— con `isError: true`. Si fallan solo algunas, entrega el análisis con un `_aviso_cobertura` que advierte que la muestra es menor a la pedida.
* `generar_borrador_cotizacion` ya no atribuye a "no hay comparables" un precio que cayó al presupuesto porque la API se cayó.
* `auditar_compras_desiertas` informa cuántas consultas fallaron junto a su comparativo.

### Añadido
* **23 tests de exactitud estadística** (211 en total) sobre una muestra fija: mediana frente a promedio, percentil 25 por interpolación, comportamiento con n par e impar, resistencia a valores atípicos, y que el orden de entrada no altere el resultado ni mute el arreglo recibido. Validados por mutación: alterar el índice de la mediana rompe 2 tests, y calcular el p25 como p75 rompe otros 2.
  Esta muestra es **sintética**, con valores elegidos para cubrir casos límite que rara vez coinciden en datos reales (n par e impar, muestra de un elemento, atípicos, precios nulos o negativos). La verificación sobre datos reales se logró después y está más abajo.

### Corregido — los logs del protocolo nunca habían funcionado
El README anunciaba como característica los *"Logs Nativos en el Protocolo"*, pero el servidor **no declaraba la capacidad `logging`**. Sin ella el SDK rechaza cada `sendLoggingMessage()`, y el `.catch()` mudo del logger se tragaba el rechazo: nadie podía enterarse. Verificado en auditoría — el servidor anunciaba solo `tools, resources, prompts`, `logging/setLevel` respondía *"Method not found"* y llegaban **0 notificaciones** pese a `LOG_LEVEL=debug`.

* Se declara `capabilities: { logging: {} }`. Ahora el servidor anuncia `logging`, acepta `logging/setLevel` y las notificaciones llegan.
* El `catch` silencioso ahora avisa **una vez** por stderr si los envíos fallan. Callarse del todo fue lo que ocultó el defecto durante meses.
* **Verificación de seguridad:** ahora que los logs sí llegan al contexto del modelo, la redacción dejó de ser teórica. Se comprobó en el caso de riesgo real —el endpoint legado de Órdenes de Compra, que lleva el ticket en el query string— y se emite como `ticket=[REDACTED]`. El ticket no aparece ni en las notificaciones ni en stderr.
* 6 tests nuevos (217 en total) que blindan la redacción de lo que se envía al cliente. Validados por mutación: quitar la redacción rompe 2.

### Añadido — anotaciones y títulos en las 15 herramientas
Cada herramienta declara ahora un `title` legible y sus `annotations` de comportamiento. No cambian la ejecución: sirven para que el cliente MCP decida cómo tratarlas. El beneficio concreto es que **un cliente puede auto-aprobar las de solo lectura** en vez de pedir confirmación en cada llamada — con 15 herramientas y flujos de varios pasos, eso evita fatiga de aprobaciones.

* **14 son `readOnlyHint: true`**: consultan la API o leen archivos locales, sin efecto sobre nada.
* **`generar_informe` es la única con efecto**: crea un archivo HTML. Se declara `readOnlyHint: false` con `destructiveHint: false` (solo agrega, no borra) e `idempotentHint: false` (cada llamada genera un archivo nuevo con su timestamp).
* **`openWorldHint: false`** en las cuatro que no salen a la red: `verificar_orden_compra` (desde la 2.3.0 solo lee caché), `obtener_estadisticas_uso`, `obtener_enlace_documento` (solo construye una URL) y `consultar_documentos_locales`.

### Verificado — la estadística de precios, ahora sobre datos REALES
Quedaba pendiente: los tests cubrían la aritmética con una muestra sintética porque la API devolvía 504. Se logró capturar una muestra real —costó tres intentos— del proceso `1057491-1711-COT26` (insumos para crioablación, Hospital Luis Calvo Mackenna), con **6 cotizaciones**. Los seis estadísticos coinciden exactamente con el cálculo hecho a mano:

| | valor |
| :--- | ---: |
| mediana | 4.556.512 |
| promedio | 4.329.766 |
| percentil 25 | 3.657.184 |

La muestra queda como fixture (`test/fixtures/cotizaciones-reales.json`) y 8 tests nuevos la ejercitan, incluido que `monto_total` sea el neto más 19% de IVA. **El cálculo de precios está verificado contra la realidad, no solo contra sí mismo.**

Un matiz que la muestra real corrigió: en este proceso **ninguna** cotización es inadmisible, al revés de lo que ocurre en los `desierta` —donde casi todas lo son, y es lo que los deja desiertos—. La nota metodológica de `analizar_precios_mercado` se refiere a esas últimas, no a todos los procesos.

### Observado, sin corregir
* **La API está más lenta que lo que documentan las herramientas.** Sus descripciones dicen "~1-5s por consulta"; lo medido el 8 de septiembre fue **15 a 30 s**, con 504 intermitentes. La viabilidad de las herramientas de análisis depende hoy más de la salud del servicio que del código. Pendiente: actualizar esas descripciones y evaluar un límite de concurrencia adaptativo.

---

## [2.4.0] - 2026-09-07

### Añadido
* **El radar considera el segundo llamado.** `convocatoria.estado_convocatoria` era el único campo que la API entrega en cada respuesta y que **ninguna herramienta usaba**. Un segundo llamado significa que el primero no logró adjudicar: el comprador vuelve con urgencia y existe un motivo de fracaso concreto que conviene averiguar antes de cotizar —si sabes cumplir lo que otros no pudieron es tu ventaja; si el presupuesto era corto, es una pérdida de tiempo—. Suma 10 pts al Hot Score (máximo teórico: 115) y cada oportunidad expone ahora el campo `llamado`.
* 5 tests de regresión (188 en total).

### Sobre la calibración
El factor se diseñó primero con 15 pts asumiendo que un segundo llamado implicaba **menos competencia**. La medición contra la API real corrigió el supuesto: de 200 procesos activos, el único en segundo llamado tenía **11 ofertas** — máxima competencia. Un primer llamado puede caerse porque todas las ofertas fueron inadmisibles por papeleo, y entonces el segundo atrae a los mismos interesados y más. Se bajó a 10 pts y se reescribió el texto del factor para no prometer una ventaja competitiva que no existe; la competencia real la sigue midiendo el Factor 1.

Verificado sobre el proceso `1057491-1711-COT26`: se marca como `llamado: 2` y obtiene 35 pts —0 por competencia, 10 por cierre próximo, 15 por presupuesto, 10 por segundo llamado—, es decir, se señala la circunstancia sin inflarlo a "caliente".

### Frecuencia observada
El segundo llamado es poco común: 9 de 150 procesos en estados cerrada/desierta (6%), y solo 1 de 200 entre los activos (0,5%). El factor aportará de forma esporádica, no en cada escaneo.

### Documentación puesta al día
El README seguía prometiendo lo que las herramientas ya habían dejado de prometer — decía que `obtener_enlace_documento` "genera el link público y oficial de descarga" y que `descargar_y_leer_documento` "descarga y extrae el texto plano", justo lo que se corrigió en 2.3.0 por imposible. Se reescribieron seis filas del catálogo y se añadieron a *Limitaciones conocidas* dos secciones nuevas: los adjuntos inaccesibles (con la razón estructural) y el 429 como token bucket que se recarga.

* **Los manuales de `docs/` también estaban obsoletos, y se sirven como recursos MCP.** `manual_servidor_mcp.md` documentaba 13 herramientas: incluía `recomendar_precio_ganador` —eliminada en la v2.0.0— y omitía `analizar_precios_mercado` (su reemplazo), `generar_informe` y `verificar_ticket`. Un modelo que lo leyera intentaría llamar algo inexistente e ignoraría un tercio del catálogo. Se corrigió el listado y se antepuso una advertencia de que la fuente autoritativa es `tools/list` del servidor vivo, no un documento estático. `sintesis_e_indice.md` repetía en dos lugares que la cuota se restablece a medianoche UTC; ahora anota la contradicción de la guía y la medición que la resuelve.
* **El recurso `compra-agil://glosario` enseñaba el modelo de cuota equivocado.** Definía el 429 como un límite diario que "se restablece al inicio del siguiente día calendario UTC". Como es un recurso que el modelo lee para razonar, propagaba la creencia que este servidor acababa de corregir en el código. Ahora explica el token bucket, cita los 13 minutos medidos y describe la espera creciente. Se añadió además la entrada *Token Bucket*, que no existía.

---

## [2.3.0] - 2026-09-06

Tres herramientas prometían cosas que la API no puede cumplir. Ninguna se elimina —no hay cambios incompatibles—, pero dejan de gastar cuota y de anunciar lo que no entregan.

### Cambiado
* **`descargar_y_leer_documento` ya no intenta descargas condenadas.** Para los IDs numéricos —los únicos que entrega esta API— responde de inmediato con el enlace a la ficha, sin gastar la petición ni esperar su timeout. Los UUID **sí** se siguen intentando: usan otro endpoint (`adjunto.mercadopublico.cl`) que nunca se pudo ejercitar, y no se da por muerto sin prueba. La descripción advierte por adelantado la limitación, para que el modelo no la llame esperando el texto del PDF.
* **`verificar_orden_compra` dejó de consultar la API por su cuenta.** Gastaba una consulta de cuota para responder siempre lo mismo: que no puede saberlo. Ahora reutiliza el detalle si ya está en caché —el flujo natural es pedir `obtener_detalle_compra` y después preguntar por la OC, y en ese caso la respuesta va completa y gratis— y si no lo está, responde igual explicando por qué no consultó y cómo confirmarlo en la ficha. **Medido: la secuencia completa pasó de 3 consultas a 1.**
* **`obtener_detalle_orden_compra` advierte de dónde sacar el código.** Su descripción prometía el detalle de una OC sin decir que el código hay que traerlo de otra fuente: consulta la API legada de Órdenes de Compra, y la de Compra Ágil no entrega códigos de OC (`id_orden_compra` viene null en el 100% de los procesos). Sirve cuando ya tienes el código —la OC que te emitieron, un correo de Mercado Público, la ficha pública—, no para descubrirlo.

### Añadido
* **`CompraAgilClient.detalleEnCache()`** — lee el detalle solo si ya está en caché, sin salir nunca a la red. Es lo que permite que `verificar_orden_compra` siga siendo útil a costo cero.
* 12 tests más (183 en total), incluidos 9 que blindan `detalleEnCache()`: que nunca genera tráfico, que construye la misma clave que `detalle()`, que no confunde un proceso con otro ni una búsqueda con un detalle, y que sin persistencia cada instancia arranca limpia. Se validaron por mutación —al alterar a propósito la construcción de la clave, fallan 4 de los 9—, de modo que no pasan por casualidad.

---

## [2.2.0] - 2026-09-06

Auditoría de las 15 herramientas contra la API de producción, desde la óptica de un proveedor PyME buscando venderle al Estado. Cuatro estaban rotas en la práctica y una limitación de diseño dejaba el servidor inutilizable por horas.

### Añadido
* **Caché de respuestas con vencimiento y persistencia** (`utils/cache.ts`). Las tres herramientas de análisis repiten exactamente la misma pareja de llamadas —`buscar({q, estado:'desierta'})` y luego `detalle()` de los primeros resultados— y no existía ninguna reutilización: el mismo histórico se descargaba hasta tres veces en minutos. Vigencia de 15 min para el detalle (un proceso desierto es inmutable) y 5 min para las búsquedas. El ticket queda excluido de la clave y nunca se escribe en disco. **Medido: repetir `generar_borrador_cotizacion` pasó de 6 consultas y 11.254 ms a 0 consultas y 41 ms; `analizar_precios_mercado` de 48.696 ms a 5 ms.**
* **`getCacheStats()` y `limpiarCache()`** en el cliente.
* **26 tests nuevos** (171 en total) sobre caché, búsqueda documental, estimación de precio y política de reintento.

### Corregido
* **`consultar_documentos_locales` no encontraba nada ante una pregunta normal.** Comparaba la consulta completa como subcadena literal, así que "¿qué multas me pueden aplicar?" devolvía "no se encontraron coincidencias en ninguno de los 10 documentos" —existiendo un PDF entero sobre multas y sanciones—. El falso negativo era además confiado: el modelo repetía al usuario que no había información. Ahora la consulta se descompone en términos, se ignoran acentos y palabras vacías, y se puntúa cada línea por cuántos términos concentra. Cuando de verdad no hay nada, se informa qué términos se buscaron.
* **`generar_borrador_cotizacion` caía al placeholder de $1.000 teniendo el presupuesto a mano.** La consulta de precios de mercado y el respaldo por presupuesto vivían en el mismo `try`, así que cualquier fallo de la API saltaba también el respaldo. Observado: un llamado de $4.800.000 generó un borrador de $1.000. La estimación se extrajo a `estimarPrecioUnitario()` con la cascada correcta, el respaldo fuera del `try`, y ahora también considera `presupuesto_estimado`.
* **Un solo 429 inutilizaba el servidor durante horas.** `markLimited()` fijaba el reset en las 00:01 UTC del día siguiente y `checkLimit()` rechazaba localmente TODA consulta posterior, sin siquiera intentar llegar a la API — lo que se reportaba como "cuota diaria agotada" era un bloqueo autoimpuesto, no un veredicto de ChileCompra. **Medido: tras un 429, la API volvió a responder con normalidad 13 minutos después.** La guía oficial se contradice (su §4 habla de día calendario, pero su §7 manda esperar `Retry-After` y el glosario define la cuota como un *token bucket* que "se recarga automáticamente"); se implementó lo segundo, que es lo que hace el servicio real. Ahora se honra `Retry-After` y, si no viene, se aplica una espera creciente (15 → 30 → 60 → 120 min) que la primera consulta exitosa reinicia.
* **El contador de cuota olvidaba todo al reiniciar.** Vivía solo en memoria, y como el servidor MCP se reinicia con cada reinicio del cliente, `obtener_estadisticas_uso` informaba `isLimited: false` segundos después de un 429 real. Ahora persiste en `.rate-limit-state.json`, acotado al día UTC.
* **`descargar_y_leer_documento` fallaba con 404 en adjuntos reales.** El endpoint heredado `RetornaDocumento.aspx` ya no sirve los adjuntos de Compra Ágil: verificado con dos documentos de procesos distintos (IDs 1855508 y 1854909), ambos 404. El error se trataba como fallo inesperado en vez de situación conocida. Ahora orienta a la ficha pública, que sí funciona. Importa porque las especificaciones para cotizar suelen estar solo en el adjunto.
* **`obtener_enlace_documento` prometía una descarga que no funciona.** Afirmaba que los IDs numéricos "se pueden descargar directamente" y entregaba esa URL muerta. Ahora la ficha va primero y el enlace heredado se ofrece advirtiendo que probablemente falle.

### Cambiado
* **Throttle bajado de 40 a 15 consultas/minuto.** La ráfaga de las herramientas de análisis era lo que vaciaba el balde de tokens y provocaba el 429.
* **Defaults más económicos:** `analizar_precios_mercado.limite_analisis` 8 → 5 y `auditar_compras_desiertas.limite_analisis` 5 → 3.
* **`obtener_estadisticas_uso` ya no promete lo que no sabe.** Declara que es un conteo local de esta instalación y que no haber recibido un 429 no garantiza que quede cuota, porque la API no publica el saldo del ticket.

### Cobertura de la auditoría
Todo lo siguiente se ejercitó por el camino real —protocolo MCP sobre stdio contra la API de producción—, no con mocks:

* **15/15 herramientas.** Además de los arreglos de arriba, se verificaron en vivo `buscar_compras_agiles` (incluidos los filtros locales `palabras_clave_requeridas`/`palabras_clave_excluidas`, con casos que sí discriminan: excluir "impresora" 4→3, exigir "cesfam" 4→1, exigir un término ausente 4→0), `obtener_detalle_compra`, `monitorear_cambios_recientes` en sus dos modos, `radar_oportunidades_calientes`, `analizar_precios_mercado` y `auditar_compras_desiertas` en sus dos ramas (`q` y `codigo_compra`), `generar_informe` en los tres formatos de papel (carta, oficio y A4) y `verificar_ticket`.
* **13/13 recursos + la plantilla `compra-agil://compras/{codigo}`**, leídos con `resources/read`: los tres catálogos JSON y los diez documentos, con extracción de texto correcta desde los PDF.
* **2/2 prompts**, obtenidos con `prompts/get`.
* **Demonio de monitoreo** (`services/monitor.ts`), el modo de operación que nunca se había probado: detectó 59 procesos en una ventana de 24 h, aplicó sus cuatro filtros, emitió una alerta real ($6.900.000, sin oferentes), la escribió en `alerts.log`, persistió el estado y en una segunda corrida emitió 0 alertas nuevas — la deduplicación funciona.

### Sin verificar (la API no expone los datos)
Tres caminos de éxito siguen sin poder probarse. De ellos solo se sabe que **fallan correctamente**; en la práctica son herramientas que un proveedor no podrá usar mientras ChileCompra no publique esa información:

* **`obtener_detalle_orden_compra`** — no hay forma de obtener un código de OC válido desde esta API. Solo se probó la degradación ante un código inexistente.
* **`verificar_orden_compra`, rama de cruce con la API de Órdenes de Compra** — ningún proceso trae `id_orden_compra`, así que ese código nunca llega a ejecutarse.
* **`descargar_y_leer_documento`, descarga y parseo del PDF** — todos los adjuntos responden 404 (ver arriba).

### Sobre los adjuntos: por qué no tiene arreglo programático
Se investigó abriendo la ficha pública en un navegador real, y el hallazgo explica de raíz el 404:

* **Las cotizaciones NO exponen adjuntos.** El array `documentos[]` existe solo a nivel del proceso (§6.1 y §6.3 de la guía); dentro de `proveedores_cotizando[]` no hay ningún campo de archivos. Los documentos que un proveedor sube con su oferta no son accesibles por la API. No hay nada que reparar: nunca estuvieron.
* **La ficha pública sí funciona**, y es la vía correcta: renderiza el proceso completo con su sección "Adjuntos". Es lo que devuelven ahora `obtener_enlace_documento` y `descargar_y_leer_documento`.
* **Pero el enlace del adjunto no tiene URL.** En la ficha es un `<a>` con `href` vacío: la descarga la dispara JavaScript desde la SPA. No existe una dirección estática que un programa pueda pedir, y una petición programática a la propia ficha devuelve 403 (protección anti-bot). Por eso mandar a la persona al navegador no es una salida perezosa, sino la única disponible hoy.
* **Los IDs de documento son numéricos, no UUID.** La guía los documenta como `string (UUID)` en §6.1, pero la API real devuelve enteros (observados 1855508 y 1854909). Una discrepancia más entre la documentación y el servicio.

---

## [2.1.0] - 2026-09-06

Cotejo de la Guía oficial v3.0 (mayo 2026) contra la implementación, con re-verificación en vivo de los hallazgos de v2.0.0.

### Añadido
* **Ventana de cambios por rango de fechas en `monitorear_cambios_recientes`.** La API documenta dos formas excluyentes de acotar los cambios (§5.1, Grupo 1): `ttl_cambio_ms` (opción A) y el par `cambio_desde`/`cambio_hasta` (opción B, con su propio Ejemplo 8.2). La opción B estaba tipada en `BuscarParams` pero **ninguna herramienta la exponía**: la sincronización incremental de un período arbitrario era inalcanzable desde el MCP y el único modo disponible tenía techo de 24 horas. Ahora ambos modos están disponibles y son mutuamente excluyentes.
* **Validación local de la ventana** (`resolverVentanaCambios`): rechaza combinar ambos modos, `cambio_hasta` sin `cambio_desde`, fechas no ISO-8601, fechas sin zona horaria y rangos invertidos. Falla antes de salir a la red para no gastar cuota.
* **`scripts/debug-ventana-cambios.ts`**: comprueba la opción B contra la API real. Verificado — rango cerrado (2.165 resultados con `fecha_ultimo_cambio` dentro del rango pedido), rango abierto (892 resultados), y **combinar ambas opciones devuelve HTTP 400**, que es lo que la validación local anticipa.
* **12 tests de regresión** sobre la resolución de ventana (124 en total).

### Verificado (sin cambios en la API)
Los hallazgos de v2.0.0 se re-comprobaron contra el servicio real casi dos meses después, con resultado idéntico:
* `estado=proveedor_seleccionado` **sigue devolviendo 0 resultados**; `estado=oc_emitida` sigue devolviendo HTTP 400.
* En una muestra sin filtrar de 24 h solo aparecen `publicada`, `cerrada` y `cancelada`: no existen procesos adjudicados en la naturaleza.
* **El Ejemplo 8.6 de la guía oficial es irrealizable.** Propone detectar OCs emitidas recorriendo `estado=proveedor_seleccionado` y revisando `id_orden_compra` en el detalle, pero su primer paso devuelve una lista vacía. Anotado en el recurso `compra-agil://estados` y en `utils/quotation.ts` para que nadie vuelva a intentarlo.

### Cambiado
* `minutos` pasa de tener default declarado (`60`) a ser opcional: el default se aplica en el handler solo cuando no se indica un rango. El comportamiento para quien no pasa parámetros es idéntico.

---

## [2.0.0] - 2026-07-15

Primera versión validada **contra la API real de Mercado Público**. Las pruebas revelaron que la documentación oficial difiere de la realidad en puntos que invalidaban tres herramientas, y que se corrigen aquí.

### ⚠ BREAKING CHANGES
* **Eliminada la herramienta `recomendar_precio_ganador`.** Buscaba procesos adjudicados, que la API no expone: era incapaz de encontrar datos.
* **Nueva herramienta `analizar_precios_mercado`** en su reemplazo. Analiza la distribución de precios **cotizados** (dato real disponible) en lugar de precios ganadores (inexistente).
* **Semántica de salida modificada** en `auditar_compras_desiertas`: los campos `casos_exitosos_*` y `*_adjudicado` pasan a `procesos_comparables_*` y `*_cotizado`, porque no había adjudicación que reportar.

### Hallazgos verificados contra la API real (45 procesos, 52 cotizaciones)
La documentación oficial (Guía API Compra Ágil v2, v3.0) resultó incorrecta en:
* **`estado=proveedor_seleccionado` devuelve SIEMPRE 0 resultados.** El parámetro se acepta, pero no retorna nada.
* **`estado=oc_emitida` devuelve HTTP 400** — ni siquiera es un filtro válido, pese a estar documentado.
* **Ningún proceso expone adjudicaciones:** `proveedor_seleccionado` valió `0` en el 100% de las cotizaciones y ningún proceso traía `id_orden_compra`.
* **El sub-objeto `orden_compra` no existe**; solo `id_orden_compra` en la raíz.
* **`seleccion.*` y `estado_cotizacion.*` no existen.** En su lugar hay `estado` (número).
* **`proveedor_seleccionado` es un número**, no un booleano.
* **La API rechaza consultas sin filtros** con HTTP 500, y exige `tamano_pagina >= 10` (confirmado: 1 y 5 devuelven 400).
* **Solo los procesos `desierta` publican sus cotizaciones** (medido: desierta 5/8 con precios, cerrada 0/8).

### Corregido
* **`verificar_ticket` devolvía HTTP 500:** consultaba sin filtros. Ahora usa una ventana `ttl_cambio_ms` de 1 hora — la consulta más liviana (~1s). Verificado contra la API real.
* **`auditar_compras_desiertas` y `generar_borrador_cotizacion` no encontraban nada nunca:** buscaban `estado=proveedor_seleccionado` (0 resultados). Ahora usan `desierta` y agregan precios cotizados.
* **Filtro de admisibilidad demasiado agresivo:** se excluían las cotizaciones declaradas inadmisibles, pero en los procesos desiertos —única fuente de precios— casi todas lo son, dejando la muestra vacía. Ahora se incluyen y se reporta el motivo de cada una: un precio ofertado es señal de mercado aunque se haya rechazado el papeleo.
* **Recurso `compra-agil://estados` actualizado** con el comportamiento real medido, marcando qué estados funcionan y cuáles no.
* **`verificar_orden_compra` es honesto:** un resultado "sin OC" ya no implica que la OC no exista, sino que la API no la publica.

### Añadido
* **Control de dispersión en `analizar_precios_mercado`:** si el precio máximo supera 10 veces la mediana, advierte que el término de búsqueda está mezclando productos distintos y que la sugerencia tiene poco valor. Evita entregar números con falsa precisión (verificado: "reparacion" → 500× la mediana, advierte; "resmas papel" → 2,8×, no advierte).
* **Percentil 25 como criterio de sugerencia**, en reemplazo de "5% bajo el promedio": resiste valores atípicos y ubica la oferta en el cuarto más económico.
* **Herramientas de depuración** (`scripts/debug-*.ts`): consultan la API real y redactan su propia salida, escribiendo el crudo en `debug/` (gitignored) para inspección humana. Son las que produjeron los hallazgos de esta versión.
* **14 tests de regresión** sobre la realidad medida de la API (100 en total): si alguien vuelve a confiar en la documentación oficial, fallan y explican por qué.

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
