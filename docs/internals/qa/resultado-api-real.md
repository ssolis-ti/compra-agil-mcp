# Resultado de la validación contra la API real

## Etapa 1 — Batería automática

5 de octubre de 2026, 21:50 hora de Chile. Rama `claude/great-bardeen-784fao`
(2.6.1 + Sprint 0), una sola instancia del servidor, desde Windows.

```
QA_API_REAL=1 node scripts/qa/cliente-mcp.mjs scripts/qa/escenarios-reales.mjs
```

| Escenario | Tiempo | Resultado |
| :--- | ---: | :--- |
| `verificar_ticket` | 10,1 s | ✅ |
| `verificar_hora_oficial` (SHOA) | 0,09 s | ✅ |
| búsqueda publicada RM | 11,9 s | ✅ |
| búsqueda por texto (`resmas`) | 27,0 s | ✅ |
| monitoreo 60 min | 1,3 s | ✅ |
| radar RM, 1 página | 10,4 s | ✅ |
| precios (3 históricos) | 48,8 s | ⚠ las 3 consultas de detalle: HTTP 504 |
| auditoría desiertas (2) | 29,5 s | ⚠ detalle `5627-283-COT26`: HTTP 504 |
| informe radar RM | 0,02 s | ✅ (desde caché) |
| estadísticas de uso | 0,002 s | ✅ |

**Consumo:** 10 consultas a la API, sin 429.

### Lo que se comprobó

- **El ticket no se filtró:** ningún `TICKETLEAK`; «Ticket en stderr: false» sobre 4.524 bytes de log.
- **Sin `forma inesperada`:** `src/api/normalizar.ts` contempló todas las respuestas reales de la batería.
- **Los dos errores son de la API, y se informan bien.** El endpoint de detalle devolvió 504 —la pasarela corta a los ~30 s, antes del timeout de 35 s—. Precios dice que **no** es una conclusión de mercado; auditoría nombra la llamada exacta y aclara que no hay parámetro que bajar. Es el mismo patrón observado en septiembre (1 de cada 3 detalles), esta vez peor (4 de 4).
- **La hora de cierre es coherente de punta a punta.** `1499-607-COT26`: la API entrega `2026-10-06 20:30` sin zona; el informe HTML imprime `06-10-2026 17:30 hora de Chile (20 h)` — UTC-3, horario de verano — con las horas restantes correctas respecto de la hora de la prueba.

### Lo que dice sobre el roadmap

- **Timeout de 35 s:** bien calibrado. Los 504 de la pasarela llegan antes (~29 s), y la búsqueda más lenta que sí respondió tardó 27 s. Bajarlo cortaría búsquedas legítimas.
- **La viabilidad de precios y auditoría depende del endpoint de detalle**, no del código. Ninguna fase del roadmap lo arregla; la caché es la única mitigación real.

### Pendiente

- **Etapa 2** (uso desde un cliente MCP): requiere registrar el servidor en Claude Desktop u otro cliente; hoy no está registrado en ninguno.
- **Oportunidad para cerrar la duda UTC / hora de Chile:** `1499-607-COT26` cierra a las 17:30 si `fecha_cierre` es UTC y a las 20:30 si es hora de Chile. Revisar su estado el 6 de octubre entre esas dos horas lo resuelve: si a las 18:00 ya no está `publicada`, es UTC.
