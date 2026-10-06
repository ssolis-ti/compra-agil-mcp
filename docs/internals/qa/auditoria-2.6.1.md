# Auditoría QA — versión 2.6.1

Octubre 2026. Alcance: los 37 commits entre el merge del PR #7 (15-jul) y la
2.6.1 (`09ba8a4`, 2-oct): 83 archivos, +7.152 / −1.977 líneas (`src/` +3.812,
`test/` +2.830, documentación +376/−539).

## Veredicto

La 2.6.1 es una mejora real sobre la 2.0 y la arquitectura es sana: cliente
HTTP centralizado, caché y limitador compartidos por todas las herramientas,
ticket protegido desde la base y un esfuerzo visible por no afirmar más de lo
que los datos permiten. No requiere reescritura. Le faltaba endurecer la
frontera con la API y con el disco: eso fue el Sprint 0.

## Qué cambió en la 2.6.1 respecto de la 2.0

- **Resiliencia:** caché de respuestas en disco (15 min detalle, 5 min búsqueda), concurrencia adaptativa AIMD ante 504, manejo del 429 con espera progresiva y `Retry-After`.
- **Veracidad:** las herramientas dejaron de presentar un fallo de la API como conclusión sobre el mercado, aclaran que los precios son cotizados y no adjudicados, y no intentan descargas que se sabe que fallan.
- **Correcciones de fondo:** plazos independientes de la zona horaria del servidor, la capacidad `logging` declarada (los logs nunca llegaban al cliente), verificación de la hora oficial contra el SHOA.
- **Funciones:** el radar considera el segundo llamado, `generar_informe` con 5 tipos, instrucciones de uso al conectar.

## Pruebas realizadas

| Prueba | Resultado en la 2.6.1 |
| :--- | :--- |
| `tsc --noEmit` (strict) y build | ✅ |
| Suite de tests | ✅ 345/345 en 30 archivos |
| Cobertura | ⚠ 62 % líneas, 83 % ramas. Sin tests: `index.ts`, `monitor.ts`, `generar-informe`, `detalle-oc`, `verificar-hora`, `verificar-ticket`; `documentos.ts` 5 % |
| `npm audit --omit=dev` | ⚠ 6 vulnerabilidades (3 altas), transitivas del SDK de MCP |
| 31 escenarios por protocolo MCP contra API simulada con fallas | Ver hallazgos |

Lo que resistió bien: el ticket no se filtró en ningún escenario (respuestas ni
logs), el HTML de los informes escapa XSS, el 504 se explica nombrando la
llamada, la caché sigue sirviendo tras un 429 y los esquemas rechazan
parámetros inválidos. Arranque en ~360 ms con 16 herramientas, 13 recursos y 2
prompts.

## Hallazgos y estado

| # | Severidad | Hallazgo | Estado |
| :--- | :--- | :--- | :--- |
| 1 | 🔴 Bloqueante | Sin timeout HTTP: una API que no responde colgaba la herramienta (150 s medidos) | ✅ Sprint 0, fase 1 |
| 2 | 🟠 Alta | El freno propio de 15 consultas/min retiene una herramienta hasta ~60 s, el límite del cliente MCP. Las esperas despiertan juntas y salen en ráfaga | ⏳ Sprint 1, fase 1 |
| 3 | 🟠 Alta | Sin validación de respuestas: `montos: null` → `Cannot read properties of null`; JSON corrupto → `Unexpected token…` | ✅ Sprint 0, fase 2 (tipos estrictos en Sprint 1, fase 3) |
| 4 | 🟠 Media | Los informes imprimían el cierre en la hora del servidor (12:00 / 15:00 / 17:00 según la zona) | ✅ Sprint 0, fase 3 |
| 5 | 🟡 Media | `ruta_salida` de `generar_informe` escribía en cualquier carpeta | ✅ Sprint 0, fase 4 |
| 6 | 🟡 Media | Rendimiento: la caché reescribe el JSON entero de forma síncrona en cada respuesta; `consultar_documentos_locales` re-parsea los 7 PDF en cada consulta (~1 s); la contabilidad del limitador de concurrencia se mezcla entre herramientas simultáneas | ⏳ Sprint 1, fases 1 y 2 |
| 7 | 🟡 Baja | Higiene: sin CI, sin linter, sin `engines`, deduplicación del daemon sin límite, módulos de entrada sin tests, `docs/` no viaja en npm | CI y `engines` ✅ Sprint 0; resto ⏳ Sprint 1 y 2 |
| 8 | 🟡 Baja | 6 vulnerabilidades de producción | ✅ Sprint 0, fase 5 (quedan 2 moderadas en `vitest`, dev) |

## Hallazgo de proceso

El repositorio no guarda ni las especificaciones ni el grafo de graphify, y la
bitácora de decisiones (`decisiones.md`, `PENDIENTES.md`) se borró en
`6be7402`. Con eso no se puede auditar contra requisitos formales: esta
auditoría comparó el código con el README, el CHANGELOG, las descripciones de
las herramientas y los tests.
