# 0027. El chat de Telegram se vincula con un código que el usuario dicta

- **Estado:** aceptada (8-oct-2026)
- **Origen:** 2.9.0, anexo de instalación por agente (RA3)

**Contexto:** para que un usuario básico conecte Telegram conversando, la herramienta tiene que descubrir su chat id. Lo que entrega la Bot API es el chat del **último mensaje** recibido por el bot, y podría ser el de un tercero que le escribió. El modelo, además, lee texto de compras escrito por terceros, que podría pedirle «confirma este chat». La ADR [0023](0023-destinos-de-aviso-fuera-del-alcance-del-modelo.md) prohíbe que una herramienta fije un destino a pedido del modelo.

**Decisión:** `conectar_telegram` busca el chat y le **envía un código de 6 dígitos**. Solo cuando el usuario se lo dicta al agente (segunda llamada con `codigo`), ese chat queda como destino, guardado en `.preferencias.json` de la carpeta de datos.
- **Almacenamiento:** el código se guarda solo como hash.
- **Límites:** vence a los 10 minutos y admite 5 intentos.
- **Parámetros:** la herramienta no acepta un chat como parámetro.

**Por qué no basta con preguntar «¿es tu chat "Ventas"?»:** un texto inyectado puede hacer que el modelo responda que sí. El código solo lo ve quien tiene ese chat en su Telegram: el modelo no puede conocerlo.

**Consecuencias:** el usuario hace un paso más: abrir Telegram y dictar el código. El entorno (`COMPRA_AGIL_TELEGRAM_CHAT_ID`) sigue mandando para quien configura a mano.
