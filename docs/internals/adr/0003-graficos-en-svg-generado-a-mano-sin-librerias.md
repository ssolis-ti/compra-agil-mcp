# 0003. Gráficos en SVG generado a mano, sin librerías

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** `barChartSVG()` emite SVG inline en ~60 líneas de TypeScript. Sin
Chart.js, sin D3.

**Por qué:** es vectorial (imprime nítido a cualquier DPI), no requiere JS
ejecutándose en el momento del print, y no añade dependencias ni peso. Para barras
simples, una librería de charting sería un mazo para una tachuela.

**Dónde:** [`src/reports/components.ts`](../../../src/reports/components.ts)
