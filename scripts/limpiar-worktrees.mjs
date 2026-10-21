#!/usr/bin/env node
/**
 * limpiar-worktrees.mjs — borra los árboles de trabajo que ya nadie usa.
 *
 * POR QUÉ EXISTE
 * Los worktrees son la protección contra que dos sesiones se pisen (ver
 * `npm run worktree` y CLAUDE.md), pero nada los borraba al terminar. Medido el
 * 2026-10-21: 22 carpetas `../Portal-Farmalasa-*`, 8 en `.claude/worktrees/`
 * (las crean los agentes aislados, 285–470 MB cada una) y 12 registros que
 * apuntaban a carpetas temporales que ya no existían. Las de `.claude/` además
 * rompían `npm run lint` y `npm test` (10,258 errores ajenos) y las indexaba
 * CodeGraph, que las vigilaba con más de 5,000 archivos abiertos cada una.
 *
 * LOS CINCO FRENOS (un worktree se salva si cualquiera aplica)
 *   1. Es el árbol principal.
 *   2. Tiene cambios sin commitear — eso no está en ningún lado más.
 *   3. Tiene commits que `origin/main` no tiene. Se mide con `git cherry`, que
 *      compara el CONTENIDO del parche: una rama mergeada con otro número de
 *      commit (cherry-pick, rebase) cuenta como ya integrada; una con trabajo
 *      propio, no.
 *   4. Se usó hace menos de N días (por defecto 3). La fecha sale del último
 *      commit y del índice de git de ESE worktree, que se toca con cualquier
 *      `status`/`add`/`checkout` — o sea, con cualquier sesión que lo esté
 *      usando, aunque todavía no haya commiteado nada.
 *   5. Un proceso vivo tiene su directorio de trabajo adentro (una terminal,
 *      un `vite`). CodeGraph no cuenta: vigila todo, no está trabajando ahí.
 *
 * USO
 *   node scripts/limpiar-worktrees.mjs             → inventario (no borra)
 *   node scripts/limpiar-worktrees.mjs --borrar    → borra lo que pasa los frenos
 *   node scripts/limpiar-worktrees.mjs --dias 7    → cambia el umbral
 *   node scripts/limpiar-worktrees.mjs --auto      → silencioso, borra, NUNCA falla
 *
 * Borra con `git worktree remove` SIN `--force`: si git encuentra algo que los
 * frenos no vieron, se niega, y eso es lo correcto. La rama se borra con
 * `branch -d`, que también se niega si no está integrada.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const DIAS_POR_DEFECTO = 3;

const args = process.argv.slice(2);
const auto = args.includes('--auto');
const borrar = auto || args.includes('--borrar');
const iDias = args.indexOf('--dias');
const dias = iDias >= 0 ? Number(args[iDias + 1]) : DIAS_POR_DEFECTO;
const log = auto ? () => {} : console.log;

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function principal() {
  try {
    if (!Number.isFinite(dias) || dias < 0) throw new Error('--dias necesita un número de días (ej. --dias 7)');
    try { git(RAIZ, 'worktree', 'prune'); } catch { /* sin efecto si no hay nada */ }

    // Directorios de trabajo de los procesos vivos (freno 5).
    let cwdVivos = [];
    try {
      cwdVivos = execFileSync('lsof', ['-a', '-d', 'cwd', '-Fcn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })
        .split('\n').reduce((acc, l, i, todas) => {
          if (l.startsWith('n') && !/codegraph/i.test(todas[i - 1] || '')) acc.push(l.slice(1));
          return acc;
        }, []);
    } catch { /* sin lsof: el freno 4 (días) sigue valiendo */ }

    const bloques = git(RAIZ, 'worktree', 'list', '--porcelain').split('\n\n').filter(Boolean);
    const filas = [];
    for (const b of bloques) {
      const ruta = b.match(/^worktree (.+)$/m)?.[1];
      const rama = b.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null;
      if (!ruta || ruta === RAIZ || !existsSync(ruta)) continue;   // freno 1

      const motivos = [];
      let sucios = 0, propios = 0, usado = 0;
      try { usado = Math.max(usado, statSync(join(git(ruta, 'rev-parse', '--absolute-git-dir'), 'index')).mtimeMs); } catch { /* sin índice */ }
      // `--no-optional-locks`: un `git status` normal refresca el índice y le
      // cambia la fecha, o sea que el inventario se tocaría a sí mismo y todo
      // parecería «usado hoy». Por lo mismo la fecha se lee ANTES.
      try { sucios = git(ruta, '--no-optional-locks', 'status', '--porcelain').split('\n').filter(Boolean).length; } catch { motivos.push('git no pudo leerlo'); }
      try { propios = git(ruta, 'cherry', 'origin/main', 'HEAD').split('\n').filter(l => l.startsWith('+')).length; } catch { motivos.push('no se pudo comparar con origin/main'); }
      try { usado = Math.max(usado, Number(git(ruta, 'log', '-1', '--format=%ct')) * 1000); } catch { /* sin commits */ }

      const diasQuieto = Math.floor((Date.now() - usado) / 86_400_000);

      if (sucios) motivos.push(`${sucios} archivo(s) sin commitear`);
      if (propios) motivos.push(`${propios} commit(s) que main no tiene`);
      if (diasQuieto < dias) motivos.push(`usado hace ${diasQuieto} día(s)`);
      if (cwdVivos.some(c => c === ruta || c.startsWith(ruta + '/'))) motivos.push('un proceso está trabajando ahí');

      filas.push({ ruta: ruta.replace(RAIZ.replace(/\/[^/]+$/, '') + '/', ''), absoluta: ruta, rama, diasQuieto, motivos });
    }

    const borrables = filas.filter(f => !f.motivos.length);
    const quedan = filas.filter(f => f.motivos.length);
    log(`\n  ${filas.length} worktree(s) además del principal · ${borrables.length} sin uso · ${quedan.length} se quedan\n`);
    for (const f of quedan) log(`  · ${f.ruta}  [${f.rama ?? 'sin rama'}]  quieto ${f.diasQuieto} d — ${f.motivos.join(', ')}`);

    for (const f of borrables) {
      if (!borrar) { log(`  ✗ borraría ${f.ruta}  [${f.rama ?? 'sin rama'}]  quieto ${f.diasQuieto} d`); continue; }
      try {
        git(RAIZ, 'worktree', 'remove', f.absoluta);
        if (f.rama) try { git(RAIZ, 'branch', '-d', f.rama); } catch { /* integrada por contenido, no por historia: la rama queda */ }
        log(`  ✓ borrado ${f.ruta}`);
      } catch { log(`  · git se negó a borrar ${f.ruta}: queda`); }
    }
    if (!borrar && borrables.length) log('\n  (no se borró nada — `--borrar` para hacerlo)');
    log('');
  } catch (e) {
    if (!auto) { console.error(`  ✗ ${e.message}`); process.exit(1); }
  }
}

principal();
