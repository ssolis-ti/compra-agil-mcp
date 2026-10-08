/**
 * Empaqueta el servidor como extensión de Claude Desktop (.mcpb), para el
 * usuario básico: doble clic e instalar, sin terminal ni Node propio
 * (anexo de instalación por agente, RA1).
 *
 * Uso: npm run build && node scripts/empaquetar-extension.mjs
 * Salida: extension/compra-agil-<versión>-<plataforma>.mcpb
 *
 * Arma una carpeta limpia con dist/, los documentos que lee el servidor, los
 * scripts de la tarea de Windows y SOLO las dependencias de producción, y la
 * empaqueta con la herramienta oficial (@anthropic-ai/mcpb). Una dependencia
 * de producción (@napi-rs/canvas, usada al leer PDF) trae un binario por
 * plataforma: el paquete sirve para la plataforma donde se arma.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
const destino = path.join(RAIZ, 'extension', 'armado');
const salida = path.join(RAIZ, 'extension', `compra-agil-${pkg.version}-${process.platform}.mcpb`);
const correr = (cmd, cwd = RAIZ) => execSync(cmd, { cwd, stdio: 'inherit' });

if (!fs.existsSync(path.join(RAIZ, 'dist', 'index.js'))) throw new Error('Falta dist/: corre primero npm run build');

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });
const copiar = (rel) => fs.cpSync(path.join(RAIZ, rel), path.join(destino, rel), { recursive: true });
for (const rel of ['dist', 'docs/api', 'docs/guias', 'docs/README.md', 'scripts/instalar-tarea-windows.ps1', 'scripts/quitar-tarea-windows.ps1', 'package.json', 'package-lock.json', 'LICENSE', 'README.md']) copiar(rel);

const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'extension', 'manifest.json'), 'utf8'));
manifiesto.version = pkg.version;
manifiesto.compatibility.platforms = [process.platform];
fs.writeFileSync(path.join(destino, 'manifest.json'), JSON.stringify(manifiesto, null, 2));

// Solo dependencias de producción, idénticas al lockfile.
correr('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', destino);

correr(`npx --yes @anthropic-ai/mcpb validate "${path.join(destino, 'manifest.json')}"`);
fs.rmSync(salida, { force: true });
correr(`npx --yes @anthropic-ai/mcpb pack "${destino}" "${salida}"`);
console.log(`\nExtensión lista: ${salida} (${(fs.statSync(salida).size / 1024 / 1024).toFixed(1)} MB)`);
