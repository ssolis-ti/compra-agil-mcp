import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { comandoConfigurar, type DependenciasConfigurar } from '../src/cli/configurar.js';
import { CompraAgilApiError } from '../src/utils/error-handler.js';

/**
 * Asistente `--configurar` (2.9.0): una persona no técnica deja todo listo
 * respondiendo preguntas, sin editar archivos. Se prueba con respuestas
 * guionadas, una API falsa y un Telegram falso.
 */
const TICKET = 'TICKET-DE-PRUEBA-NO-REAL-0000';
const TOKEN = '123456789:AAprueba-no-real-TOKEN-asistente';

function preparar(respuestas: string[], extra: Partial<DependenciasConfigurar> = {}, envInicial = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configurar-'));
  const rutaEnv = path.join(dir, '.env');
  if (envInicial) fs.writeFileSync(rutaEnv, envInicial);
  const salida: string[] = [];
  const preguntas: string[] = [];
  const pendientes = [...respuestas];
  let enviados = 0;
  const deps: DependenciasConfigurar = {
    env: {},
    rutaEnv,
    consola: {
      escribir: (l) => salida.push(l),
      preguntar: async (t) => { preguntas.push(t); if (pendientes.length === 0) throw new Error(`Sin respuesta para: ${t}`); return pendientes.shift()!; },
    },
    crearApi: (t) => ({
      buscarFresco: async (p) => {
        if (t !== TICKET) throw new CompraAgilApiError(401, [], 'GET /v2/compra-agil');
        const total = p.q === 'xyzinexistente' ? 0 : 42;
        return { items: [], paginacion: { total_resultados: total, total_paginas: 5, numero_pagina: 1, tamano_pagina: 10 } } as never;
      },
    }),
    telegram: {
      ultimoChat: async () => ({ chat: { id: '-100777', tipo: 'group', nombre: 'Compras Oficina' } }),
      probar: async () => { enviados++; return true; },
    },
    instalarArranque: async () => true,
    ...extra,
  };
  return { deps, rutaEnv, salida, preguntas, enviados: () => enviados, quedan: () => pendientes.length };
}

describe('--configurar', () => {
  it('de cero: valida el ticket, muestra cuántas compras hay por palabra, configura Telegram y escribe el .env', async () => {
    const p = preparar([
      TICKET,                 // ticket
      'Resmas, papel',        // palabras
      's',                    // ¿te sirven?
      'toner',                // excluir
      '20',                   // región inválida
      '13',                   // región
      '$200.000',             // presupuesto
      's',                    // Telegram
      TOKEN,                  // token
      '',                     // Enter tras escribirle al bot
      '',                     // silencio por defecto
      'n',                    // correo
      's',                    // dejar encendida
    ]);
    expect(await comandoConfigurar(p.deps)).toBe(0);
    expect(p.quedan()).toBe(0);
    const env = fs.readFileSync(p.rutaEnv, 'utf8');
    expect(env).toContain(`COMPRA_AGIL_TICKET=${TICKET}`);
    expect(env).toContain('MONITOR_KEYWORDS=resmas, papel');
    expect(env).toContain('MONITOR_EXCLUIR=toner');
    expect(env).toContain('MONITOR_REGIONES=13');
    expect(env).toContain('MONITOR_MIN_BUDGET_CLP=200000');
    expect(env).toContain('MONITOR_INTERVAL_MINUTES=15');
    expect(env).toContain(`COMPRA_AGIL_TELEGRAM_TOKEN=${TOKEN}`);
    expect(env).toContain('COMPRA_AGIL_TELEGRAM_CHAT_ID=-100777');
    expect(env).toContain('COMPRA_AGIL_AVISOS=telegram');
    expect(env).toContain('COMPRA_AGIL_AVISOS_SILENCIO=22:00-07:00');
    const texto = p.salida.join('\n');
    expect(texto).toMatch(/«resmas»: 42 compras abiertas/);
    expect(texto).toMatch(/Usa números del 1 al 16/);
    expect(texto).toMatch(/Encontré el chat «Compras Oficina»/);
    expect(texto).toMatch(/quedó encendida/);
    expect(p.enviados()).toBe(1);
    // Los secretos nunca se muestran ni se repiten en las preguntas.
    expect(texto + p.preguntas.join('\n')).not.toContain(TICKET);
    expect(texto + p.preguntas.join('\n')).not.toContain(TOKEN);
  });

  it('otra vez, con Enter en todo: conserva lo que había, respalda el .env y no pide el bot de nuevo', async () => {
    const inicial = [
      `COMPRA_AGIL_TICKET=${TICKET}`, 'LOG_LEVEL=info', 'MONITOR_KEYWORDS=resmas', 'MONITOR_MIN_BUDGET_CLP=0',
      `COMPRA_AGIL_TELEGRAM_TOKEN=${TOKEN}`, 'COMPRA_AGIL_TELEGRAM_CHAT_ID=-100777', 'COMPRA_AGIL_AVISOS=telegram', '',
    ].join('\n');
    const p = preparar(['', '', 's', '', '', '', '', '', '', '', 'n'], {
      env: { COMPRA_AGIL_TICKET: TICKET, MONITOR_KEYWORDS: 'resmas', MONITOR_MIN_BUDGET_CLP: '0', COMPRA_AGIL_TELEGRAM_TOKEN: TOKEN, COMPRA_AGIL_TELEGRAM_CHAT_ID: '-100777', COMPRA_AGIL_AVISOS: 'telegram' },
    }, inicial);
    expect(await comandoConfigurar(p.deps)).toBe(0);
    const env = fs.readFileSync(p.rutaEnv, 'utf8');
    expect(env).toContain(`COMPRA_AGIL_TICKET=${TICKET}`);
    expect(env).toContain('LOG_LEVEL=info');
    expect(env).toContain('MONITOR_KEYWORDS=resmas');
    expect(env).toContain('COMPRA_AGIL_TELEGRAM_CHAT_ID=-100777');
    expect(fs.readFileSync(`${p.rutaEnv}.respaldo`, 'utf8')).toBe(inicial);
    expect(p.enviados()).toBe(0);
    expect(p.salida.join('\n')).toMatch(/Cuando quieras encenderla/);
  });

  it('un ticket que no funciona se avisa; si no se reintenta, no se escribe nada', async () => {
    const p = preparar(['ticket-equivocado-no-real-123', 'n']);
    expect(await comandoConfigurar(p.deps)).toBe(1);
    expect(p.salida.join('\n')).toMatch(/✘ No funcionó/);
    expect(fs.existsSync(p.rutaEnv)).toBe(false);
  });

  it('una palabra sin resultados lo dice, y deja corregirla', async () => {
    const p = preparar([TICKET, 'xyzinexistente', 'n', 'resmas', 's', '', '', '', 'n', 'n', 'n']);
    expect(await comandoConfigurar(p.deps)).toBe(0);
    expect(p.salida.join('\n')).toMatch(/«xyzinexistente»: 0 compras abiertas ahora \(prueba otra forma de decirlo\)/);
    expect(fs.readFileSync(p.rutaEnv, 'utf8')).toContain('MONITOR_KEYWORDS=resmas');
  });

  it('correo con dos datos: Telegram y correo quedan activos; la contraseña no se muestra', async () => {
    const p = preparar([TICKET, 'resmas', 's', '', '', '', 's', TOKEN, '', '', 's', 'ana@gmail.com', 'abcd efgh ijkl mnop', 'n'], {
      correo: { verificar: async () => undefined },
    });
    expect(await comandoConfigurar(p.deps)).toBe(0);
    const env = fs.readFileSync(p.rutaEnv, 'utf8');
    expect(env).toContain('COMPRA_AGIL_AVISOS=telegram,correo');
    expect(env).toContain('COMPRA_AGIL_CORREO=ana@gmail.com');
    expect(env).toContain('COMPRA_AGIL_CORREO_CLAVE=abcdefghijklmnop');
    const texto = p.salida.join('\n') + p.preguntas.join('\n');
    expect(texto).toMatch(/El correo \(Gmail\) entró bien/);
    expect(texto).not.toMatch(/abcd/);
  });
});
