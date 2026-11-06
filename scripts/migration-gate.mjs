#!/usr/bin/env node
/**
 * Gate de deriva de migraciones: que `supabase/migrations/` siga describiendo prod.
 *
 * Contexto (C2 de PLAN-SUPABASE-CIERRE.md, cerrado el 2026-07-29): el registro de
 * prod tenía 731 migraciones contra 339 archivos locales, y solo 14 de 699 versiones
 * coincidían — el repo no era un subconjunto de la historia real, era un set paralelo
 * mantenido a mano. La causa no fue historia perdida: `apply_migration` (la MCP tool)
 * escribe SOLO en el servidor, así que guardar el archivo local siempre fue un paso
 * manual aparte, hecho de forma inconsistente durante meses. Se cerró generando un
 * baseline del catálogo de prod (`20260101000000_baseline_schema.sql`, verificado con
 * las 15 categorías de la huella en md5 idéntico a prod) y archivando las 339
 * heredadas en `supabase/migrations-legacy/`.
 *
 * Este gate existe porque nada mecánico impedía que la deriva volviera a acumularse:
 * ni olvidar el archivo ni nombrarlo con el viejo `YYYYMMDD_nombre.sql` dan error, y
 * el detector natural quedó ciego — `supabase migration list` y `db push --dry-run`
 * arrancan listando las 731 versiones pre-baseline sin archivo local, así que una
 * migración nueva sin archivo sería la fila 732 de una lista de ruido. Es el mismo
 * razonamiento que `gate:design`: una convención escrita en prosa que nadie chequea
 * es exactamente cómo se acumuló la deuda la primera vez.
 *
 * Uso:
 *   npm run gate:migrations              solo chequeos locales (sin red, sin credenciales)
 *   npm run gate:migrations -- --remote  además cruza contra el registro de prod
 *   npm run gate:migrations -- --revisar <borrador.sql>…   reglas de CLAUDE.md sobre un
 *                                        borrador, ANTES de `apply_migration`
 *   npm run gate:migrations -- --deuda [N] [--detalle]     cuántas de las últimas N
 *                                        (60) no cumplen esas reglas; nunca falla
 *
 * `--remote` FALLA si no puede leer prod. Es a propósito: pedir el cruce y que no
 * se haga no puede terminar en el mismo tilde verde que un cruce que sí encontró
 * todo — «sin deriva» es una afirmación sobre prod, no sobre el disco. El hook de
 * pre-commit usa `--hook`, así que esto no bloquea ningún commit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, readFileSync } from 'node:fs';

const DIR = 'supabase/migrations';
const LEGACY = 'supabase/migrations-legacy';

/** El baseline generado del catálogo de prod. Lleva una versión deliberadamente
 *  temprana (1-ene-2026) para ordenar ANTES de todo lo aplicado. */
const BASELINE = '20260101000000';

/** Primera migración aplicada después de registrar el baseline
 *  (`drop_overload_muerto_get_puntos_canjeados`, 2026-07-29 22:30:30 UTC).
 *
 *  Es la frontera entre "historia pre-baseline, archivada en migrations-legacy/" y
 *  "migraciones que DEBEN tener archivo local". No alcanza con comparar contra la
 *  versión del baseline: las 731 viejas van de 20260404143525 a 20260729215940, o
 *  sea son MAYORES que el baseline. Hace falta este corte explícito.
 *
 *  ⚠️ NUNCA moverlo hacia adelante para hacer callar un hallazgo: correrlo es
 *  declarar "esta migración no necesita archivo", que es precisamente la deriva
 *  que el gate detecta. Solo cambia si algún día se re-genera el baseline. */
const CORTE = '20260729223030';

/* Acá vivía PRE_BASELINE_ESPERADAS = 731, las filas de historia pre-baseline
 * medidas al cierre de C2. Se eliminó el 2026-08-12: ese día esas 731 filas se
 * borraron del registro de prod —eran lo que hacía fallar a `create_branch`, que
 * replica el historial del padre y moría en las migraciones de abril— y quedaron
 * respaldadas en `supabase_migrations.schema_migrations_legacy_bak_20260812`.
 * El gate ahora las cuenta en vivo en vez de anunciar una constante. */

const NOMBRE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

// ═════════════════════════════════════════════════════════════════════════════
// Reglas OBLIGATORIAS de CLAUDE.md, leídas del SQL (2026-11-06)
// ═════════════════════════════════════════════════════════════════════════════
//
// Cinco reglas que CLAUDE.md escribe en prosa —§«migraciones sobre tablas
// calientes» y §«Estructura BD»— y que hasta hoy no verificaba nada. Cada una
// salió de un incidente medido; una regla en prosa que nadie chequea es
// exactamente cómo se volvió a colar `WITH CHECK (true)` en `attendance` y
// `audit_logs` después de que la regla de `USING (true)` ya estaba escrita.
//
// Miran SÓLO migraciones posteriores a CORTE_REGLAS: la historia no se puede
// reescribir (ya está aplicada en prod) y acusarla haría que el gate se calle
// a fuerza de excepciones. Lo que ya existe se MIDE con `--deuda`, no se acusa.
//
// Cada regla tiene su escape en el archivo, con el mismo formato que
// `-- venta-a-mano: <motivo>`: sin motivo escrito no vale.
//
// `--revisar <archivo.sql>…` corre estas reglas sobre un borrador SIN mirar el
// corte —el borrador va al scratchpad antes de `apply_migration`, así que ése es
// el momento de revisarlo, no después de aplicado—.
const CORTE_REGLAS = '20261106140000';

const REGLAS = {
  'lock-timeout': {
    escape: 'sin-lock-timeout',
    titulo: 'DDL sin `SET lock_timeout`',
    detalle: [
      'Outage del 2026-07-08 15:48–16:02 UTC: DDL de RLS aplicado mientras corría un sync.',
      'El ALTER/CREATE espera un lock ACCESS EXCLUSIVE, TODA lectura posterior de la tabla',
      'se encola detrás, el pool de PostgREST se agota y el portal entero da 504 (que el',
      "navegador pinta como error de CORS). Poner al principio: SET lock_timeout = '5s';",
      'Si falla por lock timeout, NO congeló prod: reintentar.',
    ],
  },
  'auth-por-fila': {
    escape: 'auth-por-fila',
    titulo: 'función de auth sin `(SELECT …)` dentro de una policy',
    detalle: [
      'Sin el wrapper Postgres la evalúa POR FILA (cada llamada consulta employees +',
      'role_permissions). 2026-07-08: un count() de 27K filas en sales_invoices pasó de',
      '25,000 ms a 19 ms con `(SELECT auth_x(...))`. Ser STABLE no alcanza; sólo el',
      'initplan garantiza una evaluación. El advisor de Supabase sólo linta auth.uid().',
    ],
  },
  'definer-sin-search-path': {
    escape: 'definer-sin-search-path',
    titulo: 'SECURITY DEFINER sin `SET search_path`',
    detalle: [
      'Una función DEFINER corre con los permisos de su dueño; sin search_path fijo,',
      'quien la llama puede anteponer un esquema propio y hacerle resolver sus objetos.',
      'Regla 4 de §Estructura BD: SET search_path = public, extensions.',
    ],
  },
  'jsonb-agg': {
    escape: 'jsonb-agg',
    titulo: '`jsonb_agg` en una función que devuelve json/jsonb',
    detalle: [
      'Patrón C de CLAUDE.md: jsonb construye el valor binario completo en memoria y',
      'spillea a disco. get_stock_analysis_jsonb (4,226 filas / 4.6 MB): jsonb_agg =',
      '1,963 ms con temp spill; json_agg = 402 ms. Usar json_agg(to_json(t)) con RETURNS',
      'json. Si el agregado es chico (un puñado de filas), declararlo con el escape.',
    ],
  },
  'policy-abierta': {
    escape: 'policy-abierta',
    titulo: 'policy de escritura con condición `true`',
    detalle: [
      'USING (true) en UPDATE/DELETE y WITH CHECK (true) en INSERT están prohibidos',
      '(§Estructura BD regla 3). Por el INSERT se colaron attendance y audit_logs: se',
      'podía fabricar una marcación y firmar la bitácora con otro nombre. Usar',
      "(SELECT auth_can_edit_any(ARRAY['modulo'])) o decir de quién es la fila.",
      'Sólo `TO service_role` queda fuera: salta el RLS de todos modos.',
    ],
  },
};

// Quita comentarios. Las cadenas con `--` adentro son raras en migraciones y el
// costo de equivocarse es un falso negativo, no un falso positivo.
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, '');

// Separa los cuerpos de función (`AS $$ … $$`) del SQL de nivel superior. Los
// bloques `DO $$ … $$` se dejan EN LÍNEA: ahí adentro se crean policies y se
// hace DDL que corre al aplicar la migración, igual que si estuviera afuera. Un
// cuerpo de función, en cambio, corre cuando alguien la llama — un `ALTER TABLE`
// ahí adentro no toma ningún lock al aplicarla.
function separarCuerpos(texto) {
  const cuerpos = [];
  const arriba = texto.replace(/\$([A-Za-z_]\w*)?\$([\s\S]*?)\$\1\$/g, (m, _tag, cuerpo, idx) => {
    const antes = texto.slice(Math.max(0, idx - 12), idx);
    if (/\bDO\s*$/i.test(antes)) return ` ${cuerpo} `;
    cuerpos.push(cuerpo);
    return `$$#${cuerpos.length - 1}$$`;
  });
  return { arriba, cuerpos };
}

const DDL = /\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+(?:UNIQUE\s+)?(?:MATERIALIZED\s+)?(?:TABLE|INDEX|POLICY|TRIGGER|FUNCTION|VIEW|TYPE|SEQUENCE)\b/i;
const AUTH_LLAMADA = /(?:\bpublic\.)?\bauth_\w+\s*\(|\bauth\.(?:uid|jwt|role|email)\s*\(/gi;

// ¿La posición `idx` está dentro de un `(SELECT …)` escalar? Ése es el wrapper
// que vuelve la llamada un initplan. No alcanza con mirar lo inmediatamente
// anterior: `USING ((SELECT EXISTS (SELECT 1 FROM unnest(…) m WHERE
// auth_has_module_permission(m, …))))` (cerrar_lectura_inventario, 2026-09-23)
// está bien —el SELECT de afuera no depende de la fila— y la primera versión
// de esta regla la acusaba. Un `EXISTS (SELECT …)` / `IN (SELECT …)` a secas,
// en cambio, NO cuenta: puede estar correlacionado con la fila.
function dentroDeSubconsultaEscalar(sent, idx) {
  const abiertos = [];
  for (let i = 0; i < idx; i++) {
    if (sent[i] === '(') abiertos.push(i);
    else if (sent[i] === ')') abiertos.pop();
  }
  return abiertos.some(p =>
    /^\(\s*SELECT\b/i.test(sent.slice(p, p + 16)) &&
    !/\b(?:EXISTS|IN|ANY|ALL)\s*$/i.test(sent.slice(Math.max(0, p - 8), p)));
}

/** Devuelve [{ regla, msg }] para el SQL de UNA migración. Pura: sin disco. */
export function revisarReglas(crudo) {
  const hallazgos = [];
  const escapado = (regla) =>
    new RegExp(`--[ \\t]*${REGLAS[regla].escape}:[ \\t]*\\S`).test(crudo);
  const acusar = (regla, msg) => { if (!escapado(regla)) hallazgos.push({ regla, msg }); };

  const { arriba, cuerpos } = separarCuerpos(sinComentarios(crudo));

  // 1. DDL sin lock_timeout. Se acepta `SET [LOCAL] lock_timeout` y la forma
  //    `set_config('lock_timeout', …)`.
  const ddl = arriba.match(DDL);
  if (ddl && !/\bSET\s+(?:LOCAL\s+)?lock_timeout\b|set_config\s*\(\s*'lock_timeout'/i.test(arriba)) {
    acusar('lock-timeout', `tiene DDL («${ddl[0].replace(/\s+/g, ' ')}») y ningún SET lock_timeout`);
  }

  // 2 y 5. Policies. Se leen sentencia por sentencia: de CREATE/ALTER POLICY
  //    hasta el `;`.
  for (const m of arriba.matchAll(/\b(CREATE|ALTER)\s+POLICY\s+("[^"]+"|\S+)[\s\S]*?(?:;|$)/gi)) {
    const sent = m[0];
    const nombre = m[2];
    for (const a of sent.matchAll(AUTH_LLAMADA)) {
      if (!dentroDeSubconsultaEscalar(sent, a.index)) {
        acusar('auth-por-fila', `policy ${nombre}: «${a[0].replace(/\s+/g, '')}…» sin (SELECT …)`);
      }
    }
    const roles = (sent.match(/\bTO\s+([\w\s,"]+?)(?=\s+(?:USING|WITH)\b|\s*;|$)/i) || [])[1] || 'public';
    const soloServicio = roles.split(',').every(r => r.trim().replace(/"/g, '') === 'service_role');
    if (soloServicio) continue;
    const comando = ((sent.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i) || [])[1] || 'ALL').toUpperCase();
    const usingTrue = /\bUSING\s*\(+\s*true\s*\)+/i.test(sent);
    const checkTrue = /\bWITH\s+CHECK\s*\(+\s*true\s*\)+/i.test(sent);
    const tieneCheck = /\bWITH\s+CHECK\b/i.test(sent);
    if (['UPDATE', 'DELETE', 'ALL'].includes(comando) && usingTrue) {
      acusar('policy-abierta', `policy ${nombre} (FOR ${comando}): USING (true)`);
    } else if (['INSERT', 'UPDATE', 'ALL'].includes(comando) && checkTrue) {
      acusar('policy-abierta', `policy ${nombre} (FOR ${comando}): WITH CHECK (true)`);
    } else if (comando === 'ALL' && usingTrue && !tieneCheck) {
      acusar('policy-abierta', `policy ${nombre} (FOR ALL): USING (true) vale también como WITH CHECK`);
    }
  }

  // 3 y 4. Funciones: el encabezado y las opciones quedan en `arriba`, el
  //    cuerpo en `cuerpos[n]`.
  for (const m of arriba.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:\w+\.)?"?\w+"?)[\s\S]*?(?:;|$)/gi)) {
    const sent = m[0];
    const fn = m[1].replace(/^public\./, '').replace(/"/g, '');
    if (/\bSECURITY\s+DEFINER\b/i.test(sent) && !/\bSET\s+search_path\b/i.test(sent)) {
      // Lo arregla también un ALTER FUNCTION … SET search_path en el mismo archivo.
      const alter = new RegExp(`ALTER\\s+FUNCTION\\s+(?:public\\.)?"?${fn}"?\\b[^;]*\\bSET\\s+search_path`, 'i');
      if (!alter.test(arriba)) acusar('definer-sin-search-path', `${fn}()`);
    }
    if (/\bRETURNS\s+jsonb?\b(?!\s*\[)/i.test(sent)) {
      const cuerpo = [...sent.matchAll(/\$\$#(\d+)\$\$/g)].map(c => cuerpos[+c[1]]).join('\n');
      if (/\bjsonb_agg\s*\(/i.test(sinComentarios(cuerpo))) acusar('jsonb-agg', `${fn}()`);
    }
  }
  return hallazgos;
}

// ── `--revisar <archivo.sql>…`: un borrador, antes de aplicarlo ───────────────
if (process.argv.includes('--revisar')) {
  const archivos = process.argv.slice(process.argv.indexOf('--revisar') + 1).filter(a => !a.startsWith('--'));
  let total = 0;
  for (const a of archivos) {
    for (const h of revisarReglas(readFileSync(a, 'utf8'))) {
      total++;
      console.log(`  • ${a}: ${REGLAS[h.regla].titulo} — ${h.msg}`);
      for (const l of REGLAS[h.regla].detalle) console.log(`      ${l}`);
      console.log(`      Si es legítimo: \`-- ${REGLAS[h.regla].escape}: <motivo>\` en el archivo.\n`);
    }
  }
  console.log(total ? `\n  ✗ ${total} hallazgo(s) en ${archivos.length} archivo(s).\n`
                    : `\n  ✓ ${archivos.length} archivo(s) cumplen las reglas de migración.\n`);
  process.exit(total ? 1 : 0);
}

// ── `--deuda [N]`: cuánto de lo YA aplicado no cumple (no falla nunca) ─────────
// Para saber el tamaño de lo que el corte deja afuera. Cuenta archivos, no
// hallazgos: una migración con diez policies abiertas es UNA migración a revisar.
if (process.argv.includes('--deuda')) {
  const n = Number(process.argv[process.argv.indexOf('--deuda') + 1]) || 60;
  const ultimas = readdirSync(DIR).filter(f => NOMBRE.test(f)).sort().slice(-n);
  const porRegla = Object.fromEntries(Object.keys(REGLAS).map(r => [r, []]));
  for (const f of ultimas) {
    const reglas = new Set(revisarReglas(readFileSync(`${DIR}/${f}`, 'utf8')).map(h => h.regla));
    for (const r of reglas) porRegla[r].push(f);
  }
  console.log(`\n  Deuda en las últimas ${ultimas.length} migraciones (${ultimas[0]} → ${ultimas.at(-1)}):\n`);
  for (const [r, fs] of Object.entries(porRegla)) {
    console.log(`  ${String(fs.length).padStart(3)}  ${REGLAS[r].titulo}`);
    if (process.argv.includes('--detalle')) for (const f of fs) console.log(`         ${f}`);
  }
  console.log('');
  process.exit(0);
}

const errores = [];
const err = (msg, detalle) => errores.push({ msg, detalle });

// ── Un timestamp de 14 dígitos que no sea una fecha real casi siempre es un
//    `YYYYMMDD_nombre` al que alguien le pegó ceros, no una versión del servidor.
const timestampValido = (v) => {
  const [mes, dia, hora, min, seg] = [4, 6, 8, 10, 12].map(i => +v.slice(i, i + 2));
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && hora < 24 && min < 60 && seg < 60;
};

// `--hook`: solo los .sql que el ÍNDICE de git conoce. Mismo motivo que en
// data-gate (2026-08-01): con 2-3 sesiones sobre el mismo árbol, un borrador de
// migración sin commitear de OTRA sesión hacía fallar el commit de ésta —
// nombre inválido, versión que no es timestamp, duplicada— señalando un archivo
// que quien commitea nunca tocó. El índice incluye lo que este commit prepara
// (`git commit -o` prepara antes del hook) y excluye lo ajeno sin commitear.
// En modo manual se sigue viendo todo, que es lo que se quiere al auditar.
const soloIndexado = process.argv.includes('--hook');
const indexados = soloIndexado
  ? new Set(
      execFileSync('git', ['ls-files', '--', 'supabase/migrations', 'supabase/migrations-legacy'], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean)
        .map(p => p.slice(p.lastIndexOf('/') + 1)),
    )
  : null;

const sqls = (dir) => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.sql'))
      .map(e => e.name)
      .filter(n => !indexados || indexados.has(n))
  : null;

// ── 1. Los dos directorios existen ──────────────────────────────────────────────
const locales = sqls(DIR);
if (!locales) {
  console.error(`\n  ✗ No existe ${DIR}/.\n`);
  process.exit(1);
}
if (!existsSync(LEGACY)) {
  err(`No existe ${LEGACY}/`,
    ['El baseline solo es fiel si la historia pre-baseline está archivada ahí.',
     'Si desapareció, la arquitectura de C2 se deshizo — ver PLAN-SUPABASE-CIERRE.md.']);
}

// ── 2. Nombres: siempre <versión-de-14-dígitos>_<nombre>.sql ────────────────────
const versiones = new Map(); // versión → archivo
for (const archivo of locales.sort()) {
  const m = archivo.match(NOMBRE);
  if (!m) {
    err(`Nombre inválido: ${archivo}`,
      ['El formato es <versión>_<nombre>.sql, con la versión de 14 dígitos que asignó',
       'el servidor (la devuelve `apply_migration`, o `select max(version) from',
       'supabase_migrations.schema_migrations`). El viejo `YYYYMMDD_nombre.sql` de 8',
       'dígitos es lo que produjo la deriva: no se corresponde con ninguna fila real.']);
    continue;
  }
  const [, version] = m;
  if (!timestampValido(version)) {
    err(`Versión que no es un timestamp real: ${archivo}`,
      ['Los 14 dígitos son YYYYMMDDHHMMSS. Un `YYYYMMDD` rellenado con ceros no es',
       'la versión que asignó el servidor.']);
  }
  if (versiones.has(version)) {
    err(`Versión duplicada ${version}`, [`${versiones.get(version)} y ${archivo}`]);
  }
  versiones.set(version, archivo);
}

// ── 2b. «¿Cuenta como venta?» no se escribe a mano (U2, 2026-09-26) ──────────────
//
// Desde U2 la base contesta esa pregunta UNA vez: `public.venta_valida(estado)`
// y `public.venta_fiscal(estado, recibido_mh)`. Unas cien funciones escribían
// su propio filtro con tres redacciones que coincidían por casualidad.
//
// La regla vive en el PRE-COMMIT y no sólo en un gate contra producción por
// lo que pasó el mismo día que se migró: otra sesión aplicó su copia de
// `puntos_panel_serie` 38 segundos después y el filtro a mano volvió solo. Un
// chequeo remoto se entera después; éste, antes de que el archivo entre.
//
// Mira sólo migraciones POSTERIORES a U2 (las anteriores son historia) y sin
// comentarios. Lo legítimo —el circuito de Hacienda pregunta «¿está anulada?»,
// no «¿cuenta como venta?»— se declara en el archivo con
// `-- venta-a-mano: <motivo>`.
const CORTE_U2 = '20260926151127';
const VENTA_A_MANO = [
  /estado\s+not\s+in\s*\(\s*'(?:NULA|DTE INVALIDADO EN MH)'/i,
  /(?<![\w.'])(?<![Ss][Ee][Tt]\s)(?:\w+\.)?estado\s*=\s*'FINALIZADA'/,
];
for (const archivo of locales) {
  const m = archivo.match(NOMBRE);
  if (!m || m[1] <= CORTE_U2) continue;
  const crudo = readFileSync(`${DIR}/${archivo}`, 'utf8');
  if (/--\s*venta-a-mano:\s*\S/.test(crudo)) continue;
  const texto = crudo.replace(/--.*$/gm, '');
  const hallado = VENTA_A_MANO.map(r => texto.match(r)).find(Boolean);
  if (hallado) {
    err(`Filtro de venta escrito a mano en ${archivo}: «${hallado[0]}»`,
      ['Usar `public.venta_valida(si.estado)` (lo que se vendió) o',
       '`public.venta_fiscal(si.estado, si.recibido_mh)` (lo que entra al libro).',
       'Si de verdad la pregunta es otra (¿está anulada?), declararlo en el archivo con',
       '`-- venta-a-mano: <motivo>`. Ver docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md §E2.']);
  }
}

// ── 2c. Reglas obligatorias de CLAUDE.md (2026-11-06) ────────────────────────
// Ver `revisarReglas` arriba. Sólo lo posterior a CORTE_REGLAS; la deuda vieja
// se mide con `--deuda`, no se acusa.
for (const archivo of locales) {
  const m = archivo.match(NOMBRE);
  if (!m || m[1] <= CORTE_REGLAS) continue;
  for (const h of revisarReglas(readFileSync(`${DIR}/${archivo}`, 'utf8'))) {
    err(`${archivo}: ${REGLAS[h.regla].titulo} — ${h.msg}`,
      [...REGLAS[h.regla].detalle,
       `Si es legítimo, declararlo en el archivo: \`-- ${REGLAS[h.regla].escape}: <motivo>\`.`]);
  }
}

// ── 3. El baseline: exactamente uno, y ordena primero ───────────────────────────
if (!versiones.has(BASELINE)) {
  err(`Falta el baseline ${BASELINE}_baseline_schema.sql`,
    ['Es el único archivo que reproduce el esquema de prod. Sin él, `migrations/`',
     'describe solo lo aplicado después del 2026-07-29.']);
} else if ([...versiones.keys()].some(v => v < BASELINE)) {
  err('Hay una migración con versión anterior al baseline',
    ['El baseline tiene que ser el primero en aplicarse; una versión menor correría antes',
     'de que exista el esquema.']);
}

// ── 4. Todo lo que no es el baseline es post-corte ──────────────────────────────
for (const [version, archivo] of versiones) {
  if (version !== BASELINE && version < CORTE) {
    err(`${archivo} es anterior al corte post-baseline (${CORTE})`,
      ['La historia pre-baseline va en migrations-legacy/: aplicarla sobre el baseline',
       'falla por construcción (espera el esquema de abril, ej. employees.is_admin).']);
  }
}

// ── 5. Que nadie archive una migración nueva por error ──────────────────────────
for (const archivo of sqls(LEGACY) ?? []) {
  const version = (archivo.match(NOMBRE) || [])[1];
  if (version && version >= CORTE) {
    err(`${LEGACY}/${archivo} es post-baseline y está archivado`,
      ['Va en supabase/migrations/. Esto ya pasó una vez: un archivo recién escrito por',
       'otra sesión casi quedó archivado como "historia previa" mientras se creaba.']);
  }
}

// ── 5.bis. `cron.unschedule` sin guarda: rompe la REPRODUCCIÓN ─────────────────
// `cron.unschedule(nombre)` LANZA si el trabajo no existe. En producción existe
// —porque alguien lo creó antes— así que la migración pasa y nadie se entera.
// En una base VACÍA no existe, la migración aborta, y con ella se cae todo lo
// que venía después.
//
// Medido el 2026-08-24 al rehacer el entorno de pruebas: la creación del branch
// replica la historia sobre una base limpia y **se detuvo en la migración 331 de
// 543**. Las 212 restantes no llegaron. El trabajo que faltaba era
// `cortes-caja-1min`, que **ninguna migración crea**: se programó en producción
// a mano y una migración posterior dio por hecho que estaba.
//
// Y no es un problema del entorno de pruebas: es que el historial no se puede
// reproducir, que es exactamente lo que hace falta el día que haya que
// reconstruir la base desde cero.
//
// El patrón correcto ya se usaba en cinco migraciones de este mismo repo:
//
//     SELECT cron.unschedule('x') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'x');
//
// No mira el `PERFORM cron.unschedule(...)` que vive DENTRO del cuerpo de una
// función: eso corre cuando alguien la llama, no cuando se replica el historial.
for (const archivo of locales) {
  const texto = readFileSync(`${DIR}/${archivo}`, 'utf8');
  const sinComentarios = texto.replace(/^\s*--.*$/gm, '');
  for (const m of sinComentarios.matchAll(/\bSELECT\s+cron\.unschedule\s*\(\s*'([^']+)'\s*\)([\s\S]{0,160}?);/g)) {
    const cola = m[2] || '';
    if (/WHERE\s+EXISTS/i.test(cola)) continue;
    err(`${DIR}/${archivo}: cron.unschedule('${m[1]}') sin guarda`,
      ['`cron.unschedule` LANZA si el trabajo no existe. En una base vacía aborta la',
       'migración y todas las que vienen después dejan de aplicarse — el historial',
       'deja de poder reproducirse. Envolvelo:',
       `  SELECT cron.unschedule('${m[1]}') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${m[1]}');`]);
  }
}

// ── 5.ter. Un REVOKE que se olvida de `authenticated` no revoca nada ──────────
// Supabase concede EXECUTE por DEFECTO a `anon, authenticated, service_role`
// sobre toda función nueva. El patrón que usa todo este repo —
//
//     REVOKE EXECUTE ON FUNCTION f(...) FROM PUBLIC, anon;
//     GRANT  EXECUTE ON FUNCTION f(...) TO service_role;
//
// — parece cerrar la función a `service_role` y NO lo hace: `authenticated`
// queda adentro por la puerta de atrás, porque nunca se le quitó.
//
// Medido el 2026-08-24 cruzando lo declarado contra el ACL real de producción:
// **131 funciones tienen EXECUTE para `authenticated` sin que ninguna migración
// se lo conceda**, y 14 son SECURITY DEFINER sin guarda de permiso adentro.
// Entre ésas, `notify_employees` acepta título, cuerpo y `push` arbitrarios
// contra cualquier lista de empleados.
//
// Se descubrió reconstruyendo el módulo fiscal en el entorno de pruebas: ahí
// `calc_credito_declarable` quedó abierta a `authenticated` y en producción la
// ejecuta sólo `service_role`. La diferencia entre las dos bases era la prueba.
//
// ── Se mide el ESTADO FINAL, no cada archivo ───────────────────────────────
// La primera versión acusaba por archivo y daba 28 hallazgos sobre 7 funciones:
// una migración que arregla el permiso no borraba las quejas de las anteriores,
// así que el número no bajaba nunca y no había forma de cerrarlo. Postgres no
// funciona así — gana la última sentencia. Acá también.
//
// Y NO mira las funciones de disparador: una `RETURNS trigger` no se puede
// llamar a mano (sin `NEW` lanza), así que su EXECUTE es irrelevante. Acusarlas
// metía 14 de 28 hallazgos que no eran nada.
{
  const devuelveTrigger = new Set();
  for (const archivo of locales) {
    const t = readFileSync(`${DIR}/${archivo}`, 'utf8');
    for (const m of t.matchAll(/FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\([^)]*\)[\s\S]{0,200}?RETURNS\s+trigger/gi))
      devuelveTrigger.add(m[1]);
  }

  // Estado final por función, recorriendo las migraciones EN ORDEN de versión.
  const estado = new Map();   // fn → { authOk: boolean, archivo: string }
  for (const archivo of [...locales].sort()) {
    const texto = readFileSync(`${DIR}/${archivo}`, 'utf8').replace(/^\s*--.*$/gm, '');
    for (const m of texto.matchAll(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\([^;]*?\)\s*FROM\s+([^;]+);/gis))
      estado.set(m[1], { authOk: /\bauthenticated\b/.test(m[2]), archivo });
    for (const m of texto.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\([^;]*?\)\s*TO\s+([^;]+);/gis))
      if (/\bauthenticated\b/.test(m[2]) && estado.has(m[1]))
        estado.set(m[1], { authOk: true, archivo });   // se le concede a propósito
  }

  for (const [fn, { authOk, archivo }] of [...estado].sort()) {
    if (authOk || devuelveTrigger.has(fn)) continue;
    err(`${fn}(): el REVOKE nunca le quita el EXECUTE a \`authenticated\``,
      [`Última declaración en ${archivo}.`,
       'Supabase se lo concede por defecto, así que revocarle sólo a PUBLIC y anon lo deja adentro.',
       'Si la función no es para el navegador, en una migración nueva:',
       `  REVOKE EXECUTE ON FUNCTION public.${fn}(…) FROM PUBLIC, anon, authenticated;`,
       'Y si SÍ es para el navegador, concedésela explícitamente.']);
  }
}

const post = [...versiones.keys()].filter(v => v !== BASELINE).sort();
console.log(`\n  ${DIR}/: baseline + ${post.length} migración(es) post-baseline`);
console.log(`  ${LEGACY}/: ${(sqls(LEGACY) ?? []).length} archivo(s) de historia pre-baseline`);

// ── 6. Cruce contra el registro de prod (--remote) ──────────────────────────────
let cruceHecho = false;
if (process.argv.includes('--remote')) {
  // El CLI se traga el .env del repo si tiene un nombre de variable con `-` y aborta.
  // Workaround conocido (ver reference_edge_function_deploy_workaround): moverlo.
  const HOLD = '.env.gate-hold';
  const mover = (de, a) => { if (existsSync(de)) renameSync(de, a); };
  const restaurar = () => mover(HOLD, '.env');

  if (existsSync(HOLD) && !existsSync('.env')) {
    console.log(`  ↻ ${HOLD} quedó de una corrida interrumpida; restaurado.`);
    restaurar();
  }

  let filas, preBaseline;
  process.on('exit', restaurar);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restaurar(); process.exit(130); });
  try {
    mover('.env', HOLD);
    const consultar = (sql) => JSON.parse(execFileSync(
      'supabase', ['db', 'query', '--linked', '--agent', 'no', '-o', 'json', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));

    filas = consultar(`select version, name from supabase_migrations.schema_migrations
                       where version = '${BASELINE}' or version >= '${CORTE}' order by version`);

    // Se CUENTAN, no se asumen. Hasta el 2026-08-12 este número era la constante
    // PRE_BASELINE_ESPERADAS (731) impresa a ciegas; ese día las filas legacy se
    // borraron del registro para que `create_branch` pudiera replicar el esquema,
    // y el gate siguió anunciando 731 ignoradas cuando ya no quedaba ninguna. Un
    // gate que reporta un número que no midió miente incluso estando en verde.
    preBaseline = Number(consultar(
      `select count(*) as n from supabase_migrations.schema_migrations
       where version <> '${BASELINE}' and version < '${CORTE}'`)[0]?.n ?? 0);
  } catch (e) {
    // Que el cruce no se pueda hacer es un HALLAZGO, no una nota al pie.
    //
    // Hasta el 2026-08-17 esto imprimía un ⚠ y seguía: `filas` quedaba
    // undefined, el bloque de comparación se salteaba entero y el veredicto de
    // abajo igual anunciaba «✓ Sin deriva» con salida 0. O sea que pedir
    // `--remote` con el CLI deslogueado devolvía la MISMA respuesta que un
    // cruce que sí encontró todo — y «sin deriva» es una afirmación sobre prod,
    // no sobre el disco. Lo levantó otra sesión, cuyo `supabase db query` falló
    // y aun así vio el tilde verde.
    //
    // Es el mismo criterio que ya está escrito veinte líneas más abajo para el
    // conteo pre-baseline: un gate que reporta un número que no midió miente
    // incluso estando en verde. El hook de pre-commit corre `--hook`, no
    // `--remote`, así que fallar acá no bloquea ningún commit: sólo hace que
    // quien pidió el cruce se entere de que no hubo cruce.
    err(`No pude leer el registro de prod: ${e.message.split('\n')[0]}`,
      ['Los chequeos LOCALES de arriba sí corrieron y pasaron; lo que no se hizo es',
       'el cruce contra prod, que es lo único que `--remote` agrega.',
       'Hace falta el CLI de Supabase logueado y el proyecto linkeado:',
       '  supabase login && supabase link --project-ref sacecdkdmsdvgqnrsett',
       'Si sólo querías los chequeos locales, corré `npm run gate:migrations` sin --remote.']);
  } finally {
    restaurar();
  }

  if (filas) {
    cruceHecho = true;
    const remotas = new Map(filas.map(f => [f.version, f.name]));
    const nota = preBaseline === 0
      ? 'sin filas pre-baseline'
      : `+ ${preBaseline} pre-baseline ignoradas`;
    console.log(`  registro de prod: ${remotas.size} fila(s) desde el corte (${nota})`);

    for (const [version, name] of remotas) {
      if (!versiones.has(version)) {
        err(`Aplicada en prod y sin archivo local: ${version}_${name}`,
          ['Ésta es la deriva original: `apply_migration` escribió en el servidor y el',
           'archivo nunca se guardó. Recuperable — el SQL está en la columna `statements`:',
           `  select array_to_string(statements, E';\\n') from supabase_migrations.schema_migrations where version = '${version}';`,
           `Guardarlo como ${DIR}/${version}_${name}.sql.`]);
      }
    }
    for (const [version, archivo] of versiones) {
      if (!remotas.has(version)) {
        err(`Archivo local que no existe en el registro de prod: ${archivo}`,
          ['O la migración no se aplicó todavía, o el archivo se nombró con una versión',
           'inventada en vez de la que asignó el servidor.']);
      }
    }
  }
}

// ── Veredicto ───────────────────────────────────────────────────────────────────
//
// El tilde dice QUÉ se verificó. «Sin deriva» a secas es una afirmación sobre
// prod, y sin el cruce no se puede sostener: el mismo texto para las dos
// corridas es lo que dejó pasar el hueco de arriba durante dos semanas.
if (!errores.length) {
  console.log(cruceHecho
    ? '\n  ✓ Sin deriva: los archivos locales y el registro de prod coinciden.\n'
    : '\n  ✓ Sin deriva local. El cruce contra prod NO se hizo — pedilo con `-- --remote`.\n');
  process.exit(0);
}
console.log(`\n  ✗ ${errores.length} hallazgo(s):\n`);
for (const { msg, detalle } of errores) {
  console.log(`  • ${msg}`);
  for (const linea of detalle) console.log(`      ${linea}`);
  console.log('');
}
process.exit(1);
