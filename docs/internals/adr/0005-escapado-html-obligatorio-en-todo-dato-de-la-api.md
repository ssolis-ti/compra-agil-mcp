# 0005. Escapado HTML obligatorio en todo dato de la API

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** todo lo que venga de la API pasa por `esc()`.

**Por qué:** no es solo cosmético. En un HTML que el usuario abre en su navegador,
marcado no escapado es una **vulnerabilidad**. Los nombres de organismos traen `&`
con frecuencia (`"soporte & mantención"`) y romperían el documento.

Cubierto por tests, incluido el escapado **dentro del SVG** — que es fácil de olvidar.
