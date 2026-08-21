#!/usr/bin/env node
/**
 * permissions-gate — cruza el REGISTRO de permisos contra el CÓDIGO que los
 * consulta.
 *
 * Existe por la auditoría del 2026-08-03
 * (`docs/planes-cerrados/AUDITORIA-PERMISOS-2026-08-03.md`), que encontró a mano lo que este
 * script encuentra en 200ms:
 *
 *   · `staff_salary` — "datos sensibles", activo en 2 roles, y no lo consulta
 *     NADIE: ni el frontend, ni una función, ni una policy.
 *   · `dash_distribution` — sobrevivió a su widget.
 *   · `maintenance` — usado en el menú y ausente del registro, así que el
 *     módulo existía y no había forma de otorgarlo.
 *   · 9 filas huérfanas en la base, de renames y módulos retirados.
 *
 * Y encontró tres huecos MÁS durante la ejecución, el peor de ellos el catálogo
 * de costos consultando la clave vieja después de un rename — que habría
 * apagado los costos para todos, en silencio.
 *
 * ── La trampa que hace falta un script para no repetir ──────────────────────
 * Un `grep "hasPermission('clave')"` da falsos positivos MASIVOS: el portal
 * gatea de cinco maneras y solo una es un literal.
 *
 *     hasPermission('facturas_compra_abrir')       // literal
 *     hasPermission(`ventas_tab_${t.key}`)         // plantilla
 *     hasPermission(t.permKey)                     // variable (Pedidos)
 *     showWidget('kpi', 'dash_kpi')                // indirecta (Dashboard)
 *     <PermissionGuard moduleKey="ventas">         // guard de ruta
 *
 * El primer barrido de la auditoría dijo "42 claves muertas" y eran 2. Y hay
 * una sexta fuente que ni siquiera está en `src/`: `conteo_ver_sistema` lo
 * gatea la función `conteo_puede_ver_sistema` en Postgres — borrarlo por
 * "muerto" habría roto el conteo ciego. Por eso la lista GATEADAS_EN_LA_BASE
 * existe y se declara a mano, con su motivo escrito.
 *
 * Uso:
 *   npm run gate:permisos                      registro contra código, sin red
 *   node scripts/permissions-gate.mjs --hook   acotado al índice de git
 *
 * NO cruza contra `role_permissions` de prod: haría falta una credencial y este
 * gate corre en el pre-commit. Ese cruce se hace a mano cuando se toca el
 * registro — `select distinct module_key from role_permissions` contra las
 * claves declaradas — y es el que encuentra filas huérfanas de renames.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { archivosIndexados, leerDelIndice } from './lib/git-index.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRO = 'src/constants/permissionModules.js';
const soloIndexado = process.argv.includes('--hook');

// Claves cuyo gate NO vive en `src/` — se declaran acá con su motivo. Es la
// única lista a mano del gate, y es a propósito: son las que un barrido del
// frontend no puede ver, y borrarlas por "muertas" rompe algo real.
const GATEADAS_EN_LA_BASE = {
  conteo_ver_sistema: 'la función conteo_puede_ver_sistema() de Postgres — tapa la existencia en origen, el conteo es ciego',
  ventas_no_producto: 'lo chequea get_ventas_sin_producto() antes de leer un monto: sin el permiso devuelve NULL y el aviso no existe. Gatearlo también en el frontend sería traer las cifras al navegador para esconderlas, que no es esconderlas',
};

// Hallazgos REALES que el usuario decidió no resolver todavía. No se silencian:
// se imprimen en cada corrida como aviso y no hacen fallar el gate. La
// diferencia con una excepción a secas es que acá el motivo es "está decidido
// que no", no "esto no es un problema" — y el texto lo dice.
//
// Un gate rojo permanente enseña a ignorar el gate; uno que esconde el hallazgo
// enseña que no había hallazgo. Esto es lo único que no hace ninguna de las dos.
const PENDIENTES = {
  staff_salary:
    'Decisión del usuario 2026-08-03: dejarlo por ahora. Es el hueco más serio del '
    + 'informe — la pantalla ofrece un control de "datos sensibles" que no existe en '
    + 'ninguna capa, y el salario viaja al navegador de cualquiera que abra el '
    + 'expediente. Al resolverlo: o se gatea (frontend + server-side) o se borra.',
};

// Módulos declarados `comingSoon`: el menú los muestra apagados y nadie los
// consulta todavía. No son deuda.
const leerRegistro = (txt) => {
  const modulos = [...txt.matchAll(/\{\s*key:\s*'([a-z0-9_]+)',\s*label:[^\n]*?(comingSoon:\s*true)?[^\n]*$/gm)];
  const comingSoon = new Set([...txt.matchAll(/key:\s*'([a-z0-9_]+)'[^\n]*comingSoon:\s*true/g)].map(m => m[1]));
  const subs = [...txt.matchAll(/\{\s*key:\s*'([a-z0-9_]+)',\s*label:\s*'[^']*',\s*tipo:\s*'(tab|cap)'/g)]
    .map(m => ({ key: m[1], tipo: m[2] }));
  const subKeys = new Set(subs.map(s => s.key));
  const principales = modulos.map(m => m[1]).filter(k => !subKeys.has(k));
  return { principales: [...new Set(principales)], subs, comingSoon };
};

// ── Fuentes ────────────────────────────────────────────────────────────────
const paths = ['src'];
let archivos;
let leer;
if (soloIndexado) {
  const idx = archivosIndexados(RAIZ, paths);
  archivos = [...idx].filter(f => /\.(js|jsx)$/.test(f));
  const contenido = leerDelIndice(RAIZ, archivos);
  leer = (f) => contenido.get(f) ?? '';
} else {
  archivos = execSync(`find ${paths.join(' ')} -type f \\( -name '*.js' -o -name '*.jsx' \\)`,
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .trim().split('\n').filter(Boolean);
  leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
}

const fuentes = new Map(archivos.map(f => [f, leer(f)]));
const registroTxt = fuentes.get(REGISTRO) ?? readFileSync(join(RAIZ, REGISTRO), 'utf8');
const { principales, subs, comingSoon } = leerRegistro(registroTxt);
const declaradas = new Set([...principales, ...subs.map(s => s.key)]);

// ── Lo que el código consulta, por sus CINCO caminos ───────────────────────
const literales = new Set();
const prefijos = new Set();
const porVariable = new Set();   // permKey: 'x'  ·  permission: 'x'
for (const [f, txt] of fuentes) {
  if (f === REGISTRO) continue;  // el registro se declara, no consulta
  for (const m of txt.matchAll(/hasPermission\(\s*'([a-z0-9_]+)'/g)) literales.add(m[1]);
  for (const m of txt.matchAll(/hasPermission\(\s*`([a-z0-9_]+_)\$\{/g)) prefijos.add(m[1]);
  for (const m of txt.matchAll(/moduleKey="([a-z0-9_]+)"/g)) literales.add(m[1]);
  // Claves que viajan por una propiedad hasta un hasPermission(variable):
  // `permKey` (PedidosView) y `permission` (registro de widgets del Dashboard).
  for (const m of txt.matchAll(/\b(?:permKey|permission):\s*'([a-z0-9_]+)'/g)) porVariable.add(m[1]);
  // showWidget('id', 'dash_x') — segundo argumento literal.
  for (const m of txt.matchAll(/showWidget\(\s*'[a-z0-9_]+'\s*,\s*'([a-z0-9_]+)'/g)) porVariable.add(m[1]);
  // MODULE_MAP / grupos de menú: modules: ['a', 'b', …]
  for (const bloque of txt.matchAll(/modules:\s*\[([^\]]*)\]/g))
    for (const m of bloque[1].matchAll(/'([a-z0-9_]+)'/g)) literales.add(m[1]);
  // Sexto camino (2026-08-12): un mapa TIPO → módulo que después se consume con
  // `hasPermission(variable)`. Lo estrenó `MODULO_QUE_DECIDE`, cuando aprobar
  // solicitudes se separó por familia y la bandeja dejó de tener UN permiso.
  //
  // Se reconoce por el nombre del mapa, no por el archivo: así el gate no se
  // ata a una ruta y el patrón sirve para el próximo. Sin esta regla, los tres
  // módulos nuevos figuraban como «declarados y que nadie consulta» — o sea
  // como interruptores muertos— cuando son justo los que gatean la bandeja.
  for (const bloque of txt.matchAll(/MODULO_QUE_DECIDE\s*=\s*\{([\s\S]*?)\n\};/g))
    for (const m of bloque[1].matchAll(/:\s*'([a-z0-9_]+)'/g)) porVariable.add(m[1]);
}
const consultada = (k) =>
  literales.has(k) || porVariable.has(k) || [...prefijos].some(p => k.startsWith(p));

// ── Hallazgos ──────────────────────────────────────────────────────────────
const problemas = [];

const declaradasSinUso = [...declaradas].filter(k =>
  !consultada(k) && !comingSoon.has(k) && !GATEADAS_EN_LA_BASE[k] && !PENDIENTES[k]);
if (declaradasSinUso.length) {
  problemas.push({
    titulo: 'Declaradas en Permisos y que NADIE consulta',
    detalle: 'El switch existe y no hace nada — es el caso `staff_salary`. O se gatea, o se quita del registro.',
    items: declaradasSinUso,
  });
}

const usadasSinDeclarar = [...new Set([...literales, ...porVariable])]
  .filter(k => !declaradas.has(k) && k.length > 3);
if (usadasSinDeclarar.length) {
  problemas.push({
    titulo: 'Consultadas por el código y NO registradas',
    detalle: 'No se pueden repartir desde Permisos — es el caso `maintenance`.',
    items: usadasSinDeclarar,
  });
}

// ── Baldosas del tablero que no viven en ninguna pestaña ───────────────────
// Es la misma falla que `declaradasSinUso` con otro disfraz, y por eso vive
// acá: el permiso existe, el widget existe, el render existe — pero
// `TAB_WIDGETS` decide en qué pestaña aparece cada uno, y un id que no está en
// ninguna **no se ve nunca**, ni en el tablero ni en Personalizar. No hay
// error, no hay hueco: simplemente no existe.
//
// Pasó dos veces sin que nada avisara (`traslados` y `vendedores`, 2026-08-06)
// y las dos se descubrieron abriendo el navegador. Con el gate, se descubre
// antes de commitear.
const DASHBOARD = 'src/views/DashboardView.jsx';
const dashTxt = fuentes.get(DASHBOARD) ?? (() => {
  try { return readFileSync(join(RAIZ, DASHBOARD), 'utf8'); } catch { return ''; }
})();
if (dashTxt) {
  // Los ids del registro de widgets.
  const defsBloque = dashTxt.match(/const WIDGET_DEFS\s*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? '';
  const idsDefinidos = [...defsBloque.matchAll(/\bid:\s*'([a-z0-9_]+)'/g)].map(m => m[1]);
  // El reparto por pestaña se mudó a `src/constants/dashboardTabs.js` el
  // 2026-08-07, porque **Permisos** lo necesita igual para agrupar los widgets
  // por pestaña. Leerlo del lugar viejo no daba error: `TAB_WIDGETS` sigue
  // existiendo en la vista, pero hoy son cuatro getters, y el regex de strings
  // se llevaba los nombres de las pestañas (`'general'`, `'comercial'`…) como
  // si fueran ids de widget. El gate acusaba cuatro widgets inexistentes.
  const REPARTO = 'src/constants/dashboardTabs.js';
  const repartoTxt = fuentes.get(REPARTO) ?? (() => {
    try { return readFileSync(join(RAIZ, REPARTO), 'utf8'); } catch { return ''; }
  })();
  const tabsBloque = repartoTxt.match(/PESTANAS_TEMATICAS\s*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
  // General no se declara: `catalogoDePestana` la deriva del catálogo completo,
  // así que cubre todo y ningún widget puede quedar fuera de toda pestaña. Si
  // algún día vuelve a ser una lista literal, esto se entera solo.
  const generalDerivada = !/^\s*general\s*:/m.test(tabsBloque);
  const idsEnPestanas = new Set([...tabsBloque.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]));

  const huerfanos = generalDerivada ? [] : idsDefinidos.filter(id => !idsEnPestanas.has(id));
  if (huerfanos.length) {
    problemas.push({
      titulo: 'Widgets del tablero que no están en NINGUNA pestaña',
      detalle: 'Registrados en WIDGET_DEFS y ausentes de TAB_WIDGETS: no se ven ni en el tablero ni en Personalizar.',
      items: huerfanos,
    });
  }

  const inventados = [...idsEnPestanas].filter(id => !idsDefinidos.includes(id));
  if (inventados.length) {
    problemas.push({
      titulo: 'Pestañas del tablero que reparten un widget inexistente',
      detalle: 'Ids en PESTANAS_TEMATICAS (constants/dashboardTabs.js) que WIDGET_DEFS no define — quedan reservando un hueco que nunca se llena.',
      items: inventados,
    });
  }
}

const capsQueParecenTab = subs.filter(s => s.tipo === 'cap' && s.key.includes('_tab_'));
if (capsQueParecenTab.length) {
  problemas.push({
    titulo: 'Capacidades con `_tab_` en el nombre',
    detalle: 'El canon reserva `_tab_` para pestañas — es el caso `productos_tab_catalogo_costos`.',
    items: capsQueParecenTab.map(s => s.key),
  });
}

// ── Salida ─────────────────────────────────────────────────────────────────
console.log('');
console.log(`  registro: ${principales.length} módulos · ${subs.filter(s => s.tipo === 'tab').length} pestañas · ${subs.filter(s => s.tipo === 'cap').length} capacidades`);
console.log(`  código:   ${literales.size} literales · ${prefijos.size} plantillas · ${porVariable.size} por variable`);
if (Object.keys(GATEADAS_EN_LA_BASE).length)
  console.log(`  gateadas en Postgres (declaradas a mano): ${Object.keys(GATEADAS_EN_LA_BASE).join(', ')}`);

// Los pendientes se ven SIEMPRE, pasen o no los chequeos. Solo se listan los que
// siguen siendo ciertos: el día que la clave se gatee o se borre, desaparece del
// aviso sola y hay que sacarla de PENDIENTES.
const pendientesVivos = Object.entries(PENDIENTES)
  .filter(([k]) => declaradas.has(k) && !consultada(k));
if (pendientesVivos.length) {
  console.log(`\n  ⚠ Hallazgo abierto por decisión, no por error (${pendientesVivos.length})`);
  for (const [k, motivo] of pendientesVivos) console.log(`      · ${k} — ${motivo}`);
}
const pendientesResueltos = Object.keys(PENDIENTES)
  .filter(k => !declaradas.has(k) || consultada(k));
if (pendientesResueltos.length) {
  console.log(`\n  ℹ Ya resuelto, sacar de PENDIENTES: ${pendientesResueltos.join(', ')}`);
}

if (problemas.length === 0) {
  console.log('\n  ✓ Permisos coherentes: todo lo declarado se consulta y todo lo consultado está declarado.\n');
  process.exit(0);
}

for (const p of problemas) {
  console.log(`\n  ✗ ${p.titulo} (${p.items.length})`);
  console.log(`    ${p.detalle}`);
  for (const i of p.items) console.log(`      · ${i}`);
}
console.log('\n  Canon y matriz: docs/planes-cerrados/AUDITORIA-PERMISOS-2026-08-03.md §7-bis / §7-ter\n');
process.exit(1);
