/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Las edge functions también se revisan — `npm run gate:edge`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hasta el 2026-10-24 las ~92 funciones de `supabase/functions/` (Deno +
 * TypeScript) no las miraba NADIE: ni `tsc`, ni ESLint (que sólo lee
 * `.js/.jsx`), ni el CI. Un error de tipos se enteraba en producción, y una
 * función que llama a un cron no tiene a nadie mirando la pantalla.
 *
 * Dos pasadas, con el `deno` oficial y versión fija:
 *
 *   1. `deno check` — BLOQUEA EN CERO. La primera corrida dio 365 errores; 289
 *      salían de UNA expresión (`ReturnType<typeof createClient>`, que tipa al
 *      cliente con `Database = unknown` y deja todas las filas en `never`) y
 *      se arreglaron con un tipo en `_shared/security.ts` (`ClienteAdmin`). El
 *      resto, uno por uno; el detalle en CHANGELOG v2.1353.1. Hoy en cero, así
 *      que cualquier error nuevo es código nuevo.
 *
 *   2. `deno lint` — con BASELINE POR FUNCIÓN, que sólo baja
 *      (`scripts/edge-lint-baseline.json`). Las reglas de estilo que darían
 *      cientos de avisos sin defecto detrás están apagadas en
 *      `scripts/edge-gate/deno.json`, cada una con su motivo:
 *        · `no-explicit-any` (506): las filas de supabase-js sin tipos de la
 *          base SON `any`; el contrato de la base lo vigila `gate:tipos`.
 *        · `no-import-prefix` (105): `npm:`/`jsr:` en línea es el patrón de
 *          Supabase para funciones sin import map.
 *        · `require-await`, `no-inner-declarations`, `ban-unused-ignore`:
 *          estilo, sin falla posible.
 *      Lo que queda (variables sin usar, `let` que es `const`, import sin
 *      versión) es poco y vale mirarlo.
 *
 * ── Por qué una config propia y no la de cada función ─────────────────────
 *
 * `--config scripts/edge-gate/deno.json`: el `package.json` de la raíz hace que
 * Deno busque los `npm:` en el `node_modules` del portal (y falla: `fflate` no
 * está ahí). La config dice `nodeModulesDir: none` — la misma resolución que
 * usa Supabase al desplegar. Ningún `deno.json` de función mapea algo que el
 * código importe (sólo `@supabase/functions-js`, sin usos), así que no se
 * pierde nada. Y vive FUERA de `supabase/functions/` a propósito: un
 * `deno.json` ahí lo podría levantar el empaquetador del despliegue.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *
 *   npm run gate:edge                       las dos pasadas
 *   npm run gate:edge -- --solo-check       sólo tipos
 *   npm run gate:edge -- --update-baseline  BAJA el baseline del lint (nunca sube)
 *
 * Usa `deno` del PATH si existe (el CI lo instala con `setup-deno`, misma
 * versión); si no, `npx -y deno@<VERSION>`. Necesita red la primera vez para
 * bajar los módulos remotos — por eso NO va en el pre-commit.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION_DENO = '2.5.6';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'scripts/edge-gate/deno.json';
const OBJETIVO = 'supabase/functions/';
const BASELINE = join(RAIZ, 'scripts/edge-lint-baseline.json');

const args = new Set(process.argv.slice(2));
const soloCheck = args.has('--solo-check');
const actualizar = args.has('--update-baseline');

function deno(argv) {
  const local = spawnSync('deno', ['--version'], { encoding: 'utf8' });
  const usarLocal = local.status === 0 && local.stdout.startsWith(`deno ${VERSION_DENO} `);
  const [cmd, pre] = usarLocal ? ['deno', []] : ['npx', ['-y', `deno@${VERSION_DENO}`]];
  return spawnSync(cmd, [...pre, ...argv], {
    cwd: RAIZ, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

/** `supabase/functions/<fn>/…` → `<fn>` (o `_shared`). */
function funcionDe(archivo) {
  const rel = relative(join(RAIZ, 'supabase/functions'), archivo);
  return rel.split(/[\\/]/)[0];
}

let fallo = false;

// ── 1. Tipos ────────────────────────────────────────────────────────────────
const check = deno(['check', '--quiet', '--config', CONFIG, OBJETIVO]);
const salidaCheck = `${check.stdout}\n${check.stderr}`;
const errores = [...salidaCheck.matchAll(/^(TS\d+) \[ERROR\]: (.*)$/gm)];
if (check.status !== 0) {
  fallo = true;
  console.log(`  ✗ deno check: ${errores.length || 'hay'} error(es) de tipos en las edge functions.\n`);
  console.log(salidaCheck.split('\n').filter((l) => !/^(Download|Check) /.test(l)).join('\n').trim());
  console.log('\n    Está en CERO: todo error es código nuevo. Un tipo que no se puede');
  console.log('    expresar se resuelve con un tipo (ver `ClienteAdmin`), no con @ts-ignore.\n');
} else {
  console.log('  ✓ deno check: 0 errores de tipos en supabase/functions/');
}

// ── 2. Lint, contra el baseline ────────────────────────────────────────────
if (!soloCheck) {
  const lint = deno(['lint', '--config', CONFIG, '--json', OBJETIVO]);
  let informe;
  try {
    informe = JSON.parse(lint.stdout);
  } catch {
    console.log(`  ✗ deno lint no devolvió JSON (código ${lint.status}):\n${lint.stderr}`);
    process.exit(1);
  }
  if (informe.errors?.length) {
    // Un archivo que no se pudo parsear no es «cero avisos»: es no haber medido.
    fallo = true;
    console.log('  ✗ deno lint no pudo leer:');
    for (const e of informe.errors) console.log(`      ${e.file_path}: ${e.message}`);
  }
  const porFuncion = {};
  const detalle = {};
  for (const d of informe.diagnostics ?? []) {
    const archivo = fileURLToPath(d.filename);
    const fn = funcionDe(archivo);
    porFuncion[fn] = (porFuncion[fn] ?? 0) + 1;
    (detalle[fn] ??= []).push(`${relative(RAIZ, archivo)}:${d.range.start.line}  ${d.code}  ${d.message}`);
  }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const techo = base.porFuncion ?? {};
  const suben = Object.keys(porFuncion).filter((fn) => porFuncion[fn] > (techo[fn] ?? 0));
  const total = Object.values(porFuncion).reduce((a, n) => a + n, 0);

  if (suben.length) {
    fallo = true;
    console.log(`  ✗ deno lint: ${suben.length} función(es) con más avisos que su baseline:\n`);
    for (const fn of suben) {
      console.log(`    ${fn}: ${porFuncion[fn]} (baseline ${techo[fn] ?? 0})`);
      for (const l of detalle[fn]) console.log(`      ${l}`);
    }
    console.log('\n    El baseline SÓLO BAJA: no se sube para que calle.\n');
  } else {
    console.log(`  ✓ deno lint: ${total} aviso(s), ninguna función por encima de su baseline (${base.total}).`);
  }

  const bajaron = Object.keys(techo).filter((fn) => (porFuncion[fn] ?? 0) < techo[fn]);
  if (bajaron.length && actualizar && !suben.length) {
    const nuevo = {};
    for (const fn of Object.keys(techo).sort()) if (porFuncion[fn]) nuevo[fn] = Math.min(porFuncion[fn], techo[fn]);
    const out = { ...base, total: Object.values(nuevo).reduce((a, n) => a + n, 0), porFuncion: nuevo };
    writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`  ↓ baseline bajado en: ${bajaron.join(', ')}`);
  } else if (bajaron.length) {
    console.log(`  ℹ bajó en ${bajaron.join(', ')} — \`npm run gate:edge -- --update-baseline\` para fijarlo.`);
  }
}

process.exit(fallo ? 1 : 0);
