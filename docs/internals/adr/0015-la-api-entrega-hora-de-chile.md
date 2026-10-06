# 0015. La API entrega hora de Chile, aunque diga «Z»

- **Estado:** aceptada
- **Origen:** 2.8.0 (`9154cac`), tras el enjambre contra la API real del 6-oct

**Contexto:** `fecha_cierre` llega sin zona («2026-10-08 09:00») y `fecha_ultimo_cambio` con «Z» («2026-10-06T15:05:00.583Z»). Hasta la 2.7.0 se leían como UTC.

**Decisión:**
- Todo valor de fecha de la API se lee como hora de pared de `America/Santiago`, tenga o no «Z». Solo un offset numérico explícito se respeta.
- Las ventanas de cambios se mandan como `cambio_desde`/`cambio_hasta` escritos como la API compara —la hora de Chile del instante, con «Z»—, nunca con `ttl_cambio_ms`.
- Las fechas que escribe el usuario respetan la zona que declaran, y se exige que la declaren.

**Evidencia (6-oct-2026, reloj verificado contra el SHOA):**
- 89 de 92 cierres caen en horario de oficina leídos como hora de Chile; leídos como UTC aparecían cierres a las 03:00, 05:00 y 07:00.
- A las 15:42 de Chile el cambio más reciente decía `15:40Z`.
- `ttl_cambio_ms` de 170 min devolvía 0 y de 240 min, 1.076 cambios: la API compara su marca local contra la hora UTC real.

**Por qué la 2.7.0 concluyó lo contrario:** su prueba suponía que el filtro `ttl_cambio_ms` compara bien las horas. La API comete el mismo error en el filtro, y con eso las dos hipótesis daban resultados idénticos. La misma corrida tenía señales en contra que se explicaron con supuestos ad hoc (una API «detenida» de noche, un cierre «vencido»).

**Lección:** una medición que pasa por el mismo componente que se quiere medir no puede desmentirlo. La evidencia que lo resolvió vino de fuera de ese circuito: la distribución de las horas y el reloj oficial.

**Efectos corregidos:** cierres mostrados 3 h antes (4 en invierno), radar que ocultaba los procesos de las 3 h siguientes, monitoreo de menos de 180 min siempre vacío, daemon que cubría 21 de 24 h.

**Dónde:** `src/utils/fechas.ts`, `src/tools/monitorear-cambios.ts`.
