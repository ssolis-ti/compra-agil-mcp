# 0007. Los templates ordenan defensivamente

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** `renderRadarInforme` reordena su entrada aunque `recolectarDatosRadar`
ya la entregue rankeada.

**Por qué:** un gráfico "Top N" desordenado es un error **visible y silencioso**.
Ordenar es O(n log n) sobre decenas de filas — el costo es irrelevante frente al
riesgo. Un template no debe confiar en el orden de su entrada.

Este bug existió y lo delató la vista previa. Hay un test que lo bloquea.
