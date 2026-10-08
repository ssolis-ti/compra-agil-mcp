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

1. **Un computador con Windows** que quede encendido en horario de oficina, con [Node.js](https://nodejs.org) instalado (la versión «LTS»).
2. **Un ticket de Mercado Público.** Es gratis:
   1. Entra a https://www.chilecompra.cl/api/ y presiona «Pide tu ticket».
   2. Entra con tu Clave Única.
   3. Te llega por correo en minutos.
3. **Telegram** en tu teléfono.

## Instalar (una sola vez)

Abre una terminal: en Windows, busca «PowerShell» en el menú de inicio. Copia
estas líneas, una por una:

```bash
git clone https://github.com/ssolis-ti/compra-agil-mcp.git mcp-compra-agil
cd mcp-compra-agil
npm install
npm run build
node dist/index.js --configurar
```

Si `git` no está instalado, descarga el proyecto como ZIP desde
https://github.com/ssolis-ti/compra-agil-mcp (botón «Code» → «Download ZIP»),
descomprímelo y abre la terminal en esa carpeta.

## Configurar: el asistente te pregunta todo

`node dist/index.js --configurar` te hace cinco preguntas:

1. **Tu ticket.** Pégalo; no se ve mientras lo escribes. El asistente comprueba que funcione.
2. **Qué vendes.** Escribe palabras que aparecerían en el nombre de la compra, separadas por coma: `resma, papel, archivador`. El asistente te dice cuántas compras abiertas hay ahora con cada una. Si una da 0, prueba otra forma de decirlo.
3. **Dónde y desde qué monto.** Por ejemplo `13` para la Región Metropolitana, y `200000` como mínimo. Ojo: la mitad de las compras ágiles es de menos de $800.000.
4. **Telegram.** Te explica cómo crear tu bot con @BotFather (dos minutos). Después le escribes «hola» a tu bot y el asistente encuentra tu chat solo. Te llega un mensaje de prueba.
5. **Dejarla encendida.** Responde «s» y la vigilancia arranca sola cada vez que prendes el computador.

Para cambiar algo después, vuelve a correr `node dist/index.js --configurar`.
Enter deja cada respuesta como estaba.

## Afinar lo que vendes conversando (con Claude Desktop)

Si usas Claude Desktop con este servidor, elige el prompt **«configurar
vigilancia»** o escríbele: «Ayúdame a configurar la vigilancia: vendo útiles
de oficina en Santiago». Claude te pregunta, prueba las palabras contra
compras reales, te muestra ejemplos y guarda los criterios cuando le
confirmas. Cada cambio de criterios te llega también a Telegram, para que
sepas si alguien los tocó.

Claude **nunca** te va a pedir el ticket ni el token del bot en el chat: eso
se escribe solo con el asistente de la terminal.

## Los mensajes que vas a recibir

| Mensaje | Qué significa | Qué hacer |
| :--- | :--- | :--- |
| **N procesos nuevos calzan con tus criterios** | Hay compras abiertas de lo tuyo | Abre la ficha, revisa plazo y requisitos, y cotiza |
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

```bash
powershell -ExecutionPolicy Bypass -File scripts\quitar-tarea-windows.ps1
```

Lo que ya se revisó queda guardado: si la vuelves a encender en menos de 48
horas, retoma donde quedó.
