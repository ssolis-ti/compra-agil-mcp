import { describe, it, expect, beforeEach } from 'vitest';
import { registrarSecreto, redact, safeError, pista, _resetSecretos, secretosRegistrados } from '../src/utils/redact.js';

const TICKET = 'F8A21C90-4BE7-4D3A-9C11-77E0B2D4A6F3';

beforeEach(() => {
  _resetSecretos();
});

describe('registrarSecreto', () => {
  it('registra un secreto y su variante URL-encodeada', () => {
    registrarSecreto('valor con espacios y ñ');
    expect(secretosRegistrados()).toBe(2); // crudo + encodeado
  });

  it('ignora valores nulos o vacíos', () => {
    registrarSecreto(undefined);
    registrarSecreto(null);
    registrarSecreto('');
    expect(secretosRegistrados()).toBe(0);
  });

  it('ignora valores demasiado cortos — redactarían texto legítimo por coincidencia', () => {
    registrarSecreto('abc');
    registrarSecreto('1234567'); // 7 chars, bajo el mínimo
    expect(secretosRegistrados()).toBe(0);
  });
});

describe('redact — coincidencia exacta', () => {
  it('borra el ticket registrado de cualquier texto', () => {
    registrarSecreto(TICKET);
    const salida = redact(`Falló la request con ticket ${TICKET} en el header`);
    expect(salida).not.toContain(TICKET);
    expect(salida).toContain('[REDACTED]');
  });

  it('borra todas las apariciones, no solo la primera', () => {
    registrarSecreto(TICKET);
    const salida = redact(`${TICKET} ... ${TICKET} ... ${TICKET}`);
    expect(salida).not.toContain(TICKET);
    expect(salida.match(/\[REDACTED\]/g)).toHaveLength(3);
  });

  it('borra la variante URL-encodeada', () => {
    // Debe superar LARGO_MINIMO (8) para registrarse.
    const secreto = 'clave con espacios+y/barras';
    registrarSecreto(secreto);
    const encodeado = encodeURIComponent(secreto);
    expect(encodeado).toContain('%20'); // confirma que la codificación cambia el valor
    const salida = redact(`url?t=${encodeado}`);
    expect(salida).not.toContain(encodeado);
    expect(salida).toContain('[REDACTED]');
  });
});

describe('redact — defensa sin registro previo', () => {
  it('borra ticket= de una query string aunque el secreto NO esté registrado', () => {
    // Escenario: fallo durante el arranque, antes de registrarSecreto()
    expect(secretosRegistrados()).toBe(0);
    const salida = redact('GET https://api.mercadopublico.cl/x?ticket=SECRETO-SIN-REGISTRAR&otro=1');
    expect(salida).not.toContain('SECRETO-SIN-REGISTRAR');
    expect(salida).toContain('ticket=[REDACTED]');
    // No debe dañar los demás parámetros
    expect(salida).toContain('otro=1');
  });

  it('borra el ticket en forma de par JSON o header', () => {
    expect(redact('{"ticket": "ABC-123-SECRETO"}')).not.toContain('ABC-123-SECRETO');
    expect(redact(`headers: { 'ticket': 'OTRO-SECRETO' }`)).not.toContain('OTRO-SECRETO');
  });

  it('no altera texto sin secretos', () => {
    const limpio = 'Todo bien: 25 resultados en la región 13.';
    expect(redact(limpio)).toBe(limpio);
  });
});

describe('safeError — la fuga real demostrada', () => {
  it('tapa la fuga de "Failed to parse URL" que sí ocurre en Node', () => {
    registrarSecreto(TICKET);
    // Este es el mensaje EXACTO que Node produce al fallar el parseo de una URL
    // que lleva el ticket en la query string (verificado empíricamente).
    const error = new TypeError(`Failed to parse URL from http://[bad-url]/x?ticket=${TICKET}`);
    const salida = safeError(error);
    expect(salida).not.toContain(TICKET);
    expect(salida).toContain('[REDACTED]');
  });

  it('incluye el cause pero redactado', () => {
    registrarSecreto(TICKET);
    const error = new Error('fetch failed');
    (error as Error & { cause?: unknown }).cause = new Error(`connect to ...?ticket=${TICKET}`);
    const salida = safeError(error);
    expect(salida).toContain('fetch failed');
    expect(salida).not.toContain(TICKET);
  });

  it('maneja valores lanzados que no son Error', () => {
    registrarSecreto(TICKET);
    expect(safeError(`string crudo con ${TICKET}`)).not.toContain(TICKET);
    expect(safeError(null)).toBe('null');
    expect(safeError(42)).toBe('42');
  });
});

describe('pista', () => {
  it('muestra solo los últimos 4 caracteres', () => {
    expect(pista(TICKET)).toBe('••••A6F3');
    expect(pista(TICKET)).not.toContain('F8A21C90');
  });

  it('no revela nada de credenciales muy cortas', () => {
    expect(pista('abc')).toBe('••••');
  });

  it('informa cuando no hay credencial', () => {
    expect(pista(undefined)).toBe('(no configurado)');
  });
});
