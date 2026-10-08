# Manual de uso: avisos de Compra Ágil en tu Telegram

Para quien vende al Estado y quiere enterarse a tiempo de las compras ágiles
que le sirven, sin revisar Mercado Público a cada rato. No hace falta saber
programar.

## Qué hace

Cada 15 minutos revisa las compras ágiles nuevas de Mercado Público. Cuando
aparece una que calza con lo que vendes (por ejemplo «resmas» en la Región
Metropolitana, desde $200.000), te llega un mensaje a Telegram con el nombre,
quién compra, el presupuesto, cuándo cierra y el enlace para cotizar.

También te cuenta cuando algo anda mal: si Mercado Público no responde por
más de 2 horas te avisa que no está viendo, y cada mañana te manda un
resumen del día anterior. **Si una mañana no llega el resumen, la vigilancia
está apagada.**

## Lo que necesitas antes

1. **Un ticket de Mercado Público.** Es gratis:
   1. Entra a https://www.chilecompra.cl/api/ y presiona «Pide tu ticket».
   2. Entra con tu Clave Única.
   3. Te llega por correo en minutos.
2. **Telegram** en tu teléfono, si quieres los avisos ahí.
3. **Un computador con Windows** que quede encendido en horario de oficina, mientras quieras recibir avisos.

## Instalar y configurar: elige tu camino

Los tres caminos terminan igual: le dices a tu asistente **«Ayúdame a
empezar»** y él te guía con lo que falta. En ninguno tienes que escribir el
ticket ni el token del bot en el chat: van en un campo seguro.

### Camino 1 — Solo uso Claude Desktop (el más simple)

1. Descarga el archivo `compra-agil-…-win32.mcpb` de la última versión en
   https://github.com/ssolis-ti/compra-agil-mcp/releases.
2. Haz doble clic en él. Claude Desktop te pregunta si quieres instalar la
   extensión «Compra Ágil — Mercado Público»: acepta.
3. En la ventana de configuración de la extensión:
   - pega tu **ticket**;
   - si ya creaste tu bot de Telegram, pega también su **token**. Si no, puedes hacerlo después: tu asistente te explica cómo.
4. En una conversación nueva, escribe: **«Ayúdame a empezar»**.

No necesitas instalar nada más: Claude Desktop trae todo lo necesario.

### Camino 2 — Mi asistente puede usar la terminal (Claude Code, Cursor)

Pídele a tu asistente:

> Instala el servidor MCP de https://github.com/ssolis-ti/compra-agil-mcp,
> compílalo y regístralo como servidor «compra-agil». Para el ticket y el
> token del bot, corre `node dist/index.js --configurar-web`: abre un
> formulario en mi navegador y yo los escribo ahí. No me los pidas en el chat.
> Después corre `node dist/index.js --check` y guíame con el prompt «empezar».

Se abre una página en tu navegador (está solo en tu computador): pegas ahí el
ticket y el token, y vuelves a la conversación.

### Camino 3 — Prefiero hacerlo yo en la terminal

Con [Node.js](https://nodejs.org) (versión «LTS») instalado, abre PowerShell
y copia estas líneas, una por una:

```bash
git clone https://github.com/ssolis-ti/compra-agil-mcp.git mcp-compra-agil
cd mcp-compra-agil
npm install
npm run build
node dist/index.js --configurar
```

`--configurar` te pregunta el ticket (no se ve mientras lo escribes), qué
vendes, la región, el monto mínimo y Telegram, y deja la vigilancia encendida.
Para cambiar algo después, vuelve a correrlo: Enter deja cada respuesta como
estaba.

### Usuarios avanzados

Gateways siempre encendidos (OpenClaw, Hermes), webhook firmado, correo,
servicio de Linux, variables de entorno: [guía de vigilancia y
avisos](guia-vigilancia-y-avisos.md).

## Lo que hace tu asistente cuando le dices «Ayúdame a empezar»

1. **Revisa qué falta.**
2. **Te pregunta qué vendes, dónde y desde qué monto.** Prueba las palabras contra compras reales («con "resma" hay 14 compras abiertas ahora; por ejemplo…») y guarda los criterios cuando le confirmas. Si le das tu región, te ofrece también la **alerta total de la región**: además de lo de tu rubro, toda compra ágil nueva de tu región, en una lista breve al final del mismo aviso.
3. **Conecta tu Telegram.** Le escribes «hola» a tu bot, te llega un **código de 6 dígitos** por Telegram y se lo dictas a tu asistente. Así nadie más puede desviar tus avisos.
4. **Enciende la vigilancia.** Puede ser «mientras Claude esté abierto», sin instalar nada, o «siempre, aunque cierres Claude». Para la segunda te pide un sí explícito, porque instala una tarea en Windows.
5. **Te manda un mensaje de prueba** y te resume cómo quedó.

Para cambiar algo después, pídeselo: «agrega "tóner" a lo que vigilo», «avísame
solo desde $300.000», «avísame también todo lo de la Araucanía», «apaga la vigilancia». Cada cambio de criterios te llega
también a Telegram, para que sepas si alguien los tocó.

## Los mensajes que vas a recibir

| Mensaje | Qué significa | Qué hacer |
| :--- | :--- | :--- |
| **N procesos nuevos calzan con tus criterios** | Hay compras abiertas de lo tuyo | Abre la ficha, revisa plazo y requisitos, y cotiza |
| **N de tu rubro y M compras más en tu región** | Con la alerta total de la región: arriba (🎯) lo de tu rubro, completo; abajo (📍) todo lo demás de tu región, una línea cada una | Lo de arriba, igual; lo de abajo, una mirada rápida por si algo te sirve |
| **Procesos publicados durante el horario de silencio** | Lo que apareció de noche, junto | Igual que arriba |
| **La vigilancia no está viendo los procesos nuevos** | Mercado Público no responde hace 2 h, o no hay internet | Nada: cuando vuelva, revisa lo que se perdió y te avisa |
| **La vigilancia volvió a la normalidad** | Se recuperó y revisó lo pendiente | Nada |
| **Resumen de la vigilancia** | El día anterior: cuánto se revisó y cuántas alertas hubo | Si un día **no** llega, revisa que el computador esté encendido |
| **Cambiaron los criterios de alerta** | Alguien cambió lo que se vigila | Si no fuiste tú, vuelve a correr `--configurar` |
| **Atención con la cuota de la API** | Se está usando mucho el ticket | Si se repite, avísale a quien te instaló esto |

Un aviso **no** dice que la compra sea un buen negocio ni que la vayas a
ganar: dice que calza con lo que vendes. El plazo y los requisitos se
confirman siempre en la ficha de Mercado Público.

## Si algo no funciona

Abre la terminal en la carpeta del proyecto y corre:

```bash
node dist/index.js --check
```

Cada línea con ✘ dice qué falta. Lo más común:

- **«Ticket: falta» o «API: … 401»:** el ticket no está o venció. Corre `--configurar` y pega uno nuevo.
- **«Nadie está vigilando ahora»:** la vigilancia está apagada. Corre `--configurar` y responde «s» en el último paso, o enciéndela a mano con `node dist/index.js --vigilar`.
- **No llegan mensajes a Telegram:** corre `node dist/index.js --probar-avisos`. Si falla, corre `--configurar` y vuelve a conectar el bot.

Lo que pasó queda anotado en `vigilancia.log`, en la carpeta del proyecto.

## Para apagarla

Pídele a tu asistente «apaga la vigilancia». Si la instalaste como tarea de Windows desde la terminal, también puedes correr:

```bash
powershell -ExecutionPolicy Bypass -File scripts\quitar-tarea-windows.ps1
```

Lo que ya se revisó queda guardado: si la vuelves a encender en menos de 48
horas, retoma donde quedó.
