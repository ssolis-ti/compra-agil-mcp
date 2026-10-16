# 0029. Lectores de documentos sin módulos nativos

- **Estado:** aceptada (16-oct-2026)
- **Origen:** 2.10.0, espacio de cotización (L1–L6, N1)

**Contexto:** el 43 % de los adjuntos no se leía (33 % `.docx`, 7 % `.doc`; medición del 16-oct). En la 2.9.0, un módulo nativo (`@napi-rs/canvas`, que carga `pdf-parse`) impedía que la extensión arrancara con el Node de Claude Desktop.

**Decisión:** solo librerías en JavaScript o WebAssembly, con versión fijada exacta:
- `.docx`: `mammoth`.
- `.doc`: `word-extractor`.
- `.zip`: `fflate`.
- `.xlsx` y `.csv`: lectores propios. El `.xlsx` se lee sobre `fflate`, y de cada celda solo el valor guardado, nunca la fórmula.

No se usa `exceljs`, que arrastra 9 dependencias y está sin actualizar desde 2024, ni el paquete `xlsx` de npm, con vulnerabilidades sin parche. El formato se detecta por la firma del archivo, no por la extensión. Cada lector se carga al usarse, como el de PDF.

**Consecuencias:** dos dependencias nuevas de producción (`mammoth` y `word-extractor`) más `fflate`. El lector de `.xlsx` es propio: más código que mantener, pero sin superficie de ataque ajena. `.xls` antiguo, imágenes y OCR quedan fuera.
