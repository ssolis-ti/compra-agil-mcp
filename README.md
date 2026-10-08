# MCP Server: Compra Ágil v2 — Mercado Público de Chile 🇨🇱

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.16+%20%7C%2022.3+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Servidor [MCP (Model Context Protocol)](https://modelcontextprotocol.io) desarrollado en TypeScript que envuelve e integra de forma avanzada la API REST de **Compra Ágil v2** y la API de **Órdenes de Compra (OC)** de [Mercado Público](https://www.mercadopublico.cl). Permite a cualquier IA, agente autónomo o cliente compatible interrogar, filtrar, auditar y prospectar procesos de compra estatal del gobierno de Chile.

El proyecto está diseñado bajo una arquitectura modular y cuenta con tres modos de operación:
1. **Servidor Interactivo MCP:** Comunicación bidireccional vía Stdio para integrarse directamente con el chat y herramientas de tu IDE o cliente (Cursor, Claude Desktop, Windsurf, etc.).
2. **Vigilancia con avisos (2.9.0):** lee los procesos nuevos lote por lote, sin huecos, y avisa por **Telegram, correo o webhook firmado**, o los entrega a un gateway siempre encendido (OpenClaw, Hermes). Avisa también cuando la vigilancia está ciega y manda un resumen diario. Ver la [guía](docs/api/guia-vigilancia-y-avisos.md).
3. **Generador de Informes:** Produce documentos imprimibles autocontenidos en formatos **Carta, Oficio y A4**.

> 📌 **Antes de usarlo en decisiones de negocio**, lee [Limitaciones conocidas de la API](#️-limitaciones-conocidas-de-la-api). La documentación oficial de ChileCompra difiere del comportamiento real en puntos importantes — este servidor implementa lo que la API **hace**, no lo que promete.

---

## 📋 Tabla de Contenidos
* [¿Qué es Compra Ágil?](#-qué-es-compra-ágil)
* [Características Clave](#-características-clave)
* [Requisitos y ticket](#-requisitos-y-obtención-de-credenciales)
* [Instalación](#-instalación)
* [Configuración de Variables de Entorno](#️-configuración-de-variables-de-entorno)
* [Uso y Modos de Ejecución](#️-uso-y-modos-de-ejecución)
  * [Desarrollo](#desarrollo)
  * [Producción](#producción)
  * [Monitoreo Autónomo](#monitoreo-autónomo)
  * [Testing con MCP Inspector](#testing-con-mcp-inspector)
* [Integración con Clientes MCP y Agentes](#-integración-con-clientes-mcp-y-agentes)
  * [Claude Desktop](#2-claude-desktop)
  * [Claude Code](#3-claude-code-claudecode)
  * [OpenClaw](#4-openclaw)
  * [Cursor / Windsurf](#6-cursor--windsurf)
* [Catálogo del Servidor](#-catálogo-del-servidor)
  * [Herramientas Disponibles (Tools)](#herramientas-disponibles-tools)
  * [Recursos Disponibles (Resources)](#recursos-disponibles-resources)
  * [Prompts Disponibles](#prompts-disponibles)
* [⚠️ Limitaciones conocidas de la API](#️-limitaciones-conocidas-de-la-api)
* [🖨️ Informes imprimibles](#️-informes-imprimibles)
* [Ejemplos Prácticos de Interacción](#-ejemplos-prácticos-de-interacción)
* [Licencia](#-licencia)

---

## 🔍 ¿Qué es Compra Ágil?

Compra Ágil es el mecanismo de adquisición simplificado y directo del Estado de Chile para montos inferiores a 100 UTM. Permite a los organismos públicos convocar de forma abierta a cotizaciones rápidas a través de Mercado Público, promoviendo la participación de Empresas de Menor Tamaño (EMT).

---

## 🎯 ¿A quién está dirigido?

Este servidor MCP maneja datos públicos de la API de Compra Ágil de Mercado Público, siendo de alto valor tanto para compradores del Estado como para proveedores privados:

### 🏛️ Para Compradores Públicos (Organismos del Estado)
* **Estudios de Mercado:** Analiza los precios que el mercado cotizó en procesos similares antes de publicar una nueva adquisición.
* **Auditoría de Procesos Desiertos:** Entiende por qué una convocatoria no recibió ofertas válidas, cruzando presupuesto y plazo contra el comportamiento del mercado.
* **Informes Imprimibles:** Genera reportes profesionales en formato Carta, Oficio o A4 listos para presentar.

### 💼 Para Proveedores (Empresas y Pymes)
* **Inteligencia de Precios:** Analiza a cuánto está cotizando la competencia en procesos del mismo rubro para posicionar tu oferta.
* **Prospectar Oportunidades:** Monitorea llamados activos sin oferentes con un ranking ponderado (Hot Score) y filtros locales.
* **Vigilancia con avisos:** Telegram, correo o webhook cada vez que se publica un proceso que calza con tus palabras clave, región y presupuesto, sin perder procesos cuando la API falla.

> ⚠️ **Importante:** la API de Mercado Público **no publica qué oferta ganó**. Todo el análisis de precios se basa en cotizaciones presentadas, no en adjudicaciones. Lee [Limitaciones conocidas](#️-limitaciones-conocidas-de-la-api) antes de usarlo en decisiones de negocio.

---

## ⚡ Características Clave
* **SDK oficial de MCP 1.32:** Carga declarativa y robusta de herramientas, recursos y prompts bajo los nuevos estándares del protocolo.
* **Carga de Entorno Autónoma:** El servidor carga al iniciarse el `.env` del directorio de trabajo, de la carpeta del proyecto y de su carpeta de datos, así que funciona aunque el cliente MCP lo lance desde otra carpeta, sin variables de sistema globales ni el ticket en la config del cliente.
* **Lector de Documentación Integrado (Recursos):** Exposición nativa de guías, normativas y manuales en PDF (dentro de la carpeta `docs/`) como recursos del protocolo MCP (`compra-agil://documentacion/{filename}`). El servidor extrae el texto del PDF de manera local (y lo memoriza: la segunda consulta tarda menos de 100 ms) y lo inyecta en el LLM bajo demanda. Las guías viajan en el paquete de npm desde la 2.7.0.
* **Filtrado Inteligente Anti-Ruido:** Filtros locales (`palabras_clave_requeridas` y `palabras_clave_excluidas`, insensibles a tildes) en `buscar_compras_agiles` y, desde la 2.8.0, en el análisis de precios, la auditoría, el borrador y los informes: se aplican antes de pedir detalles, así que no gastan cuota y evitan mezclar productos distintos en una muestra de precios.
* **Hora de Chile y reloj oficial:** La API entrega hora de Chile aunque algunos campos digan "Z" (ver [Limitaciones](#-las-fechas-están-en-hora-de-chile-aunque-digan-z)); el servidor la lee así, manda las ventanas de cambios como la API las compara y calcula los plazos con la hora del SHOA (`ntp.shoa.cl`), no solo con el reloj de la máquina.
* **Errores en un solo formato:** Todo rechazo de una entrada llega como `Error de validación: … No se consultó la API.`, en español, venga del esquema o de la herramienta, y los códigos con formato imposible se rechazan antes de gastar cuota.
* **Métricas de uso:** `obtener_estadisticas_uso` informa la latencia y los errores de cada herramienta y el resultado de las consultas a la API (caché, 504, 429, timeouts) desde que arrancó el servidor.
* **Paginación y vigilancia sin huecos:** La herramienta de cambios recientes admite navegación de páginas (`numero_pagina`). La vigilancia lee la API lote por lote (la API registra los cambios cada 5 minutos), comprueba cada lote paginado, reintenta los que fallan antes de avanzar e informa lo que no pudo leer.
* **Integración del Detalle de OC:** Resuelve de forma dinámica el código alfanumérico o ID numérico de las Órdenes de Compra utilizando la API legada de Mercado Público.
* **Validado contra la API real:** El comportamiento documentado por ChileCompra difiere del real en varios puntos. Este servidor implementa lo que la API **hace**, no lo que promete, y lo documenta en [Limitaciones conocidas](#️-limitaciones-conocidas-de-la-api). Hay tests de regresión que blindan cada hallazgo.
* **Redacción de credenciales:** Todo texto que sale del proceso (logs, errores, respuestas) pasa por un punto único de redacción que borra el ticket. Es relevante porque `sendLoggingMessage` envía los logs al cliente MCP — es decir, al contexto del modelo y a la transcripción.
* **Rate Limiting Local:** Throttle proactivo que espacia las solicitudes bajo un máximo por minuto **antes** de enviarlas, además de reaccionar al error 429 para evitar la inhabilitación temporal del ticket. El estado de cuota persiste entre reinicios, y ante un 429 se honra el header `Retry-After` con espera creciente en vez de bloquear hasta el día siguiente: la cuota es un *token bucket* que se recarga solo (verificado: la API respondió con normalidad 13 min después de un 429).
* **Caché de respuestas:** Las consultas repetidas se sirven desde disco sin gastar cuota (15 min para detalles, 5 min para búsquedas). Es lo que hace viable el flujo completo de análisis: repetir `generar_borrador_cotizacion` pasó de 6 consultas y 11 s a **0 consultas y 41 ms**. El ticket nunca entra en la caché.
* **Informes imprimibles:** Genera documentos HTML autocontenidos con diseño de impresión real (`@page`, saltos controlados, cabeceras de tabla repetidas) en formatos **Carta, Oficio y A4**.
* **Logs Nativos en el Protocolo:** El servidor declara la capacidad `logging` y emite `notifications/message`, así que la actividad se puede seguir y depurar desde la propia interfaz del cliente. El cliente puede ajustar el detalle con `logging/setLevel`. Como esos logs llegan al contexto del modelo, **todo lo enviado pasa antes por la redacción de credenciales** — incluido el endpoint legado de Órdenes de Compra, que lleva el ticket en la URL y se emite como `ticket=[REDACTED]`.
* **Manejo Seguro de Documentos (UUID):** Evita errores de tipo `Authentication parameters missing` al tratar con archivos adjuntos protegidos de Compra Ágil (UUIDs) redirigiendo al usuario a la ficha pública del buscador (`https://buscador.mercadopublico.cl/ficha?code={codigo}`) en lugar de entregar enlaces de descarga directa inaccesibles.

---

## 📌 Requisitos y Obtención de Credenciales

Para utilizar este servidor MCP necesitas:
1. **Node.js 20.16+ o 22.3+** (se utiliza la API nativa de `fetch` y soporte nativo para módulos ESM).
2. **Ticket de acceso a la API** de Mercado Público de ChileCompra.

### 🔑 Paso a Paso para obtener tu Ticket de Acceso
El ticket es una credencial de acceso gratuita que identifica tus peticiones ante los servidores de Mercado Público y controla tu cuota diaria de consultas. Sigue este procedimiento oficial para obtenerlo en 2 minutos:

1. **Acceder al portal de la API:** Abre tu navegador e ingresa a [chilecompra.cl/api/](https://www.chilecompra.cl/api/).
2. **Solicitar ticket:** Haz clic en el botón destacado **«Pide tu ticket»**.
3. **Autenticación con Clave Única:** Acepta los términos y condiciones de uso e inicia sesión con tu **Clave Única** del Estado de Chile.
4. **Formulario de solicitud:** Completa los datos requeridos en el formulario y presiona el botón **«Solicitar ticket»**.
5. **Recepción por correo:** Recibirás tu ticket alfanumérico (ej: `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`) de forma inmediata en tu casilla de correo electrónico.
   * *Consejo: Si no lo visualizas en tu bandeja de entrada en unos minutos, revisa la carpeta de Correo no deseado o Spam.*

Una vez que tengas tu ticket alfanumérico copiado, puedes proceder a la instalación.

---

## 🚀 Instalación

### Opción A: 🤖 Instalación Automatizada mediante tu Agente/Asistente de IA (Recomendado)
Si estás utilizando un asistente o agente de IA en tu editor de código con permisos para ejecutar comandos (como Cursor Composer, Roo Code, Cline, Windsurf Agent o Claude Code), puedes delegar la configuración por completo. Simplemente copia y pega el siguiente prompt en el chat de tu IA:

> "Configura el servidor MCP Compra Ágil en este proyecto. Instala dependencias, compila con `npm run build` y registra un servidor stdio llamado `compra-agil` cuyo comando sea `node` y cuyo argumento sea la ruta absoluta de `dist/index.js`. El ticket ya está en la variable de entorno `COMPRA_AGIL_TICKET`: referénciala, no la leas, no la imprimas y no la copies a un archivo del repositorio. Si falta, detente y pídemela."

---

### Opción B: 💻 Instalación Manual clásica
Si prefieres realizar la instalación tú mismo desde la terminal (Node 20.16+ o 22.3+):
```bash
# Descargar el proyecto y entrar en él
git clone https://github.com/ssolis-ti/compra-agil-mcp.git mcp-compra-agil
cd mcp-compra-agil

# Instalar dependencias de desarrollo y producción
npm install

# Compilar el código fuente TypeScript (.ts -> .js en dist/)
npm run build
```

---

### Opción C: 📦 Ejecución directa vía NPX (Publicación en NPM)
El paquete se publica en npm como `@ssolis-ti/mcp-compra-agil`, así que se puede ejecutar **sin descargar el código fuente ni compilarlo**. Comprueba la versión publicada con `npm view @ssolis-ti/mcp-compra-agil version`: si es anterior a la del repositorio, usa la Opción B para tener las últimas correcciones.

1. **Configuración directa en el cliente MCP:**
   Se puede configurar el comando de inicio usando `npx`:
   ```bash
   npx @ssolis-ti/mcp-compra-agil
   ```
2. **Instalación global en el sistema:**
   ```bash
   npm install -g @ssolis-ti/mcp-compra-agil
   # Ejecución directa del binario registrado
   mcp-compra-agil
   ```
   *(Asegúrate de que el usuario defina la variable de entorno `COMPRA_AGIL_TICKET` en su cliente o entorno).*

---

## ⚙️ Configuración de Variables de Entorno

Copia la plantilla y complétala con tus credenciales:

```bash
cp .env.example .env   # en Windows: copy .env.example .env
```

```env
# Ticket oficial de acceso a la API (Obligatorio)
COMPRA_AGIL_TICKET=tu_ticket_aqui

# URL Base para las llamadas a la API v2 (por defecto api2.mercadopublico.cl)
COMPRA_AGIL_BASE_URL=https://api2.mercadopublico.cl

# Corte de cada consulta en ms (por defecto 35000, sobre los ~30 s de la pasarela)
# COMPRA_AGIL_TIMEOUT_MS=35000

# Tiempo máximo de cada llamada a una herramienta en ms (por defecto 45000)
# COMPRA_AGIL_PRESUPUESTO_MS=45000

# Carpeta de datos: caché, estado de cuota, daemon e informes. Por defecto, la
# carpeta del proyecto (clon) o una del usuario (npx). No depende del cwd.
# COMPRA_AGIL_DATA_DIR=C:/Users/tu-usuario/AppData/Local/mcp-compra-agil

# Carpeta raíz de los informes (por defecto <carpeta de datos>/informes). ruta_salida no sale de ella.
# COMPRA_AGIL_INFORMES_DIR=C:/Users/tu-usuario/Documents/informes-compra-agil

# Nivel de log: debug | info | warn | error
LOG_LEVEL=info

# --- Vigilancia (ver docs/api/guia-vigilancia-y-avisos.md) ---
# Minutos entre rondas (por defecto 15). Cada lote se lee una vez: no cambia la cuota.
MONITOR_INTERVAL_MINUTES=15
# Presupuesto mínimo en CLP (0 = sin mínimo; con 5.000.000 se pierde ~84 % de los procesos)
MONITOR_MIN_BUDGET_CLP=0
# Palabras clave en el nombre, separadas por coma (también MONITOR_EXCLUIR y MONITOR_REGIONES)
MONITOR_KEYWORDS=software, desarrollo, licencias, plataforma, sistema, soporte, cloud
# Avisos: telegram, webhook, correo (cada uno con sus variables; ver .env.example)
# COMPRA_AGIL_AVISOS=telegram
```

### 🔐 Manejo seguro del ticket

El ticket es una credencial personal. Aunque el servidor **redacta el ticket de todo log, error y respuesta** (`src/utils/redact.ts`), esa es la última línea de defensa, no un permiso para exponerlo:

* Guárdalo **solo** en el `.env` — ya está en `.gitignore`.
* **No lo pegues** en chats, issues ni capturas de pantalla.
* **No lo pases inline en la terminal** (`COMPRA_AGIL_TICKET=xxx node ...`): queda en el historial del shell y visible en la lista de procesos.
* Para comprobar que funciona usa la herramienta **`verificar_ticket`**: valida contra la API y solo muestra `••••1234`.
* Si trabajas con un agente de IA con acceso a tu disco, considera añadir reglas que le impidan leer el `.env`.

---

## 🛠️ Uso y Modos de Ejecución

### Desarrollo
Para levantar el servidor en caliente observando cambios en el código:
```bash
npm run dev
```

### Producción
Para iniciar el servidor compilado:
```bash
npm run build
npm start
```

### Monitoreo Autónomo
La vigilancia revisa los procesos nuevos cada 15 minutos, sin huecos aunque la API falle. Avisa por los canales del `.env` (Telegram, correo, webhook firmado) y deja todo en `alerts.log` y `vigilancia.log`, rotado a los 5 MB:
```bash
node dist/index.js --check          # ¿quedó bien instalado? (código 0 = sí)
node dist/index.js --probar-avisos  # un mensaje de prueba por cada canal
node dist/index.js --vigilar        # la vigilancia (también: npm run monitor)
```
Para dejarla encendida sola: `scripts\instalar-tarea-windows.ps1` (Windows) o `scripts/compra-agil-vigilancia.service` (Linux, systemd). Con un gateway siempre encendido (OpenClaw, Hermes), el gateway llama `obtener_alertas_nuevas` y `confirmar_alertas` y avisa por su canal. Todo, paso a paso, en la [guía de vigilancia y avisos](docs/api/guia-vigilancia-y-avisos.md).

**Instalación por un agente:** el agente clona, corre `npm install` y `npm run build`, y pide al dueño que escriba en el `.env` el ticket y los tokens de los canales (el agente no los lee ni los escribe). Después corre `node dist/index.js --check`: el código de salida 0 confirma que quedó listo.

### Testing con MCP Inspector
Para probar las herramientas, recursos y prompts en una interfaz gráfica local:
```bash
npm run inspect
```

---

## 🔌 Integración con Clientes MCP y Agentes

Este servidor se comunica de manera estándar mediante Stdio. Al conectar, el `initialize` entrega unas instrucciones de uso: no mostrar el ticket, no declarar un ganador, no descargar adjuntos por la API y no insistir ante un 429.

**Dónde busca el ticket y dónde guarda sus archivos.** Un cliente MCP lanza el servidor desde su propia carpeta, no desde la del proyecto, así que el servidor no depende de ella:

* **`.env`**: lo busca en la carpeta de trabajo, en la carpeta del proyecto (junto a `dist/`) y en la carpeta de datos, en ese orden. Una variable ya definida en el entorno gana. Con el ticket en el `.env` del proyecto, **la config del cliente no necesita el ticket**.
* **Carpeta de datos** (caché `.api-cache.json`, estado de cuota `.rate-limit-state.json`, estado y alertas del daemon, `informes/`): `COMPRA_AGIL_DATA_DIR` si está definida; si no, la carpeta del proyecto cuando es un clon del repositorio; si no (instalación con `npx` o `npm -g`), `%LOCALAPPDATA%\mcp-compra-agil` en Windows o `~/.local/state/mcp-compra-agil` en el resto. `COMPRA_AGIL_INFORMES_DIR` sigue mandando para los informes.

### 1. Grok

En la carpeta del proyecto, `.grok/config.toml`:

```toml
[mcp_servers.compra-agil]
command = "node"
args = ["C:/ruta/completa/compra-agil-mcp/dist/index.js"]
cwd = "C:/ruta/completa/compra-agil-mcp"
env = { COMPRA_AGIL_TICKET = "${COMPRA_AGIL_TICKET}" }
```

La carpeta tiene que estar en la lista de confianza del cliente (`/hooks-trust` o el arranque con `--trust`). Sin eso, Grok no inicia un servidor definido en el proyecto.

En Hermes el bloque `compra-agil` apunta a `dist/index.js` y no lleva el ticket dentro de `config.yaml`. El proceso hereda `COMPRA_AGIL_TICKET`. Un `.env` junto al servidor también sirve, y ese archivo no se commitea.

### 2. Claude Desktop
Añade el servidor a tu archivo de configuración global editando `%APPDATA%\Claude\claude_desktop_config.json` (en Windows) o `~/Library/Application Support/Claude/claude_desktop_config.json` (en macOS):

```json
{
  "mcpServers": {
    "compra-agil": {
      "command": "node",
      "args": ["C:\\ruta\\completa\\mcp-compra-agil\\dist\\index.js"]
    }
  }
}
```

El ticket se lee del `.env` de la carpeta del proyecto: no hace falta escribirlo en esta config ni lanzar el servidor con `cmd /c cd /d …`. Si instalaste con `npx`, deja el `.env` en la carpeta de datos (`%LOCALAPPDATA%\mcp-compra-agil\.env`) o define `COMPRA_AGIL_DATA_DIR` en el bloque `env`.

### 3. Claude Code (`claudecode`)
Para registrar el servidor de forma global en Claude Code (el agente CLI de Anthropic), ejecuta el siguiente comando en tu terminal **antes** de iniciar tu sesión de `claude`:
```bash
claude mcp add compra-agil -- node C:\ruta\completa\mcp-compra-agil\dist\index.js
```
*El ticket se toma del `.env` de la carpeta del proyecto. No lo pases en `--env`: quedaría en el historial de la terminal.*
*Nota: Si estás en un proyecto local, puedes usar rutas relativas o el comando local.*
Para comprobar que se cargó con éxito, inicia una sesión de `claude` y escribe el comando `/mcp` o ejecuta `claude mcp list` en tu terminal.

### 4. OpenClaw
Para registrar el servidor en OpenClaw (el cliente de terminal y automatización open source), puedes hacerlo de dos formas:

#### A. Vía CLI (Recomendado)
Ejecuta en tu consola:
```bash
openclaw mcp add compra-agil node "C:\\ruta\\completa\\mcp-compra-agil\\dist\\index.js"
```
*El ticket se toma del `.env` de la carpeta del proyecto. No lo pases con `openclaw mcp set … env.COMPRA_AGIL_TICKET`: quedaría en el historial de la terminal.*
#### B. Edición de Archivo de Configuración
Abre tu archivo de configuración de OpenClaw (típicamente localizado en `~/.openclaw/openclaw.json` o `~/.openclaw/openclaw.json5`) e integra el servidor dentro de la sección `"mcpServers"`:
```json5
  "mcpServers": {
    "compra-agil": {
      "command": "node",
      "args": ["C:/ruta/completa/mcp-compra-agil/dist/index.js"]
    }
  }
```
*El ticket se toma del `.env` de la carpeta del proyecto, como en Claude Desktop: no hace falta escribirlo en esta config.*
*Asegúrate de ajustar los permisos de sandbox de herramientas (`tools.sandbox.tools` o `tools.sandbox.allowlist`) en tu config de OpenClaw para permitir la ejecución del comando `node`.*

### 5. Open-Code / VSCodium / VS Code (Extensiones de Agentes)

#### Con la extensión **Roo Code (Roo Cline / Cline)**:
1. Abre los Ajustes de la extensión Roo Code/Cline (`Settings`).
2. En la sección **MCP Servers Configuration**, haz clic en `Edit MCP Settings` (esto abrirá el archivo `cline_mcp_settings.json` o `roo_mcp_settings.json`).
3. Añade el siguiente bloque:
   ```json
   {
     "mcpServers": {
       "compra-agil": {
         "command": "node",
         "args": ["C:/ruta/completa/mcp-compra-agil/dist/index.js"],
         "disabled": false
       }
     }
   }
   ```
   El ticket se toma del `.env` de la carpeta del proyecto: no lo escribas en este archivo.
4. Guarda el archivo y la extensión refrescará automáticamente registrando las nuevas herramientas.

#### Con la extensión **Continue**:
Abre tu archivo `~/.continue/config.json` y añade la configuración en el bloque `"mcpServers"`:
```json
"mcpServers": [
  {
    "name": "compra-agil",
    "command": "node",
    "args": ["C:/ruta/completa/mcp-compra-agil/dist/index.js"]
  }
]
```
*El ticket se toma del `.env` de la carpeta del proyecto: no hace falta escribirlo en esta config.*

### 6. Cursor / Windsurf
* **Cursor:** Dirígete a `Settings` > `Features` > `MCP`. Haz clic en `+ Add New MCP Server`. Escribe el nombre `compra-agil`, selecciona el tipo `Stdio`, escribe en command `node` y en args `C:/ruta/completa/mcp-compra-agil/dist/index.js`. El ticket se toma del `.env` del proyecto.
* **Windsurf:** Dirígete a la pestaña de MCP en Ajustes e ingresa la misma configuración Stdio.

### 7. Agentes Personalizados (Node.js/Python SDK)
Si estás construyendo tu propio agente o pipeline automatizado con el SDK oficial de MCP:
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["C:/ruta/completa/mcp-compra-agil/dist/index.js"],
  // Sin `env`: el servidor lee el ticket del .env de la carpeta del proyecto.
});

const client = new Client({ name: "mi-agente-cliente", version: "1.0.0" });
await client.connect(transport);

// Listar herramientas y recursos disponibles
const tools = await client.listTools();
const resources = await client.listResources();
```

---

## 📖 Catálogo del Servidor

### Herramientas Disponibles (Tools)

| Nombre de la Herramienta | Descripción de Entrada / Salida |
| :--- | :--- |
| `buscar_compras_agiles` | Busca procesos utilizando palabras clave (con filtros inteligentes locales), región (1-16), estado y ventana temporal. Parámetros `q` e `id` son excluyentes. Cada resultado trae el RUT del organismo y la fecha del último cambio. |
| `obtener_detalle_compra` | Detalle exhaustivo de una cotización: descripción, ítems y cotizaciones recibidas (confidenciales hasta el estado *Cerrada*). Incluye el código de estado, el número de llamado y, si la moneda no es CLP, el tipo de cambio. |
| `monitorear_cambios_recientes` | Sincronización reactiva e incremental por ventana de cambios, con soporte para paginación. Dos modos excluyentes: **relativo** (`minutos`, máx 1440 / 24 h) o **absoluto** (`cambio_desde`/`cambio_hasta` en ISO-8601, sin techo de 24 h) para resincronizar un período arbitrario. |
| `verificar_orden_compra` | Informa si un proceso tiene OC emitida. **No consulta la API por su cuenta** (gastaba cuota para responder siempre "no puedo saberlo"): reutiliza el detalle si ya está en caché e indica cómo confirmarlo en la ficha pública — ver [Limitaciones](#️-limitaciones-conocidas-de-la-api). |
| `obtener_detalle_orden_compra` | Desglose de productos y facturación de una OC. ⚠ **El código debe venir de otra fuente** (la OC que te emitieron, un correo, la ficha pública): consulta la API legada de Órdenes de Compra, y la de Compra Ágil no entrega códigos de OC. |
| `obtener_estadisticas_uso` | Cuántas consultas lleva esta instalación en el día UTC y si ya recibió un 429. ⚠ Es un **conteo local**, no el saldo del ticket: la API no publica cuánta cuota queda. Persiste entre reinicios. Desde la 2.8.0 suma **métricas** de esta sesión: latencia (media, mediana, p95, máxima) y errores por herramienta, y consultas a la API por resultado (caché, 200, 504, 429, timeout). |
| `verificar_ticket` | Comprueba que el ticket configurado funcione contra la API real **sin revelar su valor** (solo muestra `••••1234`). Primer diagnóstico recomendado. |
| `verificar_hora_oficial` | Contrasta el reloj de esta máquina con la hora oficial de Chile (`ntp.shoa.cl`, del SHOA). El servidor ya corrige sus plazos con esa hora cuando puede medirla; esta herramienta muestra el desfase, si la corrección está activa y la versión de la base de zonas horarias que da el paso a UTC-3/UTC-4. No consume cuota de Mercado Público. |
| `obtener_enlace_documento` | Entrega el enlace a la **ficha pública** del proceso, que es donde el adjunto sí es accesible (en un navegador). El enlace heredado de descarga directa se ofrece advirtiendo que hoy responde 404. |
| `descargar_y_leer_documento` | ⚠ **Hoy no puede descargar los adjuntos de Compra Ágil**: el portal dejó de servirlos por enlace directo (404 verificado) y en la ficha el archivo lo genera JavaScript, sin URL que pedir. Para IDs numéricos responde de inmediato con el enlace a la ficha, sin gastar el intento. Los UUID sí se intentan. |
| `consultar_documentos_locales` | Busca dentro de los PDF/TXT/MD de `docs/`. Admite **preguntas en lenguaje natural** ("¿qué multas me pueden aplicar?"), no solo palabras sueltas: descompone la consulta en términos, ignora acentos y palabras vacías, y ordena por densidad de coincidencias. Devuelve como máximo 3 archivos y nombra los que quedaron fuera. En preguntas de negocio (plazos, multas, requisitos) mandan las guías; en preguntas sobre el servidor o la API, el manual medido va primero. Si ningún fragmento reúne la mitad de los términos, lo advierte. |
| `analizar_precios_mercado` | Analiza la distribución de precios **cotizados** por la competencia en procesos similares (mín/p25/mediana/promedio/máx) y sugiere un precio competitivo. Advierte cuando la muestra es demasiado dispersa o pequeña. Acepta `palabras_clave_requeridas`/`excluidas` para no mezclar productos. ⚠ Analiza precios cotizados, **no adjudicados** — ver [Limitaciones](#️-limitaciones-conocidas-de-la-api). |
| `auditar_compras_desiertas` | Analiza por qué una convocatoria quedó desierta, cruzando su presupuesto y plazo contra los precios que el mercado cotizó en procesos del mismo rubro. Parte por la evidencia del propio proceso (motivo oficial, cotizaciones, inadmisibilidades) y no infiere requisitos si el problema fue el precio. Dice cuántos comparables sostienen cada lectura. |
| `generar_borrador_cotizacion` | Auto-completa propuestas JSON de cotización bajo el esquema oficial, calculando impuestos (19% IVA) y redactando la carta de presentación. Marca los campos a revisar: placeholders, el total frente al presupuesto (el precio por defecto cabe con IVA) y si el pedido completo puede estar en los adjuntos. |
| `radar_oportunidades_calientes` | Califica y ordena convocatorias publicadas con un score ponderado (Hot Score, máx 115) de competencia, urgencia de cierre, presupuesto, simplicidad y **segundo llamado**. Cada resultado trae el desglose de factores y el campo `llamado`. Auto-pagina. |
| `generar_informe` | Genera un **informe profesional imprimible** (HTML autocontenido, diseño A4/Carta/Oficio) y devuelve la ruta del archivo. Tipos: `radar`, `cotizacion`, `precio`, `auditoria` y `competencia`. Ver [Informes](#️-informes-imprimibles). |
| `estado_vigilancia` | Qué ve y qué no ve la vigilancia de procesos nuevos: último lote revisado, lotes pendientes o incompletos, huecos sin revisar, **ceguera**, avisos por canal, alertas sin confirmar del modo gateway, cuota proyectada y si hay un vigilante activo. Úsala antes de afirmar «no hay procesos nuevos». No consulta la API. |
| `obtener_alertas_nuevas` | **Modo gateway** (OpenClaw, Hermes): revisa los lotes de cambios nuevos, si nadie más está vigilando, y entrega las alertas sin confirmar con un `lote_id`. Lo que no se confirma vuelve a ofrecerse a los 30 min. Gasta unas pocas consultas por cada 5 min desde la última revisión. |
| `confirmar_alertas` | Marca como entregado un lote de `obtener_alertas_nuevas`. Llamarla dos veces no cambia nada. |
| `probar_avisos` | Envía un mensaje de prueba por cada canal configurado (Telegram, webhook, correo) y dice cuál llegó. No acepta un destino: los destinos se fijan solo en el `.env`. |
| `configurar_criterios` | Cambia qué se alerta: palabras clave, exclusiones, regiones, presupuesto mínimo y «solo sin ofertas»; `restablecer=true` vuelve al `.env`. **Todo cambio se avisa por los canales** con el antes y el después. |

### Recursos Disponibles (Resources)

| URI del Recurso | Tipo de Mime | Descripción de Contenido |
| :--- | :--- | :--- |
| `compra-agil://regiones` | `application/json` | Catálogo maestro de mapeo de las 16 regiones administrativas de Chile y sus identificadores numéricos. |
| `compra-agil://estados` | `application/json` | Estados de la API con su comportamiento **real verificado**: marca cuáles funcionan (`publicada`, `cerrada`, `desierta`, `cancelada`) y cuáles no (`proveedor_seleccionado` devuelve 0; `oc_emitida` da HTTP 400), pese a estar ambos documentados oficialmente. |
| `compra-agil://glosario` | `application/json` | Glosario de acrónimos del dominio de ChileCompra para contextualización semántica de la IA. |
| `compra-agil://compras/{codigo}` | `application/json` | Recurso dinámico que resuelve el objeto JSON puro devuelto por la API v2 de una Compra Ágil usando su código único. |
| `compra-agil://documentacion/{filename}` | `text/plain` | Recurso dinámico que lee y extrae todo el contenido de texto de un PDF/TXT/MD local en la carpeta `docs/` en tiempo real. Los documentos viajan en el paquete — ver la nota siguiente. |

#### 📚 La documentación viaja en el paquete

Desde la 2.7.0 el paquete de npm incluye las guías y manuales de `docs/api` y `docs/guias` (12 documentos, ~10 MB comprimido, entre ellos la guía de vigilancia y el contrato del webhook): con `npx` o `npm install` verás los 15 recursos y `consultar_documentos_locales` buscará en ellos igual que en un clon. Las notas de ingeniería (`docs/internals/`) no viajan y nunca se ofrecen como documentación.

**Para agregar tus propios documentos** (bases técnicas, normativa interna), clona el repositorio y ponlos en `docs/`: el servidor usa la carpeta `docs/` del paquete cuando tiene documentos, así que en una instalación por npm una carpeta `docs/` en tu directorio de trabajo no se lee.

### Prompts Disponibles

* **`buscar_oportunidades_proveedor`:** Plantilla estructurada para guiar a la IA a consultar la región del proveedor, buscar compras publicadas afines y filtrar las 5 mejores ofertas libres de competidores.
* **`analizar_competencia`:** Plantilla de comandos para comparar precios unitarios y totales de los participantes de un proceso finalizado, identificando la brecha económica (spread) entre ofertas. *Nota: el motivo de selección no está disponible — la API no publica adjudicaciones.*

---

## ⚠️ Limitaciones conocidas de la API

Estos hallazgos fueron **verificados empíricamente** contra el servicio real de Mercado Público (julio 2026, 45 procesos y 52 cotizaciones inspeccionados; **re-confirmados en septiembre de 2026** junto a una auditoría de las 15 herramientas de esa pasada). `verificar_hora_oficial`, añadida en la 2.5.0, no consulta esta API. La [Guía oficial API Compra Ágil v2](docs/api/) documenta un comportamiento distinto en cada uno de estos puntos.

### 🔴 Las fechas están en hora de Chile, aunque digan "Z"

| La documentación sugiere | La API real hace |
| :--- | :--- |
| `fecha_ultimo_cambio` con "Z" es UTC | Es la **hora de Chile** con una "Z" que no le corresponde |
| `ttl_cambio_ms` = cambios de los últimos N ms | Compara esas marcas contra la hora UTC real: **una ventana menor a 3 horas vuelve vacía** |

Medido el 6 de octubre de 2026 con el reloj verificado contra el SHOA: a las 15:42 de Chile el cambio más reciente decía `15:40Z`, y 89 de 92 cierres caen en horario de oficina leídos como hora de Chile. **Hasta la 2.7.0 este servidor los leía como UTC**: mostraba cada cierre 3 horas antes, el radar ocultaba los procesos que cerraban en las 3 horas siguientes y el monitoreo de menos de 3 horas venía vacío. Desde la 2.8.0 se leen como hora de Chile y las ventanas se mandan como la API compara.

### 🔴 La API no publica adjudicaciones

| La documentación dice | La API real hace |
| :--- | :--- |
| `estado=proveedor_seleccionado` es un filtro válido | Se acepta, pero devuelve **siempre 0 resultados** |
| `estado=oc_emitida` "está definido en el modelo" | **HTTP 400** — no es un filtro válido |
| `orden_compra.id_orden_compra` | El sub-objeto **no existe**; solo `id_orden_compra` en la raíz |
| `seleccion.*`, `estado_cotizacion.*` | **No existen**; hay `estado` (número) |
| `proveedor_seleccionado: boolean` | Es un **número** (`0` \| `1`) |

En la muestra, `proveedor_seleccionado` valió `0` en el **100 %** de las cotizaciones y **ningún** proceso traía `id_orden_compra`.

**Consecuencia práctica:** no es posible saber qué oferta ganó ni obtener precios adjudicados. `analizar_precios_mercado` se apoya en precios **cotizados**, que sí son señal de mercado real. `verificar_orden_compra` **ya no consulta la API por su cuenta**: gastaba cuota para responder siempre "no puedo saberlo". Reutiliza el detalle si ya está en caché y, en cualquier caso, indica cómo confirmarlo en la ficha pública. Un "sin OC" **no prueba** que la OC no exista, solo que la API no la publica.

### 📊 Dónde viven los precios

Solo los procesos **`desierta`** publican sus cotizaciones (medido: `desierta` 5/8 procesos con precios; `cerrada` 0/8). Por eso el análisis de precios se basa en ellos.

Casi todas esas cotizaciones están declaradas *inadmisibles* — es justamente lo que dejó desierto al proceso. **Se incluyen igualmente** en las estadísticas: un precio ofertado es señal de mercado aunque le hayan rechazado el papeleo, y los motivos reales observados son mayoritariamente formales (*"no cumple con garantía"*, *"no cuenta con giro acorde"*), no de precio. La herramienta reporta los motivos para que puedas ponderarlos.

### 📎 Los adjuntos no se pueden descargar por programa

| La documentación dice | La realidad medida (septiembre 2026) |
| :--- | :--- |
| `documentos[].id` es un `string (UUID)` | La API devuelve **enteros** (observados `1855508`, `1854909`) |
| Los adjuntos se descargan por su ID | El endpoint heredado responde **404** para todos los adjuntos de Compra Ágil |
| — | En la ficha pública el enlace es un `<a>` con `href` vacío: la descarga la dispara **JavaScript**, sin URL que un programa pueda pedir |

Las **cotizaciones nunca expusieron adjuntos**: el array `documentos[]` existe solo a nivel del proceso, no dentro de `proveedores_cotizando[]`.

**Consecuencia práctica:** si un llamado dice *"ver características en adjunto"*, esas especificaciones solo se pueden leer abriendo la ficha en un navegador. Las herramientas de documentos llevan ahí directamente en vez de fallar.

### ⏱️ El 429 no es una cuota diaria: es un balde que se recarga

La guía se contradice a sí misma. Su §4 dice esperar *"hasta el inicio del siguiente día calendario"*, pero su §7 manda esperar el header **`Retry-After`** y el glosario define la cuota como un **token bucket** que *"se recarga automáticamente"*. **La medición respalda lo segundo: tras un 429, la API volvió a responder con normalidad 13 minutos después.**

Por eso este servidor **no bloquea hasta el día siguiente**: honra `Retry-After` y, si no viene, aplica una espera creciente (15 → 30 → 60 → 120 min) que la primera consulta exitosa reinicia. Si recibes un 429, reintenta en unos minutos antes de suponer que agotaste el día.

### 🐌 Otras restricciones medidas

* **Las consultas sin filtros devuelven HTTP 500.** Hay que enviar al menos un filtro.
* **`tamano_pagina` mínimo es 10** (valores `1` y `5` devuelven HTTP 400).
* **La API es lenta, y empeoró.** Medido el 8 de septiembre de 2026 sobre nueve consultas: búsqueda simple **10-12 s**, búsqueda con texto **13-17 s**, y detalle de un proceso **21-25 s**, con **HTTP 504 intermitentes** en el detalle (1 de cada 3 en esa muestra). La pasarela corta a los ~30 s, así que las consultas grandes fallan enteras. Las herramientas de análisis piden sus detalles en paralelo y la caché evita repetirlos, pero conviene mantener `limite_analisis` bajo: cada unidad es una llamada de detalle más, y cada una puede caerse.
* **El segundo llamado es poco frecuente:** 6% de los procesos cerrados/desiertos y 0,5% de los activos.

---

## 🖨️ Informes imprimibles

`generar_informe` produce un HTML autocontenido (sin scripts ni recursos externos) con diseño de impresión real, y **devuelve la ruta del archivo, no su contenido** — un informe pesa decenas de KB y retornarlo al modelo consumiría miles de tokens de contexto.

| Formato | Medidas | Uso |
| :--- | :--- | :--- |
| **`carta`** (por defecto) | 216 × 279 mm | Estándar de oficina en Chile |
| **`oficio`** | 216 × 330 mm | Folio chileno, documentos oficiales |
| **`a4`** | 210 × 297 mm | Estándar ISO |

> El oficio chileno **no** equivale al `legal` de CSS (216 × 356 mm, US Legal): usarlo agregaría 26 mm de alto. Va declarado con dimensiones explícitas.

Abre el archivo en tu navegador y usa **Ctrl+P** para exportarlo a PDF, seleccionando el papel correspondiente en el diálogo de impresión.

Los informes se guardan en `informes/` de la carpeta de datos (ver [Integración](#-integración-con-clientes-mcp-y-agentes)), o en la carpeta que fije `COMPRA_AGIL_INFORMES_DIR`. `ruta_salida` solo acepta una subcarpeta dentro de ella (ej: `radar/octubre`): el modelo elige ese valor después de leer textos de terceros, así que no puede escribir en otra parte del disco.

| Tipo | Qué imprime |
| :--- | :--- |
| `radar` | Oportunidades activas ordenadas por puntuación |
| `cotizacion` | Borrador de cotización: ítems, neto, IVA 19 % y carta. No se envía a Mercado Público |
| `precio` | Distribución de precios **cotizados** (gráfico de mínimo, p25, mediana, promedio y máximo) |
| `auditoria` | Brechas de presupuesto y plazo de un proceso desierto, con recomendaciones |
| `competencia` | Tabla de cotizantes y la brecha entre el menor y el mayor monto. No nombra un adjudicado |

Para iterar el diseño sin consumir cuota de la API ni requerir ticket:
```bash
npx tsx scripts/preview-informe.ts   # radar en los tres papeles, y las otras cuatro plantillas en carta
```

---

## 💡 Ejemplos Prácticos de Interacción

* **Búsqueda Multi-Filtro:**
  * *Usuario:* "¿Qué compras ágiles de materiales eléctricos están publicadas en Valparaíso?"
  * *Acción del LLM:* Traduce "Valparaíso" al código de región `5` usando `compra-agil://regiones` y llama a `buscar_compras_agiles` con `q="materiales electricos"`, `estado="publicada"`, `region="5"`.
* **Análisis de precios para cotizar:**
  * *Usuario:* "Quiero cotizar resmas de papel, ¿a qué precio está el mercado?"
  * *Acción del LLM:* Llama a `analizar_precios_mercado` con `q="resmas papel"`. Recibe la distribución de precios cotizados y el percentil 25 como referencia competitiva.
* **Informe de oportunidades:**
  * *Usuario:* "Genérame un informe en oficio del radar de oportunidades de la RM."
  * *Acción del LLM:* Llama a `generar_informe` con `tipo="radar"`, `region="13"`, `formato_papel="oficio"`. Recibe la ruta del HTML listo para imprimir.
* **Cotización para presentar:**
  * *Usuario:* "Armame la cotización de `1057539-228-COT26` a nombre de mi empresa."
  * *Acción del LLM:* Llama a `generar_informe` con `tipo="cotizacion"` y el código. Recibe la ruta de un HTML con ítems, IVA y carta. El archivo no se envía a Mercado Público.
* **Auditoría de un proceso desierto:**
  * *Usuario:* "¿Por qué quedó desierta la compra `758-329-COT26`?"
  * *Acción del LLM:* Llama a `auditar_compras_desiertas` con `codigo_compra="758-329-COT26"`. Recibe el motivo oficial, las brechas de presupuesto/plazo frente al mercado y recomendaciones.

---

## 📄 Licencia
Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para obtener más información.
