#!/usr/bin/env node
// gate:gemelos — un cambio de pantalla va en los DOS lados: portal y app (2026-11-19).
//
// Pedido del usuario: «crea un gate … que al agregar / modificar algo nuevo
// sea en mobile o en web, siempre esté en ambos lugares».
//
// Por qué existe: la app del personal (`apps/mobile`) es la otra cara del
// portal (`src/views`, `src/components`) y los dos leen el mismo núcleo
// (`src/{data,utils,store,hooks,context,constants}`). El núcleo no se puede
// desincronizar —es un solo código—, pero las PANTALLAS sí: ese día se
// encontraron ~80 diferencias entre la web y la app, todas de la misma forma:
// una sesión cambiaba un lado y el otro se quedaba como estaba, sin que nada
// avisara. `gate:app-nativa` ya exige que cada MÓDULO tenga pantalla nativa;
// éste vigila los CAMBIOS.
//
// El mapa vive en `scripts/gemelos.json`: por módulo (clave de MODULE_MAP),
// qué archivos de pantalla son suyos en la web y en la app. Gana el patrón más
// específico (ruta exacta > glob largo > glob corto); si empatan, el archivo es
// de todos los módulos empatados.
//
// Uso:
//   npm run gate:gemelos                 completo: todo archivo de pantalla está
//                                        mapeado o declarado, y todo lo que nombra
//                                        el mapa existe.
//   npm run gate:gemelos -- --hook       pre-commit, sin red: mira lo PREPARADO.
//   node scripts/gemelos-gate.mjs --probar "M src/views/X.jsx,A apps/mobile/app/y.js" \
//        [--gemelo "Gemelo: traslados — sólo visual"]
//                                        simula una lista de archivos preparados (y
//                                        líneas del CHANGELOG) para fabricarle la
//                                        regresión al gate sin tocar el índice.
//
// En `--hook`, por cada archivo de pantalla preparado:
//   · Si no está en el mapa ni declarado (soloWeb/soloApp/genericas) → FALLA:
//     hay que mapearlo (un archivo nuevo en una carpeta ya mapeada queda mapeado
//     solo).
//   · Si es de un módulo y NO se preparó ningún archivo del otro lado de ese
//     mismo módulo → FALLA, salvo que la entrada de la versión preparada en
//     CHANGELOG.md diga
//         Gemelo: <modulo> — <motivo>            («sólo visual», «el otro lado no lo muestra»)
//         Gemelo: <modulo> — en <ruta del otro lado>   (ya estaba hecho allá)
//   · Lo del núcleo no cuenta: es compartido por construcción.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { MODULE_MAP } from '../src/constants/moduleMap.js';

const RAIZ = new URL('..', import.meta.url).pathname;
const MAPA = JSON.parse(readFileSync(join(RAIZ, 'scripts/gemelos.json'), 'utf8'));
const args = process.argv.slice(2);
const tiene = (f) => args.includes(f);
const valor = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const valores = (f) => args.flatMap((a, i) => (a === f ? [args[i + 1]] : []));

// ── Qué es un archivo de pantalla, y de qué lado ─────────────────────────────
const RAICES = { web: ['src/views/', 'src/components/'], app: ['apps/mobile/app/', 'apps/mobile/componentes/'] };
const ladoDe = (f) => (RAICES.web.some((r) => f.startsWith(r)) ? 'web' : RAICES.app.some((r) => f.startsWith(r)) ? 'app' : null);
const esCodigo = (f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f) && !f.includes('/__tests__/');
const OTRO = { web: 'app', app: 'web' };

const cacheRe = new Map();
function glob(g) {
  if (!cacheRe.has(g)) {
    cacheRe.set(g, new RegExp('^' + g.replace(/[.+^$()|[\]\\{}]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + (g.endsWith('/') ? '' : '$')));
  }
  return cacheRe.get(g);
}
const especificidad = (p) => (p.includes('*') ? p.indexOf('*') : (p.endsWith('/') ? p.length : 1e9));

const ALIAS = MAPA.mismaPantalla || {};
const canon = (k) => ALIAS[k] || k;
const soloModulo = { web: new Set(), app: new Set() };
const soloPatron = { web: {}, app: {} };
for (const [lado, sec] of [['web', MAPA.soloWeb || {}], ['app', MAPA.soloApp || {}]]) {
  for (const [p, motivo] of Object.entries(sec)) {
    if (p.startsWith('modulo:')) soloModulo[lado].add(p.slice(7));
    else soloPatron[lado][p] = motivo;
  }
}
// Todas las reglas: [patrón, tipo, valor]
const reglas = [];
for (const [m, x] of Object.entries(MAPA.modulos || {})) for (const lado of ['web', 'app']) for (const p of x[lado] || []) reglas.push([p, 'modulo', m, lado]);
for (const lado of ['web', 'app']) for (const p of Object.keys(soloPatron[lado])) reglas.push([p, 'solo', lado, lado]);
const genericas = Object.keys(MAPA.genericas || {});

// De quién es un archivo: { generica } | { solo } | { modulos: [...] } | null
function resolver(f) {
  if (genericas.some((g) => glob(g).test(f))) return { generica: true };
  let mejor = -1;
  let ganan = [];
  for (const r of reglas) {
    if (!glob(r[0]).test(f)) continue;
    const e = especificidad(r[0]);
    if (e > mejor) { mejor = e; ganan = [r]; } else if (e === mejor) ganan.push(r);
  }
  if (!ganan.length) return null;
  const solo = ganan.find((r) => r[1] === 'solo');
  if (solo) return { solo: solo[0], motivo: soloPatron[solo[2]][solo[0]] };
  return { modulos: [...new Set(ganan.map((r) => r[2]))] };
}

function listar(dir) {
  const out = [];
  const rec = (d) => {
    if (!existsSync(join(RAIZ, d))) return;
    for (const e of readdirSync(join(RAIZ, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') rec(p); } else if (esCodigo(p)) out.push(p);
    }
  };
  rec(dir.replace(/\/$/, ''));
  return out;
}

const git = (c) => { try { return execSync(c, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const errores = [];
const avisos = [];

// ── Modo completo ────────────────────────────────────────────────────────────
function completo() {
  const todos = [...RAICES.web, ...RAICES.app].flatMap(listar);
  let mapeados = 0;
  for (const f of todos) {
    const r = resolver(f);
    if (!r) errores.push(`${f} es un archivo de pantalla y no está en scripts/gemelos.json: agrégalo al módulo que corresponde (web y app), o a soloWeb/soloApp con su motivo.`);
    else if (r.modulos) mapeados++;
  }
  // Todo patrón nombrado existe (y está del lado correcto).
  const existe = (p) => todos.some((f) => glob(p).test(f));
  for (const [p, tipo, valor, lado] of reglas) {
    if (!existe(p)) errores.push(`scripts/gemelos.json nombra «${p}» (${tipo === 'modulo' ? `módulo ${valor}, ${lado}` : `solo${lado === 'web' ? 'Web' : 'App'}`}) y no existe: quítalo o corrige la ruta.`);
    else if (ladoDe(p.replace(/\*.*$/, '')) !== lado) errores.push(`scripts/gemelos.json pone «${p}» del lado ${lado}, y es del otro.`);
  }
  for (const g of genericas) if (!existe(g)) errores.push(`scripts/gemelos.json declara genérica «${g}» y no existe: quítala.`);
  // Los módulos.
  for (const [k, m] of Object.entries(MODULE_MAP)) {
    if (!m?.path) continue;
    if (MAPA.modulos[canon(k)]) continue;
    if (soloModulo.web.has(k) || soloModulo.app.has(k)) continue;
    errores.push(`El módulo «${k}» (${m.path}) no está en scripts/gemelos.json: mapea sus archivos web y app.`);
  }
  for (const [a, b] of Object.entries(ALIAS)) {
    if (!MODULE_MAP[a]) errores.push(`mismaPantalla nombra «${a}», que no está en MODULE_MAP.`);
    if (!MAPA.modulos[b]) errores.push(`mismaPantalla manda «${a}» a «${b}», que no está en modulos.`);
  }
  for (const lado of ['web', 'app']) for (const k of soloModulo[lado]) if (!MODULE_MAP[k]) errores.push(`solo${lado === 'web' ? 'Web' : 'App'} declara «modulo:${k}», que no está en MODULE_MAP.`);
  for (const [k, x] of Object.entries(MAPA.modulos)) {
    for (const lado of ['web', 'app']) {
      if (!(x[lado] || []).length && !soloModulo[OTRO[lado]].has(k)) errores.push(`El módulo «${k}» no tiene archivos del lado ${lado}: mapéalos, o declara «modulo:${k}» en solo${lado === 'web' ? 'App' : 'Web'} con su motivo.`);
    }
  }
  // FUERA_DE_LA_APP de pantallas.js tiene que estar declarado como sólo web.
  const pant = readFileSync(join(RAIZ, 'apps/mobile/pantallas.js'), 'utf8');
  const fuera = (pant.match(/FUERA_DE_LA_APP\s*=\s*new Set\(\[([^\]]*)\]/) || [, ''])[1].match(/[a-z0-9_]+/g) || [];
  for (const k of fuera) if (!soloModulo.web.has(k)) errores.push(`«${k}» está en FUERA_DE_LA_APP (apps/mobile/pantallas.js) y no en soloWeb como «modulo:${k}».`);
  return { todos: todos.length, mapeados };
}

// ── Modo hook / probar ───────────────────────────────────────────────────────
function lineasGemelo() {
  if (tiene('--probar')) return valores('--gemelo');
  const preparados = git('git diff --cached --name-only').split('\n');
  if (!preparados.includes('CHANGELOG.md')) return [];
  const version = (git('git show :src/version.js').match(/APP_VERSION\s*=\s*['"]([\d.]+)['"]/) || [])[1];
  const log = git('git show :CHANGELOG.md');
  const lineas = [];
  if (version) {
    const i = log.indexOf(`## v${version}`);
    if (i >= 0) lineas.push(...log.slice(i, (log.indexOf('\n## v', i + 1) + 1 || log.length + 1) - 1).split('\n'));
  }
  lineas.push(...git('git diff --cached -U0 -- CHANGELOG.md').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)));
  return lineas;
}

function hook() {
  let estado;
  if (tiene('--probar')) {
    estado = valor('--probar').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^([AMDR])\s+(.+)$/);
      return m ? [m[1], m[2]] : ['M', s];
    });
  } else {
    estado = git('git diff --cached --name-status').split('\n').filter(Boolean).map((l) => { const p = l.split('\t'); return [p[0][0], p[p.length - 1]]; });
  }
  const pantallas = estado.filter(([, f]) => ladoDe(f) && esCodigo(f));
  if (!pantallas.length) return { pantallas: 0 };

  // Gemelo: <modulo> — <motivo>
  const excusas = new Map();
  for (const l of lineasGemelo()) {
    const m = l.match(/^[\s>*-]*\**Gemelo\**:\**\s*`?([a-z0-9_]+)`?\s*[—–-]+\s*(.+?)\s*$/i);
    if (!m) continue;
    const k = canon(m[1]);
    if (!MAPA.modulos[k]) { errores.push(`CHANGELOG dice «Gemelo: ${m[1]}», que no es un módulo de scripts/gemelos.json.`); continue; }
    const en = m[2].match(/^en\s+`?([^\s`]+\/[^\s`]+)`?/i);
    if (en) {
      const r = existsSync(join(RAIZ, en[1])) ? resolver(en[1]) : null;
      if (!r) { errores.push(`CHANGELOG dice «Gemelo: ${m[1]} — en ${en[1]}», y esa ruta no existe o no está mapeada.`); continue; }
      if (!r.modulos?.includes(k)) { errores.push(`CHANGELOG dice «Gemelo: ${m[1]} — en ${en[1]}», y ese archivo no es de «${k}» en scripts/gemelos.json.`); continue; }
    }
    excusas.set(k, m[2]);
  }

  // Qué módulos se tocaron de cada lado.
  const tocados = { web: new Set(), app: new Set() };
  const porArchivo = [];
  for (const [st, f] of pantallas) {
    const lado = ladoDe(f);
    const r = resolver(f);
    if (!r) {
      if (st === 'D') continue;
      errores.push(`${f} ${st === 'A' ? 'es NUEVO y ' : ''}no está en scripts/gemelos.json.\n`
        + `      Mapéalo: agrégalo a modulos.<modulo>.${lado} (o a una carpeta ya mapeada), o a solo${lado === 'web' ? 'Web' : 'App'} con su motivo si por decisión vive sólo de este lado.`);
      continue;
    }
    if (r.generica || r.solo) continue;
    for (const m of r.modulos) tocados[lado].add(m);
    porArchivo.push([f, lado, r.modulos]);
  }
  for (const [f, lado, modulos] of porArchivo) {
    const otro = OTRO[lado];
    if (modulos.some((m) => tocados[otro].has(m) || excusas.has(m) || soloModulo[lado].has(m))) continue;
    const m = modulos[0];
    const delOtro = (MAPA.modulos[m]?.[otro] || []).slice(0, 4).join(', ');
    errores.push(`${f} cambia ${modulos.length > 1 ? `los módulos ${modulos.join(', ')}` : `el módulo «${m}»`} en ${lado === 'web' ? 'el PORTAL' : 'la APP'} y no se preparó nada ${otro === 'web' ? 'del portal' : 'de la app'}.\n`
      + `      Del otro lado, «${m}» es: ${delOtro}${(MAPA.modulos[m]?.[otro] || []).length > 4 ? ', …' : ''}\n`
      + `      Dos salidas:\n`
      + `        1. Haz el mismo cambio en ${otro === 'web' ? 'el portal' : 'la app'} y prepáralo en este commit.\n`
      + `        2. Si de verdad no va allá, escríbelo en la entrada de la versión en CHANGELOG.md:\n`
      + `             Gemelo: ${m} — <motivo>          (p. ej. «sólo visual», «el otro lado no lo muestra»)\n`
      + `             Gemelo: ${m} — en <ruta>         (si ${otro === 'web' ? 'el portal' : 'la app'} ya lo tenía: la ruta del archivo de allá)`
      + (MAPA.notas?.[m] ? `\n      Nota de «${m}»: ${MAPA.notas[m]}` : ''));
  }
  return { pantallas: pantallas.length, web: [...tocados.web], app: [...tocados.app], excusas: [...excusas.keys()] };
}

// ── Salida ───────────────────────────────────────────────────────────────────
const enHook = tiene('--hook') || tiene('--probar');
const res = enHook ? hook() : completo();
for (const a of avisos) console.log(`  ⚠ ${a}`);
if (errores.length) {
  for (const e of errores) console.log(`  ✗ ${e}`);
  console.log(`\n✗ gate:gemelos — ${errores.length} hallazgo(s).`);
  process.exit(1);
}
if (enHook) {
  console.log(res.pantallas
    ? `✓ gate:gemelos — ${res.pantallas} archivo(s) de pantalla preparados; web: ${res.web.join(', ') || '—'} · app: ${res.app.join(', ') || '—'}${res.excusas.length ? ` · con «Gemelo:» ${res.excusas.join(', ')}` : ''}.`
    : '✓ gate:gemelos — el commit no toca pantallas.');
} else {
  console.log(`✓ gate:gemelos — ${res.todos} archivos de pantalla: ${res.mapeados} en ${Object.keys(MAPA.modulos).length} módulos, el resto genérico o declarado de un solo lado; todo lo que nombra el mapa existe.`);
}
