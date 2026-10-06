# Documentación interna del proyecto

Documentación de **ingeniería del servidor MCP**, no del mecanismo Compra Ágil.

> ⚠️ Esta carpeta está **excluida deliberadamente** del escaneo de documentación
> que hacen `consultar_documentos_locales` y el recurso
> `compra-agil://documentacion/{filename}`. Esas herramientas existen para
> consultar normativa y guías de Compra Ágil; las notas internas del proyecto
> serían ruido ahí. La exclusión vive en `EXCLUDED_DIRS` de
> [`src/utils/docs-locator.ts`](../../src/utils/docs-locator.ts) y está cubierta
> por tests — si alguien la quita, la suite falla.
>
> Los PDFs y guías de Compra Ágil van en `docs/api/` y `docs/guias/`.

## Contenido

| Documento | Para qué sirve |
| :--- | :--- |
| [qa/README.md](qa/README.md) | **Punto de retome:** auditoría QA de la 2.6.1, Sprint 0 hecho, roadmap de sprints pendientes y plan de validación contra la API real |
| [hallazgos-api.md](hallazgos-api.md) | Comportamiento **real** de la API medido empíricamente vs. lo que promete la documentación oficial |
