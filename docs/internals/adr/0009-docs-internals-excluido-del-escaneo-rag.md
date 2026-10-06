# 0009. `docs/internals/` excluido del escaneo RAG

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** `EXCLUDED_DIRS` en el docs-locator saca esta carpeta de
`consultar_documentos_locales` y del recurso `compra-agil://documentacion/`.

**Por qué:** `docs/` es la fuente RAG del MCP y se escanea **recursivamente**
buscando `.md`. Sin la exclusión, este mismo archivo aparecería ante el LLM como si
fuera una guía de Compra Ágil. Esas herramientas existen para consultar normativa,
no las notas de ingeniería del proyecto.

**Dónde:** [`src/utils/docs-locator.ts`](../../../src/utils/docs-locator.ts), cubierto
por tests.
