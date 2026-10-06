# 0013. Normalizar las respuestas sin inventar datos

- **Estado:** aceptada
- **Origen:** Sprint 0 (`a7034e4`); tipos honestos en la 2.8.0 (fase 1.4)

**Contexto:** un listado con `montos: null` hizo caer `buscar_compras_agiles` con «Cannot read properties of null». Parchear cada acceso no escala.

**Decisión:**
- Toda respuesta pasa por `api/normalizar.ts`: los sub-objetos ausentes pasan a `{}`, las listas a `[]`, y solo los textos que el código manipula se vuelven `''`. **Ningún número se inventa**: un presupuesto ausente queda ausente, no en 0.
- Un listado sin `items` es una respuesta inválida, no «sin resultados».
- Cuando la API no responde, el error lleva una `causa` (`timeout`, `red`…) en vez de un HTTP inventado (408, 0).
- Desde la 2.8.0, los tipos declaran obligatorio solo lo que el normalizador garantiza.

**Por qué:** un 0 inventado se leería como dato, y leer un listado roto como vacío es disfrazar un fallo de la API como conclusión sobre el mercado. Un status falso se confundiría con algo que dijo la API. Con los tipos honestos el compilador destapó un `NaN` real en el borrador.

**Dónde:** `src/api/normalizar.ts`, `src/api/compra-agil-client.ts`.
