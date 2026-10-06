# Sprint 0 — lo que impedía llevar la 2.6.1 a producción

Rama `claude/great-bardeen-784fao`, PR [#8](https://github.com/ssolis-ti/compra-agil-mcp/pull/8).
Un commit por fase, cada una con su test de regresión. Cada test se comprobó
con mutación: se revirtió el arreglo y el test falló.

Resultado: 397 tests (antes 345), verdes en `TZ` America/Santiago, UTC,
Europe/Madrid y Asia/Tokyo, y en la CI (Ubuntu y Windows, Node 20 y 22).

## Fases

### Fase 1 — Tiempo límite y reintento (`c8a3739`)
- `src/api/compra-agil-client.ts`: cada consulta lleva `AbortSignal.timeout`, 35 s por defecto (`COMPRA_AGIL_TIMEOUT_MS`). Un fallo de red se reintenta **una** vez con jitter de 250–750 ms.
- `src/utils/error-handler.ts`: `CompraAgilApiError` acepta una `causa` local (`timeout`, `red`, `respuesta_invalida`) con su mensaje accionable. Así todas las herramientas lo explican sin tocarlas.
- `src/utils/concurrencia.ts`: timeout y red cuentan como congestión para el AIMD.
- `src/tools/documentos.ts`: la descarga de adjuntos corta a 30 s y rechaza más de 20 MB.
- Tests: `test/timeout-red.test.ts`.

### Fase 2 — Respuestas defensivas (`a7034e4`)
- `src/api/normalizar.ts`: Zod tolerante en la frontera del cliente para listado, detalle y orden de compra. Se aplica también al leer la caché.
- `src/services/monitor.ts`: no alerta un proceso sin monto publicado.
- Tests: `test/normalizar.test.ts` (incluye un arnés `servidorFalso()` que captura los handlers de las herramientas; reutilizable).

### Fase 3 — Fechas de informes en hora de Chile (`dce2140`)
- `src/reports/format.ts`: `fecha()` usa `parsearFechaApi()` (sin zona = UTC, la regla del resto del servidor) y formatea en `America/Santiago`. `fechaLarga()` usa el calendario de Chile. El radar rotula «hora de Chile».
- Tests: `test/fechas-informe.test.ts` (cambia `TZ` en caliente y exige el mismo resultado; compara con `fecha_cierre_hora_chile`).

### Fase 4 — Informes confinados (`6d0684e`)
- `src/reports/export.ts`: raíz `informes/` o `COMPRA_AGIL_INFORMES_DIR`; `ruta_salida` es una subcarpeta. Se rechazan `..`, rutas absolutas externas, otra unidad y symlinks que salen (se compara `realpath`). El nombre pasa por `basename`.
- `src/tools/generar-informe.ts`: valida la carpeta antes de consultar la API.
- Tests: `test/ruta-salida.test.ts`.
- ⚠ Cambio de comportamiento: una ruta absoluta fuera de la raíz pide configurar `COMPRA_AGIL_INFORMES_DIR`.

### Fase 5 — Dependencias (`73e23c5`)
- `npm audit fix`: 0 vulnerabilidades en producción (eran 6, 3 altas). Solo cambió `package-lock.json`.

### Fase 6 — CI (`3e765f3`)
- `.github/workflows/ci.yml`: tipos, build y tests en Ubuntu + Windows × Node 20 + 22; `npm audit --omit=dev --audit-level=high`.
- `test/protocolo.test.ts`: arranca el servidor real por stdio (vía `tsx`) y verifica versión, capacidades, 16 herramientas, recursos, prompts, una llamada válida, una inválida y que el ticket no salga en los logs.
- `package.json`: `engines` `>=20.16.0 <21 || >=22.3.0` (lo exige `pdf-parse`).

## Decisiones de diseño (y por qué)

| Decisión | Motivo |
| :--- | :--- |
| Timeout de 35 s, no menos | La pasarela corta a ~30 s con un 504 que el servidor ya explica, y hay consultas legítimas de 20–30 s. El timeout solo corta lo que la pasarela no cortó |
| No reintentar timeout ni 5xx | La pasarela ya esperó ~30 s; repetir pasa los 60 s del cliente MCP y gasta cuota. El proyecto ya documentaba «no reintentes en ráfaga» |
| Reintentar una vez un fallo de red | Es inmediato y suele ser transitorio: el segundo intento es barato |
| `causa` en vez de un HTTP inventado (408, 0) | Un status falso se confundiría con algo que dijo la API |
| Normalizar sin inventar datos | Un presupuesto ausente queda ausente, no en 0: un 0 se leería como dato |
| Listado sin `items` = respuesta inválida | Leerlo como «sin resultados» sería disfrazar un fallo de la API como conclusión sobre el mercado, el defecto que la 2.5.0 eliminó |
| Raíz de informes en el entorno | El modelo elige `ruta_salida` después de leer textos de terceros; el entorno no lo controla el modelo |
| Upgrade de `vitest` 3 → 5 fuera del sprint | Un salto mayor del runner no se mezcla con correcciones; es dev y no viaja en el paquete |

## Lo que no se pudo verificar

- **API real:** el entorno no tenía acceso a `mercadopublico.cl` ni ticket. Pendiente: [validacion-api-real.md](validacion-api-real.md).
- **Calibración del timeout:** 35 s sale de las mediciones del CHANGELOG (504 a ~30 s, consultas de 8–30 s). Confirmarlo con latencias reales.
