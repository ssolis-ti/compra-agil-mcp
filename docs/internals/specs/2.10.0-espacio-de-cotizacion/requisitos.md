# Requisitos — 2.10–2.12 Espacio de cotización

Forma EARS: **Cuando** (evento), **Mientras** (estado), **Si** (condición no
deseada), **Donde** (opción). Cada criterio tiene un identificador estable; si
cambia, se anota la fecha y el motivo debajo.

## Punto de partida (16-oct-2026)

- `descargar_y_leer_documento` lee solo PDF. El 43 % de los adjuntos no se lee ([medición](../../qa/medicion-formatos-adjuntos.md)).
- No hay dónde guardar el trabajo de una cotización: cada conversación parte de cero.
- `generar_borrador_cotizacion` devuelve JSON y una carta en texto; no un archivo que se pueda revisar y subir.
- Un rango de procesos (un mes de una región) son 20 llamadas de 10 filas (FALTA-001).
- Un solo ticket: si ChileCompra lo revoca o da 429, la instalación se detiene (MEJORA-006).

## Actores

- **Proveedor:** pyme que cotiza. No es técnico. Usa el agente en Claude Desktop, Hermes u otro cliente.
- **Modelo:** el LLM que usa las herramientas. Lee texto de terceros (adjuntos, nombres) que puede traer instrucciones.

## Historias

- **H1.** Como proveedor, quiero que el agente lea cualquier adjunto de la compra, sea PDF, Word o Excel, para no abrirlos uno por uno.
- **H2.** Como proveedor, quiero el conjunto de compras de un período en una planilla, para analizarlo.
- **H3.** Como proveedor, quiero que la instalación siga funcionando si un ticket falla.
- **H4.** Como proveedor, quiero una carpeta por cada compra que trabajo, con su estado, notas y archivos, que el agente retome en otra conversación.
- **H5.** Como proveedor, quiero una lista de lo que exige la compra (admisibilidad, plazos, garantías, multas, documentos) para no quedar fuera por un detalle.
- **H6.** Como proveedor, quiero cargar mi lista de precios una vez y que se cruce con lo que pide cada compra.
- **H7.** Como proveedor, quiero la carta y la planilla de la oferta en Word y Excel, listas para revisar y subir.
- **H8.** Como proveedor, quiero saber qué gané y qué perdí, y a qué precio, para cotizar mejor la próxima vez.

---

## L — Lectura multiformato (H1) · 2.10.0

- **L1** Cuando el adjunto sea `.docx`, el sistema deberá extraer su texto, incluidas las tablas, una fila por línea con las celdas separadas por « | ».
- **L2** Cuando sea `.doc` (Word 97-2003), deberá extraer su texto.
- **L3** Cuando sea `.xlsx` o `.csv`, deberá entregar cada hoja como tabla de texto (cabecera y filas), con el nombre de la hoja.
- **L4** Cuando sea `.zip`, deberá listar su contenido y leer los archivos de formatos soportados, como si fueran adjuntos.
- **L5** Si el formato no se puede leer (imagen, `.xls` antiguo, otro), deberá decir el formato y entregar la ficha, sin tratarlo como error del servidor.
- **L6** El formato se deberá reconocer por el contenido (firma del archivo), no solo por la extensión del nombre.
- **L7** `query`, `max_caracteres` y `desde_caracter` (2.9.3) deberán funcionar igual en todos los formatos.
- **L8** El texto extraído se deberá guardar en una caché por id de adjunto, para no descargar ni extraer dos veces el mismo archivo en 24 h.

## E — Exportar un rango (H2) · 2.10.0 · FALTA-001

- **E1** Cuando se llame a `exportar_procesos` con los filtros de `buscar_compras_agiles`, el sistema deberá paginar por dentro (10 por página), con el limitador de cuota y la caché.
- **E2** Deberá escribir el conjunto en la carpeta de datos (`exportaciones/`), en `csv`, `xlsx` o `json`, y devolver la ruta y agregados (cantidad, monto total, mediana, por organismo y por región), no las filas.
- **E3** Si la primera página indica más páginas que `max_paginas` (por defecto 20, tope 50), deberá decirlo antes de seguir y exportar solo hasta el tope, marcado como truncado.
- **E4** Si una página falla a mitad, deberá exportar lo leído, marcado como parcial, y decir desde qué página falta.
- **E5** La respuesta deberá informar las consultas a la API que gastó.

## T — Varios tickets con rotación (H3) · 2.10.0 · MEJORA-006

- **T1** Donde `COMPRA_AGIL_TICKETS` tenga varios tickets separados por coma, el sistema deberá repartir las consultas entre los activos, en turno. `COMPRA_AGIL_TICKET` sigue valiendo como el primero.
- **T2** La cuota y el 429 se deberán llevar por ticket, con la clave de cada uno guardada como hash, nunca el ticket.
- **T3** Si un ticket recibe 401 o 403, el sistema deberá marcarlo rechazado, avisarlo una vez y no volver a usarlo en la sesión.
- **T4** Si un ticket recibe 429, deberá saltarlo hasta que pase su espera y seguir con los otros. Solo si todos están limitados deberá esperar, como hoy.
- **T5** `verificar_ticket`, `obtener_estadisticas_uso` y `--check` deberán mostrar cada ticket enmascarado con su estado y su consumo.
- **T6** La documentación deberá advertir que repartir carga entre tickets de distintas personas para multiplicar la cuota puede ir contra los términos de ChileCompra.

## C — Espacio de cotización (H4) · 2.11.0

- **C1** Cuando se llame a `cotizacion_abrir` con un código, el sistema deberá crear su carpeta, guardar la ficha y descargar y extraer todos sus adjuntos. Si ya existe, deberá devolverla sin repetir el trabajo.
- **C2** Cada cotización deberá tener estado: `evaluando`, `preparando`, `enviada`, `ganada`, `perdida`, `desierta` o `descartada`.
- **C3** `cotizacion_listar` deberá devolver las cotizaciones abiertas, ordenadas por cierre, con estado, monto, días al cierre y un aviso si cierra en menos de 24 h.
- **C4** `cotizacion_actualizar` deberá cambiar el estado, agregar una nota con fecha o registrar el resultado (precio ofertado, ganador si se conoce).
- **C5** Cada cotización deberá ser un recurso MCP (`compra-agil://cotizacion/{codigo}`) con su resumen, para retomarla sin consultar la API.
- **C6** El usuario deberá poder agregar sus propios archivos a la carpeta `propios/` (por ruta local que él indique, nunca por URL que venga de un adjunto), y el agente deberá poder leerlos con las mismas reglas de L.

## Q — Requisitos y recordatorio (H5) · 2.11.0

- **Q1** Cuando se llame a `requisitos_de_la_compra`, el sistema deberá armar, desde los adjuntos y la ficha, una lista de verificación por tema: admisibilidad, documentos a adjuntar, plazo de entrega, garantía, multas, forma de pago, visita a terreno y criterios de evaluación.
- **Q2** Cada punto deberá citar el texto de origen (archivo y fragmento), para que el usuario lo verifique.
- **Q3** Si un tema no aparece en ningún adjunto, la lista deberá decir «no se encontró», no omitirlo.
- **Q4** La lista se deberá guardar en la cotización y se deberá poder marcar cada punto como cumplido.
- **Q5** Mientras una cotización esté en `preparando` y su cierre sea en menos de 24 h, la vigilancia deberá avisar una vez por los canales configurados.

## P — Precios propios (H6) · 2.12.0

- **P1** Cuando el usuario cargue una lista de precios (`.xlsx` o `.csv`), el sistema deberá reconocer las columnas de producto, precio y unidad, y guardarla en la carpeta de datos.
- **P2** Para una cotización, deberá cruzar cada producto pedido con la lista (sin tildes ni mayúsculas, por palabras), y decir cuáles tienen precio propio, cuáles no, y con qué confianza.
- **P3** Deberá mostrar, junto al precio propio, el precio de mercado de `analizar_precios_mercado` cuando exista.

## G — Documentos generados (H7) · 2.12.0

- **G1** `generar_cotizacion` deberá escribir en `salida/` una planilla `.xlsx` (ítems, cantidad, precio unitario, neto, IVA, total) y una carta `.docx`, con los datos de la cotización.
- **G2** Los documentos se deberán marcar como borrador hasta que el usuario lo cambie, y la respuesta deberá recordar revisarlos. El servidor nunca los envía al portal.
- **G3** Si faltan datos (RUT, razón social, precio), el documento deberá dejarlos marcados a la vista, no inventarlos.

## H — Historial (H8) · 2.12.0

- **H1** Cuando una cotización se marque `ganada` o `perdida`, el sistema deberá guardar el precio ofertado y, si el usuario lo sabe, el del ganador.
- **H2** `cotizacion_historial` deberá resumir por rubro: tasa de adjudicación, precio ofertado promedio y diferencia con el ganador.

---

## No funcionales

- **N1** Sin módulos nativos: todo en JavaScript o WebAssembly, para que la extensión corra con el Node de Claude Desktop (lección de la 2.9.0).
- **N2** Todo queda en la carpeta de datos del usuario. Nada sale del equipo salvo las consultas a Mercado Público.
- **N3** Una cotización con 6 adjuntos se abre en menos de 60 s con el portal sano.
- **N4** Textos para el usuario simples, sin jerga (pedido del 10-oct).

## Seguridad

- **S1** El texto de cualquier adjunto o archivo propio se entrega marcado como datos de terceros, no instrucciones.
- **S2** Nunca se ejecutan macros, scripts ni fórmulas: solo se lee el valor guardado de cada celda.
- **S3** Límites: 20 MB por archivo; en un ZIP, 50 archivos y 100 MB descomprimidos como máximo, y sin ZIP dentro de ZIP.
- **S4** Los nombres de archivo se sanean: ninguna ruta puede escribir fuera de la carpeta de la cotización.
- **S5** Los archivos propios solo se leen desde rutas que el usuario indicó, dentro de su carpeta de usuario.

## Fuera de alcance

- OCR de imágenes y PDF escaneados: pesa cientos de MB.
- `.xls` antiguo (1 % de la muestra) y `.odt`/`.ods`.
- Enviar la oferta al portal: siempre la sube el usuario.
- Sincronizar cotizaciones entre equipos.
