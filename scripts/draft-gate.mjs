#!/usr/bin/env node
/**
 * gate:borradores — un formulario largo no puede perderse por una sesión cerrada.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * El portal cierra la sesión sola cuando nadie usa la pantalla, y desde
 * v2.647.0 ese plazo es configurable por cargo: los cargos de sala están en 5
 * minutos. Un formulario de captura vive en memoria, así que cuando la sesión se
 * cierra se pierde TODO lo escrito y no queda rastro en ningún lado.
 *
 * El caso real que lo motivó, del usuario (2026-08-17): una dependiente llenando
 * la bitácora de antibióticos se va a sacar copia, vuelve, y encuentra la
 * pantalla de entrada.
 *
 * El aviso «¿Sigues ahí?» (v2.646.0) evita la SORPRESA. No evita la PÉRDIDA:
 * nadie vuelve a tiempo si se fue diez minutos. Lo que evita la pérdida es el
 * borrador, y el patrón ya existía en el repo —`utils/draftUtils.js`, usado por
 * `LlegadaModal` y `FinalizarCajasModal`— sin ninguna regla que lo extendiera.
 * Medido el 2026-08-17: 27 formularios de 6 campos o más, CERO con borrador.
 *
 * ── Qué mide ──────────────────────────────────────────────────────────────────
 *
 * Cuenta controles de CAPTURA por archivo (no de filtro ni de búsqueda: un
 * `SearchInput` o un `PeriodPicker` no tienen nada que perder). A partir de
 * UMBRAL controles, el archivo tiene que guardar borrador —importar
 * `saveDraft`/`loadDraft` de `utils/draftUtils`— o estar en `EXCEPCIONES` con su
 * motivo escrito.
 *
 * ── Cómo se cierra un hallazgo ────────────────────────────────────────────────
 *
 * Con el borrador puesto, o con una excepción que diga POR QUÉ ese formulario no
 * puede perder nada — normalmente porque guarda sobre la marcha. Lo que NO se
 * hace es meterlo al baseline: el baseline es la deuda vieja del día que se
 * escribió esto, y sólo baja.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const RAIZ = process.cwd();
const BASELINE = join(RAIZ, 'scripts', 'draft-gate-baseline.json');

// Seis y no cuatro: por debajo de eso son diálogos de un dato o dos —un motivo,
// una fecha— que se vuelven a escribir en diez segundos. El costo de un
// borrador no se paga ahí.
const UMBRAL = 6;

// Controles de CAPTURA. Deliberadamente NO están los de filtro y navegación
// (`SearchInput`, `RangeDatePicker`, `PeriodPicker`, `ThemeAxisPicker`): filtrar
// una lista no produce nada que se pueda perder, y contarlos haría que una
// pantalla de reportes pidiera borrador sin tener qué guardar.
const CONTROLES = [
  'PortalInput', 'PortalTextarea', 'LiquidSelect', 'LiquidDatePicker',
  'TimePicker', 'FileField', 'LazyInput', 'CatalogSelect', 'CatalogOtherInput',
  'GlassInput', 'BeautifulCheckbox', 'CanonSwitch', 'MonthYearPicker',
  'LockedField', 'TypeSelect', 'Checkbox',
];
const RE_CONTROL = new RegExp(`<(${CONTROLES.join('|')})[\\s/>]`, 'g');

// Un archivo está protegido si usa el canónico del repo.
const RE_BORRADOR = /\bfrom\s+['"][^'"]*draftUtils['"]|\b(saveDraft|loadDraft)\s*\(/;

/**
 * Excepciones — CADA UNA CON SU MOTIVO ESCRITO.
 *
 * Un formulario entra acá sólo si no puede perder nada, no si «no parece
 * importante». Si el motivo no se puede escribir en una línea verificable, no es
 * una excepción: es deuda, y va al baseline.
 */
const EXCEPCIONES = {
  'src/views/inventario/ConteoDetailView.jsx':
    'Guarda renglón por renglón con `guardar_conteo_item` apenas se cuenta cada ' +
    'producto. Lo que hay en pantalla en cualquier momento es un solo renglón; ' +
    'el conteo entero ya está en la base. Verificado el 2026-08-17.',

  'src/views/dashboard/PedirTrasladoModal.jsx':
    'Lo que se arma NO vive en este formulario: los renglones están en el store ' +
    '`useComposicionTraslado`, justamente para que cerrar el modal —que es lo que ' +
    'hay que hacer para volver a la consulta y elegir el producto siguiente— no ' +
    'los borre. Lo que queda adentro del formulario es el alta de UN renglón: ' +
    'estante de origen, presentación y cantidad, los tres elegidos en la consulta ' +
    'de la que uno viene, más el motivo. ' +
    'Y que ese store no sobreviva a una recarga es una DECISIÓN escrita, no un ' +
    'descuido: está argumentada en el encabezado de `src/store/composicionTraslado.js` ' +
    '(«una solicitud a medias que reaparece dos días después es peor que una que se ' +
    'perdió — quien la ve no sabe si la armó él, ni si la existencia que vio sigue ' +
    'estando»). Un borrador acá contradiría esa decisión: devolvería a la pantalla ' +
    'una solicitud armada contra existencias que ya no son las de hoy, y el traslado ' +
    'saldría contra un stock que no está. ' +
    'Si algún día se decide que sí debe sobrevivir, el lugar es el store —con fecha ' +
    'de vencimiento y revalidación de existencia—, no `saveDraft` sobre este modal. ' +
    'Revisado el 2026-08-21.',
};

const esJsx = (n) => n.endsWith('.jsx');

async function archivos(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await archivos(p, acc);
    else if (esJsx(e.name)) acc.push(p);
  }
  return acc;
}

const contar = (txt) => (txt.match(RE_CONTROL) || []).length;

async function main() {
  const regenerar = process.argv.includes('--regenerar');
  const base = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : { generado: null, motivo: '', deuda: [] };
  const conocidos = new Set(base.deuda || []);

  const hallazgos = [];
  const yaProtegidos = [];

  for (const abs of await archivos(join(RAIZ, 'src'))) {
    const rel = relative(RAIZ, abs);
    if (EXCEPCIONES[rel]) continue;

    const txt = readFileSync(abs, 'utf8');
    const campos = contar(txt);
    if (campos < UMBRAL) continue;

    if (RE_BORRADOR.test(txt)) {
      // Si estaba en el baseline y ahora tiene borrador, hay que sacarlo: un
      // baseline que no baja deja de ser una deuda y pasa a ser un permiso.
      if (conocidos.has(rel)) yaProtegidos.push(rel);
      continue;
    }
    hallazgos.push({ archivo: rel, campos });
  }

  if (regenerar) {
    const deuda = hallazgos.map(h => h.archivo).sort();
    writeFileSync(BASELINE, `${JSON.stringify({
      generado: new Date().toISOString().slice(0, 10),
      motivo: 'Deuda del día que se escribió el gate. Sólo baja. Ver scripts/draft-gate.mjs.',
      umbral: UMBRAL,
      deuda,
    }, null, 2)}\n`);
    console.log(`\n  Baseline regenerado: ${deuda.length} archivo(s).\n`);
    return;
  }

  const nuevos = hallazgos.filter(h => !conocidos.has(h.archivo));

  console.log('\n── Formularios largos sin borrador ───────────────────────');
  console.log(`  umbral: ${UMBRAL} controles de captura`);
  console.log(`  deuda conocida: ${conocidos.size}  ·  excepciones con motivo: ${Object.keys(EXCEPCIONES).length}`);

  if (yaProtegidos.length) {
    console.log('\n  ✓ Ya tienen borrador y siguen en el baseline — sacalos de');
    console.log('    scripts/draft-gate-baseline.json:');
    yaProtegidos.forEach(a => console.log(`      ${a}`));
  }

  if (!nuevos.length) {
    console.log(`\n✓ Sin deuda nueva. ${hallazgos.length} hallazgo(s) bajo baseline.\n`);
    return;
  }

  console.log(`\n✗ ${nuevos.length} formulario(s) largo(s) SIN borrador:\n`);
  for (const h of nuevos.sort((a, b) => b.campos - a.campos)) {
    console.log(`  ${String(h.campos).padStart(3)} campos  ${h.archivo}`);
  }
  console.log('\n  Si se cierra la sesión por inactividad, se pierde todo lo escrito.');
  console.log('  Poné borrador con `saveDraft`/`loadDraft` de src/utils/draftUtils.js,');
  console.log('  o agregalo a EXCEPCIONES en scripts/draft-gate.mjs CON SU MOTIVO.');
  console.log('  El baseline NO se regenera para tapar un hallazgo nuevo.\n');
  process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
