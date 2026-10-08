# Anexo — Instalación y configuración a través del agente (2.9.0)

Pedido del dueño (8-oct-2026): un usuario nuevo, de cualquier nivel, debe
poder instalar y configurar todo **conversando con su agente**. El
`--configurar` de la terminal no basta para un usuario básico.

## Principio

El agente conduce todo; **los secretos nunca pasan por el chat** (ticket,
token del bot, claves). El usuario los escribe en un campo seguro: la ventana
de configuración de Claude Desktop, o un formulario local en su navegador.

## Caminos por perfil

| Perfil | Instalación | Secretos | Criterios, Telegram y encendido |
| :--- | :--- | :--- | :--- |
| Básico (solo Claude Desktop) | Extensión `.mcpb`: doble clic | Campos `sensitive` de la extensión (bóveda del sistema) | Conversando: prompt `empezar`, herramientas `conectar_telegram`, `configurar_criterios`, `activar_vigilancia` |
| Intermedio (Claude Code, Cursor) | El agente clona, compila y registra | Formulario local `--configurar-web` que el agente abre | Igual que el básico |
| Avanzado (OpenClaw, Hermes, scripts) | `npx`, `.env`, systemd | Entorno | Entorno, modo gateway, webhook |

## Requisitos

- **RA1** La extensión `.mcpb` se instala sin terminal, sin Node propio ni `git`. Pide el ticket como campo sensible y obligatorio, y el token del bot como sensible y opcional.
- **RA2** Instalado como extensión, los datos van a la carpeta del usuario (`%LOCALAPPDATA%\mcp-compra-agil`), no a la carpeta de la extensión, que Claude Desktop reemplaza al actualizar.
- **RA3** `conectar_telegram` encuentra el chat del último mensaje al bot y **envía un código de 6 dígitos a ese chat**. Solo cuando el usuario escribe ese código en el chat (segunda llamada con `codigo`), el chat queda como destino. Así un tercero que le escribió al bot, o un texto inyectado, no puede desviar los avisos: el modelo no conoce el código (ADR 0027).
- **RA4** El chat confirmado se guarda en la carpeta de datos (`.avisos.json`) y vale si el entorno no fija `COMPRA_AGIL_TELEGRAM_CHAT_ID`.
- **RA5** `activar_vigilancia` ofrece dos modos (ADR 0028):
  - **`con_claude`:** la vigilancia corre dentro del servidor MCP mientras el cliente está abierto. No cambia el sistema ni deja secretos en disco.
  - **`siempre`:** instala la tarea programada (Windows). Necesita el ticket en un `.env` de la carpeta del usuario, así que el agente debe pedir un «sí» explícito, y la herramienta exige `confirmo: true`.
  - **`apagar`:** detiene la vigilancia.

  La preferencia se guarda: al reabrir Claude, el modo `con_claude` vuelve solo.
- **RA6** `--configurar-web` abre un formulario en `http://127.0.0.1:<puerto>`.
  - **Acceso:** solo escucha en la propia máquina, con un token de un solo uso en la URL.
  - **Validación:** valida el ticket y el bot, escribe el `.env` con respaldo y se cierra al terminar o a los 10 minutos.
  - **Secretos:** nunca los devuelve en la respuesta ni en los logs.
- **RA7** El prompt `empezar` lleva a cualquier usuario de cero al primer aviso:
  1. diagnóstico (`estado_vigilancia`);
  2. criterios conversando;
  3. Telegram con código;
  4. encendido;
  5. resumen.

  Pregunta el nivel solo si hace falta (si hay terminal o no).
- **RA8** Manual y README por perfil: cada uno ve solo su camino.

## Estado (8-oct-2026)

RA1–RA8 implementados y probados (826 tests):
- **Extensión:** `scripts/qa/probar-extension.mjs` la arranca como Claude Desktop y verifica herramientas, prompts, documentos y la carpeta de datos.
- **Prueba manual pendiente:** la extensión instalada en Claude Desktop y la vinculación con un bot real, con el dueño.

## Seguridad

- Ninguna herramienta acepta un secreto ni un destino como parámetro (ADR 0023 se mantiene). El código de RA3 no es un destino: es una prueba de que el dueño controla el chat.
- El formulario de RA6 rechaza peticiones sin el token de un solo uso y con un `Host` u `Origin` ajenos, para que una página web abierta en el navegador no pueda escribirle.
