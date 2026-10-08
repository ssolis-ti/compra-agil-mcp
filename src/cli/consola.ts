/**
 * Consola real para el asistente `--configurar`: preguntas por la terminal,
 * con entrada oculta para los secretos (no se ven mientras se escriben ni
 * quedan en pantalla).
 */

import readline from 'readline';
import path from 'path';
import { spawn } from 'child_process';
import type { Consola } from './configurar.js';

export function consolaDeTerminal(): Consola & { cerrar(): void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let oculta = false;
  // readline escribe en pantalla lo que se teclea: mientras la pregunta es
  // oculta, se muestra solo el texto de la pregunta.
  const original = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (!oculta || /[\r\n]/.test(s)) original(oculta ? '\n' : s);
  };
  return {
    escribir: (linea) => console.log(linea),
    preguntar: (texto, opciones) => new Promise((resolve) => {
      process.stdout.write(texto);
      oculta = Boolean(opciones?.oculta);
      rl.question('', (r) => { oculta = false; resolve(r); });
    }),
    cerrar: () => rl.close(),
  };
}

/** En Windows, instala la tarea programada con el script del repositorio. */
export function instaladorDeArranque(raiz: string): (() => Promise<boolean>) | null {
  if (process.platform !== 'win32') return null;
  return () => new Promise((resolve) => {
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(raiz, 'scripts', 'instalar-tarea-windows.ps1')], { stdio: 'inherit' });
    p.on('exit', (codigo) => resolve(codigo === 0));
    p.on('error', () => resolve(false));
  });
}
