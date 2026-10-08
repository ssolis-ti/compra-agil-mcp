# Resultado: simulación de 24 h de la vigilancia (T10.1 de la 2.9.0)

`test/simulacion-24h.test.ts`, 7-oct-2026. Un día completo a tiempo
acelerado (unos 14 s), con el volumen por hora medido en la API real el lunes
6-oct-2026 ([medicion-ventanas.md](medicion-ventanas.md)), y encima un día
malo. Corre en cada `npm test`.

## Escenario

| Elemento | Detalle |
| :--- | :--- |
| Volumen | 2.739 procesos en 288 lotes de 5 min, con el reparto por hora medido (pico de 420 a las 16:00) |
| Lote grande | 160 procesos en un lote de las 16:15 (más de 10 páginas): se lee por región |
| 504 puntuales | 6 lotes de las 11:00, 5 veces cada uno |
| API caída | 2,5 h, de 14:00 a 16:30 (sobre el umbral de ceguera de 2 h) |
| Corrimientos | 23 procesos cambiaron de lote mientras se paginaba el suyo |
| Proceso muerto | La ronda de las 09:47 se colgó y se abandonó sin guardar |
| Telegram | Caído de 19:00 a 20:00, y un 429 con `retry_after` cada 7 envíos (506 procesos afectados) |
| Reinicios | Cada ronda carga el estado desde disco, como un proceso nuevo; 104 rondas, cada 15 min |

## Resultado

| Criterio (definición de cerrada) | Resultado |
| :--- | :--- |
| Procesos sin alerta | **0** de 2.739 |
| Alertas repetidas | **0** |
| Avisos perdidos | **0**: los 2.739 llegaron a Telegram |
| Lotes pendientes o incompletos al final | 0 y 0 |
| Avisos de ceguera / recuperación por la caída de 2,5 h | 1 y 1 |
| Latencia con la API sana (NF2: ≤ intervalo + 2 min + 5 min de lote) | máxima **12 min**, media 7,6 min (164 procesos sin fallas inyectadas, antes de las 09:30) |

## Lo que encontró

1. **El aviso de «canal caído» se repetía cada ronda cuando no había otro canal.** Con Telegram como único canal, el aviso de que Telegram falla no tiene quién lo lleve. Quedaba pendiente y salía otra vez en el log de cada ronda mientras duró la caída. Ahora, si ningún canal puede llevarlo, queda en el log una sola vez (`ronda.ts`, con un test en esta simulación).
2. **El umbral de ceguera es estricto, y está bien que lo sea.** Una caída de 2 h justas no avisa: la última revisión completa fue a las 13:47 y la primera de vuelta a las 16:02. Por eso la simulación usa 2,5 h. Si se quiere avisar antes, se baja `COMPRA_AGIL_AVISOS_CEGUERA_MIN`.
3. **Cómo se mide NF2.** La latencia se mide sin los procesos demorados a propósito (429, cambio de lote, la ronda que murió). Con ellos, la máxima es 42 min: un 429 pasa el aviso a la ronda siguiente (+15 min). Es el comportamiento esperado, no una pérdida.

## Lo que esta simulación no prueba

- **La API real.** El catálogo reproduce lo medido (lotes de 5 min, bordes incluidos), pero un cambio de comportamiento de la API no aparecería aquí. Para eso está la semana real (T10.3) y la alarma de marcas entre lotes del diseño §4.
- **Los canales reales.** Telegram, el correo y el webhook están probados contra servidores simulados; el envío real lo prueba el dueño (T4.4, T6.3).
