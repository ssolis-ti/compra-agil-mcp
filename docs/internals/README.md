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
| [PENDIENTES.md](PENDIENTES.md) | Trabajo pendiente, priorizado, con contexto suficiente para retomarlo en frío |
| [hallazgos-api.md](hallazgos-api.md) | Comportamiento **real** de la API medido empíricamente vs. lo que promete la documentación oficial |
| [decisiones.md](decisiones.md) | Decisiones de arquitectura y por qué se tomaron |

## Convención

Estos documentos se escriben para **alguien que llega en frío** — incluido tú
mismo dentro de seis meses. Cada pendiente debe decir qué hay que hacer, por qué
importa y dónde tocar. Un pendiente que solo dice "mejorar X" no sirve.
