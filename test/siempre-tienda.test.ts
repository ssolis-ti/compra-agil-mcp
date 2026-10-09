import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CompraAgilClient } from '../src/api/compra-agil-client.js';
import { crearControlVigilancia, esClaudeDeLaTienda, nodeParaTarea, SIEMPRE_NO_DISPONIBLE_EN_TIENDA, SIEMPRE_SIN_NODE } from '../src/services/control-vigilancia.js';

/**
 * Claude Desktop de la Microsoft Store (prueba real del 8-oct): el Node
 * interno de Claude no se puede lanzar desde una tarea programada, y Windows
 * guarda los datos de la extensión dentro del paquete. El modo «siempre» no
 * puede funcionar ahí, y debe decirlo sin tocar el sistema.
 */
const TIENDA = String.raw`C:\Program Files\WindowsApps\Claude_2.26454.2.0_x64__pzs8sxrjxfjjc\app\Claude.exe`;

describe('esClaudeDeLaTienda', () => {
  it('reconoce el Node de Claude de la Microsoft Store', () => {
    expect(esClaudeDeLaTienda(TIENDA)).toBe(true);
    expect(esClaudeDeLaTienda(String.raw`C:\Program Files\nodejs\node.exe`)).toBe(false);
    expect(esClaudeDeLaTienda('/usr/bin/node')).toBe(false);
  });
});

describe('activar «siempre» desde la extensión de la Store', () => {
  it.runIf(process.platform === 'win32')('no instala la tarea, no escribe .env y explica qué usar', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-'));
    vi.stubEnv('COMPRA_AGIL_DATA_DIR', dir);
    try {
      const control = crearControlVigilancia({
        client: { buscarFresco: async () => { throw new Error('sin API'); } } as unknown as CompraAgilClient, env: { COMPRA_AGIL_TICKET: 'x' }, registrar: () => {}, execPath: TIENDA,
      });
      const r = await control.activar('siempre');
      expect(r).toEqual({ ok: false, detalle: SIEMPRE_NO_DISPONIBLE_EN_TIENDA });
      expect(fs.existsSync(path.join(dir, '.env'))).toBe(false);
      expect(control.modo()).toBe('apagada');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('nodeParaTarea (cualquier Claude Desktop, no solo la Store)', () => {
  it('en Node normal usa el propio ejecutable', () => {
    expect(nodeParaTarea({ execPath: 'X:/node/node.exe', electron: undefined })).toBe('X:/node/node.exe');
  });
  it('dentro de Claude (Electron) no usa Claude.exe: busca node en el PATH, o null', () => {
    expect(nodeParaTarea({ execPath: 'C:/Users/a/AppData/Local/AnthropicClaude/Claude.exe', electron: '37.0.0', buscarEnPath: () => 'C:/nodejs/node.exe' })).toBe('C:/nodejs/node.exe');
    expect(nodeParaTarea({ execPath: 'C:/Users/a/AppData/Local/AnthropicClaude/Claude.exe', electron: '37.0.0', buscarEnPath: () => null })).toBeNull();
  });
  it.runIf(process.platform === 'win32')('sin Node instalado, «siempre» lo explica y no toca el sistema', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sin-node-'));
    vi.stubEnv('COMPRA_AGIL_DATA_DIR', dir);
    try {
      const control = crearControlVigilancia({
        client: { buscarFresco: async () => { throw new Error('sin API'); } } as unknown as CompraAgilClient,
        env: { COMPRA_AGIL_TICKET: 'x' }, registrar: () => {}, execPath: 'C:/AnthropicClaude/Claude.exe', nodeParaTarea: () => null,
      });
      expect(await control.activar('siempre')).toEqual({ ok: false, detalle: SIEMPRE_SIN_NODE });
      expect(fs.existsSync(path.join(dir, '.env'))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
