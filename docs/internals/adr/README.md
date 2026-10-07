# Decisiones de arquitectura (ADR)

Por qué el código está como está. Si algo parece innecesariamente complicado, la razón probablemente esté acá.

Cada decisión en su archivo, con su estado y su origen. Las 0001–0011 vienen de `docs/internals/decisiones.md` (julio 2026), que se borró en `6be7402` y se recuperó tal cual en la 2.8.0; las siguientes son del Sprint 0 y de la 2.8.0.

Viven en `docs/internals/` y no en `docs/adr/` porque `docs/` es la fuente de `consultar_documentos_locales`: fuera de `internals/` aparecerían ante el modelo como si fueran normativa de Compra Ágil (ver la [0009](0009-docs-internals-excluido-del-escaneo-rag.md)).

Una decisión nueva va en un archivo nuevo con el número siguiente. Una que cambia se actualiza en su archivo (sección «Actualizaciones») o se reemplaza por otra que lo diga.

| # | Decisión |
| :--- | :--- |
| [0001](0001-el-html-de-los-informes-nunca-vuelve-al-llm.md) | El HTML de los informes nunca vuelve al LLM |
| [0002](0002-un-solo-punto-de-redaccion-de-secretos.md) | Un solo punto de redacción de secretos |
| [0003](0003-graficos-en-svg-generado-a-mano-sin-librerias.md) | Gráficos en SVG generado a mano, sin librerías |
| [0004](0004-informes-autocontenidos-cero-recursos-externos.md) | Informes autocontenidos, cero recursos externos |
| [0005](0005-escapado-html-obligatorio-en-todo-dato-de-la-api.md) | Escapado HTML obligatorio en todo dato de la API |
| [0006](0006-funciones-puras-de-datos-separadas-del-formato.md) | Funciones puras de datos, separadas del formato |
| [0007](0007-los-templates-ordenan-defensivamente.md) | Los templates ordenan defensivamente |
| [0008](0008-percentil-25-no-5-bajo-el-promedio.md) | Percentil 25, no "5 % bajo el promedio" |
| [0009](0009-docs-internals-excluido-del-escaneo-rag.md) | `docs/internals/` excluido del escaneo RAG |
| [0010](0010-el-oficio-chileno-se-declara-con-dimensiones-explicitas.md) | El Oficio chileno se declara con dimensiones explícitas |
| [0011](0011-rate-limiter-proactivo-no-solo-reactivo.md) | Rate limiter proactivo, no solo reactivo |
| [0012](0012-timeout-de-35-s-y-reintentos.md) | Timeout de 35 s y reintentar solo fallos de red |
| [0013](0013-normalizar-sin-inventar-datos.md) | Normalizar las respuestas sin inventar datos |
| [0014](0014-raiz-de-informes-en-el-entorno.md) | La carpeta de informes la fija el entorno, no el modelo |
| [0015](0015-la-api-entrega-hora-de-chile.md) | La API entrega hora de Chile, aunque diga «Z» |
| [0016](0016-reloj-del-shoa-como-referencia.md) | El reloj del SHOA como referencia del «ahora» |
| [0017](0017-un-solo-formato-de-error.md) | Un solo formato para los errores de validación |
| [0018](0018-comparables-solo-desiertos.md) | Los comparables de precios son procesos desiertos |
| [0019](0019-servidor-construido-aparte-del-arranque.md) | Construir el servidor aparte de su arranque |
| [0020](0020-cache-en-disco-por-rafaga-y-atomica.md) | La caché se escribe por ráfaga y de forma atómica |
| [0021](0021-vigilancia-por-marca-y-tramos-de-una-pagina.md) | *Propuesta (2.9.0):* la vigilancia avanza por una marca y lee tramos de una sola página |
| [0022](0022-bandeja-de-salida-al-menos-una-vez.md) | *Propuesta (2.9.0):* bandeja de salida persistente, entrega al menos una vez |
| [0023](0023-destinos-de-aviso-fuera-del-alcance-del-modelo.md) | *Propuesta (2.9.0):* los destinos de aviso se configuran fuera del alcance del modelo |
| [0024](0024-webhook-firmado-con-hmac-y-marca-de-tiempo.md) | *Propuesta (2.9.0):* webhook firmado con HMAC y marca de tiempo |
| [0025](0025-canales-con-fetch-nativo-y-smtp-con-nodemailer.md) | *Propuesta (2.9.0):* Telegram y webhook con `fetch` nativo; correo con `nodemailer` |
| [0026](0026-un-nucleo-dos-modos-gateway-y-daemon.md) | *Propuesta (2.9.0):* un núcleo, dos modos: el gateway entrega, el daemon vigila solo |
