# Resultado de la simulación de uso con agentes

6 de octubre de 2026, 01:19–01:23 UTC (5-oct 22:19 en Chile). Rama
`claude/great-bardeen-784fao` (2.6.1 + Sprint 0).

## Cómo se hizo

Tres subagentes usaron **una sola instancia** del servidor a la vez, a través
de `scripts/qa/puente-mcp.mjs`, contra la API simulada en modo realista:
catálogo sintético de 42 procesos (`CATALOGO=sintetico`), 40 % de las
consultas de detalle con HTTP 504 (`FALLA_DETALLE=0.4`, calibrado con la
validación real del 5-oct) y ~400 ms de latencia. Cada agente decidió **solo
con lo que ve un modelo al conectar** (instrucciones y descripciones de las
herramientas), sin leer el código.

| Perfil | Llamadas | Qué hizo |
| :--- | ---: | :--- |
| Proveedora pyme RM (aseo y oficina) | 14 | Oportunidades, cierre en hora de Chile, precio, borrador e informe de cotización, multas |
| Analista de precios | 12 | Guantes y tóner (recalculó las estadísticas), competencia, informe A4, repetición para ver la caché, cuota |
| Auditor de contraloría + casos borde | 18 | Desiertas, ventanas de cambios, región/código inválidos, adjuntos, rutas de informe, hora oficial, ticket |

**Seguridad:** 45 llamadas, **0 fugas del ticket** en respuestas y en el log
del servidor.

**Cada hallazgo se verificó contra el código** antes de anotarlo: los
subagentes reportaron también falsos positivos y artefactos de la simulación,
que van aparte al final.

## Defectos confirmados

S1, S2 y S3 ya están corregidos (rama `claude/fase-1-8-s1-s3`); el resto sigue
en la fase 1.8 del [roadmap](roadmap.md).

| # | Sev. | Herramienta | Defecto | Evidencia en el código |
| :--- | :--- | :--- | :--- | :--- |
| S1 | 🔴 Alta | `auditar_compras_desiertas` | **La recomendación ignora el motivo oficial y la evidencia del propio proceso.** Con `motivo_desierta: "Ofertas sobre el presupuesto disponible"` y una cotización del mismo proceso de $1.679.096 contra un presupuesto de $1.259.000, concluyó «No se detectaron discrepancias… revisar que no estén amarrados a una única marca». La auditoría solo compara contra *otros* procesos y nunca mira las cotizaciones del auditado ni su motivo | `src/tools/auditar-desiertas.ts:283-319`: las brechas salen solo de comparables; el mensaje genérico es el `else` final |
| S2 | 🟠 Alta | `generar_borrador_cotizacion`, `generar_informe` (cotizacion) | **El borrador supera el presupuesto del comprador sin avisar.** Total $9.148.113 contra $9.021.000, con `_campos_a_revisar: []` e informe «Sin placeholders marcados». En los desiertos, «sobrepasa el monto máximo» es causa típica de inadmisibilidad | `src/tools/generar-borrador.ts:203-252`: las advertencias cubren RUT, razón social y precio por defecto, nunca el total frente al presupuesto |
| S3 | 🟠 Alta | `analizar_precios_mercado` vs. `generar_borrador_cotizacion` | **Resultados contradictorios para el mismo proceso.** Con `codigo_compra`, el análisis se limita a la región del comprador sin que el usuario lo pida y respondió «No se encontraron procesos… en la región 5. Prueba… quita el filtro de región» (un filtro que el usuario no puso). El borrador del mismo código busca en todo el país y sí obtuvo 7 precios | `analizar-precios-mercado.ts:128-130` impone la región; `generar-borrador.ts:70-79` no la usa |
| S4 | 🟠 Media | `analizar_precios_mercado` | **La descripción contradice la respuesta.** La descripción dice que las inadmisibles «se excluyen de las estadísticas»; la respuesta y el código las incluyen. El analista recalculó: las cifras del servidor son las que *incluyen* inadmisibles (guantes: P25 $7.612 con todas vs. $7.233 solo admisibles) | Descripción en `analizar-precios-mercado.ts:40`; inclusión en `:227` y nota en `:318` |
| S5 | 🟠 Media | `auditar_compras_desiertas`, informe `auditoria` | **«Sin comparables» se informa como «sin brecha».** Sin procesos distintos para comparar devuelve `presupuesto_insuficiente: false`, `diferencia_presupuesto_porcentaje: 0` y el informe imprime «Presupuesto en rango» / «Plazo en rango». Debería ser «no evaluable» (`null`). Además, `diferencia_presupuesto_porcentaje` compara montos **totales** de procesos con cantidades distintas, sin normalizar por unidad | `auditar-desiertas.ts:246-250` y `:307-311` |
| S6 | 🟡 Media | `consultar_documentos_locales` | **Una pregunta en lenguaje natural esconde el documento relevante.** «¿qué multas me pueden aplicar…?» puso primero los manuales de la API y dejó fuera `multas-sanciones-procedimientos.pdf`: «compra» y «ágil» no son palabras vacías y, como todo el corpus trata de Compra Ágil, inflan el puntaje de cualquier archivo | `src/utils/doc-search.ts:20` (`VACIAS`); `buscarEnTexto(...)` devuelve `['multas','aplicar','atrasos','compra','agil']` |
| S7 | 🟡 Media | `buscar_compras_agiles` (y monitoreo, radar) | **Región fuera de 1-16 no se valida.** `region="17"` gasta una consulta y responde «sin resultados en esta ventana», indistinguible de «no hubo compras». También el texto «en esta ventana» aparece en búsquedas sin ventana temporal | `buscar-compras.ts:38`: `z.string()` sin rango |
| S8 | 🟡 Media | `generar_informe` | **Una ruta de Windows en un servidor Linux/macOS se acepta como subcarpeta.** `C:\Users\funcionario\Desktop` creó una carpeta con ese nombre literal dentro de `informes/` y respondió «✅». Queda confinada (no es una fuga), pero el usuario cree que el informe está en su escritorio. En Windows sí se rechaza | `reports/export.ts`: `path.resolve` en POSIX no reconoce `C:\` como absoluta |
| S9 | 🟡 Media | `analizar_precios_mercado` | **Falta información para decidir:** el aviso de cobertura no nombra los procesos cuyo detalle falló (el analista gastó 2 llamadas en averiguarlo); no hay indicador de suficiencia de muestra (n=4 de un solo comprador sale con `muestra_homogenea: true` y tono firme); una respuesta servida desde caché no dice su antigüedad | `analizar-precios-mercado.ts:328` |
| S10 | 🟡 Baja | varias | Texto y formato: la carta del borrador afirma «Cumplimiento garantizado con todas las especificaciones» sin conocerlas (`generar-borrador.ts:244`); `multa_sancion: null` no aclara si significa «sin multas» o «no informado»; la región sale como «Región 8» en la auditoría y «Biobío» en la búsqueda; el nombre de archivo de los informes usa la hora del servidor y el contenido la de Chile; `_nota_metodologica` y `_nota_horaria` se repiten completas en cada respuesta; `obtener_enlace_documento` y `descargar_y_leer_documento` se superponen | — |

## Confirmado en uso realista: el freno de 15 consultas/min (fase 1.1)

Con tres agentes compartiendo la instancia, 4 llamadas tardaron entre
**26 y 40 s** con una API que respondía en ~400 ms: `analizar_precios_mercado`
36,0 s y 26,7 s, `monitorear_cambios_recientes` 34,4 s y `generar_informe`
39,8 s. Es la espera en el freno propio, no la API. Dos usuarios activos a la
vez ya bastan para acercar herramientas al corte de 60 s del cliente.

## Descartados o atribuibles a la simulación

| Reporte del agente | Veredicto |
| :--- | :--- |
| «El filtro de ventana de `monitorear_cambios_recientes` no se aplica» | **Simulación.** La API simulada ignora `ttl_cambio_ms` y `cambio_desde/hasta`. Contra la API real se verificó que filtra (CHANGELOG, `39b44f6`) |
| Plazos negativos (`duracion_dias: -31`) | **Simulación:** el catálogo sintético generaba cierres anteriores a la publicación. Corregido en `scripts/qa/catalogo-sintetico.mjs`. Queda como mejora menor que el servidor marque fechas incoherentes |
| `obtener_detalle_compra("ABC")` devolvió una ficha | **Simulación:** la API simulada responde un detalle para cualquier código; la real responde 404. Validar el formato localmente ahorraría cuota (mejora menor) |
| «La auditoría no informa los detalles fallidos» | **No confirmado:** `auditar-desiertas.ts:344` agrega `_aviso_cobertura` cuando hay fallos; en esa llamada no hubo. Sí falta informar cuántos candidatos había |
| Tiempos de la descripción (45–55 s) vs. observados (1–27 s) | **Simulación:** la validación real del 5-oct midió 48,8 s, coherente con la descripción |
| «Hubo 504 ocultos en el análisis por código» | **No confirmado:** si el detalle falla, la herramienta devuelve error explícito; la búsqueda regional devolvió 0 de verdad (ver S3) |

## Lo que funcionó bien

- **Aritmética correcta:** el analista recalculó mínimo, máximo, mediana, P25 (interpolación lineal) y promedio, y la proveedora neto, IVA 19 % y totales: todo coincide.
- **Honestidad ante fallos:** «No interpretes esto como escasez de datos del rubro»; el 504 directo se explica sin ambigüedad; un resultado incompleto no se guarda en caché.
- **Cotizado ≠ adjudicado** en todas las herramientas e informes; nunca se declara un ganador.
- **Hora de Chile coherente** entre búsqueda, detalle e informe (UTC-4 en septiembre, UTC-3 en octubre).
- **Rechazos locales útiles:** búsqueda sin filtros, fecha sin zona y ruta con `..` se rechazan sin gastar cuota y dicen qué corregir.
- `verificar_orden_compra` reutiliza la caché y aclara que «sin OC» no prueba nada; `obtener_estadisticas_uso` no presenta el conteo local como saldo del ticket; `verificar_hora_oficial` degrada bien con NTP bloqueado.

## Cómo repetirla

Ver «Simulación de uso con agentes» en [README.md](README.md). Los prompts de
los tres perfiles están en el historial de esta sesión; el de la etapa 3 de
[validacion-api-real.md](validacion-api-real.md) sirve como base para correrla
contra la API real con presupuesto de cuota.
