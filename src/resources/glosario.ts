/**
 * Resource: compra-agil://glosario
 *
 * Glosario de términos del dominio de compras públicas chilenas.
 * Permite a la IA entender el vocabulario técnico y de negocio.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const GLOSARIO = [
  {
    termino: 'API',
    definicion: 'Interfaz de Programación de Aplicaciones. Permite que sistemas informáticos se comuniquen entre sí de forma estructurada.',
  },
  {
    termino: 'Compra Ágil',
    definicion: 'Mecanismo de contratación simplificada de Mercado Público para adquisición rápida de bienes y servicios por organismos del Estado de Chile.',
  },
  {
    termino: 'Ticket',
    definicion: 'Credencial de acceso a la API. Identifica al cliente y controla su cuota de uso diario.',
  },
  {
    termino: 'Token Bucket',
    definicion: 'Algoritmo de control de tasa de solicitudes. Un "balde" de tokens se consume con cada request y se recarga automáticamente al inicio de cada día calendario.',
  },
  {
    termino: 'EMT',
    definicion: 'Empresa de Menor Tamaño. Clasificación del Registro de Proveedores de ChileCompra que identifica a micro, pequeñas y medianas empresas.',
  },
  {
    termino: 'OC / Orden de Compra',
    definicion: 'Documento oficial que formaliza la compra al proveedor seleccionado en el proceso de Compra Ágil.',
  },
  {
    termino: 'Convocatoria',
    definicion: 'Llamado a proveedores para cotizar en una Compra Ágil. Puede haber primer llamado (abierto a proveedores invitados) y segundo llamado (ampliado).',
  },
  {
    termino: 'DCCP',
    definicion: 'Dirección de Compras y Contratación Pública. Organismo público que administra Mercado Público (www.mercadopublico.cl).',
  },
  {
    termino: 'CLP',
    definicion: 'Código de moneda del Peso Chileno según el estándar ISO 4217.',
  },
  {
    termino: 'ISO-8601',
    definicion: 'Estándar internacional para representar fechas y horas. Formato: 2026-04-01T12:00:00Z (año-mes-díaTHora:Min:SegZ para UTC).',
  },
  {
    termino: 'Sincronización incremental',
    definicion: 'Técnica para obtener solo los datos que han cambiado desde la última consulta, evitando descargas completas. Se logra usando los parámetros ttl_cambio_ms o cambio_desde/cambio_hasta.',
  },
  {
    termino: 'Paginación',
    definicion: 'Mecanismo que divide un conjunto grande de resultados en páginas de tamaño fijo (máx. 50 items por página) para facilitar su procesamiento.',
  },
  {
    termino: '429 Too Many Requests',
    definicion: 'Código HTTP que indica que se agotaron temporalmente los tokens de cuota. NO implica esperar al día siguiente: verificado contra la API real (septiembre 2026), el servicio volvió a responder con normalidad 13 minutos después de un 429. La §4 de la guía oficial dice que el límite es por día calendario, pero su §7 y su glosario describen un token bucket que se recarga solo — y es esto último lo que hace el servicio. Reintenta en unos minutos antes de suponer que agotaste el día.',
  },
  {
    termino: 'Token Bucket',
    definicion: 'Algoritmo de control de tasa: un "balde" de fichas se consume con cada solicitud y se recarga automáticamente con el tiempo. Es el modelo que sigue la cuota de esta API, por eso un 429 se supera esperando minutos y no horas. Las ráfagas son lo que lo vacía: las herramientas de análisis, que hacen varias consultas seguidas, son las que más lo agotan.',
  },
  {
    termino: 'Retry-After',
    definicion: 'Header HTTP que indica cuántos segundos esperar antes de volver a intentar una solicitud rechazada por exceso de cuota. Este servidor lo honra cuando la API lo envía; si no viene, aplica una espera creciente (15 → 30 → 60 → 120 min) que se reinicia con la primera consulta exitosa.',
  },
];

export function registerGlosarioResource(server: McpServer): void {
  server.registerResource(
    'glosario',
    'compra-agil://glosario',
    {
      description: 'Glosario de términos técnicos y de negocio del sistema de compras públicas de Chile (Mercado Público). Consulta este recurso para entender la terminología específica del dominio.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'compra-agil://glosario',
        mimeType: 'application/json',
        text: JSON.stringify(GLOSARIO, null, 2),
      }],
    })
  );
}
