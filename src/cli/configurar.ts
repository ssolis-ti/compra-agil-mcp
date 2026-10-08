/**
 * `mcp-compra-agil --configurar`: asistente de configuración en la terminal
 * (2.9.0). Pensado para alguien que no es técnico: pregunta en lenguaje simple,
 * comprueba cada respuesta contra la API real o contra Telegram, y escribe el
 * `.env` por sí mismo (con respaldo del anterior). Nadie tiene que editar
 * archivos a mano.
 *
 * Los secretos (ticket, token del bot) se escriben con la entrada oculta, van
 * directo al `.env` del dueño y nunca se muestran: solo los últimos 4
 * caracteres. Correr el asistente otra vez permite cambiar lo que se quiera:
 * Enter deja cada valor como estaba.
 *
 * Toda la entrada y salida se recibe como parámetro, para probarlo sin teclado.
 */

import fs from 'fs';
import { CompraAgilClient } from '../api/compra-agil-client.js';
import { pista, registrarSecreto, safeError } from '../utils/redact.js';
import { REGIONES } from '../resources/regiones.js';
import { ultimoChat, CanalTelegram } from '../avisos/canales/telegram.js';
import { actualizarEnv } from './archivo-env.js';

export interface Consola {
  preguntar(texto: string, opciones?: { oculta?: boolean }): Promise<string>;
  escribir(linea: string): void;
}

export interface DependenciasConfigurar {
  env: Record<string, string | undefined>;
  /** El `.env` que se escribe (el del proyecto o el de la carpeta de datos). */
  rutaEnv: string;
  consola: Consola;
  /** Inyectables en los tests. */
  crearApi?: (ticket: string) => Pick<CompraAgilClient, 'buscarFresco'>;
  telegram?: { ultimoChat: typeof ultimoChat; probar: (token: string, chatId: string) => Promise<boolean> };
  /** Instala la vigilancia para que arranque sola; null si no aplica en este sistema. */
  instalarArranque?: (() => Promise<boolean>) | null;
}

const si = (r: string) => /^(s|si|sí|y|yes)$/i.test(r.trim());
const lista = (r: string) => r.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export async function comandoConfigurar(d: DependenciasConfigurar): Promise<number> {
  const { consola: c, env } = d;
  const cambios: Record<string, string> = {};
  const crearApi = d.crearApi ?? ((t: string) => new CompraAgilClient(t, env.COMPRA_AGIL_BASE_URL || undefined, { persistir: false }));
  const tg = d.telegram ?? {
    ultimoChat,
    probar: async (token: string, chatId: string) => (await new CanalTelegram({ token, chatId }).probar()).ok,
  };

  c.escribir('');
  c.escribir('Configuración de mcp-compra-agil');
  c.escribir('Te haré unas preguntas. Enter deja cada respuesta como está ahora (entre corchetes).');
  c.escribir('');

  // ── 1. Ticket ──────────────────────────────────────────────────────
  let ticket = env.COMPRA_AGIL_TICKET?.trim();
  registrarSecreto(ticket);
  c.escribir('1/5 · Ticket de Mercado Público');
  c.escribir('   Es la clave gratuita que se pide en https://www.chilecompra.cl/api/ con tu Clave Única; llega por correo.');
  for (;;) {
    const r = (await c.preguntar(`   Pega tu ticket${ticket ? ` [${pista(ticket)}]` : ''}: `, { oculta: true })).trim();
    if (r) { ticket = r; registrarSecreto(r); }
    if (!ticket) { c.escribir('   Sin ticket no se puede consultar Mercado Público. Pídelo y vuelve a correr --configurar.'); return 1; }
    try {
      const prueba = await crearApi(ticket).buscarFresco({ estado: 'publicada', tamano_pagina: 10, numero_pagina: 1 });
      c.escribir(`   ✔ El ticket funciona: hay ${prueba.paginacion.total_resultados.toLocaleString('es-CL')} compras ágiles abiertas ahora.`);
      if (r) cambios.COMPRA_AGIL_TICKET = ticket;
      break;
    } catch (e) {
      c.escribir(`   ✘ No funcionó: ${safeError(e).slice(0, 160)}`);
      if (!si(await c.preguntar('   ¿Intentar con otro ticket? (s/n): '))) return 1;
    }
  }
  const api = crearApi(ticket);

  // ── 2. Rubro ───────────────────────────────────────────────────────
  c.escribir('');
  c.escribir('2/5 · ¿Qué vendes?');
  c.escribir('   Escribe palabras que aparezcan en el nombre de las compras que te interesan, separadas por coma.');
  c.escribir('   Ejemplo: resmas, papel, archivadores, tóner');
  let palabras = lista(env.MONITOR_KEYWORDS ?? '');
  for (;;) {
    const r = await c.preguntar(`   Palabras${palabras.length ? ` [${palabras.join(', ')}]` : ''}: `);
    if (r.trim()) palabras = lista(r);
    if (palabras.length === 0) { c.escribir('   Escribe al menos una palabra.'); continue; }
    // Muestra cuántas compras abiertas hay con cada palabra: así se ve si sirve.
    for (const p of palabras.slice(0, 6)) {
      try {
        const n = (await api.buscarFresco({ q: p, estado: 'publicada', tamano_pagina: 10, numero_pagina: 1 })).paginacion.total_resultados;
        c.escribir(`   · «${p}»: ${n} compra${n === 1 ? '' : 's'} abierta${n === 1 ? '' : 's'} ahora${n === 0 ? ' (prueba otra forma de decirlo)' : ''}`);
      } catch {
        c.escribir(`   · «${p}»: no se pudo consultar ahora (la API está lenta); se guarda igual.`);
      }
    }
    if (palabras.length > 6) c.escribir(`   (y ${palabras.length - 6} palabra(s) más)`);
    if (si(await c.preguntar('   ¿Te sirven estas palabras? (s/n): '))) break;
  }
  cambios.MONITOR_KEYWORDS = palabras.join(', ');
  const excluir = await c.preguntar(`   ¿Alguna palabra que quieras descartar? (opcional${env.MONITOR_EXCLUIR ? `, [${env.MONITOR_EXCLUIR}]` : ''}): `);
  if (excluir.trim()) cambios.MONITOR_EXCLUIR = lista(excluir).join(', ');

  // ── 3. Región y presupuesto ────────────────────────────────────────
  c.escribir('');
  c.escribir('3/5 · ¿Dónde y desde qué monto?');
  c.escribir('   Regiones: ' + REGIONES.map((x) => `${x.codigo} ${x.nombre}`).join(' · '));
  for (;;) {
    const r = await c.preguntar(`   Números de región separados por coma, o Enter para todo Chile${env.MONITOR_REGIONES ? ` [${env.MONITOR_REGIONES}]` : ''}: `);
    if (!r.trim()) break;
    const nums = r.split(',').map((x) => Number(x.trim()));
    if (nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 16)) { cambios.MONITOR_REGIONES = nums.join(','); break; }
    c.escribir('   Usa números del 1 al 16, por ejemplo: 13 o 13,5');
  }
  for (;;) {
    const actual = env.MONITOR_MIN_BUDGET_CLP ?? '0';
    const r = (await c.preguntar(`   Presupuesto mínimo en pesos, 0 para no filtrar [${actual}]: `)).replace(/[.$\s]/g, '');
    if (!r) { cambios.MONITOR_MIN_BUDGET_CLP = actual; break; }
    if (/^\d+$/.test(r)) { cambios.MONITOR_MIN_BUDGET_CLP = r; break; }
    c.escribir('   Escribe solo el número, por ejemplo 200000.');
  }
  if (Number(cambios.MONITOR_MIN_BUDGET_CLP) >= 5_000_000) {
    c.escribir('   Ojo: desde $5.000.000 se pierde la mayoría de las compras ágiles (la mitad es de menos de $800.000).');
  }
  cambios.MONITOR_INTERVAL_MINUTES = '15';

  // ── 4. Telegram ────────────────────────────────────────────────────
  c.escribir('');
  c.escribir('4/5 · Avisos por Telegram');
  const yaTiene = Boolean(env.COMPRA_AGIL_TELEGRAM_TOKEN && env.COMPRA_AGIL_TELEGRAM_CHAT_ID);
  if (si(await c.preguntar(`   ¿Quieres recibir los avisos en Telegram? (s/n)${yaTiene ? ' [ya configurado: s]' : ''}: `) || (yaTiene ? 's' : 'n'))) {
    let token = env.COMPRA_AGIL_TELEGRAM_TOKEN?.trim();
    registrarSecreto(token);
    if (!token || !yaTiene || si(await c.preguntar('   ¿Cambiar el bot o el chat? (s/n) [n]: '))) {
      c.escribir('   1) En Telegram, abre @BotFather, escribe /newbot y sigue los pasos.');
      c.escribir('   2) Te dará un token como 123456789:AA…; pégalo aquí (no se verá mientras escribes).');
      const t = (await c.preguntar(`   Token del bot${token ? ` [${pista(token)}]` : ''}: `, { oculta: true })).trim();
      if (t) { token = t; registrarSecreto(t); }
      if (!token) {
        c.escribir('   Sin token no hay Telegram; puedes configurarlo después corriendo --configurar otra vez.');
      } else {
        c.escribir('   3) Ahora escríbele «hola» a tu bot desde el chat donde quieres los avisos (o agrégalo a un grupo y escribe ahí).');
        let chatId: string | null = null;
        for (let intento = 0; intento < 3 && !chatId; intento++) {
          await c.preguntar('      Cuando lo hayas hecho, presiona Enter… ');
          const r = await tg.ultimoChat(token);
          if ('error' in r) c.escribir(`   ✘ ${r.error}`);
          else if (!r.chat) c.escribir('   Todavía no le llega ningún mensaje al bot. Escríbele y presiona Enter de nuevo.');
          else { chatId = r.chat.id; c.escribir(`   ✔ Encontré el chat «${r.chat.nombre || r.chat.tipo}».`); }
        }
        if (chatId) {
          if (await tg.probar(token, chatId)) c.escribir('   ✔ Te mandé un mensaje de prueba: revisa tu Telegram.');
          else c.escribir('   ✘ No se pudo enviar el mensaje de prueba; revisa el token.');
          cambios.COMPRA_AGIL_TELEGRAM_TOKEN = token;
          cambios.COMPRA_AGIL_TELEGRAM_CHAT_ID = chatId;
          cambios.COMPRA_AGIL_AVISOS = 'telegram';
        } else {
          c.escribir('   No pude encontrar el chat. Puedes intentarlo después con --configurar.');
        }
      }
    } else {
      cambios.COMPRA_AGIL_AVISOS = env.COMPRA_AGIL_AVISOS?.includes('telegram') ? env.COMPRA_AGIL_AVISOS : 'telegram';
    }
    const silencio = await c.preguntar('   ¿Pausar los avisos de noche, de 22:00 a 07:00, y recibirlos juntos en la mañana? (s/n) [s]: ');
    cambios.COMPRA_AGIL_AVISOS_SILENCIO = silencio.trim() === '' || si(silencio) ? '22:00-07:00' : '';
  }

  // ── Guardar ────────────────────────────────────────────────────────
  const anterior = fs.existsSync(d.rutaEnv) ? fs.readFileSync(d.rutaEnv, 'utf8') : '';
  if (anterior) fs.writeFileSync(`${d.rutaEnv}.respaldo`, anterior, 'utf8');
  fs.writeFileSync(d.rutaEnv, actualizarEnv(anterior, cambios), 'utf8');
  c.escribir('');
  c.escribir(`✔ Configuración guardada en ${d.rutaEnv}${anterior ? ' (la anterior quedó en .env.respaldo)' : ''}.`);

  // ── 5. Dejarla encendida ───────────────────────────────────────────
  c.escribir('');
  c.escribir('5/5 · Vigilancia automática');
  if (d.instalarArranque === null) {
    c.escribir('   Para dejarla encendida, sigue docs/api/guia-vigilancia-y-avisos.md (servicio de Linux) o corre: node dist/index.js --vigilar');
  } else if (si(await c.preguntar('   ¿Dejar la vigilancia encendida siempre, también al reiniciar el computador? (s/n): '))) {
    const ok = await (d.instalarArranque ?? (async () => false))();
    c.escribir(ok
      ? '   ✔ Listo: la vigilancia quedó encendida y arrancará sola con el computador.'
      : '   ✘ No se pudo dejar encendida. Puedes correrla a mano con: node dist/index.js --vigilar');
  } else {
    c.escribir('   Cuando quieras encenderla: node dist/index.js --vigilar');
    c.escribir('   Si ya estaba encendida, reiníciala para que tome estos cambios (lee la configuración al arrancar).');
  }
  c.escribir('');
  c.escribir('Todo listo. Desde ahora te avisaremos de las compras que calcen con lo que vendes.');
  c.escribir('Para cambiar algo, corre otra vez: node dist/index.js --configurar');
  return 0;
}
