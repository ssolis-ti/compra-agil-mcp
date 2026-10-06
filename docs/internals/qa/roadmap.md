# Roadmap — sprints pendientes

Cada fase se cierra con: test de regresión (comprobado con mutación),
`npx tsc --noEmit`, `npm test` verde, entrada en `CHANGELOG.md` bajo
`[Unreleased]` y un commit propio. Las fases van en orden: cada una se apoya
en la anterior.

Referencias a hallazgos: [auditoria-2.6.1.md](auditoria-2.6.1.md).

---

## Plan 2.8.0 — versión cerrada

La 2.8.0 reemplaza a la 2.7.1: junta todos los arreglos pendientes, las
mejoras de calidad del Sprint 1 y la operación mínima para dejar una versión
**cerrada** — sin defectos conocidos de severidad media o alta, con cobertura
medida y validada contra la API real. Fuentes: [resultado-enjambre-api-real.md](resultado-enjambre-api-real.md)
(E1–E11), [resultado-simulacion-agentes.md](resultado-simulacion-agentes.md)
(S10, S12–S18) y las fases de este roadmap.

Los bloques van en orden: cada uno se apoya en el anterior. Cada ítem se cierra
como dice el encabezado de este documento (test de regresión, `tsc`, suite
verde, CHANGELOG, commit propio).

### Bloque A — Hora de Chile 🔴 · L · ✅ (`9154cac`)
- **Fase 1.10** completa (ver abajo). Incluye `cierre_segundo_llamado` con su hora de Chile y `ultimo_cambio_hora_chile` en el monitoreo.
- **Reloj de referencia del SHOA (`ntp.shoa.cl`).** Hoy el NTP solo lo usa `verificar_hora_oficial`; los plazos, el radar y las ventanas restan `Date.now()` de la máquina sin contrastarlo. Medir el desfase contra el SHOA al arrancar y cada ~30 min, sin bloquear, y aplicarlo en un único `ahora()` que usen todas las herramientas y el daemon. Si el UDP 123 está bloqueado, seguir con el reloj local y decirlo en la respuesta; si el desfase pasa de 1 minuto, advertirlo en toda respuesta con plazos, no solo en la herramienta dedicada.
- **El NTP no entrega la zona horaria.** Da la hora UTC exacta; el desfase UTC-3/UTC-4 sale de la base de zonas de Node (`process.versions.tz`, hoy `2026a`), y Chile fija sus cambios de horario por decreto. Tests con los días de cambio (abril y septiembre); `verificar_hora_oficial` informa la versión de la base de zonas y advierte si es anterior al último cambio de reglas conocido.
- **Evidencia:** durante las pruebas del 6-oct el SHOA confirmó el reloj de la máquina con 102–121 ms de desfase, así que las 3 horas venían de la API y no del reloj. La aceptación del bloque usa la hora del SHOA como referencia del «ahora».
- Al cerrarlo, comprobar contra la API real que `monitorear_cambios_recientes` con `minutos: 60` trae resultados en horario hábil.

### Bloque B — Conclusiones correctas 🟠 · M · ✅ (`5b6934c`)
| Ítem | Arreglo | Dónde |
| :--- | :--- | :--- |
| ✅ E1 | La auditoría no infiere «requisitos complejos» si las inadmisibilidades son por precio; el motivo oficial manda | `auditar-desiertas.ts:494` |
| ✅ E2 | El precio por defecto del borrador cabe en el presupuesto **con IVA** | `generar-borrador.ts:134` |
| ✅ S12 | Análisis y auditoría por código entregan resultado parcial con la evidencia propia si falla un paso inicial | `analizar-precios-mercado.ts`, `auditar-desiertas.ts` |
| ✅ E3 + S14 | Término de comparables más corto con un reintento, sugerencia cuando no hay, y la nota declara que solo se usan desiertos (los cerrados no publican cotizaciones: sumarlos solo gastaría cuota) | `auditar-desiertas.ts:249`, `:300` |
| ✅ S13 | Advertencia con un solo comparable; neto frente a IVA explícito | `auditar-desiertas.ts` |
| ✅ Verificado | El borrador no recorta: cotiza todo lo que lista la API. El defecto era no avisar que el pedido completo puede estar en los adjuntos; ahora lo advierte | `generar-borrador.ts` |

### Bloque C — Cuota y errores 🟡 · M
| Ítem | Arreglo | Dónde |
| :--- | :--- | :--- |
| ✅ E4 | Validación local del código de compra y de OC; error 400 específico | `detalle-compra.ts`, `detalle-oc.ts`, `error-handler.ts:129` |
| ✅ E5 + S17 | Un solo formato de error, en español, con «se consultó la API: sí/no»; sin JSON de Zod en inglés | esquemas, `error-handler.ts` |
| ✅ S18 | `tiene_oc: null` sin dato; ficha en el 504 del detalle; procedencia del precio del borrador | varias |
| ✅ E10 | Nombre de la carpeta, sin ruta absoluta, en el rechazo de `ruta_salida` | `reports/export.ts:39` |
| ✅ E11 | 404 que distingue compra de OC | `error-handler.ts:135` |

### Bloque D — Documentos, textos y privacidad 🟡 · M
| Ítem | Arreglo | Dónde |
| :--- | :--- | :--- |
| E6 | Guías antes que el manual en preguntas de negocio; fragmentos sin solapes; aviso cuando no hay respuesta directa | `utils/doc-search.ts` |
| E8 | El informe de competencia no copia contactos personales de la descripción libre | `templates/competencia.ts:58` |
| E9 | Marca en la fila cuando `motivo_seleccion` aparece en un proceso no adjudicado | `buscar-compras.ts:111` |
| S10 | Carta sin «Cumplimiento garantizado»; región por nombre en todas partes; notas largas una vez por respuesta; nombre de archivo en hora de Chile | varias |
| — | `presupuesto_clp` aclara que ya viene en pesos; el listado de documentos no menciona `docs/internals/` | `buscar-compras.ts:91`, `documentos.ts:285` |
| ✅ Descartado | Aviso de cobertura distinto entre corridas: el texto refleja la causa real de cada una (detalles omitidos por el presupuesto de tiempo, sin cuota, frente a detalles que fallaron) | `auditar-desiertas.ts` |

### Bloque E — Mejoras de análisis 🟢 · S
- **E7:** `palabras_clave_requeridas` y `palabras_clave_excluidas` en `analizar_precios_mercado`, `auditar_compras_desiertas` y el borrador, con la misma semántica que en `buscar_compras_agiles`.

### Bloque F — Rendimiento · M
- Fases **1.2** (escritura diferida y atómica de la caché), **1.3** (caché del texto de los PDF) y **1.7** (poda del estado del daemon).

### Bloque G — Calidad · L
- **Fase 1.4** (tipos honestos) y **1.5** (ESLint en la CI; nombres de herramientas derivados del servidor, sin la lista a mano de `src/index.ts`).
- **Fase 1.6:** cobertura con umbral en la CI — herramientas ≥ 80 %, global ≥ 75 %.
- Tests de los **recursos MCP** (`glosario`, `estados`, `regiones`, documentación): ningún agente pudo leerlos.

### Bloque H — Operación · M
- **Fase 2.2:** métricas por herramienta (latencia, caché, 429/504/timeouts) en `obtener_estadisticas_uso`. Es lo que permite medir latencias desde el servidor y no desde fuera.
- **Fase 2.4:** decisiones como ADRs, incluida la de la hora de Chile y por qué la 2.7.0 concluyó lo contrario.

### Fuera de la 2.8.0
| Qué | Por qué |
| :--- | :--- |
| Fase 2.1 (prueba diaria contra la API real) | Requiere guardar un ticket en los secretos de GitHub: decisión del dueño del repositorio |
| Fase 2.5 (contraste con graphify) | El grafo vive solo en el equipo local |
| Rotar el ticket | Expuesto en el historial público desde junio; lo hace el dueño en chilecompra.cl |

### Definición de cerrada
La 2.8.0 se publica cuando se cumple todo esto:
1. `tsc`, ESLint y la suite en verde; la suite pasa con `TZ` en UTC, `America/Santiago` y `Asia/Tokyo`.
2. Cobertura sobre los umbrales del bloque G, verificada en la CI.
3. Ningún defecto conocido de severidad media o alta abierto en este roadmap.
4. Contra la API real: `scripts/qa/escenarios-reales.mjs` sin errores atribuibles al servidor; monitoreo de 60 min con resultados en horario hábil.
5. Enjambre de agentes repetido con presupuesto ≤ 60 consultas: 0 fugas del ticket, 0 hallazgos altos nuevos, y las estadísticas de precios recalculadas a mano sobre datos reales. Correrlo en un horario en que la API no esté degradada: el 6-oct los 504 del detalle impidieron obtener precios.
6. Etapa 2 hecha desde Claude Desktop.
7. README, `docs/api/manual_servidor_mcp.md`, glosario, instrucciones al conectar, `CLAUDE.md`, CHANGELOG y este punto de retome al día.
8. Publicada en npm con tag `v2.8.0` y release en GitHub.

---

## Fase 0 — Cerrar el Sprint 0 ✅

PR #8 a #17 fusionados; la 2.7.0 se validó contra la API real
([resultado-api-real.md](resultado-api-real.md)) y se publicó en npm el 6 de
octubre, con tag `v2.7.0` y release en GitHub.

---

## Sprint 1 — Rendimiento y calidad (~1 semana)

### Fase 1.0 — Rutas independientes del directorio de trabajo 🟠 ✅ (rama `claude/fase-1-0-rutas`)
**Problema medido** (5 de octubre, al registrar el servidor en Claude Desktop para la etapa 2): el servidor resuelve sus archivos con `process.cwd()`, y un cliente MCP lo lanza desde **su propio** directorio, no desde el del proyecto. Con la configuración que da el README —solo la ruta a `dist/index.js`— pasa esto:

| Archivo | Dónde se resuelve | Efecto con el cwd del cliente |
| :--- | :--- | :--- |
| `.env` | `src/utils/env-loader.ts` | No se encuentra: sin ticket en el bloque `env`, el servidor termina al arrancar. Por eso el README empuja a escribir el ticket en texto plano en la config del cliente |
| `.api-cache.json` | `src/api/compra-agil-client.ts` | La caché queda en la carpeta del cliente, o falla si no es escribible |
| `.rate-limit-state.json` | `src/utils/rate-limiter.ts` | Ídem: el conteo de cuota se separa del que ven los scripts del proyecto |
| `alerts.log`, `.monitor-state.json` | `src/services/monitor.ts` | Ídem para el daemon |
| `informes/` | `src/reports/export.ts` | Ídem, salvo que se configure `COMPRA_AGIL_INFORMES_DIR` |
| `docs/` | `src/utils/docs-locator.ts` | ✅ No afectado: ya tiene respaldo relativo al paquete |

Hoy se rodea lanzándolo con `cmd /c cd /d <proyecto> && node dist/index.js` (así quedó registrado en Claude Desktop), pero quien siga el README no lo sabe.

**Hacer:**
- Un único módulo de rutas que resuelva una **carpeta de datos** en este orden: `COMPRA_AGIL_DATA_DIR` si está definida; si no, la raíz del paquete cuando es escribible (instalación desde el repo); si no, una carpeta de usuario (`%LOCALAPPDATA%\mcp-compra-agil` en Windows, `~/.local/state/mcp-compra-agil` en el resto) para instalaciones con `npx`.
- `.env`: buscarlo en la carpeta de datos y en la raíz del paquete, además del cwd. Se mantiene la prioridad actual: una variable ya definida en el entorno gana.
- Caché, estado de cuota, estado del daemon e informes salen de ese módulo; `COMPRA_AGIL_INFORMES_DIR` sigue ganando para los informes.
- README: configuraciones de cliente que funcionen tal como están escritas, sin pedir el ticket en la config cuando hay `.env`.

**Aceptación:** un test que arranca `dist/index.js` con `cwd` en una carpeta temporal ajena y comprueba que lee el `.env` del proyecto, responde `tools/list` y escribe la caché en la carpeta de datos, no en el cwd. Con eso, la configuración del README funciona en Claude Desktop sin el rodeo de `cmd`.

### Fase 1.1 — Presupuesto de tiempo por herramienta 🟠 ✅ (rama `claude/fase-1-1-s1b`)
**Problema medido:** el freno propio de 15 consultas/min (`src/utils/rate-limiter.ts`, `throttle()`) retiene una consulta hasta ~60 s. En la batería de `scripts/qa/` la consulta ~20 del minuto esperó **57 s** antes de salir, y una herramienta con `limite_analisis` alto excede los 60 s del cliente MCP sin entregar nada. Además, las esperas despiertan todas a la vez sin volver a mirar el límite y salen en ráfaga.

**Hacer:**
- Un presupuesto por llamada de herramienta (p. ej. 45 s) que el cliente consulte antes de esperar en el freno: si la espera no cabe, no se envía la consulta y la herramienta responde con lo que tenga.
- Las herramientas de análisis (`analizar_precios_mercado`, `auditar_compras_desiertas`, `generar_borrador_cotizacion`, `generar_informe`) devuelven resultados **parciales** con un aviso de cobertura, como ya hacen ante detalles fallidos.
- `throttle()`: cola FIFO; cada despertar vuelve a comprobar el límite.
- `LimitadorConcurrencia`: contar las consultas en vuelo de forma global, no por tanda (hoy dos herramientas simultáneas suman 2× el límite), y `ultimoHttpVisto` por tanda.

**Aceptación:** ninguna herramienta pasa de 50 s con la API simulada aunque el freno esté lleno; test de que 30 esperas simultáneas nunca superan 15 envíos por ventana.

### Fase 1.10 — La API entrega hora de Chile, no UTC 🔴 (va primero)
**Problema medido** (6 de octubre, enjambre de agentes contra la API real): `fecha_cierre` y `fecha_publicacion` llegan en hora de Chile, y `fecha_ultimo_cambio` también, aunque traiga una `Z`. El filtro `ttl_cambio_ms` de la API compara esas marcas contra la hora UTC real. Evidencia y efectos en [resultado-enjambre-api-real.md](resultado-enjambre-api-real.md); la conclusión «UTC» de la validación de la 2.7.0 era incorrecta.

| Efecto hoy | Dónde |
| :--- | :--- |
| Toda hora de cierre en hora de Chile sale 3 h antes (4 h en invierno): búsqueda, detalle, radar, borrador, informes, recurso `compras/{codigo}`, alertas del daemon | `src/utils/fechas.ts` (`parsearFechaApi`) |
| El radar descarta los procesos que cierran en las próximas 3 h y corre el puntaje de urgencia | `src/tools/radar-oportunidades.ts:72` |
| `monitorear_cambios_recientes` con `minutos` < 180 devuelve siempre 0; con más, una ventana 3 h más corta | `src/tools/monitorear-cambios.ts:124` |
| `cambio_desde`/`cambio_hasta` con zona devuelven una ventana corrida 3 h | ídem |
| `verificar_ticket` informa «0 cambios en la última hora» siempre | `src/tools/verificar-ticket.ts:54` |
| El daemon cubre 21 h de las 24 pedidas | `src/services/monitor.ts` |

**Hacer:**
- `parsearFechaApi`: interpretar los valores sin zona **y** los que traen `Z` de la API como hora de `America/Santiago`, con el desfase de esa fecha (UTC-3 / UTC-4). Las fechas que escribe el usuario siguen respetando su zona.
- Ventanas: reemplazar `ttl_cambio_ms` por `cambio_desde`/`cambio_hasta` expresados como la API los compara (la hora de Chile del instante pedido con sufijo `Z`), o sumarle el desfase vigente. Aplicarlo en el monitoreo, `verificar_ticket` y el daemon. Validar los bordes de la ventana absoluta contra la API antes de elegir.
- Radar: con la hora corregida, el filtro `hoursLeft <= 0` vuelve a ser correcto; revisar los umbrales de urgencia con datos reales.
- Textos: `_nota_horaria`, `NOTA_ZONA_HORARIA`, las instrucciones que el servidor entrega al conectar (`src/instrucciones.ts`), las descripciones de las herramientas, el glosario y la regla «Fechas» de `CLAUDE.md`.
- Revisar `test/fechas.test.ts` y `test/fechas-informe.test.ts`: hoy fijan la interpretación UTC y van a fallar; eso es lo esperado.

**Aceptación:**
- Test con los datos medidos: `fecha_ultimo_cambio` `2026-10-06T15:05:00.583Z` observado a las `2026-10-06T18:06Z` es un cambio de hace ~1 minuto; `fecha_cierre` `2026-10-08 09:00` es `2026-10-08 09:00` hora de Chile (`12:00Z`).
- Test del cambio de horario (abril/septiembre): el desfase sale de la fecha del valor, no de la del servidor.
- Contra la API real: `monitorear_cambios_recientes` con `minutos: 60` en horario hábil devuelve resultados, y el cambio más reciente tiene menos de 10 minutos.
- Suite verde con `TZ` en UTC, `America/Santiago` y `Asia/Tokyo`.

### Fase 1.2 — Escritura de la caché 🟡
**Problema:** `ResponseCache.persistir()` reescribe el JSON entero (hasta 500 entradas, varios MB) con `writeFileSync` en cada respuesta, y no es atómico.

**Hacer:** escritura diferida (debounce ~1 s) y atómica (archivo temporal + `rename`); vaciar al cerrar el proceso. Igual para `.rate-limit-state.json` si aplica (ya usa lock).

**Aceptación:** 20 detalles en paralelo → 1–2 escrituras, no 20; un proceso cortado a mitad de escritura no deja la caché ilegible.

### Fase 1.3 — Caché del texto de los PDF 🟡
**Problema:** `consultar_documentos_locales` vuelve a extraer el texto de los 7 PDF en cada consulta (0,8–1 s).

**Hacer:** memorizar el texto por archivo, invalidado por `mtime` y tamaño.

**Aceptación:** la segunda consulta tarda < 100 ms.

### Fase 1.4 — Tipos honestos 🟡
**Problema:** las interfaces de `src/api/compra-agil-client.ts` declaran como `number`/`string` campos que la API puede omitir. La normalización del Sprint 0 evita los crashes, pero el compilador no avisa de un acceso inseguro nuevo (así apareció el `undefined < MIN_BUDGET` del daemon).

**Hacer:** derivar los tipos del esquema de `src/api/normalizar.ts` (`z.infer`) o marcar las hojas como opcionales/nulas, y corregir lo que `tsc` señale.

**Aceptación:** `tsc` en verde sin `as any` nuevos.

### Fase 1.5 — Linter y dependencias de desarrollo 🟡
- ESLint con `typescript-eslint` (reglas recomendadas + `no-floating-promises`), paso en la CI.
- `vitest` 3 → 5 (cierra las 2 vulnerabilidades moderadas restantes).
- `src/index.ts`: derivar los nombres de herramientas registradas en vez de la lista mantenida a mano.

### Fase 1.6 — Cobertura de las herramientas 🟡
Hoy (aprox.): `documentos.ts` 5 %, `generar-informe.ts`, `detalle-oc.ts`, `verificar-hora.ts`, `verificar-ticket.ts`, `monitor.ts` e `index.ts` 0 %.

**Hacer:** tests de handler con el arnés `servidorFalso()` de `test/normalizar.test.ts`; el daemon con la API simulada. Agregar `@vitest/coverage-v8` y un umbral en la CI.

**Aceptación:** herramientas ≥ 80 % de líneas; umbral global ≥ 75 % en la CI.

### Fase 1.7 — Daemon de monitoreo 🟡
- `.monitor-state.json` crece sin límite: guardar el código con su fecha y podar los de más de 30 días.

### Fase 1.8 — Lo que encontró la simulación con agentes 🔴
Defectos confirmados contra el código en la simulación del 6-oct ([resultado-simulacion-agentes.md](resultado-simulacion-agentes.md)). Van antes que la cobertura (1.6) porque S1–S3 hacen que un modelo dé un consejo equivocado.

- ✅ **S1 🔴** `auditar_compras_desiertas`: usar el `motivo_desierta` oficial y las cotizaciones del propio proceso frente a su presupuesto antes que los comparables; no emitir la recomendación genérica de «especificaciones amarradas a una marca» cuando la evidencia apunta a otra causa.
- ✅ **S2 🟠** `generar_borrador_cotizacion` / informe `cotizacion`: comparar el total con el presupuesto del comprador, advertir en `_campos_a_revisar` y mostrar presupuesto y cierre en el informe impreso.
- ✅ **S3 🟠** `analizar_precios_mercado` con `codigo_compra`: no imponer la región del comprador sin decirlo (buscar en todo el país, o regional con respaldo nacional, y decir cuál se usó), alineado con el borrador.
- ✅ **S4 🟠** Descripción de `analizar_precios_mercado`: decir que las inadmisibles **se incluyen**; ofrecer también las estadísticas solo de admisibles.
- ✅ **S5 🟠** `auditar_compras_desiertas`: sin comparables → `null` / «no evaluable», no `false`/0; normalizar por unidad antes de comparar presupuestos.
- ✅ **S6 🟡** `consultar_documentos_locales`: tratar «compra», «ágil» (y términos presentes en todo el corpus) como vacías o ponderarlas por frecuencia de documento.
- ✅ **S7 🟡** Validar `region` 1-16 localmente; que «sin resultados» no hable de una ventana que no se pidió.
- ✅ **S8 🟡** `ruta_salida`: rechazar rutas con letra de unidad o `\` en cualquier sistema.
- ✅ **S9 🟡** Precios: nombrar los procesos cuyo detalle falló, indicar suficiencia de muestra (procesos y compradores distintos) y la antigüedad de lo servido desde caché.

**Aceptación:** cada punto con su test de regresión y una nueva corrida de la simulación (mismos tres perfiles) sin esos hallazgos.

S1–S3 corregidos en la rama `claude/fase-1-8-s1-s3` (tests `auditoria-evidencia`, `borrador-presupuesto`, `precios-region`) y S4–S9 en `claude/fase-1-8-s4-s9` (tests `precios-inadmisibles`, `precios-informacion`, `docs-multas`, `region`, `ruta-salida`, `auditoria-evidencia`), todos verificados de punta a punta por el protocolo MCP. La segunda corrida de la simulación (mismos tres perfiles) no reprodujo ninguno de los nueve.

### Fase 1.9 — Lo que encontró la segunda simulación 🟠
Ver «Segunda corrida» en [resultado-simulacion-agentes.md](resultado-simulacion-agentes.md).

- ✅ **S1b 🟠** Auditoría: marcar presupuesto cuando las cotizaciones propias no caben con IVA (o la mayoría lo supera en neto), aunque el motivo oficial sea otro.
- ✅ **S11 🟠** Corregir la descripción de `obtener_detalle_compra` sobre cuándo aparecen las cotizaciones.
- **S12 🟠** Precios por código: si falla el detalle de referencia, usar el nombre del listado o sugerir reintentar con `q`.
- **S13 🟠** Auditoría: advertir cuando hay un solo comparable; aclarar neto vs. IVA en la comparación.
- **S14 🟠** Auditoría: término de comparables más amplio que el nombre completo del producto, o sugerirlo cuando no hay comparables.
- ✅ **S15 🟡** Documentos: ampliar el contexto de los fragmentos para no cortar cifras. Resuelto en la práctica: en el enjambre del 6-oct la tasa de la multa por atraso salió completa.
- ✅ **S16 🟡** Informe `precio`: mostrar suficiencia, cobertura y «solo admisibles».
- **S17–S18 🟡** Formato de errores de esquema, enlace a la ficha en el 504 del detalle, procedencia del precio del borrador, `tiene_orden_compra` sin dato como `null`, ejemplo de fecha con `-03:00`.

---

## Sprint 2 — Operación

### Fase 2.1 — Prueba diaria contra la API real
Workflow programado (`schedule`) con un ticket de pruebas en los secrets del repositorio, que corra `scripts/qa/escenarios-reales.mjs` con un presupuesto pequeño. Detecta a tiempo que la API cambió de forma (lo que la fase 2 del Sprint 0 rechazaría como «forma inesperada»).

### Fase 2.2 — Métricas por herramienta
Latencia, aciertos de caché, 429/504 y timeouts por herramienta, expuestos en `obtener_estadisticas_uso`. Con eso se calibra el timeout y el presupuesto de tiempo con datos y no con supuestos.

### Fase 2.3 — Documentación que viaja con el paquete ✅ (2.7.0: `docs/api`, `docs/guias` y `docs/README.md` van en `files`)
`docs/` no está en `files` de `package.json`: quien instala con `npx` no tiene las guías. Opciones: incluir `docs/api` y `docs/guias` (~15 MB de PDF) o descargarlas al primer uso.

### Fase 2.4 — Decisiones como ADRs
Recuperar `decisiones.md` y `PENDIENTES.md` (borrados en `6be7402`) y convertirlos en `docs/adr/NNNN-titulo.md`, junto con las decisiones del Sprint 0 ([sprint-0.md](sprint-0.md)). Si se usó spec-kit en local, subir `specs/` para auditar contra criterios de aceptación.

### Fase 2.5 — Contraste con el grafo de graphify
Regenerar `graphify-out/` sobre la rama actual y revisar dependencias entre módulos: que `tools/` no dependa de otra herramienta, que `api/` no importe de `tools/`, y ciclos.
