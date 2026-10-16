# 0032. Los documentos generados los revisa el usuario

- **Estado:** aceptada (16-oct-2026)
- **Origen:** 2.12.0 (G1–G3)

**Contexto:** generar la carta (`.docx`) y la planilla (`.xlsx`) ahorra trabajo. Pero una oferta mal armada puede quedar inadmisible, y es el proveedor quien responde por ella.

**Decisión:** los documentos se generan como borrador («BORRADOR» en el nombre y en el texto) hasta que el usuario marque la cotización como lista. Los datos que faltan van marcados a la vista («COMPLETAR»), nunca inventados. El servidor nunca envía nada al portal: la oferta la sube el usuario.

**Consecuencias:** un paso más para el usuario, a cambio de que ninguna oferta salga sin que la haya visto.
