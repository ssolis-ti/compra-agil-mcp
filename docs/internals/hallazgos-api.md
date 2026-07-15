# Hallazgos: comportamiento real de la API

Medido el **15 de julio de 2026** contra `api2.mercadopublico.cl` con un ticket
válido. Muestra: **45 procesos y 52 cotizaciones** inspeccionados.

La [Guía oficial API Compra Ágil v2 (v3.0, mayo 2026)](../api/Documentacion_API_Compra_Agil.md)
difiere de la realidad en varios puntos. **Este documento gana sobre la guía**: lo
de abajo está medido, no prometido.

Reproducible con los scripts de `scripts/debug-*.ts`.

---

## 1. La API no publica adjudicaciones

El hallazgo de fondo, y el que más impacta al producto.

| La guía dice | La API hace |
| :--- | :--- |
| `estado=proveedor_seleccionado` es un filtro válido | Se acepta, pero devuelve **siempre 0 resultados** |
| `estado=oc_emitida` "está definido en el modelo" | **HTTP 400 — Parámetros de consulta inválidos** |
| `orden_compra.id_orden_compra` | El sub-objeto **no existe**; solo `id_orden_compra` en la raíz |
| `seleccion.{proveedor_seleccionado,motivo,criterio}` | **No existe** (la guía ya lo marcaba como "no confirmado") |
| `estado_cotizacion.{id,glosa}` | **No existe**; hay `estado` (número) |
| `proveedor_seleccionado: boolean` | Es un **número**: `0` \| `1` |

**Evidencia:**
```
procesos inspeccionados : 45
con cotizaciones        : 17
CON GANADOR (sel=1)     : 0
con id_orden_compra     : 0
valores proveedor_seleccionado : {"0": 52}    ← siempre 0, nunca 1
valores estado (cotización)    : {"3": 52}
```

**Consecuencia:** cualquier análisis basado en "el precio que ganó" está condenado
a no encontrar datos. Por eso `recomendar_precio_ganador` fue **eliminada** en
v2.0.0 y reemplazada por `analizar_precios_mercado`, que se apoya en precios
**cotizados**.

`verificar_orden_compra` reportará "sin OC" prácticamente siempre. Eso **no prueba**
que la OC no exista — solo que la API no la publica. La ficha pública
(`https://buscador.mercadopublico.cl/ficha?code={codigo}`) sí muestra información
que la API omite.

---

## 2. Qué estados funcionan

```
✅ publicada                total=  6814
✅ cerrada                  total= 10000   (parece un tope, no el total real)
✅ desierta                 total= 10000
✅ cancelada                total= 10000
⚠️  proveedor_seleccionado   total=     0   ← acepta el filtro, no devuelve nada
❌ oc_emitida               HTTP 400       ← ni siquiera es válido
❌ adjudicada / seleccionada HTTP 400      ← probados por si acaso; no existen
```

Los `10000` son sospechosamente redondos: probablemente un tope de resultados y no
el universo real.

---

## 3. Dónde viven los precios

**Solo los procesos `desierta` publican sus cotizaciones.** Contraintuitivo pero
consistente:

| búsqueda `q=reparacion` | procesos con cotizaciones | precios unitarios |
| :--- | :--- | :--- |
| `estado=desierta` | **5 / 8** | **20** |
| `estado=cerrada` | 0 / 8 | 0 |

En la muestra de `cerrada`, **20 de 20** procesos estaban en primer llamado
(`estado_convocatoria = 1`) y ninguno exponía cotizaciones. La guía (§5.2) dice que
el detalle se muestra "desde estado Cerrada en segundo llamado en adelante" — solo
2 de 45 procesos estaban en segundo llamado, muestra insuficiente para confirmarlo.

### Las cotizaciones inadmisibles hay que incluirlas

En los procesos desiertos **casi todas** las cotizaciones están declaradas
inadmisibles — es justamente lo que dejó desierto al proceso. Filtrarlas dejaba la
muestra **vacía**.

Se incluyen porque **un precio ofertado es señal de mercado aunque le hayan
rechazado el papeleo**. Los motivos reales observados son mayoritariamente
formales:

```
"Oferta no cumple con garantia solicitada"
"OFERENTE NO CUENTA CON GIRO ACORDE A LO SOLICITADO"
"DENTRO DE LA COTIZACIÓN NO SE SEÑALA EL PLAZO... NI LA GARANTÍA"
"por equivocacion del solicitante..."
"POR MERITO Y CONVENIENCIA INSTITUCIONAL"
"El valor ofertado sobrepasa el monto máximo disponible"   ← este SÍ es de precio
```

El último sesga la muestra hacia arriba. Por eso las tools reportan
`motivos_de_inadmisibilidad`: permite ponderar la muestra en vez de confiar a ciegas.

---

## 4. Restricciones de consulta

* **Las consultas sin filtros devuelven HTTP 500** (`ERROR_INTERNO`, *"Servicio no
  disponible"*). Hay que enviar al menos un filtro. Esto causaba que
  `verificar_ticket` fallara siempre.
* **Sin ningún parámetro** → HTTP 400 (`PARAMETROS_INVALIDOS`).
* **`tamano_pagina` mínimo es 10.** `1` y `5` → HTTP 400. Máximo 50. *El comentario
  original del código tenía razón; la guía no menciona ningún mínimo.*
* **La consulta más liviana** es `ttl_cambio_ms=3600000` (~1s). Es la que usa
  `verificar_ticket`.

### Latencia medida

| consulta | tiempo |
| :--- | :--- |
| `ttl_cambio_ms=3600000` | 1,2 s |
| `estado=publicada&tamano_pagina=10` | 5,9 s |
| `q=software&tamano_pagina=10` | 9,3 s |
| `estado=publicada&tamano_pagina=50` | **14,4 s** |

Relevante: `buscarTodo` con 3 páginas puede superar los **45 segundos**.

---

## 5. Envoltorios de respuesta

Hay **tres** formas distintas, y el `error-handler` debe tolerarlas:

```jsonc
// Éxito
{ "success": "OK", "trace": null, "payload": { ... }, "errors": null }

// Error de negocio
{ "success": "NOK", "payload": null, "errors": [{ "codigo": "400", "mensaje": "..." }] }

// Error interno — ojo: "ERROR", no "NOK"
{ "success": "ERROR", "payload": null, "errors": [{ "codigo": "ERROR_INTERNO", ... }] }

// Endpoint legado (OrdenCompra.json): payload en la raíz, sin envoltorio
{ "Cantidad": 1, "Listado": [ ... ] }
```

---

## 6. Forma real de `proveedores_cotizando[]`

Claves observadas (proceso `758-329-COT26`):

```
id_cotizacion, codigo_sucursal_empresa, codigo_empresa, es_emt, razon_social,
rut_proveedor, descripcion, fecha_vigencia, fecha_creacion, valor_neto,
total_impuesto, monto_despacho, monto_total, proveedor_seleccionado,
descripcion_cotizacion, productos_cotizados, estado, justificacion_inadmisibilidad,
estado_por_comprador, activo, id_oc, nombre_impuesto, porcentaje_impuesto
```

Notas:
* `id_oc` existe **a nivel de proveedor**, no solo del proceso. La guía no lo documenta así.
* `activo` y `estado_por_comprador` valieron `null` en toda la muestra: semántica desconocida.
* `productos_cotizados[].precio_unitario` **sí trae datos reales** (ej. `378150`).

---

## Cómo reproducir

```bash
npx tsx scripts/debug-api.ts          # parámetros, mínimos de paginación, latencia
npx tsx scripts/debug-estados.ts      # qué estados devuelven datos
npx tsx scripts/debug-cotizaciones.ts # busca procesos que expongan cotizaciones
npx tsx scripts/debug-ganadores.ts    # ¿existe algún adjudicado?
```

Los scripts **redactan su propia salida** (nunca imprimen el ticket) y dejan las
respuestas crudas en `debug/` —gitignored— para inspección humana.

Los hallazgos están blindados por tests en
[`test/quotation-realidad.test.ts`](../../test/quotation-realidad.test.ts): si alguien
"corrige" el código para volver a confiar en la guía oficial, la suite falla y explica
por qué.
