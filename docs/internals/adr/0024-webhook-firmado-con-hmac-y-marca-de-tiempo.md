# 0024. Webhook firmado con HMAC y marca de tiempo

- **Estado:** aceptada (7-oct-2026, fase 0)
- **Origen:** 2.9.0, fase 0 ([diseño §6](../specs/2.9.0-vigilancia-y-avisos/diseno.md#6-canales))

**Contexto:** un receptor de webhooks (n8n, Make, un servicio propio) es una URL pública. Sin firma, cualquiera que la conozca puede inyectarle alertas falsas. Sin marca de tiempo, una firma válida capturada se puede reenviar después.

**Decisión:** cada envío lleva `X-Compra-Agil-Firma: t=<unix>,v1=<hex>`, con `hex(HMAC_SHA256(secreto, t + "." + cuerpo))`. Es el mismo esquema que usan Stripe y otros proveedores, conocido por los integradores. El receptor rechaza firmas con más de 300 s de diferencia. El esquema del cuerpo está versionado (`compra_agil.alertas` v1) y publicado en `docs/api/`, con la verificación en Node y Python. Un test ejecuta esa verificación contra firmas reales.

**Por qué no un token en una cabecera:** viaja igual en cada envío. Si se filtra un log del receptor, sirve para siempre. La firma depende del cuerpo y de la hora.

**Consecuencias:** el secreto y la URL completa se registran en la redacción, porque la URL de algunos receptores lleva su propio token. Solo `https`, salvo `localhost`.
