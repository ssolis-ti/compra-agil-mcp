# Roadmap — sprints pendientes

Cada fase se cierra con: test de regresión (comprobado con mutación),
`npx tsc --noEmit`, `npm test` verde, entrada en `CHANGELOG.md` bajo
`[Unreleased]` y un commit propio. Las fases van en orden: cada una se apoya
en la anterior.

Referencias a hallazgos: [auditoria-2.6.1.md](auditoria-2.6.1.md).

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
- **S15 🟡** Documentos: ampliar el contexto de los fragmentos para no cortar cifras.
- ✅ **S16 🟡** Informe `precio`: mostrar suficiencia, cobertura y «solo admisibles».
- **S17–S18 🟡** Formato de errores de esquema, enlace a la ficha en el 504 del detalle, procedencia del precio del borrador, `tiene_orden_compra` sin dato como `null`, ejemplo de fecha con `-03:00`.

---

## Sprint 2 — Operación

### Fase 2.1 — Prueba diaria contra la API real
Workflow programado (`schedule`) con un ticket de pruebas en los secrets del repositorio, que corra `scripts/qa/escenarios-reales.mjs` con un presupuesto pequeño. Detecta a tiempo que la API cambió de forma (lo que la fase 2 del Sprint 0 rechazaría como «forma inesperada»).

### Fase 2.2 — Métricas por herramienta
Latencia, aciertos de caché, 429/504 y timeouts por herramienta, expuestos en `obtener_estadisticas_uso`. Con eso se calibra el timeout y el presupuesto de tiempo con datos y no con supuestos.

### Fase 2.3 — Documentación que viaja con el paquete
`docs/` no está en `files` de `package.json`: quien instala con `npx` no tiene las guías. Opciones: incluir `docs/api` y `docs/guias` (~15 MB de PDF) o descargarlas al primer uso.

### Fase 2.4 — Decisiones como ADRs
Recuperar `decisiones.md` y `PENDIENTES.md` (borrados en `6be7402`) y convertirlos en `docs/adr/NNNN-titulo.md`, junto con las decisiones del Sprint 0 ([sprint-0.md](sprint-0.md)). Si se usó spec-kit en local, subir `specs/` para auditar contra criterios de aceptación.

### Fase 2.5 — Contraste con el grafo de graphify
Regenerar `graphify-out/` sobre la rama actual y revisar dependencias entre módulos: que `tools/` no dependa de otra herramienta, que `api/` no importe de `tools/`, y ciclos.
