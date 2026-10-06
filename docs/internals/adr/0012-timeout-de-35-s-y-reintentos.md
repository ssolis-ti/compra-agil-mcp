# 0012. Timeout de 35 s y reintentar solo fallos de red

- **Estado:** aceptada
- **Origen:** Sprint 0 (octubre 2026, `c8a3739`)

**Contexto:** una API que no respondía colgaba la herramienta: se midieron 150 s sin respuesta, más que los 60 s que espera un cliente MCP.

**Decisión:**
- Tiempo límite de **35 s** por consulta (`COMPRA_AGIL_TIMEOUT_MS`).
- **No** se reintenta un timeout ni un 5xx; **sí** una vez un fallo de red.

**Por qué:**
- La pasarela de Mercado Público corta a ~30 s con un 504 que el servidor ya explica, y hay consultas legítimas de 20–30 s. El timeout solo corta lo que la pasarela no cortó.
- Tras un timeout o un 5xx la pasarela ya esperó ~30 s: repetir pasa los 60 s del cliente y gasta cuota.
- Un fallo de red es inmediato y suele ser transitorio: el segundo intento es barato.

**Validado:** contra la API real el 5-oct, los 504 llegaron a ~29 s y la búsqueda más lenta que respondió tardó 27 s.

**Dónde:** `src/api/compra-agil-client.ts`.
