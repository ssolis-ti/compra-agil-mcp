import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * El servidor REAL, en el mismo proceso: transporte en memoria del SDK, el
 * `CompraAgilClient` de verdad y la API simulada de scripts/qa/mock-api.mjs.
 * Ejerce cada handler de punta a punta (protocolo → herramienta → cliente HTTP
 * → normalizador), con cobertura medida (fase 1.6 del plan 2.8.0).
 *
 * Fuera de la red: el NTP se simula aquí, y el endpoint legado de Órdenes de
 * Compra (que apunta siempre a api.mercadopublico.cl) se reemplaza en la
 * instancia. Se cuidan las consultas: el cliente admite 15 por minuto.
 */

vi.mock('../src/utils/ntp.js', async (original) => ({
  ...(await original<typeof import('../src/utils/ntp.js')>()),
  consultarHoraOficial: async () => ({
    ok: true, servidor: 'ntp.shoa.cl', desfaseMs: 80, demoraMs: 40,
    horaOficial: new Date().toISOString(), horaLocal: new Date().toISOString(),
  }),
}));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICKET = 'TICKET-DE-PRUEBA-NO-REAL-0000';
let cliente: Client;
let informes: string;

const texto = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '');
const llamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await cliente.callTool({ name, arguments: args });
  return { r, t: texto(r) };
};

async function puertoLibre(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const puerto = await puertoLibre();
  process.env.PORT = String(puerto);
  await import(pathToFileURL(path.join(RAIZ, 'scripts', 'qa', 'mock-api.mjs')).href);

  informes = fs.mkdtempSync(path.join(os.tmpdir(), 'informes-proceso-'));
  process.env.COMPRA_AGIL_INFORMES_DIR = informes;
  // verificar_ticket lo lee del entorno, como el servidor real al arrancar.
  process.env.COMPRA_AGIL_TICKET = TICKET;

  const { CompraAgilClient } = await import('../src/api/compra-agil-client.js');
  const { crearServidor } = await import('../src/servidor.js');
  const api = new CompraAgilClient(TICKET, `http://127.0.0.1:${puerto}`, { persistir: false });
  vi.spyOn(api, 'obtenerDetalleOC').mockResolvedValue({
    Cantidad: 1,
    Listado: [{
      Codigo: '1057539-1234-SE26', Nombre: 'OC de prueba', CodigoEstado: 6, Estado: 'Aceptada', CodigoLicitacion: null,
      Descripcion: null, FechaCreacion: '2026-10-01T10:00:00', FechaAceptacion: null, MontoNeto: 100_000, Impuestos: 19_000, Total: 119_000,
      Comprador: { NombreOrganismo: 'Hospital', NombreUnidad: 'Abastecimiento', RegionUsuario: 'Metropolitana' },
      Proveedor: { Nombre: 'Proveedor SpA', Rut: '76.543.210-K' },
      Items: { Listado: [{ Producto: 'Bandejas', Cantidad: 2, PrecioNeto: 50_000, TotalLinea: 100_000 }] },
    }],
  });

  const { server } = crearServidor(api, '0.0.0-test');
  const [lado, otro] = InMemoryTransport.createLinkedPair();
  await server.connect(lado);
  cliente = new Client({ name: 'prueba-en-proceso', version: '1.0.0' });
  await cliente.connect(otro);
}, 60_000);

afterAll(async () => {
  await cliente?.close();
  fs.rmSync(informes, { recursive: true, force: true });
  delete process.env.COMPRA_AGIL_INFORMES_DIR;
  delete process.env.COMPRA_AGIL_TICKET;
});

describe('servidor en proceso — conexión', () => {
  it('publica instrucciones, capacidades y las 23 herramientas', async () => {
    expect(cliente.getInstructions()).toMatch(/No declares un ganador/);
    expect(cliente.getServerCapabilities()).toMatchObject({ logging: {}, tools: {}, resources: {}, prompts: {} });
    expect((await cliente.listTools()).tools).toHaveLength(23);
  });
});

describe('servidor en proceso — herramientas que consultan la API', () => {
  it('verificar_ticket confirma el ticket sin mostrarlo', async () => {
    const { r, t } = await llamar('verificar_ticket');
    expect(r.isError, t).toBeFalsy();
    expect(t).toMatch(/Ticket válido/);
    expect(t).toMatch(/últimos 10 minutos/);
    expect(t).not.toContain(TICKET);
  });

  it('obtener_detalle_compra y luego verificar_orden_compra, que reutiliza la caché', async () => {
    const det = await llamar('obtener_detalle_compra', { codigo: '1-1-COT26' });
    expect(det.r.isError).toBeFalsy();
    expect(JSON.parse(det.t).orden_compra.tiene_oc).toBeNull();
    const oc = await llamar('verificar_orden_compra', { codigo: '1-1-COT26' });
    expect(JSON.parse(oc.t)).toMatchObject({ detalle_en_cache: true, verificacion_oc: { tiene_orden_compra: null } });
  });

  it('verificar_orden_compra sin el detalle en caché no consulta y lo explica', async () => {
    const { r, t } = await llamar('verificar_orden_compra', { codigo: '9-9-COT26' });
    expect(r.isError).toBeFalsy();
    expect(t).toMatch(/ficha/);
  });

  it('obtener_detalle_orden_compra entrega el desglose de la OC', async () => {
    const { r, t } = await llamar('obtener_detalle_orden_compra', { codigo_oc: '1057539-1234-SE26' });
    expect(r.isError).toBeFalsy();
    expect(t).toMatch(/1057539-1234-SE26/);
    expect(t).toMatch(/Bandejas/);
  });

  it('obtener_estadisticas_uso cuenta las consultas sin presentarlas como saldo', async () => {
    const { t } = await llamar('obtener_estadisticas_uso');
    expect(t).toMatch(/No es el saldo del ticket|no el saldo/i);
  });
});

describe('servidor en proceso — informes', () => {
  const archivos = () => fs.readdirSync(informes, { recursive: true }).map(String).filter((f) => f.endsWith('.html'));

  it('competencia, desde el detalle en caché', async () => {
    const { r, t } = await llamar('generar_informe', { tipo: 'competencia', codigo_compra: '1-1-COT26' });
    expect(r.isError, t).toBeFalsy();
    expect(t).toMatch(/Informe generado/);
    expect(archivos().some((f) => f.startsWith('competencia-'))).toBe(true);
  });

  it('cotizacion con precio propio, en una subcarpeta', async () => {
    const { r, t } = await llamar('generar_informe', {
      tipo: 'cotizacion', codigo_compra: '1-1-COT26', precio_unitario_personalizado: 40_000,
      rut_proveedor: '76.543.210-K', razon_social: 'Oficina Limpia SpA', ruta_salida: 'cotizaciones/octubre', formato: 'oficio',
    });
    expect(r.isError, t).toBeFalsy();
    expect(archivos().some((f) => f.replace(/\\/g, '/').startsWith('cotizaciones/octubre/cotizacion-'))).toBe(true);
  });

  it('radar de una región', async () => {
    const { r, t } = await llamar('generar_informe', { tipo: 'radar', region: '13', max_paginas: 1 });
    expect(r.isError, t).toBeFalsy();
    expect(archivos().some((f) => f.startsWith('radar-'))).toBe(true);
  });

  it('precio, con filtro de palabras clave', async () => {
    const { r, t } = await llamar('generar_informe', { tipo: 'precio', q: 'bandejas', limite_analisis: 2, formato: 'a4' });
    expect(t).not.toMatch(/Error inesperado/);
    expect(r.isError === true ? /no respondió|no se encontraron/i.test(t) : archivos().some((f) => f.startsWith('precio-'))).toBe(true);
  });

  it('auditoria de un proceso desierto', async () => {
    const { r, t } = await llamar('generar_informe', { tipo: 'auditoria', codigo_compra: '2-2-COT26', limite_analisis: 1 });
    expect(r.isError, t).toBeFalsy();
    expect(archivos().some((f) => f.startsWith('auditoria-'))).toBe(true);
  });

  it('rechaza una carpeta fuera de los informes', async () => {
    const { r, t } = await llamar('generar_informe', { tipo: 'competencia', codigo_compra: '1-1-COT26', ruta_salida: '../fuera' });
    expect(r.isError).toBe(true);
    expect(t).toMatch(/queda fuera de la carpeta de informes/);
  });

  it('los requeridos por tipo se validan sin consultar la API', async () => {
    const { r, t } = await llamar('generar_informe', { tipo: 'cotizacion' });
    expect(r.isError).toBe(true);
    expect(t).toMatch(/^Error de validación: .*codigo_compra.* No se consultó la API\.$/s);
  });
});

describe('servidor en proceso — herramientas locales', () => {
  it('verificar_hora_oficial informa el reloj del servidor y la base de zonas', async () => {
    const { r, t } = await llamar('verificar_hora_oficial');
    expect(r.isError).toBeFalsy();
    const j = JSON.parse(t);
    expect(j).toMatchObject({ sincronizado: true, reloj_que_usa_el_servidor: { fuente: 'shoa' } });
    expect(j.base_zonas_horarias).toBe(process.versions.tz);
  });

  it('consultar_documentos_locales: listado y búsqueda', async () => {
    expect((await llamar('consultar_documentos_locales')).t).toMatch(/Documentos locales de ayuda disponibles/);
    const { t } = await llamar('consultar_documentos_locales', { query: '¿Qué multas me pueden aplicar si entrego con atraso?', max_caracteres: 800 });
    expect(t).toMatch(/multas-sanciones-procedimientos\.pdf/);
    // La primera consulta extrae los 7 PDF: más lento con la cobertura instrumentada.
  }, 60_000);

  it('adjuntos con la lectura apagada: la ficha, sin salir a la red (los casos con red, en adjuntos.test.ts)', async () => {
    vi.stubEnv('COMPRA_AGIL_ADJUNTOS', 'off');
    try {
      expect((await llamar('obtener_enlace_documento', { id_documento: '1855508', codigo_compra: '1-1-COT26' })).t).toMatch(/ficha\?code=1-1-COT26/);
      const { r, t } = await llamar('descargar_y_leer_documento', { id_documento: '1855508', codigo_compra: '1-1-COT26' });
      expect(r.isError).toBeFalsy();
      expect(t).toMatch(/ficha/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('servidor en proceso — recursos y prompts', () => {
  it('lee los recursos fijos', async () => {
    for (const uri of ['compra-agil://regiones', 'compra-agil://estados', 'compra-agil://glosario']) {
      const r = await cliente.readResource({ uri });
      expect(r.contents[0]?.text?.length, uri).toBeGreaterThan(50);
    }
  });

  // Ítem 36 del plan 2.8.0: los recursos los lee el modelo para razonar; si
  // contradicen a las herramientas, propagan una creencia falsa.
  it('los recursos son coherentes con lo que hacen las herramientas', async () => {
    const leer = async (uri: string) => (await cliente.readResource({ uri })).contents[0]?.text ?? '';
    const regiones = JSON.parse(await leer('compra-agil://regiones'));
    const lista = Array.isArray(regiones) ? regiones : (regiones.regiones ?? Object.values(regiones).find(Array.isArray));
    expect(lista).toHaveLength(16);

    const estados = await leer('compra-agil://estados');
    expect(estados).toMatch(/proveedor_seleccionado/);
    expect(estados).toMatch(/0 resultados/);
    expect(estados).toMatch(/oc_emitida/);

    const glosario = await leer('compra-agil://glosario');
    expect(glosario).toMatch(/Token Bucket/);
    expect(glosario).not.toMatch(/máx\. 50/);
    expect(glosario).not.toMatch(/se restablece al inicio del siguiente día calendario/);
  });

  it('el glosario y las instrucciones no contradicen la hora de la API', async () => {
    const glosario = (await cliente.readResource({ uri: 'compra-agil://glosario' })).contents[0]?.text ?? '';
    expect(glosario).not.toMatch(/se interpretan como UTC/);
  });

  it('lee un documento y la plantilla de compra', async () => {
    const docs = await cliente.listResources();
    const md = docs.resources.find((r) => r.uri.endsWith('.md'));
    expect(md).toBeDefined();
    expect((await cliente.readResource({ uri: md!.uri })).contents[0]?.text?.length).toBeGreaterThan(100);
    const compra = await cliente.readResource({ uri: 'compra-agil://compras/1-1-COT26' });
    expect(compra.contents[0]?.text).toMatch(/cierre_hora_chile/);
  });

  it('las métricas cuentan los rechazos del esquema, que ocurren antes de la herramienta', async () => {
    await llamar('obtener_detalle_compra', { codigo: 'ABC' });
    await llamar('obtener_enlace_documento', { id_documento: '1' });
    const { metricas } = JSON.parse((await llamar('obtener_estadisticas_uso')).t);
    expect(metricas.herramientas.obtener_detalle_compra.rechazos_de_validacion).toBeGreaterThanOrEqual(1);
    expect(metricas.herramientas.obtener_enlace_documento.rechazos_de_validacion).toBe(1);
  });

  it('obtener_estadisticas_uso refleja las llamadas de esta sesión (fase 2.2)', async () => {
    const { t } = await llamar('obtener_estadisticas_uso');
    const { metricas } = JSON.parse(t);
    expect(metricas.herramientas.obtener_detalle_compra.llamadas).toBeGreaterThanOrEqual(1);
    expect(metricas.herramientas.obtener_detalle_compra.latencia_ms.maxima).toBeGreaterThanOrEqual(0);
    expect(metricas.consultas_api.enviadas).toBeGreaterThan(0);
    // verificar_orden_compra y los informes reutilizaron el detalle: hubo aciertos de caché.
    expect(metricas.consultas_api.desde_cache).toBeGreaterThan(0);
    expect(metricas.consultas_api.por_resultado['200']).toBeGreaterThan(0);
  });

  it('entrega los dos prompts', async () => {
    const a = await cliente.getPrompt({ name: 'buscar_oportunidades_proveedor', arguments: { rubro: 'aseo', region: '13' } });
    const b = await cliente.getPrompt({ name: 'analizar_competencia', arguments: { codigo: '1-1-COT26' } });
    expect(a.messages.length).toBeGreaterThan(0);
    expect(b.messages.length).toBeGreaterThan(0);
  });
});

describe('prompt configurar_vigilancia (2.9.0)', () => {
  it('guía al agente a preguntar, comprobar, confirmar y guardar, sin pedir secretos en el chat', async () => {
    const r = await cliente.getPrompt({ name: 'configurar_vigilancia', arguments: { rubro: 'útiles de oficina' } });
    const t = (r.messages[0].content as { text: string }).text;
    expect(t).toMatch(/útiles de oficina/);
    expect(t).toMatch(/buscar_compras_agiles/);
    expect(t).toMatch(/Solo con mi sí, llama a "configurar_criterios"/);
    expect(t).toMatch(/estado_vigilancia/);
    expect(t).toMatch(/No me pidas en el chat el ticket, el token del bot ni contraseñas/);
    const sinRubro = await cliente.getPrompt({ name: 'configurar_vigilancia', arguments: {} });
    expect((sinRubro.messages[0].content as { text: string }).text).toMatch(/pregúntame mi rubro/);
  });
});

describe('prompt empezar (anexo de instalación por agente)', () => {
  it('lleva de cero al primer aviso: diagnóstico, criterios, Telegram con código y encendido, sin secretos en el chat', async () => {
    const r = await cliente.getPrompt({ name: 'empezar', arguments: {} });
    const t = (r.messages[0].content as { text: string }).text;
    for (const paso of ['estado_vigilancia', 'configurar_criterios', 'conectar_telegram', 'activar_vigilancia', 'probar_avisos']) expect(t).toContain(paso);
    expect(t).toMatch(/Nunca inventes el código/);
    expect(t).toMatch(/confirmo=true/);
    expect(t).toMatch(/No me pidas en el chat el ticket, el token ni contraseñas/);
    expect(t).toMatch(/Configuración → Extensiones → Compra Ágil/);
    expect(t).not.toMatch(/Reglas:[\s\S]*Reglas:/); // un solo bloque de reglas
  });
});
