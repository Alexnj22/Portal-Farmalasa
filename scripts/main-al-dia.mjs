#!/usr/bin/env node
// Pone el `main` del árbol compartido al día con `origin/main` SIN perder nada.
//
//   npm run main:al-dia              → dice qué haría (no toca nada)
//   npm run main:al-dia -- --aplicar → lo hace, con respaldo previo
//
// ── Por qué existe (2026-10-21) ─────────────────────────────────────────────
// El árbol compartido llevaba desde el 15-oct sin avanzar: 118 commits atrás
// de `origin/main` y 8 adelante. Los 8 eran COPIAS — cada sesión commiteaba
// sobre el `main` viejo, el push rebotaba (no es fast-forward), y la sesión
// repetía el commit desde un worktree sobre `origin/main` con otro número de
// versión. El commit local se quedaba, y el siguiente nacía todavía más atrás.
//
// Nadie lo ponía al día porque ninguna salida servía: `git pull` se niega con
// el árbol sucio (siempre lo está: hay varias sesiones), y `stash` /
// `reset --hard` están prohibidos porque barren trabajo ajeno sin commitear.
//
// Este script hace lo único seguro, y se niega ante la duda:
//   1. Cada commit local que no está arriba tiene que tener un GEMELO arriba
//      (mismo asunto, sin el «(vX.Y.Z)»). Si alguno no lo tiene, es trabajo sin
//      publicar: se para y lo nombra.
//   2. Cada archivo sucio que ARRIBA también cambió tiene que ser una copia
//      vieja de lo que ya está arriba: cada línea suya que `origin/main` no
//      tiene debe aparecer en algún commit de arriba (que la agregó y después
//      la cambió). Si una línea no aparece en ningún lado, es trabajo de
//      alguien: se para y la nombra.
//   3. Respaldo de TODO lo sucio en `.git/respaldos-main/<fecha>/` antes de
//      tocar nada.
//   4. `git reset --keep origin/main`, que es el reset que se niega solo si
//      fuera a pisar un cambio local. Lo sucio que arriba NO cambió queda
//      exactamente como estaba.
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const APLICAR = process.argv.includes('--aplicar');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trimEnd();
const gitOk = (...a) => {
  try { execFileSync('git', a, { stdio: 'ignore' }); return true; } catch { return false; }
};
const lineas = (s) => (s ? s.split('\n').filter(Boolean) : []);
const sinVersion = (s) => s.replace(/\s*\(v?\d+(\.\d+)+\)\s*$/, '').trim();

const raiz = git('rev-parse', '--show-toplevel');
process.chdir(raiz);

const rama = git('rev-parse', '--abbrev-ref', 'HEAD');
if (rama !== 'main') {
  console.log(`  · Estás en «${rama}», no en main. Esto es sólo para el main del árbol compartido.`);
  process.exit(0);
}

try { git('fetch', '-q', 'origin', 'main'); } catch {
  console.error('  ✗ No se pudo hacer fetch de origin/main. Sin eso no hay contra qué comparar.');
  process.exit(1);
}

const atras    = Number(git('rev-list', '--count', 'HEAD..origin/main'));
const adelante = lineas(git('rev-list', 'origin/main..HEAD'));
if (atras === 0) {
  console.log(adelante.length
    ? `  · main está al día y tiene ${adelante.length} commit(s) sin publicar: \`git push\`.`
    : '  ✓ main ya está al día con origin/main.');
  process.exit(0);
}
console.log(`  main está ${atras} commit(s) atrás de origin/main y ${adelante.length} adelante.\n`);

let frenos = 0;

// ── 1. Los commits locales tienen que estar arriba ──────────────────────────
if (adelante.length) {
  const base = git('merge-base', 'HEAD', 'origin/main');
  const arriba = new Map(lineas(git('log', '--format=%h\t%s', `${base}..origin/main`))
    .map(l => { const [h, ...s] = l.split('\t'); return [sinVersion(s.join('\t')), h]; }));
  for (const c of adelante) {
    const asunto = git('log', '-1', '--format=%s', c);
    const gemelo = arriba.get(sinVersion(asunto));
    if (gemelo) {
      console.log(`  ✓ ${c.slice(0, 9)} ya está arriba como ${gemelo}  ${asunto}`);
    } else {
      console.log(`  ✗ ${c.slice(0, 9)} NO está arriba  ${asunto}`);
      frenos++;
    }
  }
  console.log('');
}

// ── 2. Lo sucio que arriba también cambió tiene que ser una copia vieja ─────
const cambiadosArriba = new Set(lineas(git('diff', '--name-only', 'HEAD', 'origin/main')));
const sucios          = lineas(git('diff', '--name-only', 'HEAD'));
const sinSeguir       = lineas(git('ls-files', '--others', '--exclude-standard'));
const enOrigen        = (f) => gitOk('cat-file', '-e', `origin/main:${f}`);

const aRestaurar = [];   // seguidos y sucios que arriba cambió
const aQuitar    = [];   // sin seguir que arriba ya trae
const enRiesgo = [
  ...sucios.filter(f => cambiadosArriba.has(f)).map(f => ({ f, seguido: true })),
  ...sinSeguir.filter(f => enOrigen(f)).map(f => ({ f, seguido: false })),
];

for (const { f, seguido } of enRiesgo) {
  const local  = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const origen = enOrigen(f) ? git('show', `origin/main:${f}`) : '';
  const deOrigen = new Set(origen.split('\n'));
  const propias  = local.split('\n').filter(l => l.trim() && !deOrigen.has(l));
  let huerfanas = propias;
  if (propias.length) {
    // Todo lo que alguna vez pasó por ese archivo en la historia de arriba.
    const historia = new Set(git('log', '-p', '--format=', 'origin/main', '--', f)
      .split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).map(l => l.slice(1)));
    huerfanas = propias.filter(l => !historia.has(l));
  }
  if (huerfanas.length) {
    console.log(`  ✗ ${f}: ${huerfanas.length} línea(s) que no están en ningún commit de arriba`);
    huerfanas.slice(0, 3).forEach(l => console.log(`        ${l.trim().slice(0, 100)}`));
    frenos++;
  } else {
    console.log(`  ✓ ${f}: copia vieja de lo que ya está arriba`);
    (seguido ? aRestaurar : aQuitar).push(f);
  }
}

const quedan = sucios.filter(f => !cambiadosArriba.has(f));
if (quedan.length) {
  console.log(`\n  · ${quedan.length} archivo(s) sucios que arriba no cambió: quedan EXACTAMENTE como están.`);
}

if (frenos) {
  console.log(`\n  ✗ ${frenos} freno(s). No se toca nada: hay trabajo que no está publicado.`);
  console.log('    Publicalo primero (desde un worktree sobre origin/main) o preguntale a quien lo hizo.');
  process.exit(1);
}

if (!APLICAR) {
  console.log('\n  Todo es seguro. Para hacerlo:  npm run main:al-dia -- --aplicar');
  process.exit(0);
}

// ── 3. Respaldo ──────────────────────────────────────────────────────────────
const sello   = new Date().toISOString().replace(/[:.]/g, '-');
const destino = join(git('rev-parse', '--git-common-dir'), 'respaldos-main', sello);
mkdirSync(destino, { recursive: true });
const todo = [...new Set([...sucios, ...sinSeguir])].filter(f => existsSync(f));
writeFileSync(join(destino, 'lista.txt'), todo.join('\n') + '\n');
writeFileSync(join(destino, 'diff-vs-HEAD.patch'), git('diff', 'HEAD'));
writeFileSync(join(destino, 'HEAD.txt'), git('rev-parse', 'HEAD') + '\n');
if (todo.length) execFileSync('tar', ['-cf', join(destino, 'arbol.tar'), ...todo]);
console.log(`\n  · Respaldo en ${destino}`);

// ── 4. Mover main ────────────────────────────────────────────────────────────
if (aRestaurar.length) git('checkout', 'HEAD', '--', ...aRestaurar);
for (const f of aQuitar) rmSync(f);
try {
  git('reset', '--keep', 'origin/main');
} catch (e) {
  console.error(`  ✗ git reset --keep se negó: ${e.message.split('\n')[0]}`);
  console.error(`    Lo restaurado está en el respaldo: tar -xf ${join(destino, 'arbol.tar')}`);
  process.exit(1);
}
console.log(`  ✓ main al día con origin/main (${git('rev-parse', '--short', 'HEAD')}).`);
