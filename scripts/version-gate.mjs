#!/usr/bin/env node
/**
 * Verifica que APP_VERSION haya subido cuando cambió `src/`, y que la entrada
 * de esa versión exista en CHANGELOG.md.
 *
 * Creado el 2026-07-27 después de descubrir que DOCE bumps seguidos habían
 * fallado en silencio: los scripts hacían un `replace` sobre un ancla que ya no
 * existía, no verificaban el resultado, y el commit salía igual con "(v2.7X)"
 * en el mensaje y el archivo intacto.
 *
 * Es el mismo patrón que las vistas sin import: una operación que no hace nada,
 * y nada que lo mire.
 *
 * ── El changelog vive en CHANGELOG.md, y ahora se verifica (2026-08-01) ──────
 * El 2026-07-28 se sacó el histórico de `src/version.js` (pesaba 805 KB)
 * dejando "las últimas 6 entradas ahí, que es lo que uno mira al retomar".
 * Nadie verificaba esa regla, así que **164 de las 268 entradas escritas
 * después nunca llegaron a CHANGELOG.md** y el archivo volvió a 7,330 líneas:
 * el mismo problema, reconstruido en tres semanas.
 *
 * Y el motivo de fondo es peor que el peso: con 2-3 sesiones sobre el mismo
 * árbol, todas escribían el mismo bloque al tope del mismo archivo, así que
 * colisionaban siempre. Ahora `version.js` es una línea, la entrada va a
 * CHANGELOG.md (donde dos sesiones tocan bloques distintos) y este gate lo
 * exige. Una regla que nada revisa es una regla que ya se rompió.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const leerVersion = (texto) => (texto.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
// `maxBuffer` explícito: el default de execSync es 1 MB y CHANGELOG.md ya pesa
// 1.24 MB, así que `git show :CHANGELOG.md` moría con ENOBUFS. El try/catch de
// abajo se tragaba ese error, el changelog quedaba vacío y el gate concluía que
// faltaba la entrada — bloqueando TODO commit que tocara `src/`, con la entrada
// escrita y preparada.
//
// La mordida es fina: este gate se escribió para que no se pierdan entradas, y
// recuperar las 164 que faltaban es justo lo que empujó el archivo sobre 1 MB.
// Un límite que se cruza por crecer es el que nadie ve venir.
const git = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Se lee del ÍNDICE, no del disco: lo que importa es la versión que va en ESTE
// commit. Con el archivo de trabajo se validaba un bump que podía no estar
// preparado — y con varias sesiones, podía ser el bump de otra.
let actual;
try {
  actual = leerVersion(git('git show :src/version.js'));
} catch {
  actual = leerVersion(readFileSync('src/version.js', 'utf8'));   // sin índice (primer commit)
}

let anterior = null;
try {
  anterior = leerVersion(git('git show HEAD:src/version.js'));
} catch { /* primer commit */ }

const preparados = git('git diff --cached --name-only').split('\n').filter(Boolean);
const cambios = preparados.filter(f => f.startsWith('src/') && f !== 'src/version.js');

console.log(`\n  APP_VERSION: ${anterior ?? '—'} → ${actual}`);

// ── 1. `version.js` no vuelve a ser el changelog ────────────────────────────
const enIndice = (() => { try { return git('git show :src/version.js'); } catch { return readFileSync('src/version.js', 'utf8'); } })();
const entradas = (enIndice.match(/^\/\/ v\d+\.\d+\.\d+/gm) || []).length;
if (entradas > 0) {
  console.log(`\n  ✗ src/version.js tiene ${entradas} entrada(s) de changelog.`);
  console.log('    La entrada de cada versión va en CHANGELOG.md, en la raíz.');
  console.log('    Acá solo la constante — es lo que evita que dos sesiones choquen');
  console.log('    escribiendo el mismo bloque al tope del mismo archivo.\n');
  process.exit(1);
}

if (!cambios.length) {
  console.log('  Sin cambios en src/ preparados. Nada que verificar.\n');
  process.exit(0);
}

// ── 2. La versión sube ──────────────────────────────────────────────────────
if (actual === anterior) {
  console.log(`\n  ✗ ${cambios.length} archivo(s) de src/ cambiaron y APP_VERSION sigue en ${actual}.`);
  console.log('    Corré `npm run version:bump -- patch|minor|major`, que además');
  console.log('    deja la entrada lista en CHANGELOG.md.');
  console.log('    Si el bump se hizo con un script, revisá que el reemplazo haya ocurrido:');
  console.log('    un replace que no encuentra su ancla no falla, simplemente no hace nada.\n');
  process.exit(1);
}

// ── 3. Y sube UN paso legítimo, no el de otra sesión ────────────────────────
// El 2026-08-14 pasó dos veces en la misma tarde, entre cuatro sesiones sobre
// este árbol: un `git add src/version.js` se llevó el bump que otra sesión tenía
// preparado. Quedaron dos commits cuyo rótulo no coincide con el número que
// guardan adentro — `2.605.3 → 2.605.5` y `2.606.1 → 2.606.3`.
//
// Los tres chequeos de arriba NO podían verlo, y no por casualidad: el barrido
// se lleva `version.js` **y su entrada del changelog juntas**, así que el
// chequeo 4 («existe `## v<versión>` en este commit») queda satisfecho por
// construcción. Un control que el problema nunca rompe no es un control flojo:
// mide otra cosa.
//
// Un salto de más es la firma exacta del barrido, porque el bump ajeno ya se
// había comido el número intermedio. Se exige que el destino sea uno de los tres
// sucesores válidos — patch, minor o major. Nada de "exactamente un patch": un
// minor legítimo (2.605.8 → 2.606.0) también tiene que pasar.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const partes = (v) => (String(v ?? '').match(SEMVER) || []).slice(1).map(Number);

const [maA, miA, paA] = partes(anterior);
const [maN, miN, paN] = partes(actual);

// Si alguno no parsea, no se bloquea —un formato inesperado no debería frenar un
// commit— pero se DICE. Un chequeo que no corrió y uno que pasó no pueden verse
// igual: `version.js` lo escribe `version-bump.mjs`, así que un valor que no es
// semver significa que alguien lo editó a mano o que el archivo se corrompió, y
// las dos cosas quieren un aviso.
if (anterior && (maA === undefined || maN === undefined)) {
  console.log(`\n  ⚠ No pude leer la versión como semver (HEAD: ${anterior ?? '—'}, preparada: ${actual ?? '—'}).`);
  console.log('    El chequeo de salto NO corrió. `src/version.js` no se edita a mano:');
  console.log('    sale de `npm run version:bump`.\n');
}

if (anterior && maA !== undefined && maN !== undefined) {
  const sucesores = [
    `${maA}.${miA}.${paA + 1}`,   // patch
    `${maA}.${miA + 1}.0`,        // minor
    `${maA + 1}.0.0`,             // major
  ];
  if (!sucesores.includes(actual)) {
    console.log(`\n  ✗ APP_VERSION salta de ${anterior} a ${actual}.`);
    console.log(`    Desde ${anterior} sólo se puede ir a: ${sucesores.join(', ')}.`);
    console.log('    Un salto de más suele significar que este commit se llevó el');
    console.log('    bump de OTRA sesión: `git add src/version.js` no distingue');
    console.log('    tu número del que otra dejó preparado en el mismo archivo.');
    console.log('\n    Mirá qué estás por commitear:');
    console.log('      git diff --cached src/version.js');
    console.log('    Si el número no es tuyo, sacalo del commit (no lo revuelvas ni');
    console.log('    lo pises) y volvé a correr `npm run version:bump`:');
    console.log('      git restore --staged src/version.js\n');
    process.exit(1);
  }
}

// ── 4. La entrada existe en CHANGELOG.md y va en este commit ────────────────
let changelog = '';
try { changelog = git('git show :CHANGELOG.md'); } catch { /* no preparado */ }
const tieneEntrada = new RegExp(`^## v${actual.replace(/\./g, '\\.')}\\b`, 'm').test(changelog);

if (!tieneEntrada) {
  const enDisco = new RegExp(`^## v${actual.replace(/\./g, '\\.')}\\b`, 'm')
    .test(readFileSync('CHANGELOG.md', 'utf8'));
  console.log(`\n  ✗ Falta la entrada \`## v${actual}\` en CHANGELOG.md preparado.`);
  console.log(enDisco
    ? '    Está escrita pero sin preparar: agregá CHANGELOG.md a este commit.'
    : '    Escribila antes de commitear — `npm run version:bump` la deja empezada.');
  console.log('    Sin esto la versión sube y el cambio queda sin explicación en');
  console.log('    ningún lado, que es exactamente cómo se perdieron 164 entradas.\n');
  process.exit(1);
}

console.log(`  ✓ ${cambios.length} archivo(s) de src/, la versión subió y CHANGELOG.md la documenta.\n`);
