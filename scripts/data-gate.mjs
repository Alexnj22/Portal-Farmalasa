#!/usr/bin/env node
/**
 * data-gate — invariantes de la capa de datos. Local y sin red por defecto;
 * con `--remote` agrega UNA sección que mide contra producción.
 *
 * Esa separación es deliberada y es la misma de gate:migrations: el gate corre
 * en el pre-commit, y un gate de commit que necesita red falla sin conexión y
 * enseña a escribir `--no-verify`. Lo que sólo se puede ver en producción
 * —una función de Postgres comparando contra un valor que su tabla no tiene—
 * va detrás del flag y se corre al cerrar el trabajo.
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
import { abrirCanal } from './lib/canal-supabase.mjs';

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

if (process.argv.includes('--regen-estados')) {
  console.log(`
Correr contra prod y volcar el resultado en scripts/db/estado-values.json.

Manda el CHECK cuando lo hay —es la verdad declarada y no depende de que la
tabla tenga filas—, y sólo si no hay CHECK se miran los valores observados:

  DO $$
  DECLARE r record; v text[]; out jsonb := '{}'::jsonb;
  BEGIN
    FOR r IN
      SELECT c.table_name AS t,
             (SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace n2 ON n2.oid = rel.relnamespace AND n2.nspname = 'public',
                LATERAL regexp_matches(pg_get_constraintdef(con.oid), '''([^'']*)''::text', 'g') m
               WHERE con.contype = 'c' AND rel.relname = c.table_name
                 AND pg_get_constraintdef(con.oid) ~ 'estado = ANY .ARRAY.') AS decl
        FROM information_schema.columns c
        JOIN information_schema.tables ta ON ta.table_schema = c.table_schema
             AND ta.table_name = c.table_name AND ta.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = 'estado'
       ORDER BY 1
    LOOP
      IF r.decl IS NOT NULL THEN
        out := out || jsonb_build_object(r.t, jsonb_build_object('origen','check','valores', to_jsonb(r.decl)));
      ELSE
        EXECUTE format('SELECT array_agg(DISTINCT estado ORDER BY estado) FROM public.%I WHERE estado IS NOT NULL', r.t) INTO v;
        out := out || jsonb_build_object(r.t, jsonb_build_object('origen','filas','valores', to_jsonb(coalesce(v, ARRAY[]::text[]))));
      END IF;
    END LOOP;
    CREATE TEMP TABLE _out(j jsonb); INSERT INTO _out VALUES (out);
  END $$;
  SELECT jsonb_pretty(j) FROM _out;

Una tabla con «origen: filas» lleva la lista de lo OBSERVADO, así que puede
quedarse corta cuando el sistema de origen empiece a mandar un valor nuevo —
sales_invoices es de ésas. Si la fecha de «_generado» tiene meses, regenerar
antes de creerle al verde.
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

const hallazgos = { 'tipo-booleano': [], 'cap-1000': [], 'sin-paginar': [], 'in-columna-repetida': [], 'error-ignorado': [], 'escritura-a-ciegas': [], 'tipo-sin-rotulo': [], 'alcance-contra-branch': [], 'columna-retirada': [] };

/**
 * Columnas que ya NO existen, con el motivo y a dónde se fue el dato.
 *
 * Una columna borrada no necesita un gate para dar error —la consulta falla— y
 * sin embargo hace falta: el error llega en producción, en la pantalla de
 * alguien, y el mensaje de PostgREST nombra la columna pero no dice qué
 * reemplazarla. Acá el aviso llega al escribirla y trae la respuesta.
 *
 * Se buscan sobre el código SIN comentarios (`soloCodigo`), así que las notas
 * que explican por qué se retiró no se acusan a sí mismas.
 */
const COLUMNAS_RETIRADAS = {
  system_role: 'employees.system_role se retiró el 2026-08-28: el escalón sale del CARGO (roles.rango). Usá rango_de_empleado()/auth_rango() en la base, `rango` de employees_safe en el portal, o empleados_por_rango() para buscar por escalón. Ver docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md.',
};
/* Los de la sección remota van aparte: no tienen archivo ni ratchet — una
 * función viva de Postgres comparando contra un valor inexistente es un
 * hallazgo nuevo siempre, nunca deuda heredada. */
const hallazgosRemotos = [];
const hallazgosColumna = [];

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

  // 0. columna-retirada — una columna que ya no existe, escrita otra vez.
  for (const [col, motivo] of Object.entries(COLUMNAS_RETIRADAS)) {
    for (const m of src.matchAll(new RegExp(`\\b${col}\\b`, 'g'))) {
      push('columna-retirada', archivo, lineaDe(src, m.index), motivo);
    }
  }

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

/* ── literal-de-estado-inexistente — un filtro que no filtra ────────────────
 *
 * Sección REMOTA (`--remote`): mira las funciones vivas de Postgres, no el
 * fuente. Tiene que ser así porque el defecto vive ahí y en ningún otro lado —
 * el archivo de la migración que lo corrige NOMBRA el literal viejo en su
 * comentario, así que un detector que leyera `supabase/migrations/` se
 * acusaría a sí mismo y acusaría además a toda migración histórica, que no se
 * toca.
 *
 * El bug (2026-09-01): ocho funciones filtraban las ventas anuladas con
 * `inv.estado != 'ANULADA'`, y `sales_invoices.estado` NUNCA tuvo ese valor —
 * sus tres únicos son FINALIZADA, DTE INVALIDADO EN MH y NULA. Una condición
 * contra un valor inexistente es siempre verdadera: **no descartaba ni una
 * fila**. No da error, no falta un renglón y se ve igual que un filtro que
 * funciona; por eso vivió desde el día uno. El arreglo canónico de agosto
 * (20260806022058) alcanzó a medio centenar de funciones y NO a estas ocho, y
 * peor: una migración del 21-ago reescribió `calculate_stock_params` entera y
 * copió el literal viejo sin que nada lo notara.
 *
 * Cómo decide, y por qué no resuelve alias:
 * parsear `<alias>.estado` hasta su tabla con expresiones regulares es frágil,
 * así que se compara contra la UNIÓN de los valores de TODAS las tablas con
 * columna `estado` que la función menciona. Es deliberadamente laxo: un
 * literal válido para cualquiera de ellas pasa. Aun así habría cazado las
 * ocho, porque de las tablas que nombran sólo `sales_invoices` tiene `estado`.
 * Lo que no se puede es acusar de más — un gate que le pega al que hizo bien
 * el trabajo se termina desactivando.
 *
 * Los valores salen de `scripts/db/estado-values.json`, y del CHECK de la
 * tabla cuando lo hay: ésa es la verdad declarada y no depende de que haya
 * filas, así que una tabla vacía (`recetas`) no produce falsos positivos.
 */
if (process.argv.includes('--remote')) {
  const ESTADOS = JSON.parse(leerRetrato('scripts/db/estado-values.json')).tablas;
  let canal = null;
  try {
    canal = abrirCanal('data-gate');
    const funciones = canal.consultar(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'f'
         AND pg_get_functiondef(p.oid) ~* '\\mestado\\M'
       ORDER BY 1`);

    for (const { proname, def } of funciones) {
      /* Las tablas con columna `estado` que esta función nombra. */
      const tablas = Object.keys(ESTADOS)
        .filter(t => new RegExp(`\\b${t}\\b`).test(def));
      if (tablas.length === 0) continue;   // el `estado` es de un CTE o una variable

      const validos = new Set(tablas.flatMap(t => ESTADOS[t].valores));

      /* `estado <op> 'literal'`, `estado IN ('a','b')` y `estado = ANY(ARRAY[…])`.
       * Se salta lo que está dentro de un comentario para no acusar a la nota
       * que explica el bug.
       *
       * Las dos trampas del parseo, las dos medidas la primera vez que corrió
       * —y las dos produciendo hallazgos FALSOS, que es como se desactiva un
       * gate—:
       *
       *  1. Un operador de UN valor no captura una lista. Capturando «uno o
       *     más literales separados por coma» detrás de un `=`, el match se
       *     desbordaba más allá del paréntesis y seguía tragando los literales
       *     de la línea siguiente: `v_prev.estado = 'cerrado',` dentro de un
       *     `jsonb_build_object` acusó a 'vivo', que estaba cuatro renglones
       *     abajo y no se compara con nada. Sólo `IN` y `= ANY` llevan lista, y
       *     acotada al `)` que la cierra.
       *
       *  2. Dentro de un `EXECUTE` dinámico las comillas van DOBLADAS. El SQL
       *     vive en una cadena, así que `NOT IN ('NULA', …)` se escribe
       *     `NOT IN (''NULA'', …)` — y leído con las reglas normales el primer
       *     literal es la cadena vacía. Las tres funciones que arman su
       *     consulta así (`get_ventas_con_puntos`, `get_ventas_con_receta`,
       *     que filtran BIEN) salieron acusadas. Se des-escapa el tramo antes
       *     de leerlo. */
      const cuerpo = def.replace(/--[^\n]*/g, '');
      const LITERAL = /'((?:[^']|'')*)'/g;
      const cmp = /\.?\bestado\b\s*(?:::text\s*)?(=\s*ANY|IS +NOT +DISTINCT +FROM|IS +DISTINCT +FROM|NOT +IN|IN|!=|<>|=)/gi;

      for (const m of cuerpo.matchAll(cmp)) {
        const op = m[1].replace(/\s+/g, ' ').toUpperCase();
        const deLista = op === 'IN' || op === 'NOT IN' || op.startsWith('= ANY');
        let tramo = cuerpo.slice(m.index + m[0].length, m.index + m[0].length + 400);

        /* El literal tiene que seguir INMEDIATAMENTE al operador. Si lo que
         * viene es una variable o una columna (`estado = p_estado`), no hay
         * literal que juzgar y la comparación se salta.
         *
         * Es la trampa 3, y también salió acusando a quien no debía: buscando
         * «el primer literal de los próximos 400 caracteres», un
         * `IF p_estado = ...` se llevaba el texto del `RAISE EXCEPTION` de
         * cinco líneas más abajo y lo reportaba como si fuera un valor de
         * estado — «compara estado contra 'FACTURA_ANULADA: esa factura ya
         * está anulada.'». */
        const arranque = deLista
          ? /^\s*\(\s*(?:ARRAY\s*\[\s*)?(?='')?(?=')/
          : /^\s*(?='')?(?=')/;
        if (!arranque.test(tramo)) continue;

        if (deLista) {
          /* Sólo hasta el paréntesis que cierra la lista. */
          const fin = tramo.indexOf(')');
          tramo = fin >= 0 ? tramo.slice(0, fin) : tramo;
        }
        /* Comillas dobladas ⇒ el SQL viaja dentro de una cadena: des-escapar.
         * Se detecta por el `''` que abre el primer literal, no por adivinar
         * si la función usa EXECUTE. */
        if (/^\s*\(?\s*(?:ARRAY\s*\[)?\s*''/.test(tramo)) tramo = tramo.replace(/''/g, "'");

        LITERAL.lastIndex = 0;
        const literales = [...tramo.matchAll(LITERAL)].map(l => l[1].replace(/''/g, "'"));
        for (const valor of deLista ? literales : literales.slice(0, 1)) {
          if (valor === '' || validos.has(valor)) continue;   // '' es un coalesce, no un estado
          hallazgosRemotos.push({
            archivo: `public.${proname}()`,
            linea: lineaDe(def, def.indexOf(m[0])),
            detalle: `compara estado contra '${valor}', que ninguna de las tablas que nombra `
              + `(${tablas.join(', ')}) puede tener. El filtro no descarta nada. `
              + `Valores reales: ${[...validos].sort().join(' · ')}`,
          });
        }
      }
    }
  } catch (e) {
    console.error(`\n✗ data-gate --remote: no se pudo medir contra producción — ${e.message}`);
    if (e.detalleCli) console.error(e.detalleCli);
    /* Un gate que no pudo medir NO puede dar verde. */
    process.exit(1);
  } finally {
    canal?.cerrar();
  }
}

/* ── columna-inexistente — el filtro que devuelve 400 y se lee como vacío ───
 *
 * Sección REMOTA (`--remote`): compara cada `.from('tabla')` del portal y de
 * las edge functions contra las columnas VIVAS de esa relación en producción.
 * Tiene que medirse contra la base y no contra un retrato: el retrato se
 * escribe una vez y una vista que se reescribe sin una columna lo deja viejo
 * sin avisar, que es justo el modo de falla que esta categoría persigue.
 *
 * El bug (2026-09-02): el buscador de «Reglas de despacho» no devolvía NADA
 * desde el 22-ago. Ese día se centralizó el filtro de producto en
 * `filtroProductoOCodigo`, que busca por `nombre_norm` O por `codigo_barras`.
 * Los otros cinco buscadores consultan `products`, que tiene las dos columnas;
 * éste consulta la vista `products_with_lab`, que sólo exponía `nombre_norm`.
 * PostgREST responde 400 `column products_with_lab.codigo_barras does not
 * exist`, el `catch` de la vista pinta la lista vacía, y la pantalla dice «Sin
 * resultados para "acet"». No hay error visible, no falta una fila, y nadie lo
 * reporta como defecto: se reporta como «no encuentra nada».
 *
 * Es el mismo modo de falla que `tipo-booleano` —una consulta que devuelve 0
 * filas no falla— con la diferencia de que acá SÍ hay un error, y el gate
 * existe porque el error muere en un `catch` del navegador.
 *
 * ── La cadena rota, y por qué el corte por `.from()` no sobra ──
 *
 * El patrón de este repo no es una cadena sola: es
 * `let q = supabase.from('t')…;` y más abajo `q = q.or(…)`. Un detector que
 * sólo siga la cadena contigua NO ve el `.or()` — se probó, y con la corrección
 * del día ya aplicada daba **0 hallazgos** sobre el bug que acababa de medirse.
 * Así que se sigue la variable dentro de su bloque; y el bloque termina en el
 * próximo `\n}` O en la próxima `.from(`, lo que llegue primero, porque el
 * nombre `q` se reusa: sin ese segundo corte, `employees_safe` cargaba con el
 * `.eq('employee_id')` de la consulta siguiente y salía acusada sin culpa.
 */
if (process.argv.includes('--remote')) {
  const METODOS_DE_COLUMNA = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'containedBy', 'overlaps', 'order', 'not',
    'rangeGt', 'rangeLt', 'rangeGte', 'rangeLte', 'likeAllOf', 'ilikeAnyOf']);

  /* Espacios y comentarios entre eslabones de la cadena. */
  const saltar = (s, i) => {
    while (i < s.length) {
      if (' \t\r\n'.includes(s[i])) i++;
      else if (s.startsWith('//', i)) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j + 1; }
      else if (s.startsWith('/*', i)) { const j = s.indexOf('*/', i); i = j < 0 ? s.length : j + 2; }
      else break;
    }
    return i;
  };
  /* i apunta al '('; devuelve dónde sigue y qué había adentro. Salta cadenas
   * para no cerrar con un paréntesis que vive dentro de un literal. */
  const cerrar = (s, i) => {
    let hondo = 0;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === "'" || c === '"' || c === '`') {
        for (j++; j < s.length; j++) {
          if (s[j] === '\\') { j++; continue; }
          if (s[j] === c) break;
        }
      } else if ('([{'.includes(c)) hondo++;
      else if (')]}'.includes(c)) {
        hondo--;
        if (hondo === 0) return { fin: j + 1, args: s.slice(i + 1, j) };
      }
    }
    return { fin: s.length, args: s.slice(i + 1) };
  };
  const ESLABON = /\.([A-Za-z_$][\w$]*)\s*\(/y;
  const cadena = (s, pos) => {
    const out = [];
    let i = pos;
    for (;;) {
      ESLABON.lastIndex = i;
      const m = ESLABON.exec(s);
      if (!m) break;
      const { fin, args } = cerrar(s, i + m[0].length - 1);
      out.push({ met: m[1], args });
      i = saltar(s, fin);
    }
    return out;
  };
  const literal = (args) => (args.match(/^\s*['"`]([^'"`]*)['"`]/) ?? [])[1];

  const columnasDeSelect = (args) => {
    const lit = literal(args);
    if (lit === undefined) return [];
    const partes = []; let hondo = 0, cur = '';
    for (const ch of lit) {
      if (ch === '(') { hondo++; cur += ch; }
      else if (ch === ')') { hondo--; cur += ch; }
      else if (ch === ',' && hondo === 0) { partes.push(cur); cur = ''; }
      else cur += ch;
    }
    partes.push(cur);
    return partes.map((p) => {
      p = p.trim();
      if (!p || p.includes('(') || p === '*') return null;        // recurso embebido o todo
      if (p.includes(':')) p = p.split(':').slice(1).join(':').trim();
      p = p.split('!')[0].split('->')[0].split('.')[0].trim();
      return /^[a-z_]\w*$/.test(p) ? p : null;
    }).filter(Boolean);
  };

  /* `.or('a.ilike.x,b.eq.y')` y el helper del repo, que expande a dos o tres
   * columnas. Se nombra acá porque el `.or()` lo recibe ya construido. */
  const columnasDeOr = (args) => {
    const lit = literal(args);
    if (lit !== undefined) {
      return lit.split(',').map((cond) => {
        const c = cond.trim().replace(/^\(+/, '').split('.')[0];
        return /^[a-z_]\w*$/.test(c) ? c : null;
      }).filter(Boolean);
    }
    if (args.includes('filtroProductoOCodigo')) {
      const cols = ['nombre_norm', 'codigo_barras'];
      if (/conPrincipioActivo\s*:\s*true/.test(args)) cols.push('pactivo_norm');
      return cols;
    }
    return [];
  };

  const columnasDe = ({ met, args }) => {
    if (met === 'select') return columnasDeSelect(args);
    if (met === 'or') return columnasDeOr(args);
    if (METODOS_DE_COLUMNA.has(met)) {
      const c = literal(args);
      return c && /^[a-z_]\w*$/.test(c) ? [c] : [];
    }
    return [];
  };

  let canal = null;
  try {
    canal = abrirCanal('data-gate-columnas');
    const catalogo = new Map();
    for (const { relname, cols } of canal.consultar(`
      SELECT c.relname, string_agg(a.attname, ',' ORDER BY a.attnum) AS cols
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind IN ('r','v','m','p','f')
       GROUP BY c.relname`)) {
      catalogo.set(relname, new Set(cols.split(',')));
    }

    for (const archivo of archivos) {
      const src = soloCodigo(leerFuente(archivo));
      for (const m of src.matchAll(/\.from\(/g)) {
        const ini = m.index;
        const enlaces = cadena(src, ini);
        if (enlaces[0]?.met !== 'from') continue;
        const tabla = literal(enlaces[0].args);
        if (!tabla || !catalogo.has(tabla)) continue;   // variable, o no es una relación nuestra

        const usos = enlaces.slice(1);
        const antes = src.slice(Math.max(0, ini - 200), ini);
        const mv = antes.match(/(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[\w$]+\s*$/);
        if (mv) {
          const corteLlave = src.indexOf('\n}', ini);
          const corteFrom  = src.indexOf('.from(', ini + 6);
          const fin = Math.min(corteLlave < 0 ? src.length : corteLlave,
                               corteFrom  < 0 ? src.length : corteFrom);
          const bloque = src.slice(ini, fin);
          for (const mu of bloque.matchAll(new RegExp(`\\b${mv[1]}\\s*\\.`, 'g'))) {
            usos.push(...cadena(bloque, mu.index + mu[0].length - 1));
          }
        }

        for (const uso of usos) {
          /* `{ referencedTable: 'x' }` filtra por columnas de X, no de la
           * tabla del `.from()`. Sin esto, el `.or()` de
           * auto-copy-weekly-roster salía acusado por una columna de
           * `employees` que su roster no tiene ni tiene por qué tener. */
          const ref = uso.args.match(/(?:referencedTable|foreignTable)\s*:\s*['"](\w+)['"]/);
          const destino = ref ? ref[1] : tabla;
          const validas = catalogo.get(destino);
          if (!validas) continue;
          for (const col of columnasDe(uso)) {
            if (validas.has(col)) continue;
            hallazgosColumna.push({
              archivo,
              linea: lineaDe(src, ini),
              detalle: `.${uso.met}() nombra '${col}', que ${destino} no tiene. `
                + `PostgREST responde 400 y la pantalla lo pinta como lista vacía.`,
            });
          }
        }
      }
    }
  } catch (e) {
    console.error(`\n✗ data-gate --remote: no se pudo medir el catálogo de columnas — ${e.message}`);
    if (e.detalleCli) console.error(e.detalleCli);
    /* Un gate que no pudo medir NO puede dar verde. */
    process.exit(1);
  } finally {
    canal?.cerrar();
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

/* La sección remota no tiene ratchet a propósito: una función VIVA comparando
 * contra un valor que su tabla no puede tener es siempre un hallazgo nuevo, no
 * deuda que se hereda. Bloqueante en cero desde el día uno. */
if (process.argv.includes('--remote')) {
  const n = hallazgosRemotos.length;
  console.log(`\n${n === 0 ? '✓' : '✗ SUBIÓ'}  literal-de-estado-inexistente: ${n} (tope 0)`);
  for (const h of hallazgosRemotos) {
    console.log(`     ${h.archivo}:${h.linea}\n       ${h.detalle}`);
  }
  if (n > 0) falla = true;

  /* Misma regla: una columna que la base no tiene es un hallazgo nuevo
   * siempre. Bloqueante en cero desde el día uno. */
  const nc = hallazgosColumna.length;
  console.log(`\n${nc === 0 ? '✓' : '✗ SUBIÓ'}  columna-inexistente: ${nc} (tope 0)`);
  for (const h of hallazgosColumna) {
    console.log(`     ${h.archivo}:${h.linea}\n       ${h.detalle}`);
  }
  if (nc > 0) falla = true;
}

if (falla) {
  console.error('\n✗ data-gate: una categoría subió. Es código nuevo que hay que arreglar,');
  console.error('  no un baseline que regenerar.\n');
  process.exit(1);
}
console.log(`\n✓ data-gate en verde${process.argv.includes('--remote') ? ' (con la sección remota)' : ''}\n`);
