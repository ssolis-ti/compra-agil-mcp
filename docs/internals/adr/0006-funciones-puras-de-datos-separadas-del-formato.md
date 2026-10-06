# 0006. Funciones puras de datos, separadas del formato

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** `recolectarDatosRadar()`, `evaluarOportunidad()`, `esGanador()`,
`calcularEstadisticas()` son puras y no saben nada de MCP ni de HTML.

**Por qué doble:**
1. La tool JSON y el informe consumen **el mismo dataset** y no pueden divergir.
2. Se vuelven testeables sin levantar un servidor ni tocar la red.

Es el patrón a seguir al añadir cada plantilla nueva (ver
[PENDIENTES](../qa/roadmap.md)).
