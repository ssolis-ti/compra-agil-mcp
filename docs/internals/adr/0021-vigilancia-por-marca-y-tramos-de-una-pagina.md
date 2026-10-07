# 0021. La vigilancia avanza por una marca y lee tramos de una sola página

- **Estado:** propuesta
- **Origen:** 2.9.0, fase 0 ([diseño §4](../specs/2.9.0-vigilancia-y-avisos/diseno.md#4-el-ciclo-de-vigilancia))

**Contexto:** el daemon de la 2.8.0 revisa en cada ciclo «la última hora + 5 min» y lee hasta 10 páginas de 10. Tiene tres fallas, medidas el 7-oct-2026:
- si un ciclo falla, esa hora no se vuelve a mirar;
- más allá de 100 procesos corta sin decirlo, y `verificar_ticket` vio 99 cambios en 10 minutos;
- al paginar una ventana, un proceso que vuelve a cambiar sale de ella y corre las páginas siguientes, así que se salta otro sin que nadie lo note.

**Decisión:** el estado guarda una **marca**: el final del último tramo contiguo revisado entero. Cada ciclo revisa desde la marca (menos un solape) hasta `ahora()` menos un margen de asentamiento. La ventana se parte en **tramos que caben en una página**: si la API informa más resultados que una página, el tramo se divide en ⌈total/8⌉ partes. Un tramo que falla queda pendiente y la marca no lo pasa. Más allá de 48 h, lo no revisado se informa como hueco.

**Por qué no paginar más hondo:** sube el tope, pero no corrige el corrimiento de páginas ni la ventana perdida. **Por qué no ordenar por fecha de publicación:** el filtro es por fecha de cambio. Un orden distinto del filtro no evita que un proceso salga de la ventana a mitad de la lectura.

**Consecuencias:** el costo crece con el volumen real de cambios (≈ ⌈N/8⌉ consultas más las divisiones), no con un tope fijo; la fase 0 lo mide. Un tramo de 1 minuto con más de 100 cambios se pagina y se marca como posiblemente incompleto. Es el único caso que no se puede garantizar, y queda a la vista.
