# Validación contra la API real

Lo único del Sprint 0 que falta comprobar. Se hace en local, donde la red llega
a `mercadopublico.cl` y el ticket está en `.env`.

## Antes de empezar: la cuota

La cuota del ticket se comporta como un *token bucket*: medido, un 429 se
recuperó en ~13 minutos. Evaluar una oportunidad con el flujo completo costaba
~29 consultas. Varias sesiones o subagentes golpeando la API a la vez con el
mismo ticket la agotan en minutos, y la prueba termina midiendo el 429 en vez
del servidor.

Reglas:
- **Una sola instancia del servidor** para todas las pruebas: comparte caché, freno y limitador, como en uso real.
- **Presupuesto total ≤ 60 consultas** por sesión de pruebas. Revisar `obtener_estadisticas_uso` entre etapas.
- Si aparece un 429, **parar** y anotar la hora; no reintentar en ráfaga.

## Etapa 1 — Batería automática (~15–25 consultas)

```powershell
npm run build
$env:QA_API_REAL = "1"
node scripts/qa/cliente-mcp.mjs scripts/qa/escenarios-reales.mjs
Remove-Item Env:QA_API_REAL
```

Corre en la raíz del proyecto y usa el `COMPRA_AGIL_TICKET` de `.env` (el
cliente lo lee solo para detectar fugas; nunca lo imprime).

**Qué mirar:**

| Escenario | Esperado |
| :--- | :--- |
| `verificar_ticket` | Válido, muestra solo `••••` + 4 últimos |
| `verificar_hora_oficial` | Desfase pequeño con el SHOA (si falla por UDP 123 bloqueado, lo dice) |
| Búsquedas | Sin `forma inesperada`: si aparece, la API trae algo que `src/api/normalizar.ts` no contempla → anotar el campo |
| Radar e informe | El cierre del HTML coincide con `fecha_cierre_hora_chile` del JSON y con la ficha del portal |
| Precios y auditoría | Tiempos < 60 s; si hay 504, el mensaje nombra la llamada |
| Resumen final | `TICKETLEAK` nunca aparece; «Ticket en stderr: false» |

Anota la tabla de tiempos del resumen: es el dato para calibrar el timeout de
35 s y el presupuesto de la fase 1.1 del [roadmap](roadmap.md).

## Etapa 2 — Uso real desde el cliente MCP

En Claude Desktop (o el cliente que uses), con el servidor compilado de la rama:

1. «Busca compras ágiles publicadas en la Región Metropolitana sobre resmas de papel.»
2. «Dame el detalle de la primera» → comparar con la ficha en `buscador.mercadopublico.cl`.
3. «Analiza precios de mercado para ese producto» y «genera el informe de precio en formato oficio».
4. «Guarda un informe del radar en la carpeta `radar/octubre`» → debe quedar en `informes/radar/octubre/`.
5. «Guarda el informe en C:\Windows» → debe rechazarlo explicando `COMPRA_AGIL_INFORMES_DIR`.

## Etapa 3 — Simulación con subagentes (opcional)

Con una sesión local de Claude Code en la carpeta del proyecto, este prompt
lanza la simulación respetando la cuota:

> Lee `docs/internals/qa/validacion-api-real.md` y `docs/internals/qa/roadmap.md`.
> Compila (`npm run build`) y lanza **una** instancia del servidor MCP de este
> proyecto contra la API real, usando el ticket de `.env` sin mostrarlo nunca.
> Simula uso real con 3 subagentes que comparten esa instancia, cada uno con un
> presupuesto máximo de 15 consultas a la API:
> 1. **Proveedor pyme:** busca oportunidades en su región y rubro, revisa el radar y genera un borrador de cotización.
> 2. **Analista de precios:** analiza precios de mercado de 2 productos y genera el informe de precio.
> 3. **Auditor:** audita compras desiertas de un rubro y genera el informe de competencia de un proceso.
>
> Primero en secuencia; después los tres a la vez durante una ronda corta, para
> observar el limitador de concurrencia y el freno de 15/min. Revisa
> `obtener_estadisticas_uso` entre rondas y detente ante el primer 429.
> Entrega un informe en `docs/internals/qa/resultado-api-real.md` con: latencia
> por herramienta, aciertos de caché, 504/429/timeouts, respuestas con «forma
> inesperada», calidad y coherencia de las respuestas (fechas en hora de Chile,
> montos, avisos de cobertura), si el timeout de 35 s está bien calibrado, y qué
> cambia en las prioridades del roadmap. No modifiques código sin preguntarme.
