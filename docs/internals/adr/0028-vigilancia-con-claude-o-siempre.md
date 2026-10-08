# 0028. Dos modos de vigilancia: «con Claude» y «siempre»

- **Estado:** aceptada (8-oct-2026)
- **Origen:** 2.9.0, anexo de instalación por agente (RA5)

**Contexto:** instalado como extensión de Claude Desktop, el ticket vive en la bóveda del sistema y solo lo recibe el proceso que Claude lanza. Un daemon aparte (tarea de Windows) no puede leerlo. Un usuario básico necesita poder encender la vigilancia desde el chat, sin terminal.

**Decisión:** `activar_vigilancia` ofrece dos modos.
- **`con_claude`:** el mismo bucle del daemon (`services/bucle-vigilancia.ts`) corre dentro del servidor MCP mientras el cliente está abierto.
  - No instala nada ni escribe secretos en disco.
  - La preferencia se guarda y vuelve sola al reabrir Claude.
- **`siempre`:** instala la tarea programada con el Node que trae Claude Desktop.
  - Como la tarea corre sin el entorno de Claude, copia el ticket y el token al `.env` de la carpeta del usuario (`%LOCALAPPDATA%\mcp-compra-agil`).
  - Por eso exige `confirmo: true`, y el agente debe explicarlo y pedir un «sí» explícito.

El bucle de vigilancia es uno solo para los dos modos y el vigilante es único ([0026](0026-un-nucleo-dos-modos-gateway-y-daemon.md)), así que los dos no pueden leer a la vez.

**Consecuencias:** el modo recomendado para empezar no toca el sistema. El modo `siempre` deja una copia del ticket en disco, la misma situación de quien instala desde el repositorio, y el usuario la aceptó explícitamente.
