# Medición de las ventanas de cambios (fase 0 de la 2.9.0)

Tareas T0.2–T0.4 de la [especificación](../specs/2.9.0-vigilancia-y-avisos/tareas.md#fase-0--preparación-decisiones-mediciones-y-base--7-oct-2026),
medidas el 7-oct-2026 entre las 19:00 y las 19:40 (hora de Chile) con
`scripts/qa/medir-ventanas.mjs`. Se usaron 40 consultas. Las horas van como
las compara la API: hora de Chile con «Z» ([ADR 0015](../adr/0015-la-api-entrega-hora-de-chile.md)).

## T0.2 — Bordes y resolución: la API marca los cambios por lotes de 5 minutos

Ventana `18:00–18:30` (cerrada hacía más de 40 min):

| Consulta | `total_resultados` |
| :--- | ---: |
| Ventana entera, 18:00–18:30 | 234 |
| 18:00–18:10, 18:10–18:20 y 18:20–18:30 | 168 + 81 + 41 = **290** |
| 18:00–18:05 | 138 |
| 18:02–18:03 (un minuto interior) | **0** |
| 18:05–18:05 (ancho cero, en el borde) | **114** |

Los 10 procesos de la muestra de 18:00–18:05 traen la misma marca,
`2026-10-07T18:05:00.380Z`.

**Conclusiones:**
1. **Los cambios no tienen una hora propia.** La API los registra en lotes, cada 5 minutos, y todos los del lote llevan la misma marca (`hh:m0:00.380` o `hh:m5:00.380`). Entre dos lotes no hay nada: el minuto interior da 0.
2. **Los bordes se incluyen en los dos extremos.** Las tres partes de 10 minutos suman 290 frente a 234, porque los lotes de 18:10 y 18:20 se cuentan dos veces. Una ventana de ancho cero sobre la marca devuelve el lote entero.
3. **Un lote puede traer más de 100 cambios** (114 en todos los estados), con una sola marca. No se puede dividir un lote por tiempo.
4. **`total_resultados` es exacto con estos filtros**: los conteos son consistentes entre sí, descontados los bordes dobles.

**Efecto en el diseño:** la idea de «tramos de una página divididos por tiempo» ([ADR 0021](../adr/0021-vigilancia-por-marca-y-tramos-de-una-pagina.md), primera versión) no sirve. Por debajo de un lote no hay nada que dividir. La unidad de lectura pasa a ser **el lote**. Ver la actualización de la ADR 0021.

## T0.3 — Retraso de indexación y estabilidad de una ventana cerrada

Ventana `19:00–19:10`, repetida:

| Minutos desde el fin | Total | Publicadas |
| ---: | ---: | ---: |
| 2 | 37 | 9 |
| 7 | 37 | 9 |
| 10 | 37 | 9 |

- **El lote ya estaba completo 2 minutos después de su marca**, y no llegó nada tarde. Se adopta un asentamiento de 2 minutos antes de leer un lote.
- **Una ventana cerrada no cambió** al pasar dos lotes nuevos (19:15 y 19:20). Esto se midió de noche, con poca actividad. En horario hábil, un proceso que vuelve a cambiar sale de su lote anterior y entra al nuevo. La comprobación de consistencia del diseño cubre ese caso, y la fase 10 lo mide de día.

## T0.4 — Volumen y presupuestos

**Publicadas por hora**, lunes 6-oct-2026 (cambios con `estado=publicada`, contados el 7-oct):

| Hora | 00–07 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20–23 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cambios | 4 | 6 | 79 | 228 | 229 | 296 | 327 | 195 | 139 | 309 | **420** | 250 | 75 | 39 | 18 |

Total del día ≈ 2.600. Es una cota inferior: un proceso que volvió a cambiar
después cuenta solo en su último lote. En la hora pico hay ≈ 35 por lote de
5 minutos.

**Presupuesto de 50 procesos publicados** (los más recientes):

| p10 | p25 | Mediana | p75 | p90 | Máximo | ≥ $5.000.000 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| $218.629 | $316.000 | $800.000 | $3.000.000 | $7.100.000 | $7.215.100 | 8 de 50 (16 %) |

- **El mínimo actual de $5.000.000 deja fuera el 84 % de los procesos.** No es «casi nada», como se dijo en la revisión del 7-oct, pero sí la mayoría. Para R2.3 se fija **0 por defecto** (sin filtro de monto): un filtro que el dueño no eligió no debe ocultar procesos. El monto lo pone el dueño.

## Cuota

La documentación oficial dice que el límite diario depende del tipo de ticket, pero no da un número. Con lotes de 5 minutos, la vigilancia lee cada lote una vez sin importar el intervalo:

- consultas/día ≈ Σ ⌈publicadas del lote / 10⌉ ≈ **288 lotes + ~180 páginas extra ≈ 470 al día** con el volumen del lunes repartido parejo en cada hora; con lotes desiguales, entre 450 y 650;
- el intervalo solo cambia la latencia del aviso, no el gasto;
- `COMPRA_AGIL_VIGILANCIA_CONSULTAS_DIA` queda en **1.500** por defecto. La proyección (R8.5) avisa si el gasto real se acerca.
