# 0021. La vigilancia lee la API lote por lote, con una marca del último lote completo

- **Estado:** aceptada (7-oct-2026, fase 0)
- **Origen:** 2.9.0 ([diseño §4](../specs/2.9.0-vigilancia-y-avisos/diseno.md#4-el-ciclo-de-vigilancia), [medición](../qa/medicion-ventanas.md))

**Contexto:** el daemon de la 2.8.0 revisa en cada ciclo «la última hora + 5 min» y lee hasta 10 páginas de 10. Tiene tres fallas:
- si un ciclo falla, esa hora no se vuelve a mirar;
- más allá de 100 procesos corta sin decirlo;
- al paginar, un proceso que vuelve a cambiar sale de la ventana y corre las páginas, así que otro se salta.

La medición del 7-oct mostró además que **la API registra los cambios en lotes cada 5 minutos**:
- todos los cambios de un lote llevan la misma marca (`hh:m5:00.380`), y entre lotes no hay nada;
- los bordes de `cambio_desde`/`cambio_hasta` se incluyen en los dos extremos;
- un lote puede traer más de 100 cambios.

**Decisión:**
- **La unidad de lectura es el lote.** Cada lote se pide por separado con `cambio_desde = marca` y `cambio_hasta = marca + 4 min 59 s`, con `estado=publicada` y páginas de 10. Se lee 2 minutos después de su marca (asentamiento medido).
- **La marca** es la del último lote leído completo. Cada ciclo lee, en orden, los lotes desde el siguiente a la marca hasta el último asentado. Un lote que falla queda pendiente y la marca no lo pasa. Más allá de 48 h, lo no leído se informa como hueco.
- **Consistencia de un lote paginado.** Si el lote tiene más de 10 publicadas, se leen sus páginas y al final se vuelve a pedir la página 1. El lote está completo si el total no cambió y la cantidad de códigos distintos leídos es igual a ese total. Si no, se relee una vez. Si vuelve a fallar, se lee por región (16 consultas); si aun así no cuadra, se marca como incompleto, con su total.
- **Más de 100 publicadas en un lote** (más que las 10 páginas): se lee por región de entrada.

**Por qué no dividir por tiempo** (la primera versión de esta ADR proponía tramos de una página partidos por tiempo): por debajo de un lote no hay nada que dividir. Un lote de 35 procesos no se puede partir en dos ventanas. **Por qué no leer ventanas largas:** los bordes incluidos duplican lotes, y una lectura larga cruza la escritura de un lote nuevo, que es cuando los procesos se mueven.

**Consecuencias:**
- El gasto depende del volumen, no del intervalo: ≈ 288 lotes al día más las páginas extra, unas 470 consultas con el volumen del lunes 6-oct. El intervalo del ciclo solo cambia cuánto tarda el aviso.
- La consistencia se comprueba con datos (total y códigos), no se supone.
- Si la API cambia su ciclo de 5 minutos, la detección de marcas lo debe notar: una ventana interior entre marcas con resultados es una señal de alarma que se informa en `estado_vigilancia`.
