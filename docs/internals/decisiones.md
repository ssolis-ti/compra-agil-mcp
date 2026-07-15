# Decisiones de arquitectura

Por qué el código está como está. Si algo parece innecesariamente complicado, la
razón probablemente esté acá.

---

## 1. El HTML de los informes nunca vuelve al LLM

**Decisión:** `generar_informe` escribe el archivo en disco y devuelve **solo la
ruta** más un resumen de cinco líneas.

**Por qué:** un informe pesa ~20 KB. Devolverlo como texto consumiría miles de
tokens de contexto **por llamada**. Es la trampa clásica al construir tools que
generan documentos.

**Dónde:** [`src/reports/export.ts`](../../src/reports/export.ts)

---

## 2. Un solo punto de redacción de secretos

**Decisión:** todo texto que sale del proceso pasa por `redact()`, enganchado en
tres lugares: el logger, el error-handler y los `catch` de las tools. Además,
`CompraAgilClient` registra el ticket en su constructor, así cualquier consumidor
queda cubierto sin acordarse.

**Por qué:** auditar caso por caso cada ruta de error es una batalla perdida —
siempre aparece una nueva. Se verificó empíricamente que algunos errores de `fetch`
incluyen la URL completa:

```
TypeError: Failed to parse URL from http://host/x?ticket=SECRETO
```

Y el ticket viaja en la query string del endpoint legado `/servicios`. Peor:
`sendLoggingMessage` envía los logs **nativamente al cliente MCP**, o sea al
contexto del modelo y a la transcripción.

**Límite honesto:** protege la salida *del servidor*. No protege de un agente que
lea el `.env` directamente, ni de que alguien pegue el ticket en un chat.

**Dónde:** [`src/utils/redact.ts`](../../src/utils/redact.ts)

---

## 3. Gráficos en SVG generado a mano, sin librerías

**Decisión:** `barChartSVG()` emite SVG inline en ~60 líneas de TypeScript. Sin
Chart.js, sin D3.

**Por qué:** es vectorial (imprime nítido a cualquier DPI), no requiere JS
ejecutándose en el momento del print, y no añade dependencias ni peso. Para barras
simples, una librería de charting sería un mazo para una tachuela.

**Dónde:** [`src/reports/components.ts`](../../src/reports/components.ts)

---

## 4. Informes autocontenidos, cero recursos externos

**Decisión:** CSS inline, sin CDNs, sin fuentes remotas, sin scripts.

**Por qué:** el informe debe poder enviarse por correo y verse idéntico sin red.

Verificable: `grep -c "<script" informes/*.html` → `0`.

---

## 5. Escapado HTML obligatorio en todo dato de la API

**Decisión:** todo lo que venga de la API pasa por `esc()`.

**Por qué:** no es solo cosmético. En un HTML que el usuario abre en su navegador,
marcado no escapado es una **vulnerabilidad**. Los nombres de organismos traen `&`
con frecuencia (`"soporte & mantención"`) y romperían el documento.

Cubierto por tests, incluido el escapado **dentro del SVG** — que es fácil de olvidar.

---

## 6. Funciones puras de datos, separadas del formato

**Decisión:** `recolectarDatosRadar()`, `evaluarOportunidad()`, `esGanador()`,
`calcularEstadisticas()` son puras y no saben nada de MCP ni de HTML.

**Por qué doble:**
1. La tool JSON y el informe consumen **el mismo dataset** y no pueden divergir.
2. Se vuelven testeables sin levantar un servidor ni tocar la red.

Es el patrón a seguir al añadir cada plantilla nueva (ver
[PENDIENTES](PENDIENTES.md#3-completar-las-plantillas-de-informe)).

---

## 7. Los templates ordenan defensivamente

**Decisión:** `renderRadarInforme` reordena su entrada aunque `recolectarDatosRadar`
ya la entregue rankeada.

**Por qué:** un gráfico "Top N" desordenado es un error **visible y silencioso**.
Ordenar es O(n log n) sobre decenas de filas — el costo es irrelevante frente al
riesgo. Un template no debe confiar en el orden de su entrada.

Este bug existió y lo delató la vista previa. Hay un test que lo bloquea.

---

## 8. Percentil 25, no "5 % bajo el promedio"

**Decisión:** el precio sugerido es el p25 de la distribución cotizada.

**Por qué:** el promedio se descalabra con un solo valor atípico, y las muestras
reales los tienen (se observó un rango de $4.800 a $5.000.000 en una misma
búsqueda). El p25 ubica la oferta en el cuarto más económico sin regalar margen y
resiste los extremos.

Complementado con un **control de dispersión**: si el máximo supera 10× la mediana,
la tool advierte que el término mezcla productos distintos en vez de entregar un
número con falsa precisión.

---

## 9. `docs/internals/` excluido del escaneo RAG

**Decisión:** `EXCLUDED_DIRS` en el docs-locator saca esta carpeta de
`consultar_documentos_locales` y del recurso `compra-agil://documentacion/`.

**Por qué:** `docs/` es la fuente RAG del MCP y se escanea **recursivamente**
buscando `.md`. Sin la exclusión, este mismo archivo aparecería ante el LLM como si
fuera una guía de Compra Ágil. Esas herramientas existen para consultar normativa,
no las notas de ingeniería del proyecto.

**Dónde:** [`src/utils/docs-locator.ts`](../../src/utils/docs-locator.ts), cubierto
por tests.

---

## 10. El Oficio chileno se declara con dimensiones explícitas

**Decisión:** `@page { size: 216mm 330mm }` en vez de `size: legal`.

**Por qué:** el `legal` de CSS es el **US Legal: 216 × 356 mm**. El oficio/folio
chileno mide **216 × 330 mm**. Usar `legal` estiraría la hoja 26 mm y descuadraría
la caja de texto en cada impresión.

Hay un test de regresión explícito:
```ts
expect(PAPEL.oficio.size).not.toBe('legal');
```

---

## 11. Rate limiter proactivo, no solo reactivo

**Decisión:** `throttle()` espacia las solicitudes bajo un máximo por minuto
**antes** de enviarlas, además de reaccionar al 429.

**Por qué:** la versión previa solo contaba requests y reaccionaba *después* de
recibir un 429 — pero el CHANGELOG afirmaba "Token Bucket, 40 req/min". La
descripción no coincidía con el comportamiento. Se implementó el throttle real en
vez de corregir la documentación a la baja.
