/**
 * Actualizar un `.env` sin romper lo que el dueño ya tenía (asistente
 * `--configurar`, 2.9.0). Cambia el valor de las variables pedidas donde
 * están (aunque estén comentadas con `# VARIABLE=`), agrega al final las que
 * no existen y deja intactos los comentarios y las demás variables.
 */

/**
 * El valor va tal cual: el cargador (utils/env-loader.ts) toma todo lo que sigue
 * al primer `=`, sin interpretar `#` ni escapes, y solo quita comillas que lo
 * encierren. Escribirlo sin comillas es lo que se lee igual. Un salto de línea
 * partiría la variable: se reemplaza por un espacio.
 */
const formatear = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

export function actualizarEnv(texto: string, cambios: Record<string, string>): string {
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const lineas = texto.length > 0 ? texto.split(/\r?\n/) : [];
  if (lineas.at(-1) === '') lineas.pop(); // el salto final se vuelve a poner al unir
  const pendientes = new Map(Object.entries(cambios));
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (!m || !pendientes.has(m[1])) continue;
    // Si la variable aparece dos veces, se cambia la primera y la otra se comenta.
    lineas[i] = `${m[1]}=${formatear(pendientes.get(m[1])!)}`;
    pendientes.delete(m[1]);
    for (let j = i + 1; j < lineas.length; j++) {
      if (new RegExp(`^\\s*${m[1]}\\s*=`).test(lineas[j])) lineas[j] = `# ${lineas[j]}  (reemplazada por --configurar)`;
    }
  }
  if (pendientes.size > 0) {
    while (lineas.length > 0 && lineas[lineas.length - 1].trim() === '') lineas.pop();
    lineas.push('', '# ─── Agregado por mcp-compra-agil --configurar ───');
    for (const [k, v] of pendientes) lineas.push(`${k}=${formatear(v)}`);
  }
  return lineas.join(eol) + eol;
}
