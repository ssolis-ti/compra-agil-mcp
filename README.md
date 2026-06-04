# MCP Server: Compra Ágil v2 — Mercado Público de Chile 🇨🇱

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Servidor [MCP (Model Context Protocol)](https://modelcontextprotocol.io) desarrollado en TypeScript que envuelve e integra de forma avanzada la API REST de **Compra Ágil v2** y la API de **Órdenes de Compra (OC)** de [Mercado Público](https://www.mercadopublico.cl). Permite a cualquier IA, agente autónomo o cliente compatible interrogar, filtrar, auditar y prospectar procesos de compra estatal del gobierno de Chile.

El proyecto está diseñado bajo una arquitectura modular y cuenta con dos modos de operación principales:
1. **Servidor Interactivo MCP:** Comunicación bidireccional vía Stdio para integrarse directamente con el chat y herramientas de tu IDE o cliente (Cursor, Claude Desktop, Windsurf, etc.).
2. **Demonio de Alertas en Segundo Plano:** Servicio de consulta incremental autónomo que rastrea procesos de alto valor con **0 oferentes** y guarda alertas automatizadas en un registro local.

---

## 📋 Tabla de Contenidos
* [¿Qué es Compra Ágil?](#qué-es-compra-ágil)
* [Características Clave](#características-clave)
* [Requisitos](#requisitos)
* [Instalación](#instalación)
* [Configuración de Variables de Entorno](#configuración-de-variables-de-entorno)
* [Uso y Modos de Ejecución](#uso-y-modos-de-ejecución)
  * [Desarrollo](#desarrollo)
  * [Producción](#producción)
  * [Monitoreo Autónomo](#monitoreo-autónomo)
  * [Testing con MCP Inspector](#testing-con-mcp-inspector)
* [Integración con Clientes MCP](#integración-con-clientes-mcp)
  * [Claude Desktop](#claude-desktop)
  * [OpenClaw](#openclaw)
  * [Cursor / Windsurf](#cursor--windsurf)
* [Catálogo del Servidor](#catálogo-del-servidor)
  * [Herramientas Disponibles (Tools)](#herramientas-disponibles-tools)
  * [Recursos Disponibles (Resources)](#recursos-disponibles-resources)
  * [Prompts Disponibles](#prompts-disponibles)
* [Ejemplos Prácticos de Interacción](#ejemplos-prácticos-de-interacción)
* [Licencia](#licencia)

---

## 🔍 ¿Qué es Compra Ágil?

Compra Ágil es el mecanismo de adquisición simplificado y directo del Estado de Chile para montos inferiores a 100 UTM. Permite a los organismos públicos convocar de forma abierta a cotizaciones rápidas a través de Mercado Público, promoviendo la participación de Empresas de Menor Tamaño (EMT).

---

## ⚡ Características Clave
* **Modernizado para SDK v1.12+:** Carga declarativa y robusta de herramientas, recursos y prompts bajo los nuevos estándares del protocolo.
* **Integración del Detalle de OC:** Resuelve de forma dinámica el código alfanumérico o ID numérico de las Órdenes de Compra utilizando la API legada de Mercado Público.
* **Enriquecimiento Inteligente de la OC:** Corrige las limitaciones de la API oficial donde el estado `oc_emitida` no funciona en producción. El servidor busca de forma recursiva a nivel raíz y anidado el `id_orden_compra` y enlaza el desglose de productos y datos del proveedor ganador.
* **Rate Limiting Local:** Algoritmo *Token Bucket* integrado que limita el consumo (máximo 40 llamadas por minuto) y procesa el error 429 de forma transparente para evitar la inhabilitación temporal del ticket.
* **Logs Nativos en el Protocolo:** Inyección de la notificación `sendLoggingMessage` de MCP para registrar y depurar la actividad del servidor directamente dentro de la interfaz del cliente.

---

## 📌 Requisitos y Obtención de Credenciales

Para utilizar este servidor MCP necesitas:
1. **Node.js v22+** (se utiliza la API nativa de `fetch` y soporte nativo para módulos ESM).
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

> "Por favor, inicializa y configura este servidor MCP en mi entorno local. Entra a la carpeta `mcp-compra-agil`, ejecuta `npm install` para instalar dependencias y compila el proyecto con `npm run build`. Una vez compilado con éxito, registra el servidor MCP en mis ajustes (Cursor, Roo Code, Cline, Continue o Claude Desktop según corresponda) configurando la herramienta para que se ejecute con `node` apuntando al archivo `dist/index.js` y vinculando el token `COMPRA_AGIL_TICKET` (búscalo en mi archivo `.env` o pídemelo)."

---

### Opción B: 💻 Instalación Manual clásica
Si prefieres realizar la instalación tú mismo desde la terminal:
```bash
# Entrar al proyecto
cd mcp-compra-agil

# Instalar dependencias de desarrollo y producción
npm install

# Compilar el código fuente TypeScript (.ts -> .js en dist/)
npm run build
```

---

### Opción C: 📦 Ejecución directa vía NPX (Publicación en NPM)
El servidor está configurado para empaquetarse de manera compacta. Si decides publicarlo en el registro de paquetes de NPM (ej: con `npm publish`), cualquier otra persona podrá ejecutarlo e integrarlo de forma instantánea **sin necesidad de descargar el código fuente ni compilarlo manualmente**:

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

Crea un archivo `.env` en la raíz del directorio `mcp-compra-agil/` para ingresar tus credenciales y ajustar las configuraciones por defecto:

```env
# Ticket oficial de acceso a la API (Obligatorio)
COMPRA_AGIL_TICKET=tu_ticket_aqui

# URL Base para las llamadas a la API v2 (por defecto api2.mercadopublico.cl)
COMPRA_AGIL_BASE_URL=https://api2.mercadopublico.cl

# --- Parámetros del Demonio de Monitoreo ---
# Intervalo entre búsquedas en minutos (por defecto 1 hora)
MONITOR_INTERVAL_MINUTES=60
# Presupuesto mínimo en CLP para emitir alerta (ej: 5.000.000)
MONITOR_MIN_BUDGET_CLP=5000000
# Palabras clave a buscar separadas por coma
MONITOR_KEYWORDS=software, desarrollo, licencias, plataforma, sistema, soporte, cloud
```

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
Para ejecutar el demonio de alertas en segundo plano (vigila oportunidades sin oferentes y escribe los reportes en `alerts.log`):
```bash
npm run monitor
```

### Testing con MCP Inspector
Para probar las herramientas, recursos y prompts en una interfaz gráfica local:
```bash
npm run inspect
```

---

## 🔌 Integración con Clientes MCP y Agentes

Este servidor se comunica de manera estándar mediante Stdio. A continuación se detallan las instrucciones para integrarlo con los clientes y agentes más comunes del ecosistema:

### 1. Claude Desktop
Añade el servidor a tu archivo de configuración global editando `%APPDATA%\Claude\claude_desktop_config.json` (en Windows) o `~/Library/Application Support/Claude/claude_desktop_config.json` (en macOS):

```json
{
  "mcpServers": {
    "compra-agil": {
      "command": "node",
      "args": ["C:\\ruta\\completa\\mcp-compra-agil\\dist\\index.js"],
      "env": {
        "COMPRA_AGIL_TICKET": "tu_ticket_de_chilecompra_aqui"
      }
    }
  }
}
```

### 2. Claude Code (`claudecode`)
Para registrar el servidor de forma global en Claude Code (el agente CLI de Anthropic), ejecuta el siguiente comando en tu terminal **antes** de iniciar tu sesión de `claude`:
```bash
claude mcp add compra-agil --env COMPRA_AGIL_TICKET=tu_ticket_de_chilecompra_aqui -- node C:\ruta\completa\mcp-compra-agil\dist\index.js
```
*Nota: Si estás en un proyecto local, puedes usar rutas relativas o el comando local.*
Para comprobar que se cargó con éxito, inicia una sesión de `claude` y escribe el comando `/mcp` o ejecuta `claude mcp list` en tu terminal.

### 3. OpenClaw
Para registrar el servidor en OpenClaw (el cliente de terminal y automatización open source), puedes hacerlo de dos formas:

#### A. Vía CLI (Recomendado)
Ejecuta en tu consola:
```bash
openclaw mcp add compra-agil node "C:\\ruta\\completa\\mcp-compra-agil\\dist\\index.js"
openclaw mcp set compra-agil env.COMPRA_AGIL_TICKET "tu_ticket_de_chilecompra_aqui"
```
#### B. Edición de Archivo de Configuración
Abre tu archivo de configuración de OpenClaw (típicamente localizado en `~/.openclaw/openclaw.json` o `~/.openclaw/openclaw.json5`) e integra el servidor dentro de la sección `"mcpServers"`:
```json5
  "mcpServers": {
    "compra-agil": {
      "command": "node",
      "args": ["C:/ruta/completa/mcp-compra-agil/dist/index.js"],
      "env": {
        "COMPRA_AGIL_TICKET": "tu_ticket_de_chilecompra_aqui"
      }
    }
  }
```
*Asegúrate de ajustar los permisos de sandbox de herramientas (`tools.sandbox.tools` o `tools.sandbox.allowlist`) en tu config de OpenClaw para permitir la ejecución del comando `node`.*

### 4. Open-Code / VSCodium / VS Code (Extensiones de Agentes)

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
         "env": {
           "COMPRA_AGIL_TICKET": "tu_ticket_de_chilecompra_aqui"
         },
         "disabled": false
       }
     }
   }
   ```
4. Guarda el archivo y la extensión refrescará automáticamente registrando las nuevas herramientas.

#### Con la extensión **Continue**:
Abre tu archivo `~/.continue/config.json` y añade la configuración en el bloque `"mcpServers"`:
```json
"mcpServers": [
  {
    "name": "compra-agil",
    "command": "node",
    "args": ["C:/ruta/completa/mcp-compra-agil/dist/index.js"],
    "env": {
      "COMPRA_AGIL_TICKET": "tu_ticket_de_chilecompra_aqui"
    }
  }
]
```

### 5. Cursor / Windsurf
* **Cursor:** Dirígete a `Settings` > `Features` > `MCP`. Haz clic en `+ Add New MCP Server`. Escribe el nombre `compra-agil`, selecciona el tipo `Stdio`, escribe en command `node` y en args `C:/ruta/completa/mcp-compra-agil/dist/index.js`. Añade la variable `COMPRA_AGIL_TICKET`.
* **Windsurf:** Dirígete a la pestaña de MCP en Ajustes e ingresa la misma configuración Stdio.

### 6. Agentes Personalizados (Node.js/Python SDK)
Si estás construyendo tu propio agente o pipeline automatizado con el SDK oficial de MCP:
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["C:/ruta/completa/mcp-compra-agil/dist/index.js"],
  env: {
    COMPRA_AGIL_TICKET: "tu_ticket_de_chilecompra_aqui"
  }
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
| `buscar_compras_agiles` | Busca procesos utilizando palabras clave, región (1-16), estado (publicada, cerrada, etc.) y ventana temporal. Parámetros `q` e `id` son excluyentes. |
| `obtener_detalle_compra` | Detalle exhaustivo de una cotización: descripción, ítems y cotizaciones recibidas (confidenciales hasta el estado *Cerrada*). |
| `monitorear_cambios_recientes` | Sincronización reactiva e incremental en los últimos N minutos (ventana máxima de 1440 min / 24 horas). |
| `verificar_orden_compra` | Comprobación de emisión de OC resolviendo inconsistencias de la API pública. Retorna el ID de la OC y acopla dinámicamente los desgloses económicos y datos del adjudicado. |
| `obtener_detalle_orden_compra` | Consulta detallada del desglose de productos y facturación de una OC utilizando su código alfanumérico o ID numérico. |
| `obtener_estadisticas_uso` | Retorna las estadísticas del limitador de solicitudes local (`requestsToday`, `isLimited`) para optimizar el consumo de la cuota del ticket. |

### Recursos Disponibles (Resources)

| URI del Recurso | Tipo de Mime | Descripción de Contenido |
| :--- | :--- | :--- |
| `compra-agil://regiones` | `application/json` | Catálogo maestro de mapeo de las 16 regiones administrativas de Chile y sus identificadores numéricos. |
| `compra-agil://estados` | `application/json` | Estados admitidos por la API y notas técnicas sobre su comportamiento real para optimizar las queries. |
| `compra-agil://glosario` | `application/json` | Glosario de acrónimos del dominio de ChileCompra para contextualización semántica de la IA. |
| `compra-agil://compras/{codigo}` | `application/json` | Recurso dinámico que resuelve el objeto JSON puro devuelto por la API v2 de una Compra Ágil usando su código único. |

### Prompts Disponibles

* **`buscar_oportunidades_proveedor`:** Plantilla estructurada para guiar a la IA a consultar la región del proveedor, buscar compras publicadas afines y filtrar las 5 mejores ofertas libres de competidores.
* **`analizar_competencia`:** Plantilla de comandos para comparar precios unitarios y totales de los participantes de un proceso finalizado, identificando la brecha económica (spread) y el motivo de selección.

---

## 💡 Ejemplos Prácticos de Interacción

* **Búsqueda Multi-Filtro:**
  * *Usuario:* "¿Qué compras ágiles de materiales eléctricos están publicadas en Valparaíso?"
  * *Acción del LLM:* Traduce "Valparaíso" al código de región `5` usando `compra-agil://regiones` y llama a `buscar_compras_agiles` con `q="materiales electricos"`, `estado="publicada"`, `region="5"`.
* **Auditoría de Adjudicaciones:**
  * *Usuario:* "¿Quién ganó la licitación de computadores con código `2376-331-COT26`?"
  * *Acción del LLM:* Llama a `verificar_orden_compra` con `codigo="2376-331-COT26"` para identificar al proveedor seleccionado, y luego consulta el desglose de productos utilizando `obtener_detalle_orden_compra` con el ID de la OC devuelto.

---

## 📄 Licencia
Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para obtener más información.
