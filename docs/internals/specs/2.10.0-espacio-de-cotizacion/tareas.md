# Tareas — 2.10–2.12 Espacio de cotización

Cada tarea nombra su prueba: se escribe primero y se ve fallar. Las puertas de
fase se suman a la puerta común del [README](README.md).

## Fase 0 — Medición, especificación y ADR ✅ (16-oct-2026)

| Id | Tarea | Evidencia |
| :--- | :--- | :--- |
| T0.1 ✅ | Medir los formatos de adjuntos en ~200 compras reales | [medicion-formatos-adjuntos.md](../../qa/medicion-formatos-adjuntos.md): 57 % PDF, 33 % DOCX, 7 % DOC |
| T0.2 ✅ | Revisar alternativas y librerías (licencia, mantenimiento, sin nativos) | `diseno.md` §2 |
| T0.3 ✅ | Requisitos, diseño, tareas y ADR 0029–0032 | Esta carpeta |

## Fase 1 — Lectura multiformato · 2.10.0 ✅ (16-oct-2026)

| Id | Tarea | Prueba | Cubre |
| :--- | :--- | :--- | :--- |
| T1.1 ✅ | `documentos/formato.ts`: detectar por firma (PDF, ZIP→docx/xlsx/zip, OLE→doc/xls, texto) | `documentos-formato.test.ts`: archivos reales de cada tipo y uno con extensión engañosa | L6 |
| T1.2 ✅ | Lector `.docx` propio sobre fflate, tablas aplanadas (mammoth se descartó: arrastraba un aviso de seguridad sin corrección) | `documentos-leer.test.ts` con un `.docx` de la medición | L1 |
| T1.3 ✅ | Lector `.doc` (word-extractor) | Ídem con un `.doc` | L2 |
| T1.4 ✅ | Lector `.xlsx` propio sobre fflate (valores, nunca fórmulas) y `.csv` | Ídem; una celda con fórmula entrega su valor guardado | L3, S2 |
| T1.5 ✅ | Lector `.zip` con límites | Ídem; bomba ZIP y ZIP dentro de ZIP se rechazan | L4, S3 |
| T1.6 ✅ | `documentos/leer.ts` y su uso en `descargar_y_leer_documento`; formatos no soportados con la ficha | `adjuntos.test.ts` ampliado | L5, L7 |
| T1.7 ✅ | Caché del texto por id de adjunto (24 h) | Segunda llamada sin descarga | L8 |
| T1.8 ✅ | `arranque-sin-nativos` cubre `documentos/` | Test existente | N1 |

**Puerta:** los 5 ejemplos de la medición, leídos contra el portal real. ✅ docx, doc y xlsx leídos; png y xls, rechazados con su motivo. Cobertura de los módulos nuevos: 92–100 % de líneas.

## Fase 2 — `exportar_procesos` · 2.10.0

| Id | Tarea | Prueba | Cubre |
| :--- | :--- | :--- | :--- |
| T2.1 | Herramienta con los filtros de `buscar_compras_agiles` | `exportar.test.ts` contra la API simulada | E1 |
| T2.2 | Escritores `csv` y `xlsx` (fflate) y `json` | Abrir el `.xlsx` con el lector de T1.4 | E2 |
| T2.3 | Agregados y aviso de truncado y parcial | Casos de 0, 1 y 25 páginas; 504 en la página 3 | E2–E5 |

**Puerta:** un mes de una región real exportado y abierto en Excel.

## Fase 3 — Rotación de tickets · 2.10.0

| Id | Tarea | Prueba | Cubre |
| :--- | :--- | :--- | :--- |
| T3.1 | `api/tickets.ts`: turno, limitar, rechazar, estado | `tickets.test.ts` | T1, T3, T4 |
| T3.2 | Cuota por ticket (hash) y migración del archivo anterior | `rate-limiter.test.ts` ampliado | T2 |
| T3.3 | `CompraAgilClient` con `Tickets`; un ticket = como hoy | Suite actual sin cambios + casos nuevos | T1 |
| T3.4 | `verificar_ticket`, estadísticas y `--check` por ticket | Salida enmascarada, test de secretos | T5 |
| T3.5 | Advertencia de términos en `.env.example`, manual y README | Revisión | T6 |

**Puerta:** con dos tickets y un 429 simulado en uno, la vigilancia no se detiene. Publicar **2.10.0**.

## Fase 4 — Espacio de cotización · 2.11.0

| Id | Tarea | Prueba | Cubre |
| :--- | :--- | :--- | :--- |
| T4.1 | `cotizacion/almacen.ts`: carpeta, índice, escritura atómica, nombres saneados | `cotizacion-almacen.test.ts` con rutas maliciosas | C1, S4 |
| T4.2 | `cotizacion_abrir` (ficha + todos los adjuntos) | Contra la API y el portal simulados | C1, N3 |
| T4.3 | `cotizacion_listar` y `cotizacion_actualizar` | Orden por cierre, aviso de menos de 24 h | C2–C4 |
| T4.4 | Recurso `compra-agil://cotizacion/{codigo}` | Lectura sin consultar la API | C5 |
| T4.5 | Archivos propios (`cotizacion_agregar_archivo`) | Rutas fuera de la carpeta del usuario, rechazadas | C6, S5 |

## Fase 5 — Requisitos y recordatorio · 2.11.0

| Id | Tarea | Prueba | Cubre |
| :--- | :--- | :--- | :--- |
| T5.1 | `cotizacion/requisitos.ts` por tema, con cita | TDR real de `4626-32-COT26` | Q1–Q3 |
| T5.2 | `requisitos_de_la_compra` y marcar cumplidos | Persistencia en la cotización | Q4 |
| T5.3 | Notificación `cierre_proximo` en la ronda de vigilancia | `salud.test.ts`: una sola vez | Q5 |

**Puerta:** una cotización real de punta a punta con el usuario. Publicar **2.11.0**.

## Fase 6 — Precios propios y documentos · 2.12.0

| Id | Tarea | Prueba | Cubre |
| :--- | :--- | :--- | :--- |
| T6.1 | `cargar_mis_precios` (xlsx/csv, columnas reconocidas) | Planillas con cabeceras distintas | P1 |
| T6.2 | Cruce con los productos pedidos y precio de mercado | Casos con y sin coincidencia | P2, P3 |
| T6.3 | Escritor `.xlsx` de la cotización (fórmulas simples, campos a completar) | Se relee con T1.4 y se abre en Excel | G1, G3 |
| T6.4 | Carta `.docx` | Se relee con T1.2 | G1–G3 |
| T6.5 | `generar_cotizacion` | Marca BORRADOR; nunca sube nada | G2 |

## Fase 7 — Historial y cierre · 2.12.0

| Id | Tarea | Prueba | Cubre |
| :--- | :--- | :--- | :--- |
| T7.1 | Resultado con precio ofertado y ganador | `cotizacion-historial.test.ts` | H1 |
| T7.2 | `cotizacion_historial` por rubro | Ídem | H2 |
| T7.3 | Manual de uso: «Trabajar una cotización», sin jerga | Revisión | N4 |
| T7.4 | Prueba real con Hermes y con el usuario | Nota en `docs/internals/qa/` | todos |

**Puerta:** publicar **2.12.0**.

## Matriz de trazabilidad

| Requisitos | Tareas |
| :--- | :--- |
| L1–L8, N1 | T1.1–T1.8 |
| E1–E5 | T2.1–T2.3 |
| T1–T6 | T3.1–T3.5 |
| C1–C6, S4, S5 | T4.1–T4.5 |
| Q1–Q5 | T5.1–T5.3 |
| P1–P3, G1–G3 | T6.1–T6.5 |
| H1–H2, N4 | T7.1–T7.4 |
| S1–S3 | T1.4, T1.5, T1.6 (y cada herramienta que entrega texto) |
