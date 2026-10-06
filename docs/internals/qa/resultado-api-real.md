# Resultado de la validación contra la API real

## Etapa 1 — Batería automática

5 de octubre de 2026, 21:50 hora de Chile. Rama `claude/great-bardeen-784fao`
(2.6.1 + Sprint 0), una sola instancia del servidor, desde Windows.

```
QA_API_REAL=1 node scripts/qa/cliente-mcp.mjs scripts/qa/escenarios-reales.mjs
```

| Escenario | Tiempo | Resultado |
| :--- | ---: | :--- |
| `verificar_ticket` | 10,1 s | ✅ |
| `verificar_hora_oficial` (SHOA) | 0,09 s | ✅ |
| búsqueda publicada RM | 11,9 s | ✅ |
| búsqueda por texto (`resmas`) | 27,0 s | ✅ |
| monitoreo 60 min | 1,3 s | ✅ |
| radar RM, 1 página | 10,4 s | ✅ |
| precios (3 históricos) | 48,8 s | ⚠ las 3 consultas de detalle: HTTP 504 |
| auditoría desiertas (2) | 29,5 s | ⚠ detalle `5627-283-COT26`: HTTP 504 |
| informe radar RM | 0,02 s | ✅ (desde caché) |
| estadísticas de uso | 0,002 s | ✅ |

**Consumo:** 10 consultas a la API, sin 429.

### Lo que se comprobó

- **El ticket no se filtró:** ningún `TICKETLEAK`; «Ticket en stderr: false» sobre 4.524 bytes de log.
- **Sin `forma inesperada`:** `src/api/normalizar.ts` contempló todas las respuestas reales de la batería.
- **Los dos errores son de la API, y se informan bien.** El endpoint de detalle devolvió 504 —la pasarela corta a los ~30 s, antes del timeout de 35 s—. Precios dice que **no** es una conclusión de mercado; auditoría nombra la llamada exacta y aclara que no hay parámetro que bajar. Es el mismo patrón observado en septiembre (1 de cada 3 detalles), esta vez peor (4 de 4).
- **La hora de cierre es coherente de punta a punta.** `1499-607-COT26`: la API entrega `2026-10-06 20:30` sin zona; el informe HTML imprime `06-10-2026 17:30 hora de Chile (20 h)` — UTC-3, horario de verano — con las horas restantes correctas respecto de la hora de la prueba.

### Lo que dice sobre el roadmap

- **Timeout de 35 s:** bien calibrado. Los 504 de la pasarela llegan antes (~29 s), y la búsqueda más lenta que sí respondió tardó 27 s. Bajarlo cortaría búsquedas legítimas.
- **La viabilidad de precios y auditoría depende del endpoint de detalle**, no del código. Ninguna fase del roadmap lo arregla; la caché es la única mitigación real.

### Pendiente

- **Etapa 2** (uso desde un cliente MCP): el servidor quedó registrado en Claude Desktop el 5 de octubre, lanzado con `cmd /c cd /d <proyecto> && node dist/index.js` porque la configuración del README no funciona tal como está escrita (ver la fase 1.0 del [roadmap](roadmap.md)). Falta correr los cinco pasos desde el chat.
- **Oportunidad para cerrar la duda UTC / hora de Chile:** `1499-607-COT26` cierra a las 17:30 si `fecha_cierre` es UTC y a las 20:30 si es hora de Chile. Revisar su estado el 6 de octubre entre esas dos horas lo resuelve: si a las 18:00 ya no está `publicada`, es UTC. → **Resuelto en la validación de la 2.7.0 (abajo): es UTC.**

## Validación de la 2.7.0

6 de octubre de 2026, 03:08–03:19 UTC (00:08–00:19 hora de Chile).
`main` en `7c3b459` (versión 2.7.0), desde Windows, con `npm ci` limpio.
Una sola instancia del servidor por corrida, nunca en paralelo.

**Build y tests:** `npm ci && npm run build && npm test` → 46 archivos,
**460 pasan y 1 se omite** (461). El omitido es el del enlace simbólico de
`test/ruta-salida.test.ts`, que se salta en Windows por diseño
(`skipIf(win32)`). La cifra de 458 del CHANGELOG es anterior a los últimos
PR; no hay fallos.

**Consumo total: 17 consultas a la API** (contador local de
`obtener_estadisticas_uso`), sin ningún 429. «Ticket en stderr: false» en las
cuatro corridas; ningún `TICKETLEAK`.

### Batería automática

```
QA_API_REAL=1 node scripts/qa/cliente-mcp.mjs scripts/qa/escenarios-reales.mjs
```

| Escenario | Tiempo | Resultado |
| :--- | ---: | :--- |
| `verificar_ticket` | 1,9 s | ✅ válido, enmascarado |
| `verificar_hora_oficial` (SHOA) | 0,09 s | ✅ desfase 102 ms |
| búsqueda publicada RM | 7,5 s | ✅ 1.784 resultados |
| búsqueda por texto (`resmas`) | 10,8 s | ✅ 13 resultados |
| monitoreo 60 min | 1,2 s | ✅ 0 cambios (el feed de cambios de la API estaba detenido desde las 00:10 UTC; ver abajo) |
| radar RM, 1 página | 8,4 s | ✅ 10 oportunidades |
| precios (3 históricos) | 43,8 s | ⚠ 1 de 3 detalles respondió; 2 con HTTP 504 |
| auditoría desiertas (2) | 29,5 s | ⚠ el proceso auditado (`5627-283-COT26`) dio HTTP 504 |
| informe radar RM | 0,03 s | ✅ desde caché |
| estadísticas de uso | 0,003 s | ✅ |

**Ninguna respuesta presenta un fallo de la API como «no hay datos».**
- Precios declara `procesos_que_fallaron: 2` con `motivo: api_no_respondio`, el enlace a cada ficha y el aviso «no lo interpretes como escasez de datos del rubro».
- Auditoría termina en error explícito: nombra la llamada (`GET /v2/compra-agil/5627-283-COT26`), dice que no hay parámetro que bajar, que no se reintente en ráfaga y que el fallo no quedó en caché.
- Sin `forma inesperada`: `normalizar.ts` contempló todas las respuestas.

El 504 del endpoint de detalle sigue siendo el problema dominante (3 de 4
detalles en la batería, el mismo `5627-283-COT26` que el 5-oct). Fuera de la
batería, los detalles de `1499-607-COT26` (29,8 s) y `2288-673-COT26`
(15,7 s) respondieron. El timeout de 35 s sigue bien calibrado: los 504 llegan
a ~29 s.

### ¿`fecha_cierre` es UTC u hora de Chile? — **UTC; `parsearFechaApi` está bien**

> ⚠️ **Conclusión corregida el 6 de octubre de 2026:** la API entrega **hora de Chile**, no UTC.
> El paso 2 de abajo suponía que el filtro `ttl_cambio_ms` compara bien las horas, y la API comete
> el mismo error en el filtro. Evidencia y efectos en [resultado-enjambre-api-real.md](resultado-enjambre-api-real.md).

**La ficha pública no se pudo leer de forma automática.**
`buscador.mercadopublico.cl` responde 403 de CloudFront a clientes sin
navegador, y en Chrome sin interfaz la página carga sin los datos del
proceso. El bundle del portal sí muestra que la ficha imprime `fecha_cierre`
reformateando el texto (`AAAA-MM-DD hh:mm` → `DD/MM/AAAA hh:mm`) **sin
convertir zona**, así que esa comparación tampoco habría sido concluyente
sola. Se resolvió con la API, en tres pasos y 7 consultas:

1. **El cambio de estado ocurre en el mismo reloj que `fecha_cierre`.**
   Búsqueda `estado=cerrada` ordenada por última modificación (03:16 UTC):

   | Proceso | `fecha_cierre` (cruda) | `fecha_ultimo_cambio` (con `Z`) |
   | :--- | :--- | :--- |
   | `1057491-1819-COT26` | 2026-10-05 22:05 | 2026-10-05T22:10:00Z |
   | `2281-1732-COT26` | 2026-10-05 23:00 | 2026-10-05T23:05:00Z |
   | `1057539-4367-COT26` | 2026-10-05 23:30 | 2026-10-05T23:35:00Z |
   | 7 procesos | 2026-10-05 23:58 / 23:59 | 2026-10-06T00:00:00Z |

   Un proceso pasa a `cerrada` en el primer ciclo de 5 minutos después de su
   cierre. Eso prueba que ambos campos usan el mismo reloj, pero no cuál es.

2. **Ese reloj es UTC real.** `monitorear_cambios_recientes` usa
   `ttl_cambio_ms`, una ventana relativa a la hora real de la consulta
   (03:18 UTC):
   - 200 min (desde ~23:58 UTC): 69 cambios. Entran los de `00:00Z` y `00:10Z`, y **no** los de `23:30Z` ni `23:35Z`.
   - 240 min (desde ~23:18 UTC): 73 cambios. **Sí** entran `23:30Z` y `23:35Z`.

   El borde cae justo donde predice la lectura UTC. Si la marca `Z` fuera
   hora de Chile con la zona mal puesta, esos cambios habrían ocurrido a las
   02:30 y 02:35 UTC reales, y la ventana de 200 min los incluiría.

3. **Conclusión:** `fecha_cierre` sin zona es UTC. `1499-607-COT26`
   (`2026-10-06 20:30`) cierra a las **17:30 hora de Chile**, como dicen el
   radar, el detalle y el informe. No es bloqueante.

**La anomalía que lo puso en duda, y lo que enseña.** `2288-673-COT26`
(segundo llamado) tiene `fecha_cierre` `2026-10-06 02:37` y a las 03:15 UTC
seguía `publicada` en el listado y en el detalle. Leída como hora de Chile,
eso habría probado lo contrario. Pero la API **no registró ningún cambio
después de las 00:10 UTC** (21:10 de Chile): el proceso que actualiza los
estados estaba detenido de noche, así que ese cierre todavía no se había
procesado. Es la prueba b) del encargo (un proceso publicado con cierre crudo
entre la hora de Chile y la hora UTC): apareció uno, pero no es evidencia de
hora local, sino de un estado sin actualizar. Consecuencia práctica, **no
bloqueante**:
- `obtener_detalle_compra` y `buscar_compras_agiles` pueden mostrar `estado_codigo: publicada` con un `cierre_hora_chile` ya pasado (aquí, `2026-10-05 23:37`). El radar no tiene el problema: descarta los procesos con `horas_restantes <= 0`.
- Propuesta para el roadmap (fase 1.9): si el estado es `publicada` y el cierre ya pasó, avisar «el plazo venció; la API aún no actualizó el estado».

### ¿Lista para etiquetar `v2.7.0`?

Sí: la API real no muestra bloqueantes. Los 504 del endpoint de detalle son
de la pasarela, y el servidor los informa bien. El estado `publicada` con
cierre vencido es un dato atrasado de la API, no un error de la 2.7.0.

### Pendiente

- **Etapa 2** (uso desde un cliente MCP), sin cambios respecto del 5-oct.
- Opcional: abrir `https://buscador.mercadopublico.cl/ficha?code=1499-607-COT26` en un navegador. Si muestra `06/10/2026 20:30`, la ficha imprime la hora UTC cruda. Conviene saberlo, porque los avisos del servidor remiten a la ficha para confirmar el plazo.
