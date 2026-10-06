# mcp-compra-agil

Servidor MCP (TypeScript, stdio) para la API Compra Ágil v2 de Mercado Público
de Chile. Código y documentación en español.

**Si solo vas a instalar o usar el servidor**, sigue la sección «Instalación»
del [README](README.md) y no necesitas nada más de este archivo: lo que sigue
es para desarrollar el servidor. `docs/internals/` y `scripts/qa/` son
herramientas de ingeniería, no hacen falta para usarlo.

## Retomar el trabajo

El estado del proyecto, lo hecho y lo pendiente está en
[`docs/internals/qa/README.md`](docs/internals/qa/README.md). Léelo antes de
proponer cambios: la 2.8.0 está lista en `main` y falta publicarla (ver «Plan 2.8.0» en [`docs/internals/qa/roadmap.md`](docs/internals/qa/roadmap.md)). Las decisiones de arquitectura y su porqué están en [`docs/internals/adr/`](docs/internals/adr/README.md).

## Comandos

```bash
npm ci && npm run build
npm test                          # vitest; incluye test/protocolo.test.ts, que arranca el servidor por stdio
npm run test:coverage             # con umbral: global >= 75 %, cada herramienta >= 80 %
npm run lint                      # ESLint con no-floating-promises
npx tsc --noEmit
node scripts/qa/mock-api.mjs      # API simulada con fallas (sin ticket)
node scripts/qa/cliente-mcp.mjs   # escenarios por protocolo MCP contra ella
```

## Reglas del proyecto

- **El ticket nunca se muestra.** Vive en `.env` (`COMPRA_AGIL_TICKET`). `src/utils/redact.ts` lo borra de logs y respuestas, pero eso es la última defensa.
- **No disfrazar un fallo de la API como conclusión sobre el mercado.** Si una consulta falla, la herramienta lo dice; nunca «no hay datos».
- **Las respuestas de la API pasan por `src/api/normalizar.ts`**, y los errores por `CompraAgilApiError` con mensaje accionable.
- **Fechas:** la API entrega hora de Chile, con o sin "Z" (`parsearFechaApi` en `src/utils/fechas.ts`; medido el 6-oct-2026). Las ventanas de cambios se mandan con `aFormatoApi`, nunca con `ttl_cambio_ms`. "Ahora" es `ahora()` de `src/utils/reloj.ts`, corregido contra el SHOA, no `Date.now()`.
- **Cuota:** token bucket; el flujo completo de una oportunidad cuesta ~29 consultas. No lanzar pruebas en paralelo contra la API real sin presupuesto ([validacion-api-real.md](docs/internals/qa/validacion-api-real.md)).
- **Errores de validación:** un solo formato, `Error de validación: … No se consultó la API.` (`src/utils/validacion.ts`). Una herramienta nueva lo hereda: no armes el texto a mano.
- **Construcción vs arranque:** `src/servidor.ts` arma el servidor y es lo que se prueba en proceso (`test/servidor-en-proceso.test.ts`); `src/index.ts` solo lee el entorno y conecta stdio.
- **Cada cambio:** test de regresión, `CHANGELOG.md` bajo `[Unreleased]`, commits convencionales en español explicando el porqué.
