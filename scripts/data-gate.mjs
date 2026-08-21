#!/usr/bin/env node
/**
 * data-gate — invariantes de la capa de datos. Local, sin red.
 *
 * Nace de la auditoría completa del 2026-07-30
 * (docs/AUDITORIA-COMPLETA-2026-07-30.md). Cada categoría existe porque el
 * bug correspondiente YA ocurrió en este repo, no por higiene teórica:
 *
 *   tipo-booleano   `.eq('recibido_mh', true)` sobre una columna TEXT que guarda
 *                   el sello de Hacienda: la lista "confirmadas por MH" devolvía
 *                   0 filas desde siempre, y el update escribía la cadena 'true'
 *                   encima de un sello fiscal.
 *   cap-1000        PostgREST trunca en 1000 sin avisar. `.limit(1000)` es el
 *                   cap exacto: el día que la tabla lo cruza, trunca en silencio.
 *   sin-paginar     SELECT sobre tabla grande sin range/limit/in/single/count
 *                   ni fetchAllRows.
 *   in-columna-repetida  `.in(<columna que se repite>, …)` sin paginar. El
 *                   detector de arriba da por acotada cualquier consulta con un
 *                   `.in(`, que es el «Patrón A» del CLAUDE.md; pero acotar la
 *                   entrada sólo acota la salida si la columna es una clave.
 *                   El filtro «Receta Médica» de Ventas pedía
 *                   `.in('erp_product_id', <79 ids>)` sobre sales_invoice_items
 *                   y recibía 1000 de 4,013 filas: mostraba 8 ventas de 93 en
 *                   agosto/2026 y el gate estaba verde. Arreglado el 2026-08-17
 *                   bajando el filtro a la base (get_ventas_con_receta).
 *   error-ignorado  `const { data } = await supabase...` sin mirar `error`.
 *                   Un select que falla en silencio deja Maps vacíos (pasó con
 *                   presentaciones.descripcion: un mes sin detectarse).
 *   escritura-a-ciegas  `await supabase...` a secas, sin recoger el resultado.
 *                   Es el hermano ciego del anterior y el que costó la
 *                   recepción del 2026-08-14: RLS frenó cada escritura y la
 *                   pantalla dio la llegada por confirmada igual.
 *
 * Ratchet, igual que design-gate: falla si una categoría SUBE respecto a
 * scripts/data-gate-baseline.json. Cuando una llega a 0 queda bloqueante para
 * siempre (una categoría ausente del JSON arranca en 0).
 *
 * Al BAJAR deuda: npm run gate:data -- --update-baseline y commitear el JSON.
 * NUNCA regenerar para tapar un hallazgo nuevo.
 *
 * `escritura-a-ciegas` nació con tope 26 y eso NO es una excepción disfrazada:
 * es deuda vieja que recién ahora alguien mira. Los 26 viven todos en
 * `supabase/functions/` —son inserts de bitácora de los crons, que corren con
 * la llave de servicio— y bajarlos obliga a redesplegar nueve funciones, con
 * el riesgo de `--no-verify-jwt` que describe CLAUDE.md; no se hace de paso.
 * En `src/` la categoría arrancó y quedó en CERO, así que cualquier escritura
 * a ciegas nueva del portal falla el gate el mismo día. El tope sólo baja.
 *
 * `in-columna-repetida` nació con tope 10 el 2026-08-17 y quedó en 5 el mismo
 * día. Los diez se revisaron uno por uno contra los volúmenes REALES de prod, y
 * el resultado se repartió en tres grupos:
 *
 *   ARREGLADO EN LA BASE (1)  El filtro «Receta Médica» de Ventas era el único
 *     que YA cruzaba las 1000: 4,013 filas, 1000 entregadas, agosto mostrando 8
 *     ventas de 93. No se anotó como deuda porque no era deuda, era un bug.
 *
 *   PAGINADOS (2)  Los que podían llegar al tope aunque hoy no lleguen:
 *     · `fetchInvoiceItemsByIds` — las 100 facturas con más renglones de la
 *       historia suman 1,846. No se juntan navegando, pero un filtro puede.
 *     · `fetchStockParamsForRevision` — pide productos × sucursales; con 7 salas
 *       bastan 150 productos. El peor pedido real pide 90 y usa 49.
 *
 *   DOCUMENTADOS (5)  Los que están acotados por OTRO filtro de la misma
 *     consulta, no por el `.in()`. Cada uno lleva el motivo y la medición
 *     escritos ARRIBA DE LA CONSULTA, que es donde los va a leer quien la
 *     toque: los renglones de canje de puntos (798 en toda la tabla), los lotes
 *     de UN producto (máx. 66), las fotos por nombre (1 producto por nombre),
 *     y las dos de `consolidate-timesheets` (0 ausencias del último año; 49
 *     empleados, máx. 7 marcaciones por día).
 *
 * El de las fotos es el único cuya cota es de los DATOS y no de un índice —o
 * sea que nada la garantiza—, y así está anotado.
 *
 * El tope sólo baja.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(RAIZ, 'scripts', 'data-gate-baseline.json');

// `--hook` se declara acá arriba y no junto al resto porque los RETRATOS de la
// base —abajo— también tienen que salir del índice, y se leen antes.
const soloIndexado = process.argv.includes('--hook');

/* Los retratos (`boolean-columns.json`, `request-types.json`) definen QUÉ mira
 * el gate, así que en modo hook tienen que venir del índice igual que los
 * fuentes. Leerlos del disco mientras los fuentes salen del índice mezcla dos
 * árboles y produce hallazgos que no existen en ninguno de los dos: pasó el
 * 2026-08-17, cuando otra sesión agregó `approval_requests` a `tablas_grandes`
 * en su disco y todavía no había commiteado las seis consultas que ese mismo
 * cambio venía a exigir. El gate contaba la tabla nueva (disco) contra el
 * código viejo (índice) y culpaba a un commit que no tocaba ni una ni otro.
 *
 * Es exactamente el agujero que `--hook` vino a cerrar, en la mitad que faltaba:
 * la lista de archivos y su contenido ya salían del índice; el criterio no. */
const leerRetrato = (ruta) => {
  if (soloIndexado) {
    try { return execSync(`git show :${ruta}`, { cwd: RAIZ, encoding: 'utf8' }); }
    catch { /* sin versión en el índice (archivo nuevo sin preparar): cae al disco */ }
  }
  return readFileSync(join(RAIZ, ruta), 'utf8');
};

const SCHEMA = JSON.parse(leerRetrato('scripts/db/boolean-columns.json'));

const BOOLEANAS = SCHEMA.tablas;
const GRANDES = Object.keys(SCHEMA.tablas_grandes).filter(k => !k.startsWith('_'));

/* Los tipos de solicitud que la base admite, con el nombre que ELLA les da.
 * Retrato de prod; ver el `_comment` del JSON para regenerarlo. */
const TIPOS_DE_SOLICITUD = JSON.parse(leerRetrato('scripts/db/request-types.json')).tipos;

if (process.argv.includes('--regen-tipos')) {
  console.log(`
Correr contra prod y volcar el resultado en scripts/db/request-types.json:

  select m[1] as tipo, m[2] as rotulo
  from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace,
       lateral regexp_matches(pg_get_functiondef(p.oid),
               'WHEN\\s+''([A-Z_]+)''\\s+THEN\\s+''([^'']+)''', 'g') as m
  where n.nspname = 'public' and p.proname = 'notificar_solicitud_creada';

Cruzar el resultado contra el CHECK, que es quien decide qué se admite:

  select pg_get_constraintdef(oid) from pg_constraint
  where conname = 'approval_requests_type_check';

Si el CHECK admite un tipo que el disparador no nombra, el hueco es de la BASE
y se arregla allá: el aviso de ese tipo sale hoy con la clave cruda.
`);
  process.exit(0);
}

/**
 * Excepciones con MOTIVO escrito. Una entrada por archivo, con todas sus
 * categorías — igual que design-gate, una clave repetida pisaría a la anterior
 * en silencio (lo verifica assertSinClavesDuplicadas).
 */
const EXCEPTIONS = {
  'src/utils/supabaseUtils.js': {
    'sin-paginar': 'ES el helper de paginación (fetchAllRows). El .range() lo pone él.',
  },
  'supabase/functions/_shared/dteRelatedDoc.ts': {
    'error-ignorado': 'Lookup opcional: la ausencia del documento relacionado es un resultado válido, no un fallo.',
  },
  'supabase/functions/devolver-pedido-erp/index.ts': {
    'in-columna-repetida':
      'Un solo sitio: el `.in("pedido_item_id", …)` sobre pedido_traslado_linea que busca los lotes de ida. '
      + 'Se arregló el 2026-08-21 y el detector no puede verlo porque sigue siendo un `.in(`: la entrada va en '
      + 'tandas de 400, el error se lanza en vez de descartarse, y una tanda que vuelva con 1000 filas exactas '
      + '—la firma del corte de PostgREST— aborta con un mensaje propio en vez de imprimir un vale sin lotes. '
      + 'Medido: pedido_item_id es hoy 1 a 1 (3,038 filas / 3,038 items distintos), pero el índice único es '
      + 'sobre la terna pedido+sucursal+item, así que NADIE lo garantiza — por eso el freno queda puesto. '
      + 'Si aparece un segundo `.in(` sobre tabla grande en este archivo, esta excepción lo taparía: revisarla.',
  },
};

function assertSinClavesDuplicadas(src) {
  const claves = [...src.matchAll(/^\s{2}'([^']+)':\s*\{/gm)].map(m => m[1]);
  const vistas = new Set(), dup = new Set();
  for (const k of claves) (vistas.has(k) ? dup : vistas).add(k);
  if (dup.size) {
    console.error(`✗ EXCEPTIONS tiene claves duplicadas (la segunda pisa a la primera en silencio):`);
    for (const d of dup) console.error(`    ${d}`);
    process.exit(2);
  }
}
assertSinClavesDuplicadas(readFileSync(fileURLToPath(import.meta.url), 'utf8'));

const exento = (archivo, cat) => Boolean(EXCEPTIONS[archivo]?.[cat]);

// ── recolección ────────────────────────────────────────────────────────────
// `--hook`: solo lo que el ÍNDICE de git conoce. Es lo que corre el pre-commit.
//
// Sin esto, este gate mira el disco con `find` y por lo tanto también los
// archivos sin trackear — que en este repo son, por definición, el trabajo a
// medio hacer de OTRA sesión (hay 2-3 sobre el mismo árbol, ver CLAUDE.md).
// El resultado es que una sesión no puede commitear hasta que otra termine, y
// lo peor: el mensaje culpa a "código nuevo que hay que arreglar" señalando un
// archivo que quien commitea nunca tocó. Pasó el 2026-08-01 con
// `sync-numero-control/index.ts` (3 hallazgos, tope 28 → 31) y obligó a un
// `--no-verify` en un commit de dos líneas de texto.
//
// El pre-commit ya declaraba esta intención en un comentario —"acotado al diff
// preparado […] no bloquear a esta sesión por el árbol a medio editar de otra"—
// pero lo único acotado era la CONDICIÓN para correr el gate; el gate escaneaba
// todo igual. La intención estaba escrita y no implementada.
//
// El índice es la definición correcta de "lo que este commit lleva": incluye lo
// que ya está en HEAD y lo que esta sesión acaba de preparar (`git commit -o`
// prepara antes de disparar el hook), y excluye lo ajeno sin commitear. En modo
// manual (`npm run gate:data`) se sigue viendo TODO, que es lo que uno quiere
// al auditar o antes de regenerar el baseline.
// (`soloIndexado` se declara arriba, junto a los retratos, que necesitan lo mismo.)

let archivos = execSync(
  "find src supabase/functions -type f \\( -name '*.js' -o -name '*.jsx' -o -name '*.ts' \\) ! -name 'version.js'",
  { cwd: RAIZ, encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

// El CONTENIDO también sale del índice cuando corre el hook. Filtrar la lista
// por `git ls-files` cerraba solo la mitad del agujero: un archivo trackeado que
// otra sesión tiene a medio editar se seguía leyendo del DISCO, así que sus
// hallazgos entraban al commit ajeno igual que los de un archivo sin trackear.
// Pasó el 2026-08-03 — `src/data/ventas.js` a medio editar por otra sesión subió
// `sin-paginar` de 9 a 10 y bloqueó un commit que no tocaba ese archivo ni esa
// categoría, con el mismo mensaje que culpa a "código nuevo que hay que
// arreglar". El índice ya era la definición correcta según el comentario de
// arriba; esto la termina de implementar.
//
// `git cat-file --batch` en UN proceso, no un `git show` por archivo (son ~480).
// Sale un Buffer a propósito: `execSync` corta en 1 MB si se le pide texto y el
// fuente entero pasa de eso — y el corte llegaría como un archivo truncado, no
// como un error.
function leerDelIndice(rutas) {
  const salida = execSync('git cat-file --batch', {
    cwd: RAIZ,
    input: rutas.map(r => `:${r}`).join('\n') + '\n',
    maxBuffer: 512 * 1024 * 1024,
  });
  const mapa = new Map();
  let pos = 0;
  for (const ruta of rutas) {
    const nl = salida.indexOf(0x0a, pos);
    if (nl === -1) break;
    const cabecera = salida.toString('utf8', pos, nl);   // "<oid> blob <bytes>"
    const partes = cabecera.split(' ');
    if (partes[1] !== 'blob') { pos = nl + 1; continue; } // "missing" / "ambiguous"
    const ini = nl + 1;
    const fin = ini + Number(partes[2]);
    mapa.set(ruta, salida.toString('utf8', ini, fin));
    pos = fin + 1;                                        // +1: el \n de cierre
  }
  return mapa;
}

const desdeIndice = new Map();
if (soloIndexado) {
  const indexados = new Set(
    execSync('git ls-files -- src supabase/functions', { cwd: RAIZ, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean),
  );
  const antes = archivos.length;
  archivos = archivos.filter(f => indexados.has(f));
  const fuera = antes - archivos.length;
  if (fuera > 0) {
    console.log(`\n  (${fuera} archivo${fuera !== 1 ? 's' : ''} sin trackear fuera del análisis: no son de este commit)`);
  }
  for (const [ruta, texto] of leerDelIndice(archivos)) desdeIndice.set(ruta, texto);
}

// Modo manual (`npm run gate:data`): el disco, que es lo que uno quiere al
// auditar o antes de regenerar el baseline.
const leerFuente = (archivo) => (soloIndexado
  ? (desdeIndice.get(archivo) ?? '')
  : readFileSync(join(RAIZ, archivo), 'utf8'));

const hallazgos = { 'tipo-booleano': [], 'cap-1000': [], 'sin-paginar': [], 'in-columna-repetida': [], 'error-ignorado': [], 'escritura-a-ciegas': [], 'tipo-sin-rotulo': [], 'alcance-contra-branch': [] };
const push = (cat, archivo, linea, detalle) => {
  if (exento(archivo, cat)) return;
  hallazgos[cat].push({ archivo, linea, detalle });
};
const lineaDe = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * Reemplaza comentarios y literales de cadena por espacios del MISMO largo:
 * los índices siguen valiendo (para el número de línea) pero un `.eq('x', true)`
 * citado dentro de un comentario explicativo ya no se cuenta como código.
 * Este archivo tiene comentarios largos que citan queries — sin esto, el gate
 * se delata a sí mismo con falsos positivos y deja de mirarse.
 *
 * ── Los saltos de línea del comentario de bloque se CONSERVAN ──
 *
 * `' '.repeat(m.length)` mantiene el largo en caracteres, que es lo que hace
 * falta para que `m.index` siga apuntando al mismo lugar. Pero un comentario
 * `/* … *\/` de veinte líneas tiene veinte `\n` adentro, y reemplazarlo por
 * espacios los borra: `lineaDe` cuenta `\n` en el prefijo, así que **todo
 * número de línea posterior a un comentario de bloque salía corrido hacia
 * arriba**, tantas líneas como saltos se hubieran comido.
 *
 * Medido el 2026-08-21 en `aplicar-movimiento-inventario`: el gate reportaba la
 * línea 690 —donde hay un comentario— y la escritura real estaba en la **716**.
 * Un archivo con muchos comentarios de bloque, que en este repo son casi todos,
 * daba un desfase de decenas de líneas.
 *
 * No es cosmético: un hallazgo cuya línea no lleva a ninguna parte obliga a
 * buscar a mano el sitio de verdad, y esa fricción es exactamente lo que hace
 * que una cola de 75 no se pague nunca. Se blanquea carácter por carácter
 * dejando pasar el `\n`, que cuesta lo mismo y no miente.
 */
const blanquear = (m) => m.replace(/[^\n]/g, ' ');

function soloCodigo(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blanquear)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blanquear(m.slice(p1.length)));
}

/**
 * Cómo se llama el cliente de supabase EN ESTE ARCHIVO.
 *
 * Los detectores 4 y 5 tenían el nombre `supabase` escrito a mano, y eso los
 * dejaba mirando menos de la mitad del código. Medido el 2026-08-21 sobre
 * `supabase/functions/`: de los 53 clientes que se crean con `createClient`,
 * **26 se llaman `supabase` y 24 se llaman `admin`** (más `supabaseClient`,
 * `comoElUsuario` y `client`). En llamadas: `await supabase.` aparece 79 veces
 * y `await admin.` **137** — o sea que el detector estaba ciego a la mayoría.
 *
 * El síntoma era un verde que no significaba nada: `error-ignorado: 0` con
 * **64 sitios** haciendo `const { data: x } = await admin…` sin mirar el error,
 * que es EXACTAMENTE lo que el CLAUDE.md prohíbe para edge functions desde el
 * incidente de `presentaciones.descripcion`.
 *
 * Es la misma lección que el snapshot de columnas booleanas y que
 * `tarjeta-a-mano` en design-gate: una lista escrita a mano se desincroniza del
 * registro. El nombre sale del archivo —de sus `createClient`— y así una
 * función nueva que llame `sb` al suyo entra sola.
 */
function reClientes(src, plantilla) {
  const nombres = new Set(['supabase']);
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*createClient\b/g)) nombres.add(m[1]);
  const alternativa = [...nombres].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(plantilla.replace('CLI', alternativa), 'g');
}

/**
 * El literal `{ … }` que empieza en `abre`, contando llaves.
 *
 * Existe porque `[^}]{0,400}` —lo que había antes— corta en la PRIMERA llave de
 * cierre, y esa llave puede ser la de un objeto anidado. Medido el 2026-08-21 en
 * `devolver-pedido-erp:224`:
 *
 *     .update({ estado: "error", detalle: { revisar_a_mano: true }, … })
 *
 * El recorte dejaba `revisar_a_mano: true` adentro de la ventana y el detector
 * lo reportaba como una COLUMNA de `pedido_devolucion` que «NO es boolean».
 * `revisar_a_mano` no es una columna: es una clave dentro del jsonb `detalle`.
 * O sea el gate acusando a código sano, que es la manera más rápida de que
 * alguien aprenda a saltárselo.
 *
 * Es el mismo error que ya se había pagado en `design-gate` —un detector que
 * leía el `className` sólo hasta la primera `}`— y por eso se arregla leyendo la
 * estructura en vez de ensanchar la ventana. Devuelve null si nunca cierra
 * (archivo cortado) o si el literal es absurdamente grande.
 */
function objetoLiteral(src, abre) {
  if (src[abre] !== '{') return null;
  let prof = 0;
  for (let i = abre; i < src.length && i - abre < 4000; i++) {
    if (src[i] === '{') prof++;
    else if (src[i] === '}') { prof--; if (prof === 0) return src.slice(abre + 1, i); }
  }
  return null;
}

/**
 * Los pares `clave: true|false` del PRIMER nivel de un literal.
 *
 * Todo lo que esté dentro de un `{}`, `[]` o `()` anidado se salta: ahí las
 * claves son del jsonb, del arreglo o de la llamada — no columnas de la tabla.
 */
function clavesDePrimerNivel(cuerpo) {
  const out = [];
  let prof = 0;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === '{' || c === '[' || c === '(') { prof++; continue; }
    if (c === '}' || c === ']' || c === ')') { prof--; continue; }
    if (prof !== 0) continue;
    const resto = cuerpo.slice(i);
    const m = /^(\w+)\s*:\s*(true|false)\s*(?=[,}\n]|$)/.exec(resto);
    if (m && (i === 0 || /[\s,{]/.test(cuerpo[i - 1]))) {
      out.push([m[1], m[2]]);
      i += m[0].length - 1;
    }
  }
  return out;
}

/** Tabla del `.from('X')` que gobierna la posición idx (el más cercano hacia atrás). */
function tablaEnContexto(src, idx) {
  const antes = src.slice(0, idx);
  const m = [...antes.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)].pop();
  return m ? m[1] : null;
}

for (const archivo of archivos) {
  const src = soloCodigo(leerFuente(archivo));

  // 1. tipo-booleano — .eq/.neq/.is(col, true|false) y {col: true|false} en escrituras,
  //    contra el snapshot de columnas realmente BOOLEAN.
  for (const m of src.matchAll(/\.(eq|neq|is)\(\s*['"](\w+)['"]\s*,\s*(true|false)\s*\)/g)) {
    const col = m[2];
    const tabla = tablaEnContexto(src, m.index);
    if (!tabla || !(tabla in BOOLEANAS)) continue;      // tabla desconocida → no opinar
    if (BOOLEANAS[tabla].includes(col)) continue;       // correcto
    push('tipo-booleano', archivo, lineaDe(src, m.index),
      `.${m[1]}('${col}', ${m[3]}) sobre ${tabla}: la columna NO es boolean`);
  }
  for (const m of src.matchAll(/\.(update|upsert|insert)\(\s*\{/g)) {
    const tabla = tablaEnContexto(src, m.index);
    if (!tabla || !(tabla in BOOLEANAS)) continue;
    const cuerpo = objetoLiteral(src, m.index + m[0].length - 1);
    if (cuerpo === null) continue;
    for (const [clave, valor] of clavesDePrimerNivel(cuerpo)) {
      if (BOOLEANAS[tabla].includes(clave)) continue;
      push('tipo-booleano', archivo, lineaDe(src, m.index),
        `.${m[1]}({ ${clave}: ${valor} }) sobre ${tabla}: la columna NO es boolean`);
    }
  }

  // 2. cap-1000
  for (const m of src.matchAll(/\.limit\(\s*1000\s*\)/g)) {
    push('cap-1000', archivo, lineaDe(src, m.index),
      '.limit(1000) es el cap exacto de PostgREST — usar fetchAllRows o un límite explícito menor');
  }

  // 3. sin-paginar
  for (const m of src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)([\s\S]{0,450})/g)) {
    const tabla = m[1];
    if (!GRANDES.includes(tabla)) continue;
    const frag = m[2].split(/\.from\(/)[0];
    if (!/\.select\(/.test(frag)) continue;
    if (/head:\s*true/.test(frag)) continue;                              // solo count
    if (/\.range\(|\.limit\(|\.single\(|\.maybeSingle\(|\.in\(/.test(frag)) continue;
    if (/\.eq\(\s*['"]id['"]/.test(frag)) continue;                       // por PK
    if (/\.(update|upsert|insert|delete)\(/.test(frag.split('.select(')[0])) continue; // select de retorno
    const ctx = src.slice(Math.max(0, m.index - 260), m.index);
    if (/fetchAllRows\s*\(/.test(ctx.split('\n').slice(-7).join('\n'))) continue;
    push('sin-paginar', archivo, lineaDe(src, m.index),
      `select sobre ${tabla} sin paginar — envolver en fetchAllRows()`);
  }

  /* 3b. in-columna-repetida — el punto ciego que dejó pasar el filtro «Receta
   *     Médica» de Ventas durante toda su vida.
   *
   * El detector de arriba trata cualquier `.in(` como prueba de que la consulta
   * está acotada. Esa es la lectura del «Patrón A» del CLAUDE.md: si la ENTRADA
   * tiene ≤1000 elementos, la SALIDA también. Pero eso sólo vale cuando la
   * columna del `.in()` es única en esa tabla — una clave. Si se repite, cada
   * elemento de la entrada trae N filas y el techo desaparece:
   *
   *     .from('sales_invoice_items').select('invoice_id').in('erp_product_id', ids)
   *
   * 79 ids de entrada, 4,013 filas de salida, 1000 entregadas. El filtro veía
   * 901 de 3,655 facturas y agosto/2026 mostraba 8 ventas de 93. El gate estaba
   * verde: había un `.in(`. Peor todavía, marcaba la línea de al lado —un select
   * sobre `products` que devuelve 79 filas— así que señalaba la sana.
   *
   * `id` es la única columna que en este esquema es clave en todas las tablas
   * grandes, así que es la única que exime. Para el resto hace falta paginar
   * (fetchAllRows), acotar a mano, o mover el filtro a la base — que es lo que
   * terminó haciendo Ventas.
   */
  /* La ventana es de 1500 y no de 450 como la de arriba, y se corta también en
   * el `}` a columna cero: el `.range()` de `fetchInvoicesList` vive DESPUÉS de
   * un if/else de veinte líneas, o sea fuera de 450 caracteres. Con la ventana
   * corta esa consulta —que sí pagina— se reportaba igual, y un detector que
   * grita sobre código sano se termina apagando. El corte por fin de función
   * evita el problema opuesto: tomar prestado el `.range()` de la consulta que
   * viene después.
   *
   * Y la ventana va en un LOOKAHEAD, que no consume. Con `([\s\S]{0,1500})` a
   * secas cada coincidencia se comía 1500 caracteres, o sea los `.from(` que
   * venían justo después: `fetchInvoiceItemsByIds` y `fetchStockParamsForRevision`
   * nunca llegaban a examinarse porque la consulta anterior se los había
   * tragado. Un detector puede quedar ciego por su propio avance de cursor, y
   * eso no se ve en el resultado — se ve contando a mano lo que debería salir. */
  for (const m of src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)(?=([\s\S]{0,1500}))/g)) {
    const tabla = m[1];
    if (!GRANDES.includes(tabla)) continue;
    const frag = m[2].split(/\.from\(/)[0].split(/\n\}/)[0];
    if (!/\.select\(/.test(frag)) continue;
    if (/head:\s*true/.test(frag)) continue;
    if (/\.range\(|\.limit\(|\.single\(|\.maybeSingle\(/.test(frag)) continue;
    if (/\.(update|upsert|insert|delete)\(/.test(frag.split('.select(')[0])) continue;
    const ctx = src.slice(Math.max(0, m.index - 260), m.index);
    if (/fetchAllRows\s*\(/.test(ctx.split('\n').slice(-7).join('\n'))) continue;
    for (const q of frag.matchAll(/\.in\(\s*['"](\w+)['"]/g)) {
      if (q[1] === 'id') continue;                                        // clave: acota de verdad
      push('in-columna-repetida', archivo, lineaDe(src, m.index),
        `.in('${q[1]}', …) sobre ${tabla}: la columna se repite, así que acotar `
        + `la entrada NO acota la salida — paginar con fetchAllRows() o filtrar en la base`);
    }
  }

  // 4. error-ignorado
  for (const m of src.matchAll(reClientes(src, String.raw`const\s*\{\s*data(?:\s*:\s*\w+)?\s*\}\s*=\s*await\s+(?:CLI)\s*\.`))) {
    push('error-ignorado', archivo, lineaDe(src, m.index),
      'destructurar solo `data`: el error del query se descarta');
  }

  /* 4b. alcance-contra-branch — preguntar por 'BRANCH' en vez de por 'ALL'.
   *
   * Hay TRES alcances, no dos: 'ALL', 'BRANCH' y 'MINE'. Preguntar
   * `getScope(m) === 'BRANCH'` para decidir si se recorta —o su espejo
   * `!== 'BRANCH'` para decidir si se ofrece el selector de sucursal— deja a
   * 'MINE' del lado ancho: no es BRANCH, luego ve todas. Y desde el 2026-08-21
   * `getScope` devuelve 'MINE' cuando el módulo no está en `rolePerms`, que es
   * justo el caso que antes caía en 'ALL'.
   *
   * La pregunta correcta es siempre la misma y es sobre el lado angosto:
   * **¿tiene alcance global?** → `=== 'ALL'` para ofrecer, `!== 'ALL'` para
   * recortar. Nació en cero: los 28 sitios que había se convirtieron el mismo
   * día, y no hay ninguno legítimo — si mañana hace falta distinguir BRANCH de
   * MINE, se distingue con una comparación propia y su motivo escrito, no
   * reintroduciendo la que confunde.
   *
   * Sólo `src/`: en `supabase/` el alcance lo resuelve `auth_module_scope()`,
   * que es SQL y tiene su propio CASE de tres ramas. */
  for (const m of soloCodigo(src).matchAll(/getScope\([^)]*\)\s*[!=]==\s*'BRANCH'/g)) {
    if (!archivo.startsWith('src/')) continue;
    push('alcance-contra-branch', archivo, lineaDe(src, m.index),
      "compara el alcance contra 'BRANCH': hay tres, y 'MINE' queda del lado ancho — preguntar por 'ALL'");
  }

  // 5. escritura-a-ciegas — `await supabase…` cuyo resultado no se recoge.
  //    El detector de arriba mira `const { data } = await`, o sea que sólo ve a
  //    quien AL MENOS pidió el dato. La forma que costó la recepción del
  //    2026-08-14 en La Popular no destructura nada: `await supabase.rpc(…)` a
  //    secas, y a la línea siguiente la pantalla se da por guardada. Un UPDATE
  //    que RLS frena responde 204 sin filas y `error: null` — byte por byte lo
  //    mismo que el éxito—, así que esa línea es indistinguible de haber
  //    funcionado. La regla ya estaba escrita en CLAUDE.md desde el incidente
  //    de `presentaciones.descripcion`; lo que faltaba era que algo la mirara.
  for (const m of src.matchAll(reClientes(src, String.raw`await\s+(?:CLI)\s*\.`))) {
    const antes  = src.slice(0, m.index).trimEnd();
    const ultimo = antes.at(-1) ?? '';
    if ('=(,[?:&|'.includes(ultimo)) continue;   // se asigna, se pasa como argumento o se compone
    if (/\breturn$/.test(antes)) continue;       // lo devuelve: el error lo mira el llamador
    push('escritura-a-ciegas', archivo, lineaDe(src, m.index),
      'el resultado se descarta: la escritura puede fallar sin lanzar nada');
  }
}

/* ── tipo-sin-rotulo: un tipo que la base admite y el portal no sabe nombrar ──
 *
 * No es un patrón dentro de un archivo, así que no va en el bucle de arriba:
 * es un cruce entre lo que dice Postgres y UNA lista del portal.
 *
 * El bug, dos veces el mismo (2026-08-15): `REQUEST_TYPES` traduce la clave
 * interna al castellano, y quien la lee cae a la clave cruda si no está —
 * `REQUEST_TYPES[t]?.label ?? t`—. Ese `?? t` es correcto como último recurso,
 * pero significa que agregar un tipo y olvidar el rótulo **no falla**: imprime
 * `INVENTORY_DISCARD_REQUEST` debajo del nombre de una persona y sigue.
 *
 *   · La primera copia era una lista aparte en el Inicio con 7 de los 15 tipos.
 *     Se borró; ahora esa pantalla lee el registro.
 *   · La segunda era el registro mismo: le faltaba `VACATION_CHANGE`, que la
 *     base admite, el plan de vacaciones crea y el disparador del aviso ya
 *     nombraba «Cambio de vacaciones». O sea que quien lo pedía recibía el
 *     aviso en castellano y encontraba la solicitud rotulada con la clave.
 *
 * Se compara contra el retrato de la base (`scripts/db/request-types.json`) y
 * no contra otra lista del portal: cruzar dos listas escritas a mano deja
 * pasar lo que las dos olvidaron. Y se compara TAMBIÉN el texto, porque el
 * rótulo tiene que ser el mismo en la pantalla y en el aviso: dos nombres
 * distintos para una cosa es la mitad del problema que esto viene a cerrar.
 *
 * Regenerar el retrato cuando la base cambie:
 *   npm run gate:data -- --regen-tipos
 */
{
  const RUTA_TIPOS = 'src/store/slices/requestsSlice.js';
  const src = leerFuente(RUTA_TIPOS);
  // El bloque `export const REQUEST_TYPES = { … };` y nada más: el archivo tiene
  // otros mapas y comentarios que citan tipos.
  const bloque = src.match(/export const REQUEST_TYPES\s*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
  const rotulos = new Map(
    [...bloque.matchAll(/^\s*([A-Z_]+):\s*\{[^}]*?label:\s*'([^']*)'/gm)].map(m => [m[1], m[2]]));

  for (const [tipo, rotuloBase] of Object.entries(TIPOS_DE_SOLICITUD)) {
    const enElPortal = rotulos.get(tipo);
    if (enElPortal === undefined) {
      push('tipo-sin-rotulo', RUTA_TIPOS, lineaDe(src, src.indexOf('REQUEST_TYPES')),
        `la base admite '${tipo}' y REQUEST_TYPES no lo nombra — se pinta la clave cruda. `
        + `La base lo llama «${rotuloBase}»`);
    } else if (enElPortal !== rotuloBase) {
      push('tipo-sin-rotulo', RUTA_TIPOS, lineaDe(src, src.indexOf(`${tipo}:`)),
        `'${tipo}' se llama «${enElPortal}» en pantalla y «${rotuloBase}» en el aviso`);
    }
  }
}

// ── reporte + ratchet ──────────────────────────────────────────────────────
const conteos = Object.fromEntries(Object.entries(hallazgos).map(([k, v]) => [k, v.length]));

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE, JSON.stringify(conteos, null, 2) + '\n');
  console.log('✓ baseline de data-gate actualizado:', JSON.stringify(conteos));
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
let falla = false;

for (const [cat, lista] of Object.entries(hallazgos)) {
  const tope = baseline[cat] ?? 0;            // categoría ausente ⇒ bloqueante en cero
  const n = lista.length;
  const estado = n > tope ? '✗ SUBIÓ' : n < tope ? '↓ bajó' : n === 0 ? '✓' : '· igual';
  console.log(`\n${estado}  ${cat}: ${n} (tope ${tope})`);
  if (n > tope) {
    falla = true;
    for (const h of lista) console.log(`     ${h.archivo}:${h.linea}\n       ${h.detalle}`);
  } else if (n > 0 && n <= tope) {
    for (const h of lista.slice(0, 4)) console.log(`     ${h.archivo}:${h.linea} — ${h.detalle}`);
    if (lista.length > 4) console.log(`     … y ${lista.length - 4} más`);
  }
}

if (falla) {
  console.error('\n✗ data-gate: una categoría subió. Es código nuevo que hay que arreglar,');
  console.error('  no un baseline que regenerar.\n');
  process.exit(1);
}
console.log('\n✓ data-gate en verde\n');
