# 0001. El HTML de los informes nunca vuelve al LLM

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** `generar_informe` escribe el archivo en disco y devuelve **solo la
ruta** más un resumen de cinco líneas.

**Por qué:** un informe pesa ~20 KB. Devolverlo como texto consumiría miles de
tokens de contexto **por llamada**. Es la trampa clásica al construir tools que
generan documentos.

**Dónde:** [`src/reports/export.ts`](../../../src/reports/export.ts)
