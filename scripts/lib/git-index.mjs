/**
 * Leer archivos desde el ÍNDICE de git, no del disco.
 *
 * Por qué existe: en este repo trabajan 2-3 sesiones sobre el mismo árbol
 * (CLAUDE.md). Un gate de pre-commit que lee el disco reporta hallazgos del
 * trabajo a medio hacer de OTRA sesión y bloquea un commit que no los tocó —
 * pasó dos veces (2026-08-01 con `sync-numero-control`, 2026-08-03 con
 * `src/data/ventas.js`). El índice es la definición correcta de "lo que este
 * commit lleva": HEAD más lo que la sesión acaba de preparar.
 *
 * Vive acá y no duplicado en cada gate porque el parseo tiene dos trampas y dos
 * copias de la misma regla no son dos testigos:
 *
 *   1. `maxBuffer` explícito — pedirle texto a `execSync` corta en 1 MB, y el
 *      corte llega como archivos truncados, no como un error.
 *   2. El avance del lote es por BYTES, que es lo que anuncia la cabecera
 *      `<oid> blob <n>`. Contar caracteres desalinea todo a partir del segundo
 *      archivo: casi todo este repo tiene acentos y `String.length` (UTF-16) no
 *      es el tamaño UTF-8 — medido, 5141 contra 5149 en un solo archivo.
 *
 * Verificado sobre los 395 archivos de `src/` + `supabase/functions/`: idénticos
 * a `git show :<ruta>`, 0 discrepancias.
 */
import { execSync } from 'node:child_process';

/** @returns {Set<string>} rutas que el índice conoce bajo los paths dados */
export function archivosIndexados(raiz, paths) {
  return new Set(
    execSync(`git ls-files -- ${paths.join(' ')}`, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .trim().split('\n').filter(Boolean),
  );
}

/**
 * Contenido de cada ruta según el índice. Un solo `git cat-file --batch` para
 * todas: son ~400 archivos y un `git show` por archivo cuesta 400 procesos.
 * @returns {Map<string,string>}
 */
export function leerDelIndice(raiz, rutas) {
  const mapa = new Map();
  if (rutas.length === 0) return mapa;
  const salida = execSync('git cat-file --batch', {
    cwd: raiz,
    input: rutas.map(r => `:${r}`).join('\n') + '\n',
    maxBuffer: 512 * 1024 * 1024,
  });
  let pos = 0;
  for (const ruta of rutas) {
    const nl = salida.indexOf(0x0a, pos);
    if (nl === -1) break;
    const partes = salida.toString('utf8', pos, nl).split(' ');   // "<oid> blob <bytes>"
    if (partes[1] !== 'blob') { pos = nl + 1; continue; }         // "missing" / "ambiguous"
    const ini = nl + 1;
    const fin = ini + Number(partes[2]);
    mapa.set(ruta, salida.toString('utf8', ini, fin));
    pos = fin + 1;                                                // +1: el \n de cierre
  }
  return mapa;
}
