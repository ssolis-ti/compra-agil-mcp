# Especificación 2.10–2.12 — Espacio de cotización

De «encontrar la compra» a «subir la oferta», sin salir del agente. Se trabaja
igual que la [2.9.0](../2.9.0-vigilancia-y-avisos/README.md): requisitos →
diseño → tareas → prueba que falla → código, con una puerta por fase.

| Documento | Pregunta que responde |
| :--- | :--- |
| [requisitos.md](requisitos.md) | ¿Qué tiene que pasar para que esté bien? |
| [diseno.md](diseno.md) | ¿Cómo se construye sin romper lo que hay? |
| [tareas.md](tareas.md) | ¿En qué orden, y cómo sé que terminé cada paso? |
| ADR [0029](../../adr/0029-lectores-de-documentos-sin-modulos-nativos.md)–[0032](../../adr/0032-documentos-generados-los-revisa-el-usuario.md) | ¿Por qué así? |
| [Medición de formatos](../../qa/medicion-formatos-adjuntos.md) | ¿Qué adjuntos hay de verdad? |

## Por qué, y la ventaja

Medido el 16-oct: **el 43 % de los adjuntos no se podía leer** (33 % `.docx`,
7 % `.doc`). Y cotizar es más que leer. Hoy la gente arma la oferta fuera del
agente, a mano.

Lo que hay disponible (búsqueda del 16-oct):
- **Otros servidores MCP de Mercado Público** consultan la API y nada más: no leen adjuntos ni guardan trabajo.
- **Servicios de alertas** (LicitAlertas) avisan y resumen bases, en la nube y de pago.

Este servidor ya avisa (2.9) y analiza precios. Con esta especificación cubre
el ciclo completo, **en el equipo del usuario y gratis**:

| Paso | Herramienta | Versión |
| :--- | :--- | :--- |
| Encontrar | vigilancia, `buscar_compras_agiles`, radar, `exportar_procesos` | 2.9 / **2.10** |
| Leer todo | `descargar_y_leer_documento` en PDF, DOCX, DOC, XLSX, CSV y ZIP | **2.10** |
| Entender | `requisitos_de_la_compra`: lista de verificación del TDR | **2.11** |
| Trabajar | espacio de cotización con estado, notas y archivos | **2.11** |
| Poner precio | precios de mercado (2.6) + **tus precios** cruzados con lo pedido | **2.12** |
| Entregar | carta `.docx` y planilla `.xlsx` listas para revisar y subir | **2.12** |
| Aprender | historial propio: qué ganaste, qué perdiste y a qué precio | **2.12** |

## Versiones

| Versión | Fases | Contenido |
| :--- | :--- | :--- |
| 2.10.0 | 1–3 | Lectura multiformato, `exportar_procesos`, rotación de tickets |
| 2.11.0 | 4–5 | Espacio de cotización, requisitos, recordatorio de cierre |
| 2.12.0 | 6–7 | Precios propios, documentos generados, historial |

## Estado

| Fase | Nombre | Estado |
| :--- | :--- | :--- |
| 0 | Medición, especificación y ADR | ✅ 16-oct |
| 1 | Lectura multiformato | ⏳ |
| 2 | `exportar_procesos` | ⏳ |
| 3 | Rotación de tickets | ⏳ |
| 4 | Espacio de cotización | ⏳ |
| 5 | Requisitos y recordatorio de cierre | ⏳ |
| 6 | Precios propios y documentos generados | ⏳ |
| 7 | Historial y cierre | ⏳ |

## Puerta común (al cerrar cada fase)

- [ ] `tsc`, `lint` y `npm test` en verde; módulos nuevos ≥ 80 % de líneas.
- [ ] Test de arquitectura y de secretos en verde.
- [ ] **Sin módulos nativos** (test `arranque-sin-nativos`): la extensión corre con el Node de Claude.
- [ ] Probado contra el portal o la API real con al menos un caso de la medición.
- [ ] `CHANGELOG.md` y el estado de esta tabla.
