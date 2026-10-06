# Resultado del enjambre de agentes contra la API real

6 de octubre de 2026, 15:05–15:15 hora de Chile. Versión **2.7.0**, una sola
instancia del servidor (la que Claude Desktop lanza para la sesión), API real
de Mercado Público. Es la primera prueba con agentes contra la API real: la
[simulación anterior](resultado-simulacion-agentes.md) usó una API simulada.

## Cómo se hizo

Cuatro subagentes usaron la misma instancia a la vez, cada uno con un perfil,
un juego de herramientas asignado y un presupuesto de cuota. Los tres primeros
no conocían los defectos ya documentados ni leyeron el código: decidieron solo
con las descripciones y las respuestas, como un usuario real.

| Perfil | Herramientas | Presupuesto | Llamadas |
| :--- | :--- | ---: | ---: |
| Proveedora pyme RM (aseo y oficina) | búsqueda, radar, detalle, borrador, informe `cotizacion`, verificar OC, hora | 12 | 15 |
| Analista de precios | análisis de precios (texto y código), búsqueda, informe `precio` | 14 | 9 |
| Auditora de un organismo de control | monitoreo, auditoría de desiertas, detalle, búsqueda, informes `auditoria` y `competencia` | 14 | 16 |
| QA de normativa y casos borde | documentos locales, enlaces y adjuntos, hora, ticket, entradas inválidas, detalle de OC | 4 | 19 |

**Cobertura:** las 16 herramientas. Los recursos MCP (`glosario`, `estados`,
`regiones`) quedaron sin probar: los subagentes no tenían acceso a las
herramientas de lectura de recursos.

**Cuota:** el contador local pasó de 10 a **48** (incluidas 2 consultas de la
verificación final). Presupuesto de la sesión: 60. **Ningún 429.**

**Seguridad:** ningún agente vio algo con aspecto de credencial, y el ticket no
aparece en los 3 informes HTML generados. `verificar_ticket` muestra solo los
4 últimos caracteres.

**Cada hallazgo se verificó contra el código o contra la API** antes de
anotarlo. Los que no se pudieron verificar van marcados.

---

## 🔴 Hallazgo principal: la API entrega hora de Chile, no UTC

La validación de la 2.7.0 concluyó que `fecha_cierre` sin zona es UTC
([resultado-api-real.md](resultado-api-real.md)). **Es al revés:** la API
entrega la hora de Chile, y en `fecha_ultimo_cambio` le pone una `Z` que no
corresponde. Tres agentes lo señalaron por separado; se confirmó con cuatro
pruebas independientes.

### Evidencia

1. **Las horas de cierre son horas de oficina chilenas.** 92 valores de
   `fecha_cierre` en la caché:

   | Lectura | Cierres entre 08:00 y 18:59 | Picos |
   | :--- | ---: | :--- |
   | Hora cruda como hora de Chile | **89 / 92** | 10:00 y 15:00 |
   | Hora cruda como UTC (lo que hace el servidor) | 64 / 92 | 07:00 y 12:00; cierres a las 03:00, 05:00 y 06:00 |

2. **El cambio más reciente lleva la hora de Chile del momento.** A las 15:06
   de Chile, el último `fecha_ultimo_cambio` fue `2026-10-06T15:05:00.583Z`
   (auditora). Leído como UTC, la API llevaría 3 horas sin registrar cambios
   en un martes hábil.

3. **Prueba de ventanas relativas** (15:13 de Chile):

   | `minutos` | Resultados | Cambio más reciente |
   | ---: | ---: | :--- |
   | 170 | **0** | — |
   | 240 | 1.076 | `15:10:00Z` (hace 3 min, en el ciclo de 5 min de la API) |

   La API compara la marca —que es hora de Chile— contra la hora UTC real.
   Toda ventana menor a 3 horas cae entera en el futuro.

4. **Ventana absoluta corrida:** `cambio_desde/hasta` 09:00–12:00 `-03:00`
   devolvió cambios de 12:00 a 15:00 de Chile (auditora).

### Por qué la 2.7.0 llegó a la conclusión opuesta

Su paso 2 suponía que la API compara bien las horas en `ttl_cambio_ms`: «si la
`Z` fuera hora de Chile, la ventana de 200 min incluiría esos cambios». Pero la
API comete el mismo error en el filtro, y con eso los resultados son idénticos
bajo las dos hipótesis. La misma corrida tenía las señales: siete cierres a las
23:58/23:59 (el típico «fin del día» local), la API «detenida» desde las 21:10
de Chile (en realidad las 00:10, minutos antes de la consulta) y un proceso
`publicada` con el cierre «vencido» (que en realidad todavía no llegaba).

### Efectos en el servidor

| Dónde | Efecto | Evidencia |
| :--- | :--- | :--- |
| `fecha_cierre_hora_chile`, `cierre_hora_chile` en búsqueda, detalle, radar, borrador e informes | **3 horas antes** de la real (4 en invierno). Es el error conservador: nadie pierde un plazo, pero se descartan oportunidades que siguen abiertas | `src/utils/fechas.ts` |
| Radar | **Descarta los procesos que cierran en las próximas 3 horas**, que son los más urgentes; el puntaje de urgencia queda corrido | `radar-oportunidades.ts:72`: `if (hoursLeft <= 0) return null` |
| `monitorear_cambios_recientes` con `minutos` < 180 | **Siempre 0.** Con más de 180, devuelve una ventana 3 h más corta que la pedida | prueba 3 |
| `monitorear_cambios_recientes` con `cambio_desde/hasta` | Ventana corrida 3 horas | prueba 4 |
| `verificar_ticket` | «cambios en la última hora → 0» siempre; por eso era «la consulta más liviana» | `verificar-ticket.ts:54` |
| Daemon de monitoreo | La ventana de 24 h cubre en realidad 21 h | `ttl_cambio_ms` |

### Qué hacer (propuesta, sin implementar)

- Interpretar `fecha_cierre`, `fecha_publicacion` y `fecha_ultimo_cambio` como
  hora de `America/Santiago`, aunque traigan `Z`.
- Para las ventanas, mandar a la API la hora de Chile del instante pedido
  etiquetada como la API la espera, en vez de `ttl_cambio_ms`; o sumarle a
  `ttl_cambio_ms` el desfase vigente. Verificar con la prueba 3: 60 minutos
  deben dar resultados en horario hábil.
- Test de regresión con los datos de este informe: `2026-10-06T15:05:00Z`
  observado a las 18:06 UTC es un cambio de hace 1 minuto.
- Corregir la conclusión de [resultado-api-real.md](resultado-api-real.md), la
  `_nota_horaria` y las instrucciones que el servidor entrega al conectar.

---

## Otros defectos confirmados

| # | Sev. | Herramienta | Defecto | Evidencia |
| :--- | :--- | :--- | :--- | :--- |
| E1 | 🟠 Alta | `auditar_compras_desiertas` | **Marca `requisitos_complejos` contra el motivo oficial.** Motivo «PROVEEDOR SOBREPASA PRESUPUESTO MÁXIMO», única inadmisibilidad por precio, y aun así recomienda revisar «certificaciones difíciles de obtener». Basta que todas las ofertas sean inadmisibles, sin mirar por qué | `auditar-desiertas.ts:494-495` |
| E2 | 🟠 Media | `generar_borrador_cotizacion` | **El precio por defecto no cabe en el presupuesto.** Usa presupuesto − 10 % en neto; con IVA supera el presupuesto ($552.874 contra $516.267). Lo avisa, pero el valor sugerido debería caber con IVA | `generar-borrador.ts:134` |
| E3 | 🟠 Media | `auditar_compras_desiertas` | **Los comparables salen solo de procesos desiertos.** Sesga la muestra hacia los que fracasaron; la búsqueda usó solo el primer ítem («Toldos») de un lote de cuatro productos. Relacionado con S14 | `auditar-desiertas.ts:249`, `:300` |
| E4 | 🟡 Media | `obtener_detalle_compra` | **Un código mal formado gasta cuota.** `ABC` llega a la API, y el error 400 habla de fechas, `q`/`id` y regiones, que no aplican | `detalle-compra.ts:28` (formato solo en la descripción); `error-handler.ts:129` |
| E5 | 🟡 Media | varias | **Cuatro formatos de error distintos:** texto plano, `-32602` con JSON de Zod, «Error de validación:» y Zod en inglés («Invalid input: expected string») en `obtener_enlace_documento`. Solo algunos dicen si se gastó cuota. Amplía S17 | respuestas de los casos 7, 8, 9 y 11a |
| E6 | 🟡 Media | `consultar_documentos_locales` | **El manual del servidor tapa a las guías en preguntas de negocio.** «¿Qué es un segundo llamado?» trae primero filas del manual; la definición de las guías queda fuera. «¿Cuántos días tengo para cotizar?» no se responde ni se avisa. Las ventanas de contexto se solapan y repiten líneas hasta 5 veces | respuestas de los casos 2–4 |
| E7 | 🟡 Media | `analizar_precios_mercado` | **Sin filtro de términos requeridos.** «guantes nitrilo» trae «Actividad de futbol recreativo» y guantes térmicos de panadería; la muestra puede mezclar productos | `analizar-precios-mercado.ts` (0 usos de `palabras_clave_requeridas`) |
| E8 | 🟡 Baja | informe `competencia` | **Copia la descripción libre del proveedor**, con su teléfono y correo personal. Es dato público de la API, pero no aporta al análisis | `templates/competencia.ts:58` |
| E9 | 🟡 Baja | `buscar_compras_agiles` | `motivo_seleccion` («su precio total fue el más bajo») en un proceso **desierto**, sin marca en la fila. La descripción lo advierte; la fila no | `buscar-compras.ts:111-113` |
| E10 | 🟡 Baja | `generar_informe` | El rechazo de `ruta_salida` muestra la ruta absoluta, con el usuario de Windows incluido | `reports/export.ts:39` |
| E11 | 🟡 Baja | varias | El error 404 es compartido y no dice si se buscó una compra o una OC (`error-handler.ts:135`); el listado de documentos menciona `docs/internals/` (`documentos.ts:285`) | — |

### Reportados, sin verificar

- El borrador redujo un pedido de varios productos (jabón, lavaloza,
  desinfectante, papel) a un solo ítem «Toallas de papel» sin advertir que el
  detalle está en un adjunto `.docx`.
- La auditoría por código no entrega nada si falla la búsqueda de comparables,
  aunque ya tiene la evidencia del proceso. Mismo patrón que S12.
- El aviso de cobertura de la auditoría cambió entre dos corridas sobre los
  mismos códigos («no se pidieron… no gastó cuota» / «fallaron porque la API no
  respondió»).
- `cierre_segundo_llamado` no trae su hora de Chile; `monitorear` no trae
  `ultimo_cambio_hora_chile`.

### Ya conocidos, que reaparecieron

S10 (la carta promete «Cumplimiento garantizado»; «Región 5» frente a «Región de
Valparaíso»), S12 (el análisis por código falla entero si falla el paso
inicial), S14 (término de comparables), S17 (formato de errores) y S18
(`tiene_oc: false` sin dato).

### Descartados

- «Faltan resultados parciales cuando fallan algunos detalles»: ya existen
  (`_aviso_cobertura`, `analizar-precios-mercado.ts:406`). Al analista le
  fallaron todos los detalles; por eso no los vio.
- `presupuesto_clp` junto a `moneda: UTM`: el valor viene del campo
  `monto_disponible_clp` de la API, ya convertido a pesos. Sí convendría
  decirlo en la respuesta.

---

## La API durante la prueba

| Tipo de consulta | Duración observada | Fallos |
| :--- | ---: | :--- |
| Búsqueda (texto, estado, región) | 29–37 s | 3 × HTTP 500/503 |
| Detalle de un proceso | 17–35 s | **4 de 5 con HTTP 504** (llamadas directas) |
| Análisis de precios (3–4 detalles) | 17–52 s | **6 de 6 sin precios**: 500 en la búsqueda o 504 en todos los detalles |
| Auditoría | 33–55 s | 503 y 504; ningún comparable en toda la sesión |
| Monitoreo | 15–37 s | — |
| Desde caché (informe, verificar OC) | 3–5 s | — |

Las duraciones son un **tope**: se midieron con la hora del sistema antes y
después de cada llamada, e incluyen 4–6 s del propio agente. La fase 2.2
(métricas por herramienta) permitiría medirlas desde el servidor.

Con la API así, **el análisis de precios no entregó ni una cifra** y la
auditoría nunca tuvo comparables. Las herramientas lo informaron bien
(«Esto NO significa que no haya precios publicados… la API no respondió»).
La viabilidad del análisis de mercado sigue dependiendo del endpoint de
detalle de ChileCompra.

## Lo que funcionó bien

- **Aritmética exacta** donde hubo datos: neto + IVA 19 % y excesos sobre el presupuesto en el borrador y en la auditoría; el HTML cuadra con el JSON.
- **Honestidad:** ningún ganador declarado; los 500/503/504 nunca se presentaron como conclusión de mercado; «sin comparables» se distingue de «sin brecha».
- **Rechazos locales sin cuota:** búsqueda sin filtros, región 17, fecha sin zona, `C:\Windows` y `../fuera` (nada se escribió fuera de `informes/`).
- **Caché útil:** `verificar_orden_compra` y el informe de competencia salieron de caché en 3–5 s.
- **Normativa de multas:** el PDF de sanciones sale primero y la tasa (1 % diario, tope de 20 días) ya no se corta: S15 resuelto en la práctica.
- `verificar_hora_oficial`: 102–117 ms de desfase con el SHOA.

## Veredictos de los perfiles

- **Proveedora:** lo usaría para descubrir oportunidades; no le confiaría el plazo ni el precio del borrador.
- **Analista:** el diseño es honesto, pero hoy no pudo recomendar ningún precio: la API no entregó datos.
- **Auditora:** usaría la evidencia del propio proceso (motivo, cotizaciones, montos); no las horas ni la conclusión sobre requisitos.

## Qué cambia en el roadmap

1. **Nuevo, primero:** la interpretación horaria y las ventanas de cambios. Afecta a todas las herramientas con fechas, al radar y al monitoreo.
2. E1 (requisitos contra el motivo oficial) y E2 (precio por defecto con IVA): pequeños y de alto impacto en la confianza.
3. E4 y E5 junto con S17: validación local y un solo formato de error.
4. Fase 2.2 (métricas por herramienta): sin ella, las latencias solo se pueden medir desde fuera, como aquí.
