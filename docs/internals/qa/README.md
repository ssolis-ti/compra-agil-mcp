# QA y plan de trabajo — punto de retome

Estado del proyecto hasta la versión 2.9.0, publicada el 9-oct-2026 (npm
`latest`, tag `v2.9.0` y release con la extensión `.mcpb`). Empieza aquí para
retomar el trabajo en una sesión local.

## Dónde quedamos

| Qué | Estado |
| :--- | :--- |
| Auditoría QA de la 2.6.1 | ✅ Hecha — [auditoria-2.6.1.md](auditoria-2.6.1.md) |
| Sprint 0 (bloqueantes para producción) | ✅ Hecho — [sprint-0.md](sprint-0.md) |
| PR #8 a #13 | ✅ Fusionados en `main` (6-oct) |
| Validación contra la API real | ✅ Etapa 1 de la 2.7.0 hecha (6-oct), sin bloqueantes; ⚠ su conclusión de que `fecha_cierre` es UTC resultó incorrecta (ver la fila del enjambre) — [resultado-api-real.md](resultado-api-real.md). Falta la etapa 2 (uso desde un cliente MCP) |
| Simulación de uso con 3 agentes (API simulada) | ✅ Dos corridas — [resultado-simulacion-agentes.md](resultado-simulacion-agentes.md): la primera halló S1–S9 (corregidos en los PR #9 y #10); la segunda no los reprodujo y halló S1b y S11–S18 (fase 1.9) |
| Enjambre de 4 agentes contra la API **real** (6-oct, 2.7.0) | ✅ Hecho — [resultado-enjambre-api-real.md](resultado-enjambre-api-real.md). **La API entrega hora de Chile, no UTC:** horas de cierre 3 h antes, radar que oculta los cierres de las próximas 3 h, monitoreo de menos de 180 min siempre vacío. Más E1–E11. Va como fase 1.10 |
| Fases 1.0, 1.1 y 1.8 (S1–S9) más S1b, S11 y S16 | ✅ Hechas — PR #9 a #13 |
| Versión 2.7.0 | ✅ Publicada en npm el 6-oct (`latest`); probada instalándola con `npx` desde una carpeta vacía. Tag `v2.7.0` y release en GitHub |
| Publicación automática en npm | ✅ `publicar.yml`: un tag `v*` publica (requiere el secreto `NPM_TOKEN`); si la versión ya se publicó a mano, solo crea la release |
| Versión 2.8.0 (cerrada) | ✅ Publicada en npm el 7-oct (`latest`), tag `v2.8.0` y release en GitHub — [Plan 2.8.0](roadmap.md#plan-280--versión-cerrada) completo (bloques A–H), validada contra la API real y con un segundo enjambre cuyos hallazgos se corrigieron. 🟡 Queda repetir en Claude Desktop el detalle y el informe de precios de la etapa 2 (el 7-oct la API respondió 504) |
| Versión 2.9.0 — vigilancia confiable y avisos | ✅ Cerrada el 9-oct ([especificación y estado](../specs/2.9.0-vigilancia-y-avisos/README.md), ADR 0021–0028). Probada en real con el dueño por la instalación del repositorio y por la extensión `.mcpb` (Telegram, Aysén); revisión de código con 10 hallazgos corregidos. Seguimiento: semana real completa (T10.3), correo con cuenta real (T6.3), tarea de Windows (T9.1), instalación por un agente desde cero (T10.2) |
| Segundo enjambre contra la API real (6-oct, 2.8.0) | ✅ [resultado](resultado-enjambre-api-real.md#validación-de-la-280-contra-la-api-real): hora confirmada en vivo, estadísticas verificadas a mano sobre datos reales, 0 fugas; F1–F10 corregidos |

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
npm test            # todos deben pasar (884 en la 2.9.0)
```

Después, en este orden:

1. **Seguimiento de la 2.9.0**, anotado en su [especificación](../specs/2.9.0-vigilancia-y-avisos/README.md):
   - semana real completa (T10.3);
   - correo con una cuenta real (T6.3);
   - tarea de Windows en el equipo del dueño (T9.1);
   - instalación por un agente desde cero (T10.2).
2. **Pendiente de la 2.8.0:** repetir en Claude Desktop el detalle y el informe de precios de la etapa 2 → [validacion-api-real.md](validacion-api-real.md).
3. **Una versión nueva** empieza por su especificación en `docs/internals/specs/` (como la 2.9.0) y se publica según la sección 6 de `CONTRIBUTING.md`. `npm publish` lo corre el dueño, porque su cuenta tiene verificación en dos pasos. El tag se empuja **después**: el flujo crea la release cuando la versión ya aparece en el registro, lo que tarda unos minutos.

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
