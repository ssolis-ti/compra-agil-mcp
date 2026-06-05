# Manual del Servidor MCP Compra Ágil v2

Este manual describe en detalle la arquitectura, el funcionamiento, la modularidad y el catálogo de herramientas (tools), recursos (resources) y prompts de la integración de **Compra Ágil v2** de Mercado Público (Chile) bajo el estándar **Model Context Protocol (MCP)**.

---

## 1. Introducción y Conceptos de MCP

El **Model Context Protocol (MCP)** es un estándar abierto que permite a modelos de lenguaje (LLMs) y asistentes inteligentes (como Cursor, Claude Desktop o Windsurf) interactuar de forma segura con herramientas locales, bases de datos y APIs externas. 

Este servidor actúa como un **puente de comunicación**:
1. El **Cliente MCP (IDE/IA)** detecta las intenciones del usuario y solicita al servidor ejecutar una acción mediante mensajes JSON-RPC.
2. El **Servidor MCP** procesa la solicitud, interactúa con la API REST de Mercado Público de Chile, maneja los límites de cuota (Rate Limiting), mapea las inconsistencias de datos de la API y devuelve una respuesta estructurada.
3. El **Modelo de Lenguaje** lee los datos limpios y genera una respuesta en lenguaje natural para el usuario.

---

## 2. Arquitectura y Estructura del Proyecto

El servidor está estructurado de manera modular para separar la capa de comunicación de red, las utilidades del protocolo y las definiciones de herramientas, promoviendo la fácil extensión del sistema.

### Árbol de Directorios del Código Fuente (`mcp-compra-agil/src/`)
```text
mcp-compra-agil/src/
├── index.ts                  # Punto de entrada y registro de componentes MCP
├── api/                      # Cliente HTTP central de la API de Mercado Público
│   └── compra-agil-client.ts # Manejo de endpoints, cabeceras y token bucket
├── tools/                    # Implementación de las Herramientas (Tools) del MCP
│   ├── buscar-compras.ts     # Búsqueda general y paginada de cotizaciones
│   ├── detalle-compra.ts     # Obtención del detalle de un proceso
│   ├── detalle-oc.ts         # Consulta detallada de Órdenes de Compra (OC API)
│   ├── verificar-oc.ts       # Validador robusto de emisión de OC (Ejemplo 8.6)
│   ├── monitorear-cambios.ts # Rastreo de actualizaciones recientes
│   └── estadisticas-uso.ts   # Métricas del consumo del RateLimiter local
├── resources/                # Recursos Estáticos y Dinámicos del MCP
│   ├── regiones.ts           # Listado de las 16 regiones de Chile y sus códigos
│   ├── estados.ts            # Diccionario semántico de estados de compra
│   ├── glosario.ts           # Definiciones del dominio de compras públicas
│   └── compras-template.ts   # Recurso dinámico de compras individuales
├── prompts/                  # Plantillas de Prompts guías para la IA
│   ├── buscar-oportunidades.ts # Flujo guiado para prospección de licitaciones
│   └── analizar-competencia.ts  # Plantilla para evaluar ofertas y spreads de competidores
├── services/                 # Servicios de ejecución en segundo plano (Daemon)
│   └── monitor.ts            # Demonio para alertas de compras con 0 ofertas
└── utils/                    # Funciones y clases auxiliares
    ├── rate-limiter.ts       # Control de tráfico (Token Bucket de 40 solicitudes/min)
    ├── error-handler.ts      # Procesamiento de códigos HTTP y formateador amigable
    └── logger.ts             # Emisor de logs integrados al flujo de transporte nativo
```

---

## 3. Modularidad y Flujo de Datos

### Capa de Red y Resiliencia (`api/` & `utils/`)
* **CompraAgilClient:** Encapsula las solicitudes HTTP usando el método nativo `fetch` de Node.js. 
* **Ruteo Dinámico de Endpoints:** Centraliza y diferencia las llamadas dirigidas a la API v2 de Compra Ágil (`https://api2.mercadopublico.cl/v2/`) de las llamadas dirigidas a los endpoints legados de Órdenes de Compra (`https://api.mercadopublico.cl/servicios/v1/publico/`), inyectando de forma transparente el ticket del proveedor en los Headers o en los parámetros Query String según corresponda.
* **Manejo del Error 429 y Rate Limiting:** Implementa un limitador `RateLimiter` tipo **Token Bucket** para mitigar la suspensión del ticket ante solicitudes concurrentes. Mapea el error `429` de Mercado Público devolviendo un mensaje explicativo con recomendaciones de resguardo para la IA.
* **Sanitización del Modelo de Datos:** Corrige de forma transparente inconsistencias comunes de la API de Mercado Público (como el mapeo inconsistente de `id_orden_compra` a nivel de raíz vs nivel anidado y el formato de flag entero `proveedor_seleccionado: 1` en lugar de booleanos).

### Registro en el Servidor (`index.ts`)
El servidor inicializa el canal de comunicación a través de **Stdio (Standard Input/Output)** compatible con clientes MCP. Registra de forma declarativa cada una de las herramientas, recursos y plantillas de prompts exponiéndolas directamente al cliente durante la fase de negociación inicial del protocolo.

---

## 4. Catálogo Detallado de Herramientas (Tools)

Las herramientas son funciones semánticas ejecutables por la IA para resolver requerimientos específicos.

### 1. `buscar_compras_agiles`
* **Descripción:** Busca y filtra procesos de Compra Ágil. Los parámetros de texto libre (`q`) y código exacto del proceso (`id`) son mutuamente excluyentes en la API.
* **Parámetros Clave:**
  * `q` *(string, opcional)*: Palabras clave en el título.
  * `id` *(string, opcional)*: Código exacto del proceso (ej: `1057539-228-COT26`).
  * `estado` *(string, opcional)*: Estados separados por coma (ej: `publicada,cerrada`).
  * `region` *(string, opcional)*: Código de la región (1-16).
  * `publicado_desde` / `publicado_hasta` *(string, opcional)*: Ventanas temporales (formato `YYYY-MM-DD`).
* **Respuesta:** Retorna un listado compacto optimizado en tokens con códigos de proceso, nombres, estados, presupuestos, fechas de cierre e instituciones compradoras.

### 2. `obtener_detalle_compra`
* **Descripción:** Obtiene la ficha completa de un proceso de Compra Ágil.
* **Parámetros:**
  * `codigo` *(string, requerido)*: Código del proceso (ej: `926-21-COT26`).
* **Regla de Negocio:** La lista de cotizaciones de proveedores y sus montos detallados se mantiene vacía (`proveedores_cotizando: []`) por normativa de ChileCompra mientras el proceso se encuentre **"Publicada"** (abierta a ofertas) para evitar la colusión. Se liberan al pasar a estado **"Cerrada"** (segundo llamado) o **"Proveedor seleccionado"**.

### 3. `monitorear_cambios_recientes`
* **Descripción:** Detecta procesos creados o actualizados en los últimos N minutos.
* **Parámetros:**
  * `minutos` *(number, requerido)*: Ventana temporal (máximo 1440 min / 24h).
  * `estado` / `region` *(string, opcional)*: Filtros adicionales de filtrado.

### 4. `verificar_orden_compra`
* **Descripción:** Comprueba si un proceso ya cuenta con una Orden de Compra emitida.
* **Solución de Inconsistencia:** Resuelve una falla de la API donde el estado `oc_emitida` no funciona en la práctica y el campo `codigo_orden_compra` retorna nulo. Evalúa directamente si `id_orden_compra` es distinto de nulo a nivel raíz o anidado. Si se encuentra un ID, consulta de forma reactiva la API de Órdenes de Compra para acoplar la información de montos y el nombre del proveedor seleccionado.

### 5. `obtener_detalle_orden_compra`
* **Descripción:** Obtiene el desglose completo de una Orden de Compra de Mercado Público.
* **Parámetros:**
  * `id_orden_compra` *(string/number, requerido)*: ID numérico o código alfanumérico de la OC.
* **Respuesta:** Detalle de artículos comprados, plazos de entrega, montos netos, IVA, despacho e información de facturación del proveedor.

### 6. `obtener_estadisticas_uso`
* **Descripción:** Permite a la IA consultar en tiempo real el consumo actual de cuotas del Rate Limiter local para optimizar el número de llamadas.

### 7. `obtener_enlace_documento`
* **Descripción:** Genera el enlace de descarga pública oficial en Mercado Público para un adjunto (bases, especificaciones o anexos) usando su ID de documento.

### 8. `descargar_y_leer_documento`
* **Descripción:** Descarga un documento adjunto de Mercado Público (bases técnicas/administrativas) en formato PDF usando su ID, extrae su texto y lo retorna al LLM. Permite búsqueda local de palabras clave.

### 9. `consultar_documentos_locales`
* **Descripción:** Busca y lee información dentro de los manuales, normativas o guías de Compra Ágil almacenados localmente en la carpeta `docs/` (soporta formatos .pdf, .txt, .md).

### 10. `recomendar_precio_ganador`
* **Descripción:** Analiza procesos históricos similares de Compra Ágil que ya fueron adjudicados para sugerir un precio unitario o total óptimo y competitivo para postular.

### 11. `auditar_compras_desiertas`
* **Descripción:** Analiza y audita las causas de por qué un proceso quedó desierto (sin ofertas), comparándolo contra históricos exitosos similares (presupuesto, plazos, etc.).

### 12. `generar_borrador_cotizacion`
* **Descripción:** Genera automáticamente un borrador estructurado en formato JSON con la propuesta de cotización de un proveedor, calculando sumas e IVA e incorporando una carta formal de presentación.

### 13. `radar_oportunidades_calientes`
* **Descripción:** Escanea, califica y clasifica de forma priorizada los procesos de Compra Ágil activos (publicados) mediante un score ponderado (Hot Score) de competencia y conveniencia.

---

## 5. Catálogo de Recursos (Resources)

Los recursos son fuentes de información estática o dinámica expuestas bajo esquemas de URIs que la IA puede leer como contexto adicional.

* **`compra-agil://regiones`:** Catálogo de mapeo de las 16 regiones de Chile. Permite a la IA traducir nombres de regiones (ej: "Valparaíso") a su código de filtro numérico (`5`).
* **`compra-agil://estados`:** Detalle semántico de los estados de una Compra Ágil con notas sobre su comportamiento real en producción.
* **`compra-agil://glosario`:** Glosario de acrónimos del dominio de adquisiciones del Estado chileno (ej: *DCCP, EMT, RUT, OC*).
* **`compra-agil://compras/{codigo}`:** Recurso dinámico que permite la lectura directa de la ficha JSON cruda de un proceso ingresando su código único de cotización.
* **`compra-agil://documentacion/{filename}`:** Recurso dinámico que lee y extrae todo el contenido de texto plano de un documento local PDF, TXT o MD de la carpeta `docs/` en tiempo real.

---

## 6. Catálogo de Prompts

Los prompts son plantillas estructuradas de conversación que el usuario puede invocar desde el cliente para guiar a la IA en flujos de trabajo complejos.

* **`buscar_oportunidades_proveedor`:** Guía a la IA paso a paso para identificar el código de la región de un proveedor, buscar cotizaciones abiertas afines a su rubro y redactar un reporte comparativo con los procesos de mayor presupuesto y menor cantidad de competidores.
* **`analizar_competencia`:** Estructura un análisis comparativo de precios unitarios y totales de los proveedores oferentes tras el cierre de una Compra Ágil, detectando el spread del mercado e identificando si el proveedor seleccionado fue el más económico.

---

## 7. Servicio de Monitoreo en Segundo Plano (Daemon)

Además de actuar como servidor interactivo MCP, el proyecto incluye un script autónomo de monitoreo periódicamente ejecutable:

### Funcionamiento de `services/monitor.ts`
El demonio corre de forma independiente y realiza ciclos periódicos de consulta:
1. Hace consultas incrementales mediante la función `cambiosRecientes` basándose en el intervalo establecido.
2. Aplica un pipeline de 4 filtros lógicos en memoria:
   * **Estado:** El proceso debe ser una oportunidad vigente abierta (`estado.codigo: "publicada"`).
   * **Ofertas:** El proceso debe registrar exactamente **0 ofertas recibidas** (`total_ofertas_recibidas === 0`).
   * **Presupuesto:** El monto disponible debe superar un límite mínimo configurable (para priorizar oportunidades de alto valor).
   * **Coincidencia:** El título del proceso debe contener al menos una de las palabras clave configuradas.
3. Si un proceso supera los filtros, genera una alerta y la añade de forma permanente con marca de tiempo al archivo local **`alerts.log`**.

### Variables de Entorno del Demonio (`.env`)
```env
# Frecuencia del ciclo (minutos)
MONITOR_INTERVAL_MINUTES=60

# Presupuesto mínimo en pesos chilenos para generar alerta
MONITOR_MIN_BUDGET_CLP=5000000

# Palabras clave a buscar (separadas por coma)
MONITOR_KEYWORDS=software, desarrollo, licencias, plataforma, sistema, soporte
```

---

## 8. Guía de Ejecución y Despliegue

### Requisitos Previos
* Node.js v22 o superior.
* Ticket válido de acceso API Mercado Público.

### Comandos de Consola
```bash
# Instalar dependencias del proyecto
npm install

# Compilar archivos TypeScript (.ts -> .js en dist/)
npm run build

# Iniciar el demonio de monitoreo autónomo
npm run monitor

# Ejecutar el inspector interactivo de herramientas MCP
npm run inspect
```
