# QA y plan de trabajo — punto de retome

Estado del proyecto después de la auditoría QA de la 2.6.1, su Sprint 0 y la
versión 2.7.0 (octubre 2026). Empieza aquí para retomar el trabajo en una
sesión local.

## Dónde quedamos

| Qué | Estado |
| :--- | :--- |
| Auditoría QA de la 2.6.1 | ✅ Hecha — [auditoria-2.6.1.md](auditoria-2.6.1.md) |
| Sprint 0 (bloqueantes para producción) | ✅ Hecho — [sprint-0.md](sprint-0.md) |
| PR #8 a #13 | ✅ Fusionados en `main` (6-oct) |
| Validación contra la API real | ✅ Etapa 1 de la 2.7.0 hecha (6-oct), sin bloqueantes; `fecha_cierre` confirmada como UTC — [resultado-api-real.md](resultado-api-real.md). Falta la etapa 2 (uso desde un cliente MCP) |
| Simulación de uso con 3 agentes (API simulada) | ✅ Dos corridas — [resultado-simulacion-agentes.md](resultado-simulacion-agentes.md): la primera halló S1–S9 (corregidos en los PR #9 y #10); la segunda no los reprodujo y halló S1b y S11–S18 (fase 1.9) |
| Fases 1.0, 1.1 y 1.8 (S1–S9) más S1b, S11 y S16 | ✅ Hechas — PR #9 a #13 |
| Versión 2.7.0 | 🟡 En `main`; **sin publicar en npm** (npm sigue en la 2.5.0). Falta la validación real y el tag `v2.7.0` |
| Publicación automática en npm | 🟡 PR [#14](https://github.com/ssolis-ti/compra-agil-mcp/pull/14): `publicar.yml` publica al empujar un tag `v*`; requiere el secreto `NPM_TOKEN` |
| Resto del Sprint 1, fase 1.9 y Sprint 2 | ⏳ Pendientes — [roadmap.md](roadmap.md) |

Todo lo de la 2.7.0 se probó contra una API **simulada** con fallas
inyectadas: el entorno en la nube donde se hizo no tenía acceso a
`mercadopublico.cl` ni el ticket. Por eso lo primero en local es validar contra
la API real antes de publicar.

## Cómo retomar en local (Windows)

```powershell
cd C:\Users\P0zcl\Desktop\proyectos\mcp-compra-agil
git fetch origin
git checkout main
git pull
npm ci
npm run build
npm test            # todos deben pasar (458 en la 2.7.0)
```

Después, en este orden:

1. **Validar contra la API real** → [validacion-api-real.md](validacion-api-real.md). Si algo sale mal, se corrige en un PR antes de publicar.
2. **Publicar la 2.7.0** → fase 0 del [roadmap](roadmap.md) y la sección 6 de `CONTRIBUTING.md`.
3. **Sprint 1** → [roadmap.md](roadmap.md), fase por fase (quedan 1.2–1.7 y la 1.9).

## Banco de pruebas sin ticket

`scripts/qa/` reproduce la auditoría sin red ni ticket:

```powershell
npm run build
node scripts/qa/mock-api.mjs                 # terminal 1: API simulada con fallas
node scripts/qa/cliente-mcp.mjs              # terminal 2: 26 escenarios por protocolo MCP
```

`cliente-mcp.mjs` arranca `dist/index.js` por stdio, como Claude Desktop, y
termina con una tabla de tiempos y una verificación de que el ticket no se
filtró. Las fallas que inyecta la API simulada están documentadas al inicio de
`mock-api.mjs`. Variables útiles: `COMPRA_AGIL_TIMEOUT_MS=3000` (para que los
cuelgues se corten rápido) y `SNIP=0` (solo la tabla).

Con `QA_API_REAL=1` el mismo cliente apunta a la API real usando tu `.env`
(ver [validacion-api-real.md](validacion-api-real.md)).

### Simulación de uso con agentes

Para que varios agentes (o subagentes de Claude Code) usen el servidor como
lo haría un modelo, compartiendo una sola instancia:

```powershell
$env:CATALOGO = "sintetico"; $env:FALLA_DETALLE = "0.4"; $env:LATENCIA_MS = "400"
node scripts/qa/mock-api.mjs          # terminal 1: ~40 procesos sintéticos, 40 % de detalles con 504
node scripts/qa/puente-mcp.mjs        # terminal 2: puente HTTP en el puerto 8770
```

Los agentes leen `GET /contexto` (instrucciones y herramientas, lo mismo que ve
un modelo al conectar), llaman con `POST /llamar` y `GET /registro` devuelve
todas las llamadas con su tiempo. Con `QA_API_REAL=1` el puente usa la API
real y gasta cuota.

## Contexto que no está en el repositorio

- **graphify:** se usó para generar un grafo del proyecto (`.graphifyignore`, commit `39b44f6`). La salida, `graphify-out/`, está en `.gitignore` y solo existe en tu equipo. Sirve para contrastar la arquitectura antes del Sprint 1.
- **spec-kit:** no hay rastro en el repositorio ni en su historial (ni `.specify/`, ni `specs/`, ni comandos `/speckit`). Si se usó, fue solo en local: revisa si existen `.specify\`, `specs\` o `.claude\commands\speckit.*` en tu carpeta. Si existen, conviene subir las especificaciones para revisar cada función contra sus criterios de aceptación.
- **Bitácora de decisiones:** `docs/internals/decisiones.md` y `PENDIENTES.md` se borraron en `6be7402`. Se recuperan con `git show 6be7402^:docs/internals/decisiones.md`. El Sprint 2 propone reponerlas como ADRs.
