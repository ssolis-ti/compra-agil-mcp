# 0018. Los comparables de precios son procesos desiertos

- **Estado:** aceptada
- **Origen:** 2.0.0 (medición); declarado en la 2.8.0 (E3)

**Contexto:** el análisis de precios, la auditoría y el borrador buscan procesos parecidos para obtener precios cotizados.

**Decisión:** se buscan solo procesos `desierta`.

**Por qué:** son los únicos que publican sus cotizaciones. Medido contra la API real: 5 de 8 desiertos traían cotizaciones, 0 de 8 cerrados. Sumar cerrados solo gastaría cuota.

**Consecuencia declarada:** la muestra se inclina hacia compras que también fracasaron, y muchas cotizaciones son inadmisibles por papeleo. Por eso las herramientas incluyen las inadmisibles (el precio ofertado sigue siendo señal), muestran sus motivos, y la nota metodológica lo dice. Hasta la 2.8.0 la nota afirmaba «cerrado o desierto», que no era cierto.

**Dónde:** `src/tools/analizar-precios-mercado.ts`, `src/tools/auditar-desiertas.ts`, `src/tools/generar-borrador.ts`.
