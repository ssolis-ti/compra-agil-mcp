# 0004. Informes autocontenidos, cero recursos externos

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** CSS inline, sin CDNs, sin fuentes remotas, sin scripts.

**Por qué:** el informe debe poder enviarse por correo y verse idéntico sin red.

Verificable: `grep -c "<script" informes/*.html` → `0`.
