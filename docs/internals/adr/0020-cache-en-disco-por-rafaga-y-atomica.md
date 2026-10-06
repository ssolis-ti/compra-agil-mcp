# 0020. La caché se escribe por ráfaga y de forma atómica

- **Estado:** aceptada
- **Origen:** 2.8.0 (fase 1.2, `38f8684`)

**Contexto:** cada respuesta reescribía el JSON entero de la caché —hasta 500 entradas— con una escritura síncrona; una tanda de 20 detalles eran 20 escrituras que bloqueaban el proceso, y un corte a mitad podía dejar el archivo ilegible.

**Decisión:** las escrituras de una ráfaga se agrupan en una, ~1 s después de la última respuesta, a un archivo temporal que luego se renombra. Lo pendiente se escribe al cerrar el proceso.

**Lo que no se cambió:** el estado de cuota (`.rate-limit-state.json`) se sigue escribiendo al instante y con lock: es pequeño, lo comparten varios procesos y tiene que estar al día.

**Dónde:** `src/utils/cache.ts`.
