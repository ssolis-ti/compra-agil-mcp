# Diseño — 2.10–2.12 Espacio de cotización

## 1. Capas y módulos nuevos

Se respeta la regla de capas del test de arquitectura: `tools/` → `servicios`
y `api/`; el núcleo nuevo (`documentos/`, `cotizacion/`) no importa `tools/`
ni toca `process.env`.

```
src/
  documentos/                 ← 2.10 · lectura y escritura de archivos (puro)
    formato.ts                  detectar el formato por firma (L6)
    leer.ts                     leerDocumento(buffer, nombre) → { formato, texto, hojas? } | { noSoportado }
    lectores/pdf.ts docx.ts doc.ts xlsx.ts csv.ts zip.ts
    escribir/xlsx.ts docx.ts    ← 2.12
    limites.ts                  S3: tamaños, cantidad de archivos en ZIP
  api/
    adjuntos.ts                 (2.9.2) listar y descargar del portal
    tickets.ts                ← 2.10 · rotación (T1–T4)
  cotizacion/                 ← 2.11 · el espacio de trabajo (puro sobre disco)
    almacen.ts                  carpeta por código, índice, escritura atómica
    requisitos.ts               lista de verificación (Q1–Q4)
    precios-propios.ts        ← 2.12 · lista del usuario y cruce (P1–P3)
    historial.ts              ← 2.12
  tools/
    documentos.ts               descargar_y_leer_documento usa documentos/leer.ts
    exportar.ts               ← 2.10 · exportar_procesos
    cotizacion.ts             ← 2.11 · abrir, listar, actualizar, requisitos, generar
  resources/cotizacion.ts     ← 2.11 · compra-agil://cotizacion/{codigo}
```

## 2. Librerías (ADR 0029)

| Necesidad | Elección | Por qué |
| :--- | :--- | :--- |
| `.docx` → texto y tablas | `mammoth` (BSD-2), `convertToHtml` + aplanado de tablas | JavaScript puro; mantenida |
| `.doc` → texto | `word-extractor` (MIT) | JavaScript puro; formato OLE |
| `.zip` y el interior de `.xlsx`/`.docx` | `fflate` (MIT, sin dependencias) | Pequeña, rápida y con límites manejables |
| `.xlsx` → tablas | Lector propio sobre `fflate`: `sharedStrings.xml` + `sheetN.xml` | `exceljs` arrastra 9 dependencias y está sin actualizar desde 2024; `xlsx` (SheetJS) en npm tiene vulnerabilidades sin parche. Solo se leen valores, nunca fórmulas (S2) |
| `.csv` | Lector propio: detecta `;` o `,`, comillas y BOM | Sin dependencias |
| `.xlsx` de salida | Escritor propio sobre `fflate` (una hoja, estilos mínimos) | Sin dependencias |
| `.docx` de salida | `docx` (MIT), versión fijada con ≥ 2 semanas de antigüedad | Generar Word a mano es frágil |

Las versiones se fijan exactas en `package.json`. Ninguna trae `.node`: el
test `arranque-sin-nativos` se amplía a cargar `documentos/`.

## 3. Lectura (2.10)

```
descargar_y_leer_documento
  └─ api/adjuntos: listar → elegir → descargar (de a uno; 2.9.2)
       └─ caché del texto por id (L8)  ──► si está, se usa
       └─ documentos/leer(buffer, nombre)
            formato.ts: %PDF / PK (zip: docx | xlsx | zip) / D0CF11E0 (OLE: doc | xls) / texto
            → lector del formato → texto plano
       └─ tramosConTermino / desde_caracter (2.9.3), igual para todos
```

- **Tablas de Word y Excel** se aplanan a «celda | celda | celda»: así `query` y `tramosConTermino` las tratan como texto, y el modelo las lee en orden.
- **ZIP:** se listan sus entradas; se leen las de formatos soportados, en orden, hasta los límites de S3. Cada una lleva su nombre como encabezado.
- **Caché del texto:** `datos/adjuntos/<id>.txt` con 24 h de vida. Un TDR se descarga una vez aunque el agente lo consulte diez veces.

## 4. Exportar (2.10)

`exportar_procesos` pagina por su cuenta (10 por página, con el limitador y la
caché) para poder cortar en la página que falla (E4). Escribe
`datos/exportaciones/procesos-AAAAMMDD-HHMM.{csv|xlsx|json}` y devuelve
agregados, no las filas. Las columnas son los campos de `buscar_compras_agiles`,
con las fechas en hora de Chile.

**Tiempo (E6).** Una herramienta tiene 45 s y una página tarda hasta ~8 s
(Hermes midió 154 s para 20). La exportación corre como trabajo en segundo
plano (`fueraDeLaHerramienta`), identificado por sus filtros. La herramienta
espera hasta 35 s: si terminó, entrega el resultado; si no, el avance y la
indicación de volver a llamarla igual. Un trabajo terminado se guarda 1 h; uno
en curso no se lanza dos veces.

## 5. Tickets (2.10, ADR 0031)

```
api/tickets.ts
  ticketsDelEntorno(env)      // COMPRA_AGIL_TICKET primero, luego COMPRA_AGIL_TICKETS
  class Tickets {
    elegir(excepto)           // el activo de menor espera; a igual espera, por turno
    hayOtro(excepto)          // ¿queda uno utilizable para reintentar?
    rechazar(ticket, http)    // 401/403: fuera hasta reiniciar
    estado()                  // [{ ticket: '••••12DC', estado, consultas_hoy, limitado_hasta }]
  }
```

- **Un limitador por ticket:** su freno por minuto, su 429 y su conteo del día. Se guarda en `.rate-limit-state-<sha256(ticket)[0:16]>.json`; el archivo anterior (`.rate-limit-state.json`) se copia al primer ticket una vez. Un archivo por ticket, y no uno con todos, para no cambiar el formato que ya lee `RateLimiter` ni su candado.
- **Reintento:** un 429, 401 o 403 reintenta la misma consulta con otro ticket utilizable. Un 5xx o un timeout no (como hoy).
- **Con un solo ticket** un 401 no lo marca rechazado: se informa como siempre en cada llamada.
- El **limitador de concurrencia** sigue siendo uno solo y compartido.
- `CompraAgilClient` recibe `string | string[] | Tickets`.

## 6. Espacio de cotización (2.11, ADR 0030)

```
datos/cotizaciones/
  indice.json                         ← { codigo: { estado, nombre, cierreUtc, monto, actualizada } }
  <codigo>/
    cotizacion.json                   ← estado, notas[], resultado, requisitos[], items[]
    ficha.json                        ← detalle normalizado al abrirla
    adjuntos/<nombre>.<ext> + .txt    ← original y texto extraído
    propios/                          ← archivos del usuario
    salida/                           ← documentos generados (2.12)
```

- **Archivos JSON con escritura atómica y candado** (`utils/archivo-atomico`, `utils/bloqueo`), como la vigilancia. Una pyme maneja decenas de cotizaciones al año. Si algún día son miles, se cambia el almacén sin tocar las herramientas.
- El **código** se valida con `esquemaCodigoCompra` antes de usarlo como nombre de carpeta (S4). Los nombres de adjuntos se sanean: solo letras, números, `-`, `_` y `.`, y sin `..`.
- **Recordatorio de cierre (Q5):** la ronda de vigilancia lee `indice.json` y genera una notificación `cierre_proximo` por cotización en `preparando` con cierre en menos de 24 h. Clave estable: no se repite.

## 7. Requisitos (2.11)

Por tema, una lista de términos de búsqueda (sin tildes):

| Tema | Términos |
| :--- | :--- |
| Admisibilidad | admisibilidad, requisitos minimos, inadmisible |
| Documentos a adjuntar | adjuntar, documentos, certificado, declaracion jurada |
| Plazo de entrega | plazo de entrega, plazo de ejecucion, dias habiles, dias corridos |
| Garantía | garantia |
| Multas | multa, sancion |
| Forma de pago | forma de pago, factura, pago |
| Visita a terreno | visita a terreno, visita tecnica |
| Criterios de evaluación | criterios de evaluacion, ponderacion, puntaje |

Para cada tema se buscan sus términos con `tramosConTermino` en todos los
adjuntos. Se guarda el mejor tramo (archivo y texto), recortado a unos 600
caracteres. Si no hay tramo: «no se encontró» (Q3). Es extracción, no
interpretación: el modelo resume, y el usuario ve la cita.

## 8. Documentos generados (2.12, ADR 0032)

- **Planilla `.xlsx`:** hoja «Cotización» con código, organismo, ítems (descripción, cantidad, unidad, precio unitario, neto), IVA 19 % y total, todo con fórmulas simples. Los campos que faltan van en amarillo con «COMPLETAR».
- **Carta `.docx`:** los datos del borrador actual (2.8), con el plazo de `diasEnTexto` (2.9.3) y los requisitos marcados como cumplidos.
- Nombre `salida/<codigo>-cotizacion-BORRADOR.{xlsx,docx}`. «BORRADOR» sale solo cuando el usuario marca la cotización como lista.

## 9. Amenazas

| Amenaza | Defensa |
| :--- | :--- |
| Instrucciones dentro de un adjunto o planilla | S1: se marca como datos de terceros en cada respuesta |
| Macro o fórmula maliciosa en `.docx`/`.xlsx` | S2: solo se leen valores; nunca se evalúa nada |
| Bomba ZIP, archivo enorme | S3: límites antes y durante la descompresión |
| Ruta maliciosa en un nombre de adjunto o del ZIP | S4: nombres saneados; se verifica que la ruta final quede dentro de la carpeta |
| El modelo pide leer `C:\Windows\…` como «archivo propio» | S5: solo rutas dentro de la carpeta del usuario, y solo a pedido explícito |
| Fuga del ticket en el archivo de cuota | T2: solo el hash del ticket |

## 10. Cuota

- Leer adjuntos no gasta el ticket: es el portal.
- `exportar_procesos`: una consulta por página, informada en la respuesta (E5).
- `cotizacion_abrir`: una consulta (el detalle), más el portal para los adjuntos.
