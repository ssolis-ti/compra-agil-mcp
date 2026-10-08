import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * Instaladores del daemon (T9.1–T9.2 de la 2.9.0; R10.3). No se instalan en
 * la prueba (cambiarían el sistema): se verifica lo que pueden verificar sin
 * ejecutarse.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f: string) => fs.readFileSync(path.join(RAIZ, 'scripts', f), 'utf8');

describe('servicio de systemd', () => {
  it('arranca --vigilar, se reinicia ante fallos y no lleva secretos', () => {
    const u = leer('compra-agil-vigilancia.service');
    expect(u).toMatch(/^ExecStart=.*dist\/index\.js --vigilar$/m);
    expect(u).toMatch(/^Restart=on-failure$/m);
    expect(u).toMatch(/^WantedBy=default\.target$/m);
    expect(u).not.toMatch(/COMPRA_AGIL_TICKET=|TOKEN=|SECRETO=|CLAVE=/);
  });
});

describe('tarea programada de Windows', () => {
  const instalar = leer('instalar-tarea-windows.ps1');

  it('verifica con --check antes de instalar, arranca --vigilar y se reinicia', () => {
    expect(instalar).toMatch(/--check/);
    expect(instalar).toMatch(/--vigilar/);
    expect(instalar).toMatch(/-RestartCount 999/);
    expect(instalar).toMatch(/-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
    expect(instalar).not.toMatch(/COMPRA_AGIL_TICKET\s*=|TOKEN\s*=/);
  });

  it('los .ps1 llevan BOM: Windows PowerShell 5.1 los leería como ANSI y rompería los acentos', () => {
    for (const f of ['instalar-tarea-windows.ps1', 'quitar-tarea-windows.ps1']) {
      expect(fs.readFileSync(path.join(RAIZ, 'scripts', f)).subarray(0, 3).toString('hex')).toBe('efbbbf');
    }
  });

  it.skipIf(process.platform !== 'win32')('PowerShell los analiza sin errores de sintaxis', () => {
    const comando = "foreach ($f in $args) { $e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e); $e.Count }";
    const archivos = ['instalar-tarea-windows.ps1', 'quitar-tarea-windows.ps1'].map((f) => path.join(RAIZ, 'scripts', f));
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `& { ${comando} }`, ...archivos], { encoding: 'utf8' });
    expect(r.stdout.trim().split(/\s+/)).toEqual(['0', '0']);
    // Arrancar PowerShell en los runners de CI pasa a veces de los 5 s por defecto.
  }, 30_000);
});
