# MCP Server: Compra Ágil v2 — Mercado Público de Chile 🇨🇱

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Servidor [MCP (Model Context Protocol)](https://modelcontextprotocol.io) desarrollado en TypeScript que envuelve e integra de forma avanzada la API REST de **Compra Ágil v2** y la API de **Órdenes de Compra (OC)** de [Mercado Público](https://www.mercadopublico.cl). Permite a cualquier IA, agente autónomo o cliente compatible interrogar, filtrar, auditar y prospectar procesos de compra estatal del gobierno de Chile.

El proyecto está diseñado bajo una arquitectura modular y cuenta con tres modos de operación:
1. **Servidor Interactivo MCP:** Comunicación bidireccional vía Stdio para integrarse directamente con el chat y herramientas de tu IDE o cliente (Cursor, Claude Desktop, Windsurf, etc.).
2. **Daemon de Alertas en Segundo Plano:** Servicio de consulta incremental autónomo que rastrea procesos de alto valor con **0 oferentes** y guarda alertas automatizadas en un registro local.
3. **Generador de Informes:** Produce documentos imprimibles autocontenidos en formatos **Carta, Oficio y A4**.

> 📌 **Antes de usarlo en decisiones de negocio**, lee [Limitaciones conocidas de la API](#️-limitaciones-conocidas-de-la-api). La documentación oficial de ChileCompra difiere del comportamiento real en puntos importantes — este servidor implementa lo que la API **hace**, no lo que promete.

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
* **Alertas Automatizadas:** El Daemon en segundo plano notifica oportunidades que coincidan con tu presupuesto mínimo y rubro.

> ⚠️ **Importante:** la API de Mercado Público **no publica qué oferta ganó**. Todo el análisis de precios se basa en cotizaciones presentadas, no en adjudicaciones. Lee [Limitaciones conocidas](#-limitaciones-conocidas-de-la-api) antes de usarlo en decisiones de negocio.

---

## ⚡ Características Clave
* **Modernizado para SDK v1.12+:** Carga declarativa y robusta de herramientas, recursos y prompts bajo los nuevos estándares del protocolo.
* **Carga de Entorno Autónoma:** El servidor detecta y carga de forma automática y manual el archivo `.env` del directorio de trabajo al iniciarse, facilitando la conexión en clientes MCP de escritorio sin necesidad de configurar variables de sistema globales.
* **Lector de Documentación Integrado (Recursos):** Exposición nativa de guías, normativas y manuales en PDF (dentro de la carpeta `docs/`) como recursos del protocolo MCP (`compra-agil://documentacion/{filename}`). El servidor extrae el texto del PDF de manera local y lo inyecta en el LLM bajo demanda.
* **Filtrado Inteligente Anti-Ruido:** Filtros locales en la herramienta `buscar_compras_agiles` (`palabras_clave_requeridas` y `palabras_clave_excluidas`) para afinar búsquedas amplias de la API y remover ofertas irrelevantes.
* **Paginación Inteligente y Monitoreo Completo:** La herramienta de cambios recientes admite navegación de páginas (`numero_pagina`), y el demonio de monitoreo periódico procesa de forma recursiva todas las páginas de resultados (`client.buscarTodo()`) para evitar pérdidas de alertas.
* **Integración del Detalle de OC:** Resuelve de forma dinámica el código alfanumérico o ID numérico de las Órdenes de Compra utilizando la API legada de Mercado Público.
* **Validado contra la API real:** El comportamiento documentado por ChileCompra difiere del real en varios puntos. Este servidor implementa lo que la API **hace**, no lo que promete, y lo documenta en [Limitaciones conocidas](#-limitaciones-conocidas-de-la-api). Hay tests de regresión que blindan cada hallazgo.
* **Redacción de credenciales:** Todo texto que sale del proceso (logs, errores, respuestas) pasa por un punto único de redacción que borra el ticket. Es relevante porque `sendLoggingMessage` envía los logs al cliente MCP — es decir, al contexto del modelo y a la transcripción.
* **Rate Limiting Local:** Throttle proactivo que espacia las solicitudes bajo un máximo por minuto **antes** de enviarlas, además de reaccionar al error 429 para evitar la inhabilitación temporal del ticket.
* **Informes imprimibles:** Genera documentos HTML autocontenidos con diseño de impresión real (`@page`, saltos controlados, cabeceras de tabla repetidas) en formatos **Carta, Oficio y A4**.
* **Logs Nativos en el Protocolo:** Inyección de la notificación `sendLoggingMessage` de MCP para registrar y depurar la actividad del servidor directamente dentro de la interfaz del cliente.
* **Manejo Seguro de Documentos (UUID):** Evita errores de tipo `Authentication parameters missing` al tratar con archivos adjuntos protegidos de Compra Ágil (UUIDs) redirigiendo al usuario a la ficha pública del buscador (`https://buscador.mercadopublico.cl/ficha?code={codigo}`) en lugar de entregar enlaces de descarga directa inaccesibles.

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

Copia la plantilla y complétala con tus credenciales:

```bash
cp .env.example .env   # en Windows: copy .env.example .env
```

```env
# Ticket oficial de acceso a la API (Obligatorio)
COMPRA_AGIL_TICKET=tu_ticket_aqui

# URL Base para las llamadas a la API v2 (por defecto api2.mercadopublico.cl)
COMPRA_AGIL_BASE_URL=https://api2.mercadopublico.cl

# Nivel de log: debug | info | warn | error
LOG_LEVEL=info

# --- Parámetros del Daemon de Monitoreo ---
# Intervalo entre búsquedas en minutos (por defecto 1 hora)
MONITOR_INTERVAL_MINUTES=60
# Presupuesto mínimo en CLP para emitir alerta (ej: 5.000.000)
MONITOR_MIN_BUDGET_CLP=5000000
# Palabras clave a buscar separadas por coma
MONITOR_KEYWORDS=software, desarrollo, licencias, plataforma, sistema, soporte, cloud
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
Para ejecutar el Daemon de alertas en segundo plano (vigila oportunidades sin oferentes y escribe los reportes en `alerts.log`):
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
| `buscar_compras_agiles` | Busca procesos utilizando palabras clave (con filtros inteligentes locales), región (1-16), estado y ventana temporal. Parámetros `q` e `id` son excluyentes. |
| `obtener_detalle_compra` | Detalle exhaustivo de una cotización: descripción, ítems y cotizaciones recibidas (confidenciales hasta el estado *Cerrada*). |
| `monitorear_cambios_recientes` | Sincronización reactiva e incremental en los últimos N minutos (ventana máxima de 1440 min / 24 horas), con soporte para paginación. |
| `verificar_orden_compra` | Comprueba si un proceso tiene OC emitida leyendo `id_orden_compra` y cruzándolo con la API de OC. ⚠ En la práctica reportará "sin OC" casi siempre: la API no publica adjudicaciones — ver [Limitaciones](#-limitaciones-conocidas-de-la-api). |
| `obtener_detalle_orden_compra` | Consulta detallada del desglose de productos y facturación de una OC utilizando su código alfanumérico o ID numérico. |
| `obtener_estadisticas_uso` | Retorna las estadísticas del limitador de solicitudes local (`requestsToday`, `isLimited`) para optimizar el consumo de la cuota del ticket. |
| `verificar_ticket` | Comprueba que el ticket configurado funcione contra la API real **sin revelar su valor** (solo muestra `••••1234`). Primer diagnóstico recomendado. |
| `obtener_enlace_documento` | Genera el link público y oficial de descarga de un archivo adjunto del proceso de Mercado Público. |
| `descargar_y_leer_documento` | Descarga y extrae el texto plano de un documento adjunto en PDF del proceso de compra de forma remota, permitiendo realizar búsquedas de palabras clave. |
| `consultar_documentos_locales` | Busca y extrae fragmentos coincidentes dentro de los archivos PDF/TXT/MD de ayuda de Compra Ágil guardados en la carpeta local `docs/`. |
| `analizar_precios_mercado` | Analiza la distribución de precios **cotizados** por la competencia en procesos similares (mín/p25/mediana/promedio/máx) y sugiere un precio competitivo. Advierte cuando la muestra es demasiado dispersa. ⚠ Analiza precios cotizados, **no adjudicados** — ver [Limitaciones](#-limitaciones-conocidas-de-la-api). |
| `auditar_compras_desiertas` | Analiza por qué una convocatoria quedó desierta, cruzando su presupuesto y plazo contra los precios que el mercado cotizó en procesos del mismo rubro. Reporta el motivo oficial de deserción. |
| `generar_borrador_cotizacion` | Auto-completa propuestas JSON de cotización bajo el esquema oficial, calculando impuestos (19% IVA) y redactando la carta de presentación. Marca explícitamente los campos placeholder. |
| `radar_oportunidades_calientes` | Califica y ordena convocatorias publicadas según un score ponderado (Hot Score) de competencia (sin oferentes), urgencia, presupuesto y simplicidad. Auto-pagina. |
| `generar_informe` | Genera un **informe profesional imprimible** (HTML autocontenido, diseño A4/Carta/Oficio) y devuelve la ruta del archivo. Ver [Informes](#-informes-imprimibles). |

### Recursos Disponibles (Resources)

| URI del Recurso | Tipo de Mime | Descripción de Contenido |
| :--- | :--- | :--- |
| `compra-agil://regiones` | `application/json` | Catálogo maestro de mapeo de las 16 regiones administrativas de Chile y sus identificadores numéricos. |
| `compra-agil://estados` | `application/json` | Estados de la API con su comportamiento **real verificado**: marca cuáles funcionan (`publicada`, `cerrada`, `desierta`, `cancelada`) y cuáles no (`proveedor_seleccionado` devuelve 0; `oc_emitida` da HTTP 400), pese a estar ambos documentados oficialmente. |
| `compra-agil://glosario` | `application/json` | Glosario de acrónimos del dominio de ChileCompra para contextualización semántica de la IA. |
| `compra-agil://compras/{codigo}` | `application/json` | Recurso dinámico que resuelve el objeto JSON puro devuelto por la API v2 de una Compra Ágil usando su código único. |
| `compra-agil://documentacion/{filename}` | `text/plain` | Recurso dinámico que lee y extrae todo el contenido de texto de un PDF/TXT/MD local en la carpeta `docs/` en tiempo real. |

### Prompts Disponibles

* **`buscar_oportunidades_proveedor`:** Plantilla estructurada para guiar a la IA a consultar la región del proveedor, buscar compras publicadas afines y filtrar las 5 mejores ofertas libres de competidores.
* **`analizar_competencia`:** Plantilla de comandos para comparar precios unitarios y totales de los participantes de un proceso finalizado, identificando la brecha económica (spread) entre ofertas. *Nota: el motivo de selección no está disponible — la API no publica adjudicaciones.*

---

## ⚠️ Limitaciones conocidas de la API

Estos hallazgos fueron **verificados empíricamente** contra el servicio real de Mercado Público (julio 2026, 45 procesos y 52 cotizaciones inspeccionados). La [Guía oficial API Compra Ágil v2](docs/api/) documenta un comportamiento distinto en cada uno de estos puntos.

### 🔴 La API no publica adjudicaciones

| La documentación dice | La API real hace |
| :--- | :--- |
| `estado=proveedor_seleccionado` es un filtro válido | Se acepta, pero devuelve **siempre 0 resultados** |
| `estado=oc_emitida` "está definido en el modelo" | **HTTP 400** — no es un filtro válido |
| `orden_compra.id_orden_compra` | El sub-objeto **no existe**; solo `id_orden_compra` en la raíz |
| `seleccion.*`, `estado_cotizacion.*` | **No existen**; hay `estado` (número) |
| `proveedor_seleccionado: boolean` | Es un **número** (`0` \| `1`) |

En la muestra, `proveedor_seleccionado` valió `0` en el **100 %** de las cotizaciones y **ningún** proceso traía `id_orden_compra`.

**Consecuencia práctica:** no es posible saber qué oferta ganó ni obtener precios adjudicados. `analizar_precios_mercado` se apoya en precios **cotizados**, que sí son señal de mercado real. `verificar_orden_compra` reportará "sin OC" casi siempre — lo que **no prueba** que la OC no exista, solo que la API no la publica.

### 📊 Dónde viven los precios

Solo los procesos **`desierta`** publican sus cotizaciones (medido: `desierta` 5/8 procesos con precios; `cerrada` 0/8). Por eso el análisis de precios se basa en ellos.

Casi todas esas cotizaciones están declaradas *inadmisibles* — es justamente lo que dejó desierto al proceso. **Se incluyen igualmente** en las estadísticas: un precio ofertado es señal de mercado aunque le hayan rechazado el papeleo, y los motivos reales observados son mayoritariamente formales (*"no cumple con garantía"*, *"no cuenta con giro acorde"*), no de precio. La herramienta reporta los motivos para que puedas ponderarlos.

### 🐌 Otras restricciones medidas

* **Las consultas sin filtros devuelven HTTP 500.** Hay que enviar al menos un filtro.
* **`tamano_pagina` mínimo es 10** (valores `1` y `5` devuelven HTTP 400).
* **La API es lenta:** entre 1 y 14 segundos por consulta según el tamaño de página.

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

Para iterar el diseño sin consumir cuota de la API ni requerir ticket:
```bash
npx tsx scripts/preview-informe.ts   # genera los tres formatos con datos de muestra
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
* **Auditoría de un proceso desierto:**
  * *Usuario:* "¿Por qué quedó desierta la compra `758-329-COT26`?"
  * *Acción del LLM:* Llama a `auditar_compras_desiertas` con `codigo_compra="758-329-COT26"`. Recibe el motivo oficial, las brechas de presupuesto/plazo frente al mercado y recomendaciones.

---

## 📄 Licencia
Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para obtener más información.
