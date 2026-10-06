# 0014. La carpeta de informes la fija el entorno, no el modelo

- **Estado:** aceptada
- **Origen:** Sprint 0 (`6d0684e`)

**Contexto:** `ruta_salida` de `generar_informe` aceptaba cualquier carpeta del disco. El modelo elige ese parámetro después de leer textos de terceros —nombres de procesos, razones sociales—, así que una instrucción inyectada en un dato de la API podía hacer escribir archivos donde quisiera.

**Decisión:** los informes solo se escriben dentro de una raíz: `COMPRA_AGIL_INFORMES_DIR` o `informes/` de la carpeta de datos. `ruta_salida` solo elige una subcarpeta; `..`, rutas absolutas y enlaces que salgan de la raíz se rechazan.

**Por qué:** el entorno no lo controla el modelo. Desde la 2.8.0 el rechazo muestra solo el nombre de la raíz, no su ruta absoluta (con el usuario del sistema).

**Dónde:** `src/reports/export.ts`.
