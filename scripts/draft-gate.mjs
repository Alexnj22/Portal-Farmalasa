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
//
// `useBorrador` entró acá el 2026-08-24, y no reconocerlo era un agujero con
// forma de acierto: un formulario que lo usa BIEN salía marcado como deuda, y
// la forma de callar al gate habría sido agregarle un `saveDraft` redundante al
// lado — o sea, el gate empujando a duplicar justo lo que el hook vino a
// centralizar. Es el mismo modo de falla que ya se corrigió en `gate:movil`,
// donde una fila envuelta en `memo()` era una caja cerrada para el detector.
const RE_BORRADOR = /\bfrom\s+['"][^'"]*(draftUtils|useBorrador)['"]|\b(saveDraft|loadDraft|useBorrador)\s*\(/;

/**
 * Excepciones — CADA UNA CON SU MOTIVO ESCRITO.
 *
 * Un formulario entra acá sólo si no puede perder nada, no si «no parece
 * importante». Si el motivo no se puede escribir en una línea verificable, no es
 * una excepción: es deuda, y va al baseline.
 */
const EXCEPCIONES = {
  'src/views/dashboard/PedirTrasladoModal.jsx':
    'Lo que se puede perder acá NO vive en el modal: los renglones ya agregados ' +
    'y la causa viven en `store/composicionTraslado.js`, porque agregar un ' +
    'producto CIERRA este formulario para volver a la consulta de inventario a ' +
    'elegir el siguiente. Ese store persiste con `saveDraft`/`loadDraft` desde ' +
    'v2.702.4, así que una composición de tres salas sobrevive al cierre de ' +
    'sesión por inactividad —5 minutos en los cargos de sala—. Lo único que ' +
    'queda en el modal es el renglón A MEDIO ESCRIBIR (origen, presentación, ' +
    'cantidad), que son tres campos y se vuelven a elegir desde la misma lista ' +
    'que los ofreció.',
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

  'src/views/productos/TabCatalogo.jsx':
    'No hay nada que perder: TODO autoguarda. La foto, el devolutivo, la ' +
    'categoría y los principios activos se persisten al cambiar —con 700 ms de ' +
    'espera, misma decisión que la ficha del proveedor en Política de ' +
    'Vencimiento— y por eso la pantalla no tiene botón «Guardar»: su pie lo dice ' +
    'literalmente («todo autoguarda: foto, devolutivo, categoría y principios»). ' +
    'Un borrador acá guardaría una copia de algo que ya está en la base, y al ' +
    'recuperarlo podría pisar un cambio POSTERIOR hecho desde otra pantalla. ' +
    'Verificado el 2026-08-24.',

  'src/views/DashboardView.jsx':
    'No es un formulario. Sus 12 controles son ONCE selectores de sucursal —uno ' +
    'por widget: turnos, ventas, anulaciones, min/max, movimientos, facturas, ' +
    'cortes, bolsas…— más el selector de mes: filtran lo que cada tarjeta ' +
    'muestra, no capturan nada. El detector excluye `SearchInput`, ' +
    '`RangeDatePicker` y `PeriodPicker` por este mismo motivo, y no puede ' +
    'excluir `LiquidSelect`, que en el resto del portal SÍ es captura. Lo que sí ' +
    'se puede perder en el tablero —el acomodo de los widgets— ya persiste por ' +
    'su cuenta en `portal_dash_layout_*`, y los formularios de verdad viven en ' +
    'los widgets, que se miran uno por uno. Verificado el 2026-08-24.',
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
