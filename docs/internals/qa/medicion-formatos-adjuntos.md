# Medición: formatos de los adjuntos de Compra Ágil (16-oct-2026)

Fase 0 de la especificación [2.10.0](../specs/2.10.0-espacio-de-cotizacion/README.md).

**Muestra:** las ~200 compras ágiles publicadas más recientes (20 páginas de
`estado=publicada`, ordenadas por publicación). Se listaron sus adjuntos en el
portal, de a uno, con 0,4 s entre consultas.

| Formato | Archivos | % |
| :--- | ---: | ---: |
| `.pdf` | 138 | 57 % |
| `.docx` | 80 | 33 % |
| `.doc` | 18 | 7 % |
| `.png` / `.jpg` | 5 | 2 % |
| `.xlsx` / `.xls` | 3 | 1 % |
| **Total** | **244** | |

- Hasta 6 adjuntos por compra.
- Hasta la 2.9.3 el servidor leía solo los PDF: **el 43 % de los adjuntos (docx, doc, imágenes, planillas) no se podía leer**.
- Las imágenes son escaneos o fotos: leerlas exige OCR, que queda fuera (ver requisitos, fuera de alcance).

Ejemplos para las pruebas: docx `1079967-758-COT26`, doc `4089-292-COT26`,
xlsx `4594-196-COT26`, xls `3734-594-COT26`, png `1655-170-COT26`.
