#!/usr/bin/env node
// gate:novedades — Novedades dice la verdad y no se queda atrás (2026-11-16).
//
// Pedido del usuario: «audita que según el módulo, así las novedades y así le
// aparecen a cada uno. Y un gate que, al agregar o modificar una función
// importante, se agregue ahí lo nuevo.»
//
// Cuatro chequeos, todos sin red:
//
//   A. MÓDULOS QUE EXISTEN. Cada `modulo` y cada `si: { modulo }` de
//      `src/constants/novedades.js` es una clave real del registro de permisos.
//      Una clave mal escrita no lanza: la novedad sale a nadie o a todos.
//
//   B. QUIEN LA VE, LA PUEDE ABRIR. Con la foto de permisos de producción
//      (`scripts/db/permisos-de-cargos.json`), para cada cargo: si ve una
//      novedad que trae `ruta`, tiene que poder abrir esa pantalla. Es lo que
//      pasó con Cumplimiento: la novedad salía al jefe porque el permiso lo
//      tenía, y el permiso no debía tenerlo. El gate no decide quién DEBE ver
//      qué —eso es del usuario—, pero sí que la novedad y el permiso digan lo
//      mismo.
//
//   C. LO NUEVO TIENE SU NOVEDAD. Todo módulo del menú (`MODULE_MAP`) y todo
//      widget del Inicio (`WIDGETS` de `DashboardView.jsx`) está cubierto por
//      una novedad (su `modulo` o un `si`) o está en
//      `scripts/novedades-baseline.json` (lo que ya existía el día que nació el
//      gate). El baseline es un trinquete: sólo baja. Un módulo o widget NUEVO
//      sin novedad hace fallar el commit.
//
//   D. ¿VA A NOVEDADES? (con `--hook`, o `--valorar` para consultarlo). El gate
//      puntúa lo preparado —pantalla nueva, módulo o widget nuevo, versión
//      menor/mayor, textos visibles nuevos— y, si pasa el umbral, exige que la
//      entrada de `CHANGELOG.md` diga `Novedades: <id>` o
//      `Novedades: no — <motivo>`. La decisión es del USUARIO: la sesión le
//      pregunta antes de escribirla. Debajo del umbral no pide nada.
//
// Uso:
//   npm run gate:novedades              A, B y C
//   npm run gate:novedades -- --hook    A, B, C y D (pre-commit)
//   npm run gate:novedades -- --valorar ¿lo preparado necesita preguntar?
//   npm run gate:novedades -- --reporte qué novedades ve cada cargo
//   npm run gate:novedades -- --sql     la consulta para regenerar la foto
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (r) => readFileSync(path.join(RAIZ, r), 'utf8');
const args = new Set(process.argv.slice(2));

const SQL = `select json_agg(json_build_object('id', r.id, 'nombre', r.name, 'p', coalesce((
  select json_object_agg(module_key, (case when can_view then 'v' else '' end)
    ||(case when can_edit then 'e' else '' end)||(case when can_approve then 'a' else '' end) order by module_key)
  from role_permissions rp where rp.role_id = r.id and (can_view or can_edit or can_approve)), '{}'::json)) order by r.id)
from roles r;`;
if (args.has('--sql')) { console.log(SQL); process.exit(0); }

const { TANDAS, novedadesVisibles, cumple } = await import(pathToFileURL(path.join(RAIZ, 'src/constants/novedades.js')).href);
const { MODULE_MAP, moduleKeyForPath } = await import(pathToFileURL(path.join(RAIZ, 'src/constants/moduleMap.js')).href);
const FOTO = JSON.parse(leer('scripts/db/permisos-de-cargos.json'));
const BASE = JSON.parse(leer('scripts/novedades-baseline.json'));

const errores = [];
const avisos = [];
const todas = TANDAS.flatMap((t) => t.novedades);
const ids = new Set(todas.map((n) => n.id));

// ── A. Claves que existen ───────────────────────────────────────────────────
const registro = new Set([
    ...Object.keys(MODULE_MAP),
    ...[...leer('src/constants/permissionModules.js').matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]),
]);
function modulosDe(si, out = []) {
    if (!si) return out;
    if (Array.isArray(si)) { si.forEach((x) => modulosDe(x, out)); return out; }
    if (si.alguno) { si.alguno.forEach((x) => modulosDe(x, out)); return out; }
    if (si.modulo) out.push(si.modulo);
    return out;
}
const cubiertos = new Set();
for (const n of todas) {
    const claves = [n.modulo, ...modulosDe(n.si),
        ...[...(n.pasos || []), ...(n.ojo || [])].flatMap((x) => (typeof x === 'string' ? [] : modulosDe(x.si)))].filter(Boolean);
    for (const k of claves) {
        if (!registro.has(k)) errores.push(`A · «${n.id}» usa el módulo «${k}», que no está en el registro de permisos.`);
    }
    [n.modulo, ...modulosDe(n.si)].filter(Boolean).forEach((k) => cubiertos.add(k));
}

// ── B. Quien la ve, la puede abrir ──────────────────────────────────────────
const fechaFoto = new Date(FOTO._generado);
const diasFoto = Math.round((Date.now() - fechaFoto) / 86_400_000);
if (!(diasFoto <= 30)) avisos.push(`B · La foto de permisos tiene ${diasFoto} días. Regenérala (--sql) antes de creerle a este chequeo.`);
const reporte = [];
for (const [id, cargo] of Object.entries(FOTO.cargos)) {
    const p = cargo.p || {};
    const ctx = { roleId: Number(id), puede: (k, nivel = 'can_view') => (p[k] || '').includes({ can_view: 'v', can_edit: 'e', can_approve: 'a' }[nivel]) };
    const ve = novedadesVisibles(ctx).flatMap((t) => t.novedades);
    reporte.push({ id, nombre: cargo.nombre, ve });
    // Tiene el módulo y pasa el `si`, pero ningún paso es para él: la novedad
    // se cae sin avisar (pasó con Subjefe y Traslados, que no estaba en GRUPOS).
    for (const n of todas) {
        if (n.especial || ve.some((x) => x.id === n.id)) continue;
        if (n.modulo && !ctx.puede(n.modulo)) continue;
        if (!cumple(n.si, ctx)) continue;
        errores.push(`B · ${cargo.nombre} tiene el módulo de «${n.id}», pero ningún paso es para su cargo. Agrégalo a un grupo de GRUPOS o escribe sus pasos.`);
    }
    for (const n of ve) {
        if (!n.ruta) continue;
        const destino = moduleKeyForPath(n.ruta.split('?')[0]);
        if (destino && destino !== 'novedades' && !ctx.puede(destino)) {
            errores.push(`B · ${cargo.nombre} ve «${n.id}», pero no puede abrir ${n.ruta} (módulo «${destino}»). Ata la novedad a ese módulo o corrige el permiso.`);
        }
    }
}
for (const n of todas) {
    if (n.especial) continue;
    if (!reporte.some((r) => r.ve.some((x) => x.id === n.id))) avisos.push(`B · «${n.id}» no le sale a ningún cargo.`);
}

// ── C. Lo nuevo tiene su novedad ────────────────────────────────────────────
const widgets = [...leer('src/views/DashboardView.jsx').matchAll(/\{\s*id:\s*'[a-z_]+',[^}]*?permission:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
const vigilados = new Set([...Object.keys(MODULE_MAP), ...widgets]);
const base = new Set(BASE.sin_novedad);
for (const k of [...vigilados].sort()) {
    if (cubiertos.has(k) || base.has(k)) continue;
    errores.push(`C · «${k}» es nuevo y no tiene novedad. Agrégala en src/constants/novedades.js (con su modulo: '${k}').`);
}
for (const k of base) {
    if (cubiertos.has(k)) avisos.push(`C · «${k}» ya tiene novedad: quítalo de scripts/novedades-baseline.json.`);
    else if (!vigilados.has(k)) avisos.push(`C · «${k}» ya no existe: quítalo de scripts/novedades-baseline.json.`);
}

// ── D. ¿Va a Novedades? Lo valora el gate y lo decide el usuario ──────────
// Pedido del usuario (2026-11-16): «que me pregunte antes si se agrega a
// novedad o no, o un mecanismo que valore si es necesario». Las dos cosas:
// el gate PUNTÚA el commit y, si parece algo que el personal tiene que saber,
// exige que el CHANGELOG diga la decisión. Esa decisión NO la toma la sesión:
// se le pregunta al usuario (regla en CLAUDE.md) y se anota su respuesta.
//
// Puntos (umbral UMBRAL):
//   +3 pantalla nueva (un archivo nuevo en src/views o apps/mobile/app)
//   +3 módulo nuevo en el menú o widget nuevo en el Inicio
//   +2 versión menor o mayor (así se marca una función nueva)
//   +1 por cada 5 textos visibles nuevos en pantallas (tope 3)
// Un commit que no toca pantallas puntúa 0: lo interno no va a Novedades.
const UMBRAL = 4;
const git = (c) => { try { return execSync(c, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const PANTALLAS = /^(src\/views|src\/components|apps\/mobile\/app)\//;
function valorar() {
    const motivos = [];
    let puntos = 0;
    const estado = git('git diff --cached --name-status').split('\n').filter(Boolean).map((l) => l.split('\t'));
    const archivos = estado.map((x) => x[x.length - 1]);
    if (!archivos.some((f) => PANTALLAS.test(f))) return { puntos: 0, motivos: ['no toca pantallas'] };
    const nuevas = estado.filter(([st, f]) => st === 'A' && /^(src\/views\/.*\.jsx|apps\/mobile\/app\/.*\.js)$/.test(f)).map((x) => x[1]);
    if (nuevas.length) { puntos += 3; motivos.push(`pantalla nueva: ${nuevas.slice(0, 3).join(', ')}`); }
    const agregado = (f) => git(`git diff --cached -U0 -- ${f}`).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const modNuevos = agregado('src/constants/moduleMap.js').filter((l) => /path:\s*'\//.test(l)).length;
    const widNuevos = agregado('src/views/DashboardView.jsx').filter((l) => /\{\s*id:\s*'[a-z_]+',.*permission:/.test(l)).length;
    if (modNuevos || widNuevos) { puntos += 3; motivos.push(`${modNuevos ? `${modNuevos} módulo(s) nuevo(s) en el menú` : ''}${modNuevos && widNuevos ? ' y ' : ''}${widNuevos ? `${widNuevos} widget(s) nuevo(s) en el Inicio` : ''}`); }
    const version = (txt) => (txt.match(/APP_VERSION\s*=\s*['"](\d+)\.(\d+)\.(\d+)['"]/) || []).slice(1).map(Number);
    const [a1, a2] = version(git('git show HEAD:src/version.js'));
    const v = version(git('git show :src/version.js'));
    if (v.length && (v[0] > a1 || v[1] > a2)) { puntos += 2; motivos.push(`versión ${v.join('.')} (función nueva)`); }
    const textos = archivos.filter((f) => PANTALLAS.test(f)).flatMap(agregado)
        .filter((l) => />\s*[A-ZÁÉÍÓÚÑ¿¡][^<>{}]{3,}</.test(l) || /\b(label|title|titulo|placeholder|texto)=?["':]\s*['"]?[A-ZÁÉÍÓÚÑ¿¡][a-záéíóúñ]/.test(l)).length;
    const porTexto = Math.min(3, Math.floor(textos / 5));
    if (porTexto) { puntos += porTexto; motivos.push(`${textos} textos visibles nuevos`); }
    return { puntos, motivos, version: v.join('.') };
}
if (args.has('--hook') || args.has('--valorar')) {
    const val = valorar();
    const necesita = val.puntos >= UMBRAL;
    if (args.has('--valorar')) {
        console.log(`Valoración: ${val.puntos} punto(s) de ${UMBRAL} — ${val.motivos.join('; ') || 'nada visible'}.`);
        console.log(necesita ? '→ Parece algo que el personal tiene que saber: pregúntale al usuario si va a Novedades.' : '→ No hace falta preguntar.');
    }
    const log = val.version ? git('git show :CHANGELOG.md') : '';
    const i = val.version ? log.indexOf(`## v${val.version}`) : -1;
    const seccion = i < 0 ? '' : log.slice(i, (log.indexOf('\n## v', i + 1) + 1 || log.length + 1) - 1);
    const linea = seccion.match(/^[\s>*-]*\**Novedades\**:\**\s*(.+)$/im);
    if (linea && !/^no\b/i.test(linea[1].trim())) {
        const pedidos = linea[1].split(/[,\s]+/).map((x) => x.replace(/[`*.]/g, '')).filter(Boolean);
        for (const x of pedidos) if (!ids.has(x)) errores.push(`D · CHANGELOG v${val.version} nombra la novedad «${x}», que no existe en src/constants/novedades.js.`);
    }
    if (args.has('--hook') && necesita && !linea) {
        errores.push(`D · Este commit parece algo que el personal tiene que saber (${val.puntos} puntos: ${val.motivos.join('; ')}).\n`
            + `      Pregúntale al usuario si va a Novedades —no lo decidas tú— y anota su respuesta en la entrada v${val.version || '?'} de CHANGELOG.md:\n`
            + '      «Novedades: <id>» (después de agregarla o actualizar sus pasos) o «Novedades: no — <motivo>».');
    }
}

// ── Salida ──────────────────────────────────────────────────────────────────
if (args.has('--reporte')) {
    for (const r of reporte.filter((x) => x.ve.length)) {
        console.log(`${r.nombre} (${r.ve.length}): ${r.ve.map((n) => n.id).join(', ')}`);
    }
    console.log('');
}
for (const a of avisos) console.log(`  ⚠ ${a}`);
if (errores.length) {
    console.log('');
    for (const e of errores) console.log(`  ✗ ${e}`);
    console.log(`\n✗ gate:novedades — ${errores.length} hallazgo(s).`);
    process.exit(1);
}
console.log(`✓ gate:novedades — ${todas.length} novedades coherentes con los permisos de ${reporte.length} cargos; ${vigilados.size - base.size} de ${vigilados.size} módulos y widgets con novedad.`);
