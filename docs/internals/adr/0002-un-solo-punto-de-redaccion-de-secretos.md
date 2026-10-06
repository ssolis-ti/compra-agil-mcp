# 0002. Un solo punto de redacción de secretos

- **Estado:** aceptada
- **Origen:** `docs/internals/decisiones.md` (julio 2026), borrado en `6be7402` y recuperado tal cual en la 2.8.0.

**Decisión:** todo texto que sale del proceso pasa por `redact()`, enganchado en
tres lugares: el logger, el error-handler y los `catch` de las tools. Además,
`CompraAgilClient` registra el ticket en su constructor, así cualquier consumidor
queda cubierto sin acordarse.

**Por qué:** auditar caso por caso cada ruta de error es una batalla perdida —
siempre aparece una nueva. Se verificó empíricamente que algunos errores de `fetch`
incluyen la URL completa:

```
TypeError: Failed to parse URL from http://host/x?ticket=SECRETO
```

Y el ticket viaja en la query string del endpoint legado `/servicios`. Peor:
`sendLoggingMessage` envía los logs **nativamente al cliente MCP**, o sea al
contexto del modelo y a la transcripción.

**Límite honesto:** protege la salida *del servidor*. No protege de un agente que
lea el `.env` directamente, ni de que alguien pegue el ticket en un chat.

**Dónde:** [`src/utils/redact.ts`](../../../src/utils/redact.ts)
