#!/usr/bin/env node
/**
 * gate:rutas — la dirección dice lo que abre, y lo dice en el idioma del portal.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * Lo reportó el usuario el 2026-08-26, mirando la barra de direcciones:
 * *«¿por qué dice dashboard si es empleados? el inicio no debería ser
 * dashboard?»*. Y tenía razón dos veces: `/dashboard` abría el LISTADO DE
 * EMPLEADOS y `/overview` abría el tablero — las dos decían lo contrario de lo
 * que mostraban.
 *
 * Lo grave no es que estuviera mal: es que **el repo ya lo sabía y nada lo
 * miraba**. El comentario de `ROUTE_TITLES` decía, escrito a mano y desde hacía
 * semanas, «el path es legado: la ruta es el listado». Una nota al margen no es
 * una regla: no falla, no avisa, y el siguiente que agrega una vista no la lee.
 * Ver [[feedback_una_afirmacion_que_nadie_verifica_deja_de_ser_cierta]].
 *
 * Y el encabezado de la pantalla decía lo correcto todo el tiempo («Gestión de
 * personal»). O sea que el nombre viejo sobrevivía **exactamente en el único
 * lugar que nadie revisaba** y que el usuario sí mira.
 *
 * ── Qué mide ──────────────────────────────────────────────────────────────────
 *
 * A · **Toda ruta tiene título de pestaña.** Sin él, la pestaña del navegador
 *     dice «Portal FarmaSalud» y con veinte abiertas no se distinguen. Faltaban
 *     19 el día que se escribió `ROUTE_TITLES`, y volvió a faltar una
 *     (`/carnes-del-dia`) en cuanto se agregó una vista.
 *
 * B · **La pestaña se copia del ENCABEZADO de la vista, no del menú.** El menú
 *     puede abreviar porque se lee dentro de su grupo («Listado» bajo Personal);
 *     la pestaña se lee sola, entre otras veinte. Al medirlo aparecieron dos que
 *     no coincidían: `/vacation-plan` decía «Plan de vacaciones» sobre una
 *     pantalla titulada «Plan anual de vacaciones», y `/compras` decía «Compras»
 *     sobre «Compras (Bodega)».
 *
 * C · **La ruta va en español y nombra lo que abre.** Es la misma regla que ya
 *     rige el texto de pantalla —el portal no le habla al usuario en la jerga de
 *     adentro (§26 de DESIGN.md, y la regla del ERP en CLAUDE.md)—; la barra de
 *     direcciones es texto de pantalla como cualquier otro, sólo que nadie la
 *     había mirado.
 *
 * ── Cómo se cierra un hallazgo ────────────────────────────────────────────────
 *
 * A y B se cierran arreglando: agregando el título, o copiándolo del encabezado.
 * No hay excepción posible porque no hay motivo posible.
 *
 * C se cierra renombrando la ruta **y dejando la vieja como redirección** — un
 * favorito del navegador no vive en ninguna tabla y no hay forma de medir a
 * quién le rompés el enlace. Ver la receta al final de este archivo.
 *
 * `HEREDADAS` es la deuda del día que se escribió esto: rutas en inglés que ya
 * estaban en producción. **Sólo baja.** Una ruta NUEVA en inglés falla el gate
 * aunque se la agregue a esa lista — el chequeo compara contra el conjunto
 * exacto, así que agregar una entrada nueva también falla. Es a propósito: la
 * lista es un inventario de lo que hay que arreglar, no un lugar donde esconder
 * lo que se acaba de escribir.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Se pueden apuntar a otro archivo para PROBAR EL GATE: un detector al que
// nadie le fabricó la regresión que debería cazar es un cero que no significa
// nada. `tests/unit/rutasGate.test.js` los usa para meterle una ruta en inglés
// y una pestaña que no copia su encabezado, y comprobar que falla por las dos.
const APP = process.env.RUTAS_GATE_APP || 'src/App.jsx';
const MODULOS = process.env.RUTAS_GATE_MODULOS || 'src/constants/moduleMap.js';
const PRECARGA = process.env.RUTAS_GATE_PRECARGA || 'src/constants/routeImporters.js';
// `RUTAS_GATE_HEREDADAS` (JSON) reemplaza la lista de deuda. Existe SÓLO para
// que la prueba pueda fabricar el caso «una entrada de deuda que ya se
// arregló»: hoy la lista está vacía y ese chequeo no tendría contra qué
// dispararse, o sea que quedaría sin prueba justo el día que vuelva a hacer
// falta.

// ── Rutas que NO son una vista del portal ────────────────────────────────────
// El kiosco corre sin sesión y es su propia aplicación; login y no-access son
// puertas; raw-test es un banco de pruebas que no aparece en ningún menú.
const FUERA_DE_ALCANCE = new Set(['/kiosk', '/login', '/no-access', '/raw-test']);

// ── Deuda heredada: rutas en inglés que ya estaban en producción ─────────────
//
// Cada una lleva el nombre en español que le corresponde —el del encabezado de
// su propia vista— para que renombrarla sea una decisión ya tomada y no una
// discusión de vocabulario cada vez. Al renombrar una, se borra de acá.
//
// NO se agregan entradas nuevas. Ver el encabezado de este archivo.
// Al escribirse este gate eran DIECIOCHO rutas en inglés. El usuario las mandó
// arreglar todas el mismo día («corrige los que ya están mal»), así que la lista
// nació y quedó vacía en la misma sesión — y se queda acá, vacía, a propósito:
// es la estructura que hace que una entrada NUEVA falle el gate, y borrarla
// significaría que la próxima ruta en inglés no tendría contra qué chocar.
//
// Formato, para el día que haga falta: `'/ruta': 'motivo o nombre en español'`.
const HEREDADAS = process.env.RUTAS_GATE_HEREDADAS
  ? JSON.parse(process.env.RUTAS_GATE_HEREDADAS)
  : {};

// ── Redirecciones legadas ────────────────────────────────────────────────────
// Un `<Route>` cuyo elemento es un `<Navigate>` NO es una vista: es el puente
// que deja vivo un favorito viejo. Se detectan solas por el elemento, así que
// esta lista no hace falta — queda documentado que se excluyen a propósito.

// Dos palabras que NO están en esta lista aunque lo parezcan:
//   · `monitor` es española (RAE), y la vista se llama «Monitor en tiempo
//     real». El regex la acusaba.
//   · `ios` es el nombre de una plataforma, no una palabra: `/prueba-ios`
//     es español con un nombre propio adentro, igual que «Corte Z».
// Las dos eran falsos positivos de este mismo regex, de la misma familia
// que los otros dos de la primera corrida. Un detector que acusa al que
// hizo bien el trabajo es un detector que se termina desactivando.
const PALABRAS_EN_INGLES = /(^|-)(dashboard|overview|audit|auditview|schedule|schedules|request|requests|payroll|announcement|announcements|branch|branches|role|roles|permission|permissions|profile|my|orphan|objects|sync|health|test|staff|employee|detail|vacation|plan|settings|home|users|user|list|new|edit|view)($|-)/;

const leer = (p) => readFileSync(p, 'utf8');

// ── ROUTE_TITLES ─────────────────────────────────────────────────────────────
function titulosDeRuta(app) {
  const i = app.indexOf('const ROUTE_TITLES');
  if (i < 0) throw new Error('No encontré ROUTE_TITLES en App.jsx');
  const bloque = app.slice(i, app.indexOf('};', i));
  const out = {};
  for (const m of bloque.matchAll(/'([^']+)':\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

// ── Las rutas declaradas en App.jsx, con su componente ───────────────────────
function rutasDeApp(app) {
  const out = [];
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]{0,260}?)\}\s*\/>/g)) {
    const path = m[1];
    const el = m[2];
    // Una ficha de detalle (`…/:id`) no tiene un título fijo: lo arma
    // `AppWithToast` con el nombre de lo que se abrió. Acusarla de «sin
    // título» sería acusar al que hizo bien el trabajo.
    if (path.includes('*') || path.includes(':')) continue;
    // Una redirección no es una vista: es el puente de un favorito viejo.
    const esRedireccion = /<Navigate\b/.test(el) || /^Ir[A-Z]/.test((el.match(/<([A-Z][A-Za-z0-9_]*)/) || [])[1] || '');
    const comp = (el.match(/<([A-Z][A-Za-z0-9_]*)/g) || [])
      .map(s => s.slice(1))
      .filter(c => !['PermissionGuard', 'Navigate', 'Suspense', 'ErrorBoundary'].includes(c))[0] || null;
    out.push({ path: path.startsWith('/') ? path : '/' + path, comp, esRedireccion });
  }
  // Rutas anidadas con índice (`<Route path="personal"><Route index …`).
  for (const m of app.matchAll(/<Route\s+path="([a-z0-9-]+)"\s*>/g)) {
    const p = '/' + m[1];
    if (!out.some(r => r.path === p)) out.push({ path: p, comp: null, esRedireccion: false });
  }
  return out;
}

// ── El encabezado de una vista (el `title` de GlassViewLayout) ───────────────
const cache = new Map();
function archivoDe(comp) {
  if (cache.has(comp)) return cache.get(comp);
  const buscar = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { const r = buscar(p); if (r) return r; }
      else if (e.name === `${comp}.jsx`) return p;
    }
    return null;
  };
  const r = existsSync('src') ? buscar('src') : null;
  cache.set(comp, r);
  return r;
}
function encabezadoDe(comp) {
  if (!comp) return null;
  const f = archivoDe(comp);
  if (!f) return null;
  // Sólo el literal. Un `title={<div>…}` o un ternario se resuelven en tiempo
  // de render y desde acá no se pueden leer sin adivinar — y adivinar es cómo
  // un detector empieza a acusar al que hizo bien el trabajo. Devuelve null:
  // «no lo pude medir» no es «está mal».
  //
  // Se toma el PRIMER `title=` después de `<GlassViewLayout` y nada más. La
  // versión anterior buscaba el primer `title="…"` LITERAL en los siguientes
  // 400 caracteres, y eso salta por encima de un `title={` dinámico hasta
  // caer en el `title` de un BOTÓN anidado: en `EncuestaView` el gate reportó
  // que el encabezado era «Volver a Gestión de encuesta», que es el tooltip de
  // la flecha de volver. Un hallazgo inventado sobre una vista correcta.
  const src = leer(f);
  const i = src.indexOf('<GlassViewLayout');
  if (i < 0) return null;
  const m = /\stitle=(["'{])/.exec(src.slice(i, i + 600));
  if (!m || m[1] === '{') return null;          // dinámico: no se puede medir
  const lit = new RegExp(`\\stitle=${m[1]}([^${m[1]}]+)${m[1]}`).exec(src.slice(i, i + 600));
  return lit ? lit[1] : null;
}

// ── Medición ─────────────────────────────────────────────────────────────────
const app = leer(APP);
const titulos = titulosDeRuta(app);
const rutas = rutasDeApp(app).filter(r => !FUERA_DE_ALCANCE.has(r.path));

const sinTitulo = [];
const pestanaDistinta = [];
const enIngles = [];

for (const r of rutas) {
  if (r.esRedireccion) continue;
  if (!titulos[r.path]) sinTitulo.push(r.path);
  const enc = encabezadoDe(r.comp);
  if (enc && titulos[r.path] && enc !== titulos[r.path]) {
    pestanaDistinta.push({ path: r.path, pestana: titulos[r.path], encabezado: enc });
  }
  const slug = r.path.slice(1);
  if (PALABRAS_EN_INGLES.test(slug)) enIngles.push(r.path);
}

// ── El módulo del menú apunta a una ruta que existe ──────────────────────────
const mm = leer(MODULOS);
const rutasVivas = new Set(rutas.map(r => r.path));
const modulosRotos = [];
for (const m of mm.matchAll(/^\s*([a-z_0-9]+):\s*\{\s*path:\s*'([^']+)',\s*label:\s*'([^']+)'([\s\S]{0,120}?)\}/gm)) {
  const [, key, path, label, resto] = m;
  if (/comingSoon:\s*true/.test(resto)) continue;   // todavía no tiene ruta, a propósito
  if (!rutasVivas.has(path)) modulosRotos.push({ key, path, label });
}

// ── La precarga conoce a toda ruta ──────────────────────────────────────────
//
// `IMPORTADOR_POR_RUTA` mapea el primer segmento de la ruta a la vista que la
// atiende, para empezar a bajar el módulo al pasar el mouse por el menú. Su
// modo de falla es el peor de todos: **no rompe nada**. Si falta la clave,
// `prefetchRuta` no encuentra nada y no hace nada, así que la vista carga lento
// la primera vez y no hay error, ni log, ni pantalla en blanco.
//
// El 2026-08-26 se renombraron 19 rutas y este mapa quedó viejo entero. Y
// `cortes` estaba mal desde mucho antes —figuraba como `cortes_caja`, que es la
// clave del MÓDULO y no el segmento de la ruta—, o sea que Cortes de caja nunca
// se precargó y nadie podía notarlo.
const precarga = leer(PRECARGA);
const bloquePre = precarga.slice(precarga.indexOf('IMPORTADOR_POR_RUTA'), precarga.indexOf('};', precarga.indexOf('IMPORTADOR_POR_RUTA')));
const clavesPre = new Set([...bloquePre.matchAll(/'([^']+)':\s*IMPORTADORES\./g)].map(m => m[1]));
const sinPrecarga = [];
for (const r of rutas) {
  if (r.esRedireccion) continue;
  const seg = r.path.slice(1).split('/')[0];
  if (!clavesPre.has(seg)) sinPrecarga.push(r.path);
}

// ── Informe ──────────────────────────────────────────────────────────────────
const c = { rojo: '\x1b[31m', verde: '\x1b[32m', gris: '\x1b[90m', neg: '\x1b[1m', fin: '\x1b[0m' };
console.log(`\n── Cómo se llaman las vistas ─────────────────────────────`);
console.log(`  ${rutas.filter(r => !r.esRedireccion).length} rutas · ${rutas.filter(r => r.esRedireccion).length} redirecciones legadas · canon: DESIGN.md §33\n`);

let falla = false;

if (sinTitulo.length) {
  falla = true;
  console.log(`  ${c.rojo}✗${c.fin} ${c.neg}${sinTitulo.length} ruta(s) sin título de pestaña${c.fin}`);
  for (const p of sinTitulo) console.log(`      ${c.gris}${p}${c.fin}`);
  console.log(`    Agregalas a ROUTE_TITLES en App.jsx, copiando el encabezado de la vista.\n`);
}

if (pestanaDistinta.length) {
  falla = true;
  console.log(`  ${c.rojo}✗${c.fin} ${c.neg}${pestanaDistinta.length} pestaña(s) que no copian su encabezado${c.fin}`);
  for (const p of pestanaDistinta) {
    console.log(`      ${c.gris}${p.path}${c.fin}  pestaña «${p.pestana}» · encabezado «${p.encabezado}»`);
  }
  console.log(`    La pestaña se copia del ENCABEZADO, no del menú: se lee sola, entre otras veinte.\n`);
}

if (modulosRotos.length) {
  falla = true;
  console.log(`  ${c.rojo}✗${c.fin} ${c.neg}${modulosRotos.length} módulo(s) del menú apuntan a una ruta que no existe${c.fin}`);
  for (const m of modulosRotos) console.log(`      ${c.gris}${m.key} → ${m.path}${c.fin}  («${m.label}»)`);
  console.log(`    Un ítem del menú que lleva al 404 no da error: se ve como una pantalla rota.\n`);
}

if (sinPrecarga.length) {
  falla = true;
  console.log(`  ${c.rojo}✗${c.fin} ${c.neg}${sinPrecarga.length} ruta(s) sin clave en IMPORTADOR_POR_RUTA${c.fin}`);
  for (const p of sinPrecarga) console.log(`      ${c.gris}${p}${c.fin}`);
  console.log(`    Su vista no se precarga y NO da error: sólo carga lento la primera vez.`);
  console.log(`    Agregá la clave en src/constants/routeImporters.js.\n`);
}

const nuevasEnIngles = enIngles.filter(p => !(p in HEREDADAS));
const heredadasYaArregladas = Object.keys(HEREDADAS).filter(p => !enIngles.includes(p));

if (nuevasEnIngles.length) {
  falla = true;
  console.log(`  ${c.rojo}✗${c.fin} ${c.neg}${nuevasEnIngles.length} ruta(s) NUEVA(s) en inglés${c.fin}`);
  for (const p of nuevasEnIngles) console.log(`      ${c.gris}${p}${c.fin}`);
  console.log(`    La barra de direcciones es texto de pantalla: va en español y nombra`);
  console.log(`    lo que abre. Renombrala y dejá la vieja como redirección.\n`);
}

if (heredadasYaArregladas.length) {
  falla = true;
  console.log(`  ${c.rojo}✗${c.fin} ${c.neg}${heredadasYaArregladas.length} entrada(s) de HEREDADAS que ya no existen${c.fin}`);
  for (const p of heredadasYaArregladas) console.log(`      ${c.gris}${p}${c.fin}`);
  console.log(`    Se arreglaron: borralas de HEREDADAS en scripts/rutas-gate.mjs.`);
  console.log(`    Una lista de deuda que nombra deuda saldada deja de ser creíble.\n`);
}

const deuda = enIngles.filter(p => p in HEREDADAS);
if (deuda.length) {
  console.log(`  ${c.gris}deuda heredada — rutas en inglés de antes del 2026-08-26: ${deuda.length}${c.fin}`);
  for (const p of deuda) console.log(`      ${c.gris}${p.padEnd(24)} ${HEREDADAS[p]}${c.fin}`);
  console.log('');
}

if (falla) {
  console.log(`${c.rojo}✗ gate:rutas${c.fin}\n`);
  process.exit(1);
}
console.log(`${c.verde}✓ gate:rutas${c.fin} — sin deuda nueva.\n`);

/* ── Receta para renombrar una ruta ────────────────────────────────────────────
 *
 * 1. `<Route path="nueva">` en App.jsx, y la vieja se queda como
 *    `<Route path="vieja" element={<Navigate to="/nueva" replace />} />`.
 *    Si la vieja tenía parámetros (`/vieja/algo/:id`), la redirección tiene que
 *    CONSERVARLOS — un `<Navigate>` suelto pierde el id y deja a quien tenía el
 *    expediente de alguien guardado mirando el listado completo, sin entender
 *    por qué. Eso es peor que un 404: parece que funcionó.
 * 2. `MODULE_MAP` en `src/constants/moduleMap.js` — de ahí sale el menú Y la
 *    pantalla de aterrizaje al iniciar sesión.
 * 3. `ROUTE_TITLES` en App.jsx.
 * 4. `grep -rn "/vieja" src/ tests/` — quedan `navigate()` sueltos en las vistas.
 * 5. Las pruebas de navegador que la nombren. Andan igual por la redirección,
 *    pero una prueba que llega por un rebote mide otra cosa que la que llega
 *    directo.
 * 6. Mirá si alguna notificación guardada la nombra:
 *    `SELECT count(*) FROM notifications WHERE link LIKE '/vieja%'`.
 */
