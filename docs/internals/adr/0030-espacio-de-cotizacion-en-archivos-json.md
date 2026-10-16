# 0030. El espacio de cotización vive en archivos JSON

- **Estado:** aceptada (16-oct-2026)
- **Origen:** 2.11.0 (C1–C6)

**Contexto:** cada compra que se trabaja necesita estado, notas, archivos y requisitos, y el agente debe retomarla en otra conversación. Una base de datos nativa (`better-sqlite3`) rompe la extensión (ADR 0029). `node:sqlite` no existe en Node 20, que el proyecto soporta. `sql.js` funciona, pero carga la base entera en memoria.

**Decisión:** una carpeta por compra en `datos/cotizaciones/<codigo>/`, con `cotizacion.json` y un `indice.json` para listar. Se escribe con la escritura atómica y el candado que ya usa la vigilancia. El código se valida antes de usarlo como nombre de carpeta, y los nombres de archivo se sanean.

**Consecuencias:** cero dependencias, y archivos que el usuario puede abrir y respaldar. Las consultas son simples (listar y filtrar en memoria): sirve para decenas o cientos de cotizaciones. Si se necesita más, se cambia `cotizacion/almacen.ts` sin tocar las herramientas.
