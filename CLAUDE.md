# mcp-compra-agil

Servidor MCP (TypeScript, stdio) para la API Compra Ágil v2 de Mercado Público
de Chile. Código y documentación en español.

## Retomar el trabajo

El estado del proyecto, lo hecho y lo pendiente está en
[`docs/internals/qa/README.md`](docs/internals/qa/README.md). Léelo antes de
proponer cambios: el siguiente paso es la validación contra la API real y
luego el Sprint 1 de [`docs/internals/qa/roadmap.md`](docs/internals/qa/roadmap.md).

## Comandos

```bash
npm ci && npm run build
npm test                          # vitest; incluye test/protocolo.test.ts, que arranca el servidor por stdio
npx tsc --noEmit
node scripts/qa/mock-api.mjs      # API simulada con fallas (sin ticket)
node scripts/qa/cliente-mcp.mjs   # escenarios por protocolo MCP contra ella
```

## Reglas del proyecto

- **El ticket nunca se muestra.** Vive en `.env` (`COMPRA_AGIL_TICKET`). `src/utils/redact.ts` lo borra de logs y respuestas, pero eso es la última defensa.
- **No disfrazar un fallo de la API como conclusión sobre el mercado.** Si una consulta falla, la herramienta lo dice; nunca «no hay datos».
- **Las respuestas de la API pasan por `src/api/normalizar.ts`**, y los errores por `CompraAgilApiError` con mensaje accionable.
- **Fechas:** sin zona = UTC (`parsearFechaApi` en `src/utils/fechas.ts`); se muestran en hora de Chile.
- **Cuota:** token bucket; el flujo completo de una oportunidad cuesta ~29 consultas. No lanzar pruebas en paralelo contra la API real sin presupuesto ([validacion-api-real.md](docs/internals/qa/validacion-api-real.md)).
- **Cada cambio:** test de regresión, `CHANGELOG.md` bajo `[Unreleased]`, commits convencionales en español explicando el porqué.
