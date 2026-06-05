# Síntesis, Explicación, Lógica e Índice de la API Compra Ágil v2

Este documento contiene la síntesis detallada página por página y el índice general condensado de la documentación de la **API Compra Ágil v2** (Mercado Público de Chile), estructurado para su uso en el diseño e implementación de un servidor **MCP (Model Context Protocol)**.

---

## 📌 Índice General: API Compra Ágil v2

### 1. Introducción y Fundamentos
*   **1.1. ¿Qué es Compra Ágil?** `[Pág. 3]`
    *   Mecanismo de contratación simplificada del Estado de Chile.
    *   Identificación de de procesos (formato de código único: `XXXXXX-YYY-COTXX`).
*   **1.2. Casos de Uso Clave** `[Pág. 3]`
    *   Monitoreo en tiempo real, sincronización incremental, transparencia.
*   **1.3. Entorno de Conexión** `[Pág. 3]`
    *   URL Base Oficial: `https://api2.mercadopublico.cl`

### 2. Autenticación y Credenciales
*   **2.1. Obtención del Ticket de Acceso** `[Pág. 3]`
    *   Registro y validación de identidad con Clave Única en chilecompra.cl.
*   **2.2. Cabeceras HTTP (Headers)** `[Pág. 4]`
    *   Header obligatorio: `ticket: TU_TICKET_AQUI`.
    *   Ejemplos de autenticación rápida en cURL y Python.

### 3. Control de Tráfico y Límites (Rate Limiting)
*   **3.1. Algoritmo Token Bucket y Cuotas** `[Pág. 4]`
    *   Límites basados en día calendario (reseteo automático a medianoche UTC).
*   **3.2. Gestión del Error 429 (Too Many Requests)** `[Pág. 5]`
    *   Estructura del payload de error.
    *   Algoritmo para calcular el tiempo de espera dinámico y evitar el bloqueo del ticket.

### 4. Referencia de la API (Endpoints y Parámetros)
*   **4.1. Listado y Búsqueda (`GET /v2/compra-agil`)** `[Pág. 6-7]`
    *   *Filtros temporales (Ventana de cambios y fechas de publicación).*
    *   *Filtros por estado (Publicada, cerrada, desierta, cancelada, proveedor_seleccionado).*
    *   *Filtros geográficos (Códigos de Región 1 al 16).*
    *   *Búsqueda por texto libre (`q`) o código específico (`id`).*
    *   *Paginación y ordenamiento de resultados.*
    *   *Limitaciones conocidas (Ausencia de filtro directo por organismo).*
*   **4.2. Detalle de una Compra (`GET /v2/compra-agil/{codigo}`)** `[Pág. 8]`
    *   *Reglas de visibilidad de ofertas (Primer vs. Segundo llamado).*
    *   *Fases de la Convocatoria.*

### 5. Diccionario de Datos (Modelos de Datos y Campos)
*   **5.1. Esquema del Listado (`payload.items[]`)** `[Pág. 9]`
    *   Estructura del JSON de respuesta corta.
*   **5.2. Esquema del Detalle Completo (`payload`)** `[Pág. 10]`
    *   Información general, plazos de entrega y presupuestos.
*   **5.3. Módulo de Orden de Compra (`payload.orden_compra`)** `[Pág. 10]`
    *   Mapeo de la OC asociada (`id_orden_compra` como clave confiable).
*   **5.4. Módulo de Productos Solicitados (`payload.productos_solicitados[]`)** `[Pág. 11]`
*   **5.5. Módulo de Proveedores y Cotizaciones (`payload.proveedores_cotizando[]`)** `[Pág. 11-12]`
    *   Identificación de empresas (EMT), ofertas financieras (neto, IVA, despacho, total) y desglose de productos cotizados.
*   **5.6. Metadatos, Motivos y Sostenibilidad** `[Pág. 13]`
    *   Flags ambientales y sociales. Motivos de descarte o cancelación.

### 6. Gestión de Excepciones y Errores HTTP
*   **6.1. Respuestas "NOK"** `[Pág. 13]`
    *   Estructura JSON del arreglo `errors[]`.
*   **6.2. Matriz de Códigos de Estado HTTP** `[Pág. 13]`
    *   Acciones recomendadas para códigos `400`, `401`, `403`, `404`, `429`, `500` y `503`.

### 7. Guía de Integración Práctica (Ejemplos de Código)
*   **7.1. Monitoreo de Publicaciones en Tiempo Real** `[Pág. 14]`
*   **7.2. Sincronización Incremental de Base de Datos** `[Pág. 15]`
*   **7.3. Búsqueda Multi-Filtro (Texto + Región + Estado)** `[Pág. 16]`
*   **7.4. Consulta de Detalle e Información de Negocio** `[Pág. 16]`
*   **7.5. Algoritmo de Paginación Automatizada** `[Pág. 17]`
*   **7.6. Cruce de Datos para Detección de Órdenes de Compra Reales** `[Pág. 17-18]`

### 8. Recursos de Apoyo
*   **8.1. Glosario de Términos del Dominio** `[Pág. 19]`
    *   Conceptos técnicos (API, Token Bucket, Payload) y de compras estatales (DCCP, EMT, OC).

---

## 📝 Análisis de Lógica y Síntesis Página por Página

### **Página 01**
*   **Sección:** Portada oficial.
*   **Lógica:** Identifica la procedencia (`v2` de la API de Compra Ágil de Mercado Público, v3.0 de la guía, de mayo de 2026). Establece el punto de partida y la vigencia.

### **Página 02**
*   **Sección:** Historial de versiones.
*   **Lógica:** Informa sobre correcciones a inconsistencias críticas en respuestas reales vs documentadas históricamente (como el comportamiento real de `oc_emitida`, campos adicionales para proveedores, y límites de filtrado). Previene errores de asunción en el desarrollo de la lógica del MCP.

### **Página 03**
*   **Sección:** Introducción y Primeros Pasos.
*   **Lógica:** Explica la base del negocio (Compra Ágil como contratación directa y simplificada) y la obtención del ticket usando Clave Única. Establece la URL base oficial (`https://api2.mercadopublico.cl`).

### **Página 04**
*   **Sección:** Autenticación y Control de Cuotas.
*   **Lógica:** Detalla el uso obligatorio de la cabecera `ticket` y cómo funciona el límite de solicitudes por día calendario (resetea al cambiar de día, no a las 24h).

### **Página 05**
*   **Sección:** Límite Excedido (Error 429) y Mitigación.
*   **Lógica:** Estructura de error JSON ante cuota agotada y código para calcular la pausa requerida hasta el reseteo diario. Es la lógica central que debe implementar el controlador de red del MCP para evitar interrupciones o bloqueos del ticket.

### **Página 06**
*   **Sección:** Endpoints y Filtros de Fecha.
*   **Lógica:** Define los dos endpoints (`GET /v2/compra-agil` y `GET /v2/compra-agil/{codigo}`) y parámetros de ventana de cambios (`ttl_cambio_ms`, `cambio_desde`, `cambio_hasta`, etc.).

### **Página 07**
*   **Sección:** Filtros Avanzados (Estados, Región, Búsqueda, Orden).
*   **Lógica:** Enumera los estados y códigos de región oficiales (1-16). Explica la exclusión mutua de parámetros de búsqueda (`q` vs `id`) y la limitación de no contar con filtrado directo por organismo público.

### **Página 08**
*   **Sección:** Endpoint de Detalle y Reglas del Modelo.
*   **Lógica:** Lógica para mostrar las ofertas/proveedores según la etapa de convocatoria (Llamado 1 vs Llamado 2) y cuándo se libera el detalle de las cotizaciones (a partir de estado Cerrada en el segundo llamado).

### **Página 09**
*   **Sección:** Esquema del Listado (`items[]`).
*   **Lógica:** Estructura ligera del payload del listado. Útil para optimizar tokens de contexto enviando solo los campos requeridos por la IA en la búsqueda inicial.

### **Página 10**
*   **Sección:** Esquema del Detalle e Integración con Orden de Compra.
*   **Lógica:** Detalla cómo relacionar una Compra Ágil con su Orden de Compra mediante `id_orden_compra` ya que `codigo_orden_compra` suele retornar nulo incluso con la OC emitida.

### **Página 11**
*   **Sección:** Productos Solicitados y Proveedores Cotizando (Parte 1).
*   **Lógica:** Define las estructuras para identificar los productos solicitados y las propiedades generales de las empresas oferentes (incluyendo su categorización como Empresa de Menor Tamaño - EMT).

### **Página 12**
*   **Sección:** Proveedores Cotizando (Parte 2 - Cotizaciones).
*   **Lógica:** Describe detalladamente los campos económicos y técnicos de cada cotización (impuestos, despacho, descripciones libres de las propuestas y desglose del valor unitario).

### **Página 13**
*   **Sección:** Resumen, Motivos, Flags y Manejo de Errores.
*   **Lógica:** Tabla de códigos HTTP y lógica de negocio asociada a banderas sostenibles. El MCP debe traducir estos códigos a respuestas legibles para el LLM.

### **Página 14**
*   **Sección:** Ejemplo 8.1 (Última hora).
*   **Lógica:** Muestra el uso de `ttl_cambio_ms` para monitoreo reactivo.

### **Página 15**
*   **Sección:** Ejemplo 8.2 (Sincronización incremental).
*   **Lógica:** Lógica de ventanas deslizantes utilizando `cambio_desde` y `cambio_hasta`.

### **Página 16**
*   **Sección:** Ejemplos 8.3 (Búsqueda multi-filtro) y 8.4 (Lectura de detalle).
*   **Lógica:** Implementación directa de llamadas GET y análisis básico de datos.

### **Página 17**
*   **Sección:** Ejemplo 8.5 (Paginación automática) y Ejemplo 8.6 (Cruce con OC).
*   **Lógica:** Bucle incremental de páginas y resolución del problema de emisión de OC mediante inspección profunda de compras en `proveedor_seleccionado`.

### **Página 18**
*   **Sección:** Página en blanco.
*   **Lógica:** Elemento espaciador sin contenido de texto en el PDF.

### **Página 19**
*   **Sección:** Glosario.
*   **Lógica:** Definiciones clave del dominio.
