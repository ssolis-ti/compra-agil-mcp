# Guía de Contribución (CONTRIBUTING)

¡Gracias por tu interés en contribuir al servidor MCP de Compra Ágil v2! Como proyecto de código abierto enfocado en mejorar la transparencia y eficiencia en las compras del Estado de Chile, valoramos enormemente cada Pull Request, reporte de bug o sugerencia.

Para mantener una base de código limpia, mantenible y robusta, solicitamos a todos los desarrolladores seguir los siguientes lineamientos de diseño de software y flujos de trabajo.

---

## 1. Principios de Arquitectura del Proyecto

Este servidor se rige por principios de **Clean Architecture** adaptados a microservicios del Model Context Protocol:
* **Separación de Responsabilidades:** La lógica de red (`api/`), la definición del protocolo MCP (`tools/` y `resources/`) y la lógica auxiliar (`utils/`) deben estar estrictamente desacopladas.
* **Inyección de Dependencias:** El cliente HTTP (`CompraAgilClient`) se inyecta en cada módulo de herramienta durante su registro, evitando inicializaciones cruzadas o variables globales de conexión.
* **Resiliencia ante todo (Graceful Degradation):** Las herramientas deben capturar los errores de la API externa (como la cuota diaria agotada 429 o caídas 503) utilizando el formateador central [error-handler.ts](src/utils/error-handler.ts) para retornar explicaciones claras y sugerencias accionables que la IA pueda comprender, en lugar de provocar un crash en el transporte.

---

## 2. Configuración del Entorno de Desarrollo

1. **Bifurcar (Fork) y Clonar:**
   ```bash
   git clone https://github.com/tu-usuario/mcp-compra-agil.git
   cd mcp-compra-agil
   ```
2. **Instalar Dependencias:**
   ```bash
   npm install
   ```
3. **Configurar Variables de Entorno:**
   Crea un archivo `.env` en la raíz del proyecto:
   ```env
   COMPRA_AGIL_TICKET=tu_ticket_de_chilecompra_aqui
   COMPRA_AGIL_BASE_URL=https://api2.mercadopublico.cl
   ```
4. **Modo Desarrollo (Live Reload):**
   ```bash
   npm run dev
   ```

---

## 3. Guía de Desarrollo para Componentes MCP

Si vas a agregar una nueva herramienta o recurso, asegúrate de cumplir con los siguientes estándares:

### A. Nuevas Herramientas (Tools)
* Crea el archivo correspondiente dentro de `src/tools/` (ej: `src/tools/mi-herramienta.ts`).
* Define parámetros de entrada autodescriptivos mediante esquemas de **Zod**. Recuerda que las descripciones de los campos son leídas por el modelo de lenguaje (LLM); sé preciso y proporciona ejemplos.
* Exporta una función de registro con la firma `registerMiHerramienta(server: McpServer, client: CompraAgilClient): void`.
* Llama a `server.registerTool` (SDK v1.12+) envolviendo la descripción y el esquema Zod de entrada en el objeto `config`.
* Retorna siempre un objeto con estructura `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`.

### B. Mapeo de Respuestas de la API
* Si la API real de Mercado Público devuelve un payload complejo, define interfaces TypeScript detalladas dentro de [compra-agil-client.ts](src/api/compra-agil-client.ts).
* Modela las respuestas de las herramientas para que entreguen la menor cantidad de tokens posibles, eliminando metadatos o arreglos redundantes que saturen la ventana de contexto de la IA.

---

## 4. Convenciones de Ramas y Commits

Adoptamos el estándar de **Conventional Commits**. Los mensajes de commit deben seguir la estructura: `<tipo>(<ámbito>): <descripción>`

### Tipos Válidos:
* `feat`: Nueva funcionalidad (ej: `feat(tools): agregar detalle de orden de compra`).
* `fix`: Resolución de un bug (ej: `fix(api): corregir mapeo de proveedor seleccionado`).
* `docs`: Cambios en la documentación (ej: `docs(mcp): crear guia de contribucion`).
* `style`: Cambios cosméticos que no afectan la lógica del código.
* `refactor`: Reestructuración de código sin añadir características nuevas.
* `test`: Adición o corrección de pruebas unitarias/integración.
* `chore`: Actualizaciones de dependencias o tareas de mantenimiento (ej: `chore: actualizar npm scripts`).

### Flujo de Trabajo con Ramas (Git Flow Simplificado):
* Toda mejora debe implementarse en una rama secundaria: `feature/nombre-de-mejora` o `bugfix/nombre-de-error`.
* Se prohíbe realizar commits directos sobre la rama `main`.
* Los Pull Requests (PR) deben dirigirse hacia la rama `develop` para su integración y posterior promoción a `main`.

---

## 5. Lista de Verificación Antes de Crear un PR (Publishing Checklist)

Antes de enviar tus cambios para revisión, verifica que:
1. [ ] El código TypeScript compila de forma exitosa ejecutando `npm run build` sin generar advertencias.
2. [ ] `npm test` pasa completo. La CI (`.github/workflows/ci.yml`) lo corre en Ubuntu y Windows con Node 20 y 22, incluida una prueba de humo que arranca el servidor por stdio, y rechaza vulnerabilidades altas en las dependencias de producción.
3. [ ] Se han actualizado los archivos de documentación correspondientes si cambiaste o agregaste alguna herramienta o parámetro.
4. [ ] No has expuesto de forma accidental credenciales ni tokens de la API (`.env`) en el historial de Git.
5. [ ] El formateador y linter no reportan conflictos estéticos.

---

## 6. Publicar una versión

La publicación en npm la hace GitHub Actions (`.github/workflows/publicar.yml`) al empujar un tag de versión. Requiere una sola vez el secret `NPM_TOKEN` en el repositorio (Settings → Secrets and variables → Actions), con un token de npm de tipo *Automation*.

1. En un PR: subir la versión con `npm version X.Y.Z --no-git-tag-version` y mover `[Unreleased]` del CHANGELOG a `[X.Y.Z] - fecha`.
2. Fusionar ese PR en `main`.
3. Crear y empujar el tag sobre `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`.

El workflow se detiene antes de publicar si falta el token, si el tag no coincide con `package.json` o si el CHANGELOG no tiene su sección. Si la versión ya existe en npm (se publicó a mano con `npm publish`), no vuelve a publicar: solo crea la release de GitHub. Publicar es irreversible: npm no permite reutilizar un número de versión.

Para publicar a mano, desde `main` y con los clientes MCP cerrados: `npm ci && npm publish --access public` (`prepublishOnly` compila y corre los tests); luego empujar el tag para la release.

