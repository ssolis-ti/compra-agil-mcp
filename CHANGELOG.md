# Historial de Cambios (CHANGELOG)

Todos los cambios notables realizados en este proyecto se registrarán en este archivo. El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere a [SemVer (Versionado Semántico)](https://semver.org/lang/es/).

---

## [Unreleased]

### Seguridad
* **SDK de MCP 1.29.0 → 1.32.1** por el aviso [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) (severidad alta, versiones 1.12.0–1.30.1): el **cliente OAuth** del SDK podía enviar credenciales a un servidor de autorización elegido por el servidor MCP. Este servidor usa solo el lado servidor sobre stdio y no usa OAuth, así que no estaba expuesto, pero el aviso hacía fallar la CI (`npm audit --omit=dev --audit-level=high`) desde su publicación. `npm audit --omit=dev`: 0 vulnerabilidades.

### Corregido — la API entrega hora de Chile, no UTC
* **Los cierres se mostraban 3 horas antes (4 en invierno).** La API entrega `fecha_cierre`, `fecha_publicacion` y `fecha_ultimo_cambio` en hora de Chile, esta última con una "Z" que no le corresponde. Hasta la 2.7.0 se leían como UTC. Medido el 6 de octubre contra la API real, con el reloj verificado contra el SHOA: a las 15:42 de Chile el cambio más reciente decía `15:40Z`, y 89 de 92 cierres caen en horario de oficina leídos como hora de Chile (leídos como UTC aparecían cierres a las 03:00 y 05:00). La validación de la 2.7.0 había concluido lo contrario porque supuso que el filtro de la API compara bien las horas; comete el mismo error ahí.
* **El radar ocultaba los procesos que cerraban en las 3 horas siguientes**, justo los más urgentes: los daba por cerrados. Ahora los muestra, con su puntaje de urgencia.
* **`monitorear_cambios_recientes` con menos de 180 minutos volvía siempre vacío**, y con más devolvía una ventana 3 h más corta: `ttl_cambio_ms` compara las marcas de la API contra la hora UTC real. Las dos ventanas se mandan ahora como rango `cambio_desde`/`cambio_hasta` escrito como la API compara. Verificado: los últimos 60 minutos trajeron 1.517 cambios, el más reciente de hace 2 minutos.
* **Un rango `cambio_desde`/`cambio_hasta` salía corrido 3 horas**, y los dos extremos se comparaban como texto: `10:00-03:00` parecía anterior a `12:00Z`. Ahora se comparan instantes.
* **`verificar_ticket` informaba «0 cambios en la última hora» en pleno horario hábil**, por el mismo filtro. Ahora consulta los últimos 10 minutos.
* **El daemon de monitoreo cubría 21 de las 24 horas pedidas** por el mismo motivo.
* **La auditoría calculaba la duración de los procesos con `new Date()`**, que depende de la zona del servidor.

### Corregido — conclusiones que la evidencia no sostenía
* **La auditoría inventaba un problema de requisitos (E1).** Bastaba con que todas las cotizaciones fueran inadmisibles, o con que el proceso tuviera criterios ambientales, para marcar `requisitos_complejos` y recomendar revisar «certificaciones difíciles de obtener». En el enjambre contra la API real, un proceso desierto por «PROVEEDOR SOBREPASA PRESUPUESTO MÁXIMO», con su única cotización inadmisible por precio, recibió esa recomendación. Ahora se leen las justificaciones de inadmisibilidad: si todas son de precio, no se infieren requisitos, y los criterios ambientales solo se mencionan como algo a revisar cuando ningún otro dato explica la deserción.
* **El precio por defecto del borrador no cabía en el presupuesto (E2).** Era el presupuesto menos 10 % en neto: con IVA el total quedaba en el 107 % ($552.874 frente a $516.267). Ahora el total con IVA queda en el 90 % del presupuesto, que cabe lo incluya o no.
* **El análisis de precios por código fallaba entero si no respondía el detalle del proceso (S12).** Ahora toma el nombre del listado, que es más liviano y suele responder cuando el detalle da 504. Si tampoco responde, dice qué falló y sugiere `q`. Si falla la búsqueda de históricos, dice que fue el primer paso y que no consultó ningún detalle.
* **La auditoría por código no entregaba nada si fallaba la búsqueda de comparables (S12).** Ahora entrega la evidencia del propio proceso —motivo, cotizaciones, montos— y el fallo va como aviso de cobertura.
* **Los comparables se buscaban con el nombre completo del producto (S14)** y solo se encontraba el propio proceso. Ahora se usan hasta dos palabras con significado y, si no hay comparables, se reintenta una vez con una. Sin comparables, sugiere un término más general.
* **La nota metodológica decía que los comparables eran «cerrado o desierto» (E3)**; el código usa solo desiertos, porque son los únicos que publican cotizaciones. La nota lo dice ahora, con el sesgo que implica.
* **Con un solo comparable lo llamaba «promedio» (S13)** y no advertía que lo cotizado es neto. La lectura dice cuántos comparables la sostienen (`comparables_usados`), advierte que uno solo es una referencia débil y que si el presupuesto incluye IVA la holgura real es menor.
* **El borrador no avisaba que el pedido completo puede estar en los adjuntos.** En el enjambre la API listaba un producto y el pedido real tenía cuatro, en un `.docx`. Si hay adjuntos, el borrador lo advierte con el enlace a la ficha.

### Corregido — errores en un solo formato, y sin gastar cuota en lo que se puede validar
* **Un mismo tipo de problema salía en cuatro formatos (E5, S17)**: texto plano, `MCP error -32602: Input validation error…`, «Error de validación:» y mensajes de zod en inglés («Invalid input: expected string, received undefined»), y solo algunos decían si se había gastado cuota. Ahora todo rechazo de una entrada —del esquema o de la herramienta— llega como `Error de validación: <qué corregir>. No se consultó la API.`, con los mensajes de zod en español. Se instala en un solo punto (`utils/validacion.ts`), así que una herramienta nueva lo hereda; una prueba de protocolo lo verifica de punta a punta y falla si una versión del SDK cambia cómo rechaza argumentos.
* **Un código con formato imposible gastaba una consulta (E4).** `obtener_detalle_compra` con `ABC` llegaba a la API para volver con un 400 que hablaba de fechas, de `q`/`id` y de regiones. Los códigos de compra y de OC se validan ahora en el esquema de las ocho herramientas que los reciben.
* **Los errores de la API nombran lo que falló (E4, E11, S18).** El 400 sobre un código habla del código; el 404 dice si no existe la compra o la orden de compra; el 504 del detalle trae el enlace a la ficha.
* **`tiene_oc` y `tiene_orden_compra` eran `false` sin dato (S18)**, mientras la misma respuesta advertía que eso no prueba que la OC no exista. Ahora son `null` («no informado»).
* **El precio del borrador no decía de qué muestra salía (S18).** Ahora nombra el término con que se buscaron los procesos comparables.
* **El rechazo de `ruta_salida` mostraba la ruta absoluta de la carpeta de informes (E10)**, con el usuario del sistema. Ahora muestra solo su nombre.

### Corregido — documentos, textos y privacidad
* **La búsqueda en documentos ponía el manual técnico antes que las guías en preguntas de negocio (E6).** «¿Qué es un segundo llamado?» traía primero la tabla de herramientas del manual del servidor y dejaba fuera la guía que lo explica. Ahora el manual va primero solo en preguntas sobre el servidor o la API; en las de negocio, a igual relevancia, mandan las guías sobre todo lo de `docs/api/`. Probado con los documentos reales: las cuatro preguntas del enjambre abren con una guía, y la de segundo llamado trae la explicación del primer y el segundo llamado.
* **Los fragmentos se repetían (E6).** Dos coincidencias en líneas vecinas se incluían una a la otra como contexto, y un título repetido en cada página del PDF salía cinco veces. Ahora no se repite contexto ni línea.
* **Palabras de relleno como «cuántos», «tengo» o «puedo» contaban como términos (E6)**, y si el mejor fragmento reúne menos de la mitad de los términos, la respuesta advierte que los documentos pueden no responder la pregunta de forma directa.
* **El informe de competencia copiaba teléfonos y correos personales (E8)** de la descripción libre de las cotizaciones. Ahora se omiten.
* **`motivo_seleccion` aparecía en procesos desiertos sin ninguna marca (E9).** La fila trae `_nota_motivo`: es un criterio del comprador, no prueba una adjudicación. Y si la moneda no es CLP, `_nota_moneda` aclara que `presupuesto_clp` ya está en pesos.
* **La carta del borrador prometía «Cumplimiento garantizado con todas las especificaciones» (S10)** sin conocerlas, y decía «No ha sido enviado» en el texto dirigido al comprador. Ahora deja un espacio para que el proveedor detalle el cumplimiento, y lo recuerda en `_campos_a_revisar`.
* **La auditoría decía «Región 5» donde el detalle dice «Región de Valparaíso» (S10).**
* **El nombre de los archivos de informe usaba la hora del servidor (S10)** y no coincidía con la hora impresa adentro. En un servidor en Punta Arenas (UTC-3 todo el año) el nombre salía con una hora de más en invierno.
* **El pie de los cinco informes imprimía la hora de generación 3 horas corrida** al pasar un instante del servidor por el lector de fechas de la API. Era una regresión del cambio horario de esta misma versión; se detectó y corrigió antes de publicarla.

### Añadido
* **`palabras_clave_requeridas` y `palabras_clave_excluidas` en `analizar_precios_mercado`, `auditar_compras_desiertas`, `generar_borrador_cotizacion` y `generar_informe` (E7).** La búsqueda de texto de la API es amplia: en el enjambre, «guantes nitrilo» trajo una actividad de fútbol recreativo y guantes térmicos de panadería, que se colaban en la muestra de precios. El filtro se aplica al listado antes de pedir los detalles, así que no gasta cuota extra; la cobertura informa cuántos procesos descartó, y si no queda ninguno lo dice sin pedir detalles. Misma semántica que en `buscar_compras_agiles` —requeridas: todas; excluidas: basta una—, ahora insensible a tildes en las cinco herramientas: «camion» encuentra «camión».
* **El servidor usa la hora del SHOA como referencia.** Mide el desfase contra `ntp.shoa.cl` al arrancar y cada 30 minutos, en segundo plano, y corrige con eso los plazos, el radar, las ventanas del monitoreo y el daemon (`utils/reloj.ts`). Si el UDP 123 está bloqueado sigue con el reloj local; si el desfase pasa de un minuto, lo advierte (`_aviso_reloj`) en toda respuesta con fechas. `COMPRA_AGIL_NTP=off` lo desactiva.
* **`verificar_hora_oficial` informa el reloj que usa el servidor y la base de zonas horarias.** El NTP da la hora UTC exacta, no la zona: el paso a UTC-3/UTC-4 sale de la base de zonas de Node, y Chile cambia su horario por decreto. Advierte si la base es anterior a la 2025b.
* **El detalle trae la hora de Chile de los cierres de cada llamado**, y el monitoreo la del último cambio.

### Rendimiento
* **La caché escribe a disco una vez por ráfaga, y de forma atómica (fase 1.2).** Antes cada respuesta reescribía el JSON entero —hasta 500 entradas— con una escritura síncrona: una tanda de 20 detalles eran 20 escrituras que bloqueaban el proceso. Ahora se agrupan en una sola, ~1 s después de la última respuesta, a un archivo temporal que luego se renombra: un corte a mitad deja el archivo anterior completo. Lo pendiente se escribe al cerrar el proceso.
* **El texto de los PDF locales se memoriza (fase 1.3).** `consultar_documentos_locales` y el recurso de documentación extraían los 7 PDF en cada consulta (0,8–1 s); ahora la segunda lectura tarda menos de 100 ms, y un archivo se relee si cambia su fecha o su tamaño.
* **El estado del daemon de monitoreo ya no crece sin límite (fase 1.7).** Cada código alertado guarda su fecha y se podan los de más de 30 días. El formato anterior se sigue leyendo, así que un daemon instalado no re-alerta al actualizarse.

### Eliminado
* `CompraAgilClient.cambiosRecientes()`: no tenía usos y mandaba la ventana defectuosa.

### Cambiado
* **`publicar.yml` ya no falla si la versión se publicó a mano.** La 2.7.0 se publicó con `npm publish` desde el equipo del desarrollador; al empujar después el tag, el workflow se detenía en «ya está en npm» y no creaba la release. Ahora, si la versión ya está en npm, se salta el token, la instalación y la publicación, y solo crea la release con las notas del CHANGELOG.

### Corregido
* **`npm publish` fallaba en el equipo del desarrollador** por un test que no estaba aislado de su `.env`: `test/rutas.test.ts` arranca el servidor y este también lee el `.env` de la raíz del paquete, donde está el ticket real y, como trae `.env.example`, `COMPRA_AGIL_BASE_URL` de la API real. El test consultaba la API real con el ticket real (gastando cuota) y se cortaba a los 5 s. En la CI no hay `.env` y pasaba. Ahora el servidor del test corre desde una copia del paquete sin `.env`.

## [2.7.0] - 2026-10-06

Auditoría QA de la 2.6.1, dos simulaciones de uso con agentes y la validación contra la API real (etapa 1). Lo que impedía llevar el servidor a producción y lo que llevaba a un modelo a dar un consejo equivocado. 463 tests (eran 345), CI en Ubuntu y Windows con Node 20 y 22.

> **En npm la versión anterior publicada es la 2.5.0**: la 2.6.0 y la 2.6.1 no llegaron al registro. Quien actualice desde npm recibe también sus cambios (secciones de abajo).

**Cambios de comportamiento** (detalle en cada sección):
* La carpeta de datos (caché, estado de cuota, daemon, `informes/`) ya no depende de la carpeta desde la que se lanza el servidor. Ver «fase 1.0».
* `ruta_salida` de `generar_informe` solo acepta subcarpetas de la carpeta de informes; para otra carpeta, `COMPRA_AGIL_INFORMES_DIR`.
* `region` fuera de 1-16 se rechaza en el servidor, sin consultar la API.
* Una herramienta que antes esperaba hasta ~60 s en el límite propio de consultas por minuto ahora responde enseguida («reintenta en ~N s») o con resultados parciales.
* En `auditar_compras_desiertas`, `analisis_de_brechas` puede traer `null` (no evaluable); la evidencia del propio proceso va primero en las recomendaciones.
* `analizar_precios_mercado` con `codigo_compra` es nacional salvo que se pase `region`.

### Corregido — paquete de npm
* **El paquete no traía las guías ni los manuales.** `files` de `package.json` solo incluía `dist/`, así que con `npx` o `npm install -g` la carpeta `docs/` no existía: `consultar_documentos_locales` y el recurso `compra-agil://documentacion/…` quedaban vacíos sin decir por qué. Ahora se publican `docs/api/` y `docs/guias/`; `docs/internals/` (notas de ingeniería) sigue fuera. Lo detectó la revisión del contenido del paquete antes de publicar; `test/paquete.test.ts` lo comprueba con `npm pack --dry-run`.

### Seguridad — dependencias de desarrollo
* **vitest 3.2 → 4.1.11.** `npm audit` marcaba 3 vulnerabilidades (2 críticas en `tinypool`, de ejecución de código por contaminación de prototipos, y 1 moderada en `@vitest/mocker`, de lectura de archivos). Solo afectaban a quien corre los tests: el paquete publicado no las incluye, y `npm audit --omit=dev` ya daba 0. Se eligió la 4.1.11 y no la 5, que exige Node 22.12 y dejaría fuera a Node 20, todavía soportado. El árbol de producción no cambia.

### Añadido — publicación
* **Publicación automática en npm** (`.github/workflows/publicar.yml`): al empujar un tag `vX.Y.Z`, comprueba que exista el secret `NPM_TOKEN`, que el tag coincida con `package.json`, que esa versión no esté publicada y que el CHANGELOG tenga su sección; publica (con build y tests por `prepublishOnly`, y procedencia firmada si el repositorio es público) y crea la release de GitHub con esa sección como notas.

### Documentación — validación y retome
* README: la instalación manual empieza con `git clone` e indica la versión de Node, y la opción `npx` avisa que npm puede ir atrás del repositorio (hoy sirve la 2.5.0). El punto de retome de QA (`docs/internals/qa/README.md`) y la fase 0 del roadmap reflejan que los PR #8 a #13 ya están en `main` y que falta la validación real y el tag.
* Validación de la 2.7.0 contra la API real (`docs/internals/qa/resultado-api-real.md`): sin bloqueantes, 17 consultas y ningún 429. Queda confirmado que `fecha_cierre` sin zona es UTC: el estado pasa a `cerrada` en el primer ciclo de 5 minutos después del cierre, en el mismo reloj que `fecha_ultimo_cambio`, y la ventana relativa `ttl_cambio_ms` prueba que ese reloj es UTC real. De noche la API puede dejar un proceso `publicada` con el cierre ya vencido.

### Corregido — rutas independientes del directorio de trabajo (fase 1.0)
* **Lanzado por un cliente MCP como indicaba el README, el servidor no encontraba el `.env` y repartía su estado por la carpeta del cliente.** Todo se resolvía con `process.cwd()`, y Claude Desktop lanza el servidor desde su propia carpeta: sin el ticket en texto plano en la config del cliente, terminaba al arrancar (medido el 5 de octubre; se rodeaba con `cmd /c cd /d <proyecto> && …`). Ahora el `.env` se busca en la carpeta de trabajo, la del proyecto y la de datos, y caché, estado de cuota, estado del daemon e informes van a una carpeta de datos fija: `COMPRA_AGIL_DATA_DIR`, la del proyecto si es un clon, o una del usuario si se instaló con `npx`. El README ya no pide el ticket en la config del cliente.
  * ⚠ **Cambio de comportamiento:** quien lanzaba el servidor desde otra carpeta encontrará la caché, el estado y los `informes/` en la carpeta de datos, no en esa carpeta.

### Corregido — rendimiento (fase 1.1)
* **El freno propio de 15 consultas/min podía retener una herramienta hasta el corte del cliente MCP.** Medido: una consulta esperó 57 s en la batería de `scripts/qa/`, y en la simulación con agentes cuatro llamadas tardaron 25-45 s con la API respondiendo en ~400 ms. Ahora cada llamada a una herramienta tiene un presupuesto de 45 s (`COMPRA_AGIL_PRESUPUESTO_MS`): si una consulta tendría que esperar más de lo que queda, no se envía —no gasta cuota— y la herramienta responde con lo que tenga. Las de análisis distinguen en sus avisos los detalles que fallaron en la API de los que se omitieron por tiempo (`procesos_que_fallaron_detalle[].motivo`). El corte de cada consulta tampoco pasa lo que le queda a la herramienta.
* **Las consultas que esperaban turno salían en ráfaga.** El freno esperaba a que saliera la más antigua y, al despertar, anotaba la hora sin volver a mirar: varias esperas simultáneas superaban juntas el máximo. Ahora cada consulta reserva su turno antes de esperar, en orden de llegada.
* **Dos herramientas simultáneas sumaban el doble del límite de concurrencia.** Cada tanda contaba solo sus consultas en vuelo; ahora el conteo es global, y el último HTTP de error se anota por llamada a herramienta, no por cliente.

### Corregido — hallazgos de la simulación de uso con agentes (fase 1.8)
* **S1 · `auditar_compras_desiertas` concluía lo contrario de la evidencia del propio proceso.** Solo comparaba contra otros procesos: uno desierto por «Ofertas sobre el presupuesto disponible», con una cotización 33 % sobre su presupuesto, recibía «No se detectaron discrepancias… amarrados a una única marca». Ahora empieza por el motivo oficial (clasificado en presupuesto, requisitos, plazo o sin ofertas, sin inventar una causa si no se reconoce) y por las cotizaciones del proceso frente a su presupuesto, incluido el caso en que la oferta cabe en neto pero no con IVA. La nueva `evidencia_del_proceso_auditado` y el informe impreso lo muestran. Sin comparables distintos ya no se borra esa evidencia, y la sugerencia genérica sobre las bases solo aparece cuando no hay ninguna otra pista, sin atribuir causa.
* **S1b · La auditoría declaraba «presupuesto suficiente» aunque ninguna oferta cabía con IVA.** El aviso solo se daba si el motivo oficial era presupuesto: en la segunda simulación, una desierta por «requisitos técnicos» con sus cuatro ofertas sobre el presupuesto con IVA (y tres en neto) salía con `presupuesto_insuficiente: false`. Ahora se marca cuando ninguna cotización cabe con IVA o la mayoría supera el presupuesto en neto, cualquiera sea el motivo, y la recomendación explica que depende de si el presupuesto incluye IVA.
* **S11 · La descripción de `obtener_detalle_compra` afirmaba algo no confirmado sobre las cotizaciones.** Decía que «solo se muestran desde el estado "Cerrada" en segundo llamado», tomado de la guía oficial; lo medido es que las traen los procesos desiertos (5 de 8) y no los cerrados de primer llamado (0 de 8), y en eso se apoya `analizar_precios_mercado`. Un modelo que creyera la descripción descartaba los procesos útiles. Ahora dice lo medido y que una lista vacía de proveedores no significa que no haya ofertas (`total_ofertas`).
* **S16 · El informe impreso de precio decía menos que la herramienta JSON.** No mostraba la suficiencia de la muestra, la cobertura ni la distribución sin inadmisibles, y su nota remitía a un campo JSON que quien lee el papel no ve. Ahora muestra la suficiencia (destacada si es baja), procesos encontrados, revisados y sin detalle, la frescura de la caché y una tabla «Con y sin inadmisibles».
* **S2 · El borrador de cotización superaba el presupuesto del comprador sin avisar.** En la simulación ofreció $9.148.113 con IVA frente a $9.021.000, con `_campos_a_revisar: []`. Ahora compara el neto y el total con el presupuesto (la API no dice si lo incluye IVA), lo advierte con el precio unitario máximo que cabría en cada caso, y devuelve `comparacion_presupuesto`, `fecha_cierre` y `fecha_cierre_hora_chile`. El informe `cotizacion` muestra el presupuesto, si el total cabe y el cierre en hora de Chile; su resumen ya no dice «Sin placeholders marcados» cuando hay advertencias.
* **S3 · `analizar_precios_mercado` con `codigo_compra` contradecía al borrador del mismo proceso.** Imponía en silencio la región del comprador, respondía «quita el filtro de región» (un filtro que el usuario no puso) y no encontraba históricos que el borrador, que busca en todo el país, sí encontraba. Ahora el análisis es nacional salvo que se pase `region`; `region_analisis` dice de qué región es el comprador y cómo acotar, y el mensaje sin resultados solo sugiere quitar la región si el usuario la pidió.
* **S4 · La descripción de `analizar_precios_mercado` contradecía su respuesta.** Decía que las cotizaciones inadmisibles «se excluyen de las estadísticas»; el código y la nota de la respuesta las incluyen, y un modelo que solo leyera la descripción informaba lo contrario. Ahora la descripción dice que entran, la respuesta agrega `estadisticas_precio_unitario_solo_admisibles` para comparar, y la nota cuenta las inadmisibles de esa muestra en vez de afirmar que «casi todas lo son».
* **S5 · La auditoría informaba «sin brecha» cuando no había podido comparar.** Sin comparables devolvía `presupuesto_insuficiente: false` y el informe imprimía «Presupuesto en rango». Ahora cada brecha distingue hay brecha (`true`), se evaluó y no hay (`false`) y no evaluable (`null`); el informe lo muestra así. Además el presupuesto se compara **por unidad** cuando los comparables traen precio unitario (antes comparaba montos totales de compras de 2 y de 9 unidades), con `base_comparacion` y una `lectura_diferencia` que dice el signo de la diferencia en palabras.
* **S7 · Una región inexistente gastaba una consulta y respondía «sin resultados».** `region` se valida en el servidor (1-16; varias separadas por coma donde la herramienta lo admite) en búsqueda, monitoreo, radar, precios e informes, y el rechazo dice qué códigos usar. «Sin resultados en esta ventana» queda para el monitoreo; una búsqueda sin ventana temporal dice «sin resultados para estos filtros».
* **S8 · En Linux o macOS, una ruta de Windows en `ruta_salida` creaba una carpeta con ese nombre.** «C:\Users\…\Desktop» terminaba como `informes/C:\Users\…\Desktop/` y la herramienta respondía ✅. Ahora una ruta con letra de unidad o UNC se rechaza en cualquier sistema, como ya pasaba en Windows, y una subcarpeta escrita con barras invertidas («radar\octubre») se trata como subcarpeta.
* **S6 · `consultar_documentos_locales` escondía el documento relevante ante una pregunta natural.** «¿qué multas me pueden aplicar… en una compra ágil?» traía los manuales de la API y dejaba fuera `multas-sanciones-procedimientos.pdf`, porque «compra» y «ágil» —presentes en todo el corpus— sumaban puntaje a cualquier archivo. Esos términos del dominio (compra, ágil, mercado, público, ChileCompra) ya no cuentan, salvo que la consulta no tenga otro.
* **S9 · Al análisis de precios le faltaba información para decidir.** Cuando fallaba un detalle no decía cuál (el analista gastó dos llamadas en averiguarlo); cuatro precios de un único comprador salían con `muestra_homogenea: true` y tono firme; y una repetición servida desde caché no lo decía. Ahora `procesos_que_fallaron_detalle` y el aviso nombran los procesos con su ficha, `suficiencia_muestra` cuenta procesos, compradores distintos y precios (la sugerencia avisa si la muestra es chica), y `_frescura` dice cuánto lleva en caché la búsqueda reutilizada.

Sprint 0 de la auditoría QA de octubre 2026: lo que impedía llevar la 2.6.1 a producción.

### Seguridad
* **`generar_informe` escribía en cualquier carpeta del disco.** `ruta_salida` lo elige el modelo después de leer textos de terceros (nombres de procesos, razones sociales), y se aceptaba cualquier ruta: en la auditoría se escribió un informe fuera del directorio de trabajo con solo pedirlo. Ahora todo queda dentro de la carpeta de informes (`informes/` o `COMPRA_AGIL_INFORMES_DIR`), y `ruta_salida` es una subcarpeta de ella. Se rechazan `..`, rutas absolutas externas, otra unidad y enlaces simbólicos que salen. La carpeta se valida antes de consultar la API, así que un rechazo no gasta cuota.
  * ⚠ **Cambio de comportamiento:** quien pasaba una ruta absoluta fuera de `informes/` debe configurar `COMPRA_AGIL_INFORMES_DIR`.

### Añadido
* **CI en GitHub Actions** (`.github/workflows/ci.yml`): tipos, build y tests en Ubuntu y Windows con Node 20 y 22, más `npm audit` de producción con nivel alto. El repositorio no tenía ninguna verificación automática antes de un merge.
* **Prueba de humo por el protocolo MCP** (`test/protocolo.test.ts`): arranca el servidor real por stdio y comprueba versión, capacidades, las 16 herramientas, recursos, prompts, una llamada válida, una inválida y que el ticket no salga en los logs. Hasta ahora ningún test verificaba que el servidor arrancara.
* **Banco de pruebas `scripts/qa/`**: API simulada con fallas inyectadas (cuelgue, 504, 429, JSON cortado, nulos, XSS) y un cliente MCP que corre escenarios por stdio contra el servidor compilado. Con `QA_API_REAL=1` corre una batería acotada contra la API real. Para simular uso con agentes: catálogo sintético con fallas aleatorias calibradas con la API real (`CATALOGO=sintetico`, `FALLA_DETALLE`, `LATENCIA_MS`) y un puente HTTP (`puente-mcp.mjs`) hacia una sola instancia del servidor. Documentación de la auditoría, el Sprint 0 y el roadmap en `docs/internals/qa/`.
* **`engines` en `package.json`**: Node `>=20.16 <21 || >=22.3`, lo que exige `pdf-parse`.

### Dependencias
* **`npm audit fix`: 0 vulnerabilidades en producción** (eran 6, 3 altas: `hono`, `@hono/node-server`, `fast-uri`, `ip-address`, `qs`, `body-parser`, todas transitivas del SDK de MCP para sus transportes HTTP, que este servidor no usa). Solo cambia `package-lock.json`. El 6 de octubre se publicó un aviso crítico contra `proxy-addr` (GHSA-jqcg-44mw-7w3h, también transitivo vía `express`): queda en 2.0.8. Quedan 2 moderadas en `vitest`, que es de desarrollo y no viaja en el paquete; su arreglo es un salto de versión mayor y va aparte.

### Corregido
* **Una API que no respondía colgaba la herramienta para siempre.** Ninguna consulta tenía tiempo límite: en la auditoría la llamada siguió abierta hasta que el cliente MCP se rindió a los 150 s. Ahora cada consulta se corta a los 35 s (`COMPRA_AGIL_TIMEOUT_MS`), por encima de los ~30 s en que la pasarela ya responde 504, y el mensaje dice cuánto se esperó y qué llamada fue. El timeout cuenta como congestión para el limitador de concurrencia y no queda en caché. La descarga de adjuntos se corta a los 30 s y rechaza archivos de más de 20 MB.
* **Un corte de red salía como `Error inesperado: fetch failed`.** Ahora se reintenta una vez, con espera aleatoria, y si vuelve a fallar se explica como fallo de conexión. No se reintentan ni el timeout ni los 5xx: la pasarela ya esperó ~30 s y repetir llevaría la herramienta por sobre los 60 s que espera un cliente MCP.
* **Un 200 con cuerpo cortado salía como `Unexpected token…`, texto crudo de JavaScript.** Ahora se explica como respuesta inválida de la API, nombra la llamada y no queda en caché.
* **Un listado con `montos: null` hacía caer `buscar_compras_agiles` con `Cannot read properties of null`.** Las respuestas se normalizan una sola vez en el cliente (`src/api/normalizar.ts`): un sub-objeto ausente pasa a `{}`, una lista ausente a `[]`, y los textos que se manipulan (`nombre`, `codigo`, `estado.codigo`) a `''`. No se inventan montos: un presupuesto ausente sigue ausente, no en 0. Los campos no documentados pasan intactos. Un listado sin `items` no se lee como «sin resultados»: se explica como respuesta con forma inesperada y no queda en caché.
* **El daemon de monitoreo habría caído con un proceso sin monto publicado.** Ahora no lo alerta.
* **Los informes HTML imprimían el cierre en la hora del servidor.** `fecha()` leía el valor sin zona como hora local y lo mostraba en hora local: el mismo cierre salía 12:00 en Chile, 15:00 en un servidor UTC y 17:00 en Madrid, y contradecía el `fecha_cierre_hora_chile` de la herramienta JSON. Ahora usa el mismo parser que el resto del servidor (sin zona = UTC) y muestra la hora de Chile; el radar lo rotula. `fechaLarga()` usa el calendario de Chile.

## [2.6.1] - 2026-10-02

Respuestas que dejan de contradecir lo ya medido. No hubo llamada nueva a la API.

### Corregido
* **La página que se ofrece es 10.** `buscar_compras_agiles` y `monitorear_cambios_recientes` rechazan otro tamaño. `analizar_precios_mercado` y `auditar_compras_desiertas` piden 10. Un HTTP 504 pide bajar `tamano_pagina` solo si esa URL traía más de 10.
* **Una ventana vacía ya no se puede leer como «1 de 0».** `numero_pagina` y `total_paginas` van en 0, y `pagina` sigue diciendo `sin resultados en esta ventana`. El monitor trae `total_filtrados_en_pagina`. Una fila con 0 ofertas trae `_nota_ofertas`: es dato del listado, no de la ficha.
* **El recurso `compra-agil://compras/{codigo}` trae `_nota_horaria` y `cierre_hora_chile`.** `verificar_hora_oficial` dice si ese instante es UTC-3 o UTC-4.
* **El glosario ya no dice «máx. 50» ni define la orden de compra como compra al proveedor seleccionado.** La frase corta de `desierta` no niega las ofertas. Si la región del prompt ya es un código del 1 al 16, se usa tal cual.
* **`consultar_documentos_locales` adelanta el PDF de sanciones en una consulta de multas.** La guía oficial se marca como descripción prometida. El recorte termina en una palabra. El listado sin consulta agrupa el Markdown y el PDF de la misma guía. `obtener_enlace_documento` nombra el 404 y no ofrece la URL heredada.
* **El borrador no se presenta como cotización formal enviada.** `activo` y `es_emt` traen una nota de que no son un dictamen. `verificar_orden_compra` sin caché no habla de un corte reciente. `obtener_estadisticas_uso` conserva `cuota_agotada` y agrega `vio_rechazo_temporal`. Si fallan todos los detalles de precios y se conoce el HTTP, el aviso lo nombra.
* **Dos procesos ya no se pisan el contador de `.rate-limit-state.json`.** Se relee y se escribe bajo un lock. `buscar_compras_agiles` no anuncia un HTTP 500 por una llamada que no se hizo. El radar no habla de llamados fáciles de ganar. Un solo detalle de precios caído no pide bajar `limite_analisis`.

## [2.6.0] - 2026-10-02

Informes para el resto del flujo, y respuestas que dejan de tirar lo que la API ya manda. `generar_informe` con `tipo=radar` sigue igual.

### Añadido
* **`generar_informe` tiene cuatro plantillas además del radar.** `cotizacion` presenta el borrador (ítems, neto, IVA 19 % y carta). `precio` grafica la distribución cotizada. `auditoria` muestra las brechas y las recomendaciones. `competencia` compara cotizantes y la brecha entre montos, sin nombrar un adjudicado. Cada una usa la misma recolección que la herramienta JSON. El archivo sigue siendo HTML.

### Corregido
* **`buscar_compras_agiles` y `obtener_detalle_compra` tiraban campos que la API ya manda.** La búsqueda ahora trae el RUT del organismo y `fecha_ultimo_cambio`. `motivo_seleccion` solo si viene con texto, y no se lee como adjudicación. El detalle trae `estado_codigo`, el número de llamado y el último cambio. El tipo de cambio aparece solo si la moneda no es CLP. Una cotización inadmisible trae su justificación. Sigue sin publicarse el proveedor adjudicado.
* **`docs/api/sintesis_e_indice.md` enseñaba primero la cuota por día calendario.** La §4 de la guía lo dice. La medición, la §7 y el glosario describen un token bucket: un 429 de septiembre 2026 se recuperó en 13 minutos. El índice ahora abre por eso. El servidor espera `Retry-After` o 15 → 30 → 60 → 120 minutos, y no bloquea hasta el día siguiente. El ejemplo 8.6 queda marcado: en la muestra, `proveedor_seleccionado` valió 0.
* **Tres scripts de depuración muestreaban con páginas de 50.** `debug-cotizaciones`, `debug-ganadores` y la muestra de estados de `debug-estados` piden 10. `debug-api.ts` conserva la sonda del máximo, que es la llamada que puede devolver 504.
* **`radar_oportunidades_calientes` pedía páginas de 50 y la pasarela las cortaba.** Medido el 1 de octubre de 2026: `estado=publicada` + región con `tamano_pagina=10` respondió en ~8 s; la misma búsqueda con 50 devolvió HTTP 504 a los ~30 s. El radar y el informe que usa los mismos datos piden ahora 10, el mínimo de la API. `max_paginas` sigue en 3, así que el barrido por defecto cubre 30 procesos.
* **El texto del 504 culpaba siempre a una búsqueda que no se había hecho.** Decía que lo más lento es texto sobre `estado=desierta` en cualquier corte de pasarela. Ahora nombra la llamada real (`GET` + ruta + query, sin ticket) y esa nota aparece solo cuando la llamada trae las dos cosas.
* **`buscar_compras_agiles`, `obtener_detalle_compra` y `monitorear_cambios_recientes` devolvían el cierre sin zona.** El radar ya decía que `"2026-09-11 12:00"` se lee como UTC y mostraba la hora de Chile. Esas tres herramientas entregaban el texto crudo. Ahora incluyen `_nota_horaria` y la hora de Chile junto al valor de la API. Sigue sin resolverse si la API habla en UTC o en hora de Chile: la suposición es UTC, y la nota pide confirmar el plazo en la ficha.
* **`buscar_compras_agiles` decía que la página por defecto era 15 y no enviaba ninguna.** El tamaño quedaba en manos de la API. Ahora, si no se indica, pide 10.
* **El monitoreo pedía páginas de 50.** `monitorear_cambios_recientes` usaba ese default y el daemon `monitor.ts` también. El mismo tamaño, sobre `publicada` + región, respondió HTTP 504 el 1 de octubre de 2026. Ahora piden 10, el mínimo de la API. El daemon sigue cortando a las 10 páginas, así que un ciclo cubre como máximo 100 procesos. El prompt `buscar_oportunidades_proveedor` ya no pide 50.
* **`buscar_compras_agiles` aceptaba una llamada sin filtros y la API respondía HTTP 500.** Ahora se rechaza en el servidor, sin gastar cuota, si no viene `estado`, `region`, `q`, `id`, `publicado_desde` o `publicado_hasta`. Orden, página y palabras clave locales no cuentan.
* **Una ventana sin resultados decía "1 de 0".** La API responde `numero_pagina=1` y `total_paginas=0`. `monitorear_cambios_recientes` y `buscar_compras_agiles` copiaban esos números. Ahora `pagina` dice `0 de 0`.
* **`consultar_documentos_locales` devolvía todos los archivos que rozaban la consulta.** Cada uno aportaba hasta 3.000 caracteres. Una pregunta sobre orden de compra y adjuntos ocupaba unos 24.500. Ahora devuelve como máximo 3: el manual del servidor si calificó, y los siguientes por puntaje. El tope por archivo sigue en 3.000. La respuesta dice cuántos quedaron fuera y sus nombres.
* **`consultar_documentos_locales` abría con la guía oficial.** Una pregunta sobre orden de compra y adjuntos devolvía primero `Documentacion_API_Compra_Agil.md`, que promete `oc_emitida` y descarga directa. El manual de este servidor quedaba detrás. Si ese manual coincide en al menos dos términos —o en el único término de una consulta corta— ahora va primero, y la respuesta lo dice. `docs/internals/` sigue fuera del índice.

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

### Corregido — las descripciones mentían sobre los tiempos
Decían que la API tarda *"~1-5s por consulta"*. Medido el 8 de septiembre sobre nueve consultas, la realidad es otra:

| Tipo de consulta | Éxito | Tiempo |
| :--- | :---: | ---: |
| Búsqueda simple | 3/3 | 10,2–12,3 s |
| Búsqueda con texto | 3/3 | 12,8–17,3 s |
| Detalle de un proceso | 2/3 | 20,8–25,1 s |

Importa porque el modelo elige `limite_analisis` y `max_paginas` leyendo esas descripciones: con "1-5s" en la cabeza, pedir 15 procesos parece barato cuando en realidad son quince llamadas de 20-25 s cada una, varias de las cuales fallarán. Ahora cada parámetro declara su costo real y si las llamadas son paralelas (no multiplican el tiempo, sí la probabilidad de fallo) o secuenciales (lineales en ambas cosas).

### Añadido — límite de concurrencia adaptativo
Ninguno de los dos extremos servía: en serie las herramientas de análisis tardaban más de 105 s, y con paralelismo fijo insisten contra un servicio saturado, gastando cuota en llamadas condenadas. Se añade `utils/concurrencia.ts`, que aplica la política de control de congestión de TCP (**AIMD**): baja a la mitad ante la primera señal de saturación y sube de a uno solo tras una tanda completa sin errores.

* **Qué cuenta como saturación:** HTTP 502, 503, 504 y los cortes de red. **Qué no:** 400 y 404, que hablan del ítem pedido y no del servicio, y 429, del que ya se encarga el `RateLimiter` con su `Retry-After`. Reaccionar a esos bajaría el paralelismo por motivos equivocados.
* **Reacciona a mitad de tanda:** si los primeros detalles ya vienen con 504, los que faltan salen con menos paralelismo en vez de repetir el error en bloque.
* **El limitador vive en el cliente y es compartido**, así que lo que una herramienta aprende sobre el estado del servicio protege a la siguiente. `detallesEnParalelo()` reemplaza el `Promise.all(...map(...catch))` que las tres herramientas de análisis tenían duplicado.
* **Verificado en producción** con la API degradada: ante una tanda de 5, el limitador bajó a 2 y el análisis **completó igual** con 42 s y 10 cotizaciones útiles, informando que 4 de 5 consultas habían fallado. Antes esa misma consulta fallaba entera.
* 19 tests nuevos (244 en total). Validados por mutación: quitar la reducción rompe 6, e ignorar el límite rompe 4.

### Corregido — el cálculo de plazos dependía de dónde corriera el servidor
La API entrega dos formatos para el mismo instante: `fechas.fecha_cierre` viene como `"2026-09-11 12:00"`, **sin zona horaria**, mientras que su hermano `convocatoria.fecha_cierre_primer_llamado` trae `"2026-09-11T12:00:00Z"`. Verificado en 8 de 8 procesos: el valor es idéntico, solo uno declara su zona.

El peligro no era solo la ambigüedad. Ante un string así, `new Date()` lo interpreta **en la zona horaria del servidor**. Medido: el mismo `"2026-09-11 12:00"` se convierte en 15:00Z desplegado en Chile y en 12:00Z desplegado en UTC. El radar calculaba `horas_restantes` —y con ella hasta 30 puntos de urgencia— con **tres horas de diferencia según dónde estuviera corriendo**, con datos idénticos.

* **`utils/fechas.ts`** interpreta esas fechas de forma determinista, igual en cualquier servidor. Verificado ejecutando la suite con `TZ` en UTC, Santiago y Tokio: 16/16 en las tres.
* **Se asume UTC** ante la duda. No se pudo determinar con certeza si esos valores son UTC u hora de Chile: el filtro `ttl_cambio_ms` de la API trata las marcas `Z` como UTC real, pero la ficha del portal muestra ese mismo "12:00" a usuarios chilenos sin convertir. Se elige UTC porque **el error es asimétrico**: leerlo como hora local siendo UTC haría creer que quedan tres horas más y se perdería el plazo; al revés, solo se apura de más.
* **El radar expone `fecha_cierre_hora_chile`** junto al valor crudo, y una `_nota_horaria` en la salida —no en los logs— para que ni el modelo ni la persona asuman hora local.
* **Las alertas del daemon informan el cierre en hora de Chile.** Su detección no estaba afectada (usa `ttl_cambio_ms`, una ventana relativa), pero el mensaje decía "Cierre: 2026-09-08 10:26" sin indicar zona: en una alerta cuyo objetivo es avisar a tiempo, esa confusión era justo el fallo a evitar.
* `auditar_compras_desiertas` **no estaba afectada**: resta dos fechas para calcular la duración y el desfase se cancela.
* 16 tests nuevos (260 en total).

### Añadido — `verificar_hora_oficial`, contra el reloj oficial de Chile
Herramienta nueva (16 en total) que contrasta el reloj de esta máquina con **`ntp.shoa.cl`**, del Servicio Hidrográfico y Oceanográfico de la Armada, que es quien fija legalmente la hora en Chile.

Resuelve un problema **distinto y anterior** al de la interpretación de fechas: los plazos se calculan restando la hora local, así que un reloj desviado falsea `horas_restantes` y el puntaje de urgencia del radar aunque la fecha de la API se lea perfectamente. Un reloj atrasado hace creer que queda más tiempo del real — el error que cuesta una licitación.

* Implementa lo mínimo de NTP (RFC 5905) sobre `dgram`, **sin dependencias nuevas**, con la fórmula del protocolo que descuenta el viaje de ida y vuelta en vez de atribuirlo todo al reloj.
* **No consume cuota** de Mercado Público.
* **Degrada sin romper** si la red bloquea el UDP 123, habitual en redes corporativas: lo informa y sugiere comparar a mano contra `horaoficial.cl`.
* Marca el resultado como error cuando el desfase supera un minuto, para que el modelo no lo pase por alto.
* Verificado en vivo: responde en **97 ms** con un desfase de 50 ms. 9 tests nuevos (269 en total), que dependen de que un servidor inexistente falle y no de que `ntp.shoa.cl` responda, para no atar la suite a la red.

### Observado, sin corregir
* **Queda sin resolver si `fecha_cierre` es UTC u hora de Chile.** La prueba concluyente —observar un proceso cruzar de `publicada` a `cerrada`— no se pudo hacer: no había procesos cerrando ese día en la muestra. Mientras tanto la interpretación elegida es la conservadora y está declarada en la salida.
* **La lentitud es del servicio, no del cliente.** Los 504 en el endpoint de detalle aparecieron en 1 de cada 3 consultas. La caché, el paralelismo y ahora la concurrencia adaptativa lo mitigan, pero la viabilidad de las herramientas de análisis depende de la salud de ChileCompra más que del código.

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
