import { describe, it, expect } from 'vitest';
import { actualizarEnv } from '../src/cli/archivo-env.js';

/** El asistente --configurar no debe romper el .env del dueño. */
describe('actualizarEnv', () => {
  it('cambia en su lugar, descomenta, agrega al final y conserva lo demás', () => {
    const antes = [
      '# Ticket oficial',
      'COMPRA_AGIL_TICKET=viejo',
      'LOG_LEVEL=info',
      '# COMPRA_AGIL_AVISOS=telegram',
      'MONITOR_KEYWORDS=software, desarrollo',
      '',
    ].join('\r\n');
    const despues = actualizarEnv(antes, {
      COMPRA_AGIL_TICKET: 'nuevo',
      COMPRA_AGIL_AVISOS: 'telegram',
      MONITOR_KEYWORDS: 'resmas, papel',
      COMPRA_AGIL_TELEGRAM_CHAT_ID: '-100123',
    });
    expect(despues).toBe([
      '# Ticket oficial',
      'COMPRA_AGIL_TICKET=nuevo',
      'LOG_LEVEL=info',
      'COMPRA_AGIL_AVISOS=telegram',
      'MONITOR_KEYWORDS=resmas, papel',
      '',
      '# ─── Agregado por mcp-compra-agil --configurar ───',
      'COMPRA_AGIL_TELEGRAM_CHAT_ID=-100123',
      '',
    ].join('\r\n'));
  });

  it('un .env vacío o inexistente queda con las variables pedidas', () => {
    expect(actualizarEnv('', { A_B: '1' })).toMatch(/^\n# ─── Agregado.*\nA_B=1\n$/s);
  });

  it('si la variable aparece dos veces, cambia la primera y comenta la otra', () => {
    const r = actualizarEnv('X_Y=1\nX_Y=2\n', { X_Y: '3' });
    expect(r).toBe('X_Y=3\n# X_Y=2  (reemplazada por --configurar)\n');
  });

  it('los valores van tal cual y el cargador real los lee igual (sin saltos de línea)', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-'));
    const valor = 'resmas, papel #1 = a4';
    fs.writeFileSync(path.join(dir, '.env'), actualizarEnv('', { PRUEBA_ENV_IDA_VUELTA: valor, PRUEBA_ENV_SALTO: 'a\nb' }));
    delete process.env.PRUEBA_ENV_IDA_VUELTA;
    const { loadEnvManual } = await import('../src/utils/env-loader.js');
    const antes = process.cwd();
    process.chdir(dir);
    try { loadEnvManual(); } finally { process.chdir(antes); }
    expect(process.env.PRUEBA_ENV_IDA_VUELTA).toBe(valor);
    expect(process.env.PRUEBA_ENV_SALTO).toBe('a b');
  });
});
