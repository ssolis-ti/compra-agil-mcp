# 0023. Los destinos de aviso se configuran fuera del alcance del modelo

- **Estado:** aceptada (7-oct-2026, fase 0)
- **Origen:** 2.9.0, fase 0 ([diseño §9](../specs/2.9.0-vigilancia-y-avisos/diseno.md#9-amenazas))

**Contexto:** el modelo lee nombres y descripciones que escribe cualquier comprador. Si una herramienta MCP pudiera fijar el chat de Telegram, la URL del webhook o el correo de destino, el texto de un proceso podría pedirle que los cambie, y las alertas, o lo que el modelo agregue, irían a un tercero. Es el mismo razonamiento que dejó la carpeta de informes en el entorno ([0014](0014-raiz-de-informes-en-el-entorno.md)).

**Decisión:** los destinos y sus credenciales se leen solo de variables de entorno o del `.env`. Ninguna herramienta acepta un destino como parámetro, ni siquiera `probar_avisos`. Los criterios (palabras, regiones, presupuesto) sí se pueden cambiar por herramienta, porque su peor efecto es silenciar alertas, y ese efecto se hace visible: cada cambio se avisa por todos los canales, con el antes y el después.

**Consecuencias:** configurar un canal requiere editar el `.env`. Eso lo hace el dueño, o un agente al que el dueño le dicta el valor sin que el valor pase por el chat. Un test verifica que el esquema de ninguna herramienta tenga campos de destino.
