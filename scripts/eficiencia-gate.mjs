#!/usr/bin/env node
/**
 * gate:eficiencia — cuánto le pide el portal al sistema de origen, y que eso
 * no crezca sin que nadie lo haya decidido.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * El 2026-08-20 el usuario preguntó si un barrido nuevo no estaría saturando el
 * sistema. Medido, el barrido era **1 disparo en 24 h**. El que pedía de verdad
 * era otro: la vigilancia de los cortes de caja, con **2.863 disparos** y 13
 * peticiones cada uno — unas 25.000 al día. Llevaba semanas corriendo así y
 * nadie lo había mirado con esa pregunta en la mano, porque **no había forma de
 * verlo**: la cadencia de un cron vive en producción, el costo por corrida vive
 * en el código, y nada los juntaba.
 *
 * Este gate los junta. No mide velocidad —eso es `gate:perf`—: mide **volumen y
 * silencio**. Cuántas veces por día el portal toca el sistema de origen, y si
 * algo de eso está fallando sin que nadie se entere.
 *
 * ── Cuatro cosas que este gate SÍ puede afirmar ───────────────────────────────
 *
 * 1. Que ningún cron nuevo apareció sin que su costo quedara declarado.
 * 2. Que ninguna cadencia se apretó en silencio.
 * 3. Que lo declarado sigue vivo en producción — un cron que dejó de existir es
 *    una protección que se apagó sola. `backup-critical-tables` estuvo **17
 *    días sin correr** y lo delató una alerta, no un gate.
 * 4. Que las llamadas salientes están saliendo bien. Un redeploy sin
 *    `--no-verify-jwt` deja al cron contestando 401 **antes de ejecutar una
 *    línea**, y ya pasó tres veces.
 *
 * ── Una cosa que NO puede afirmar, y hay que decirla ──────────────────────────
 *
 * Cuántas peticiones hace cada corrida. Eso sale del código y de cuántas vueltas
 * dé su bucle: no se lee de afuera. Así que se DECLARA, con su motivo escrito, y
 * lo que el gate vigila es que la suma no crezca. Los que todavía no se midieron
 * están anotados como tales y se cuentan aparte: un número que no se midió no se
 * puede sumar a un presupuesto sin mentir. Esa deuda **sólo baja**.
 *
 * Uso:
 *   npm run gate:eficiencia                    todo (necesita red)
 *   npm run gate:eficiencia -- --hook          sólo lo local (para el pre-commit)
 *   npm run gate:eficiencia -- --update-baseline  baja los números a lo medido
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { abrirCanal } from './lib/canal-supabase.mjs';

const BASELINE_FILE = 'scripts/eficiencia-gate-baseline.json';
const SOLO_LOCAL = process.argv.includes('--hook');
const REGENERAR = process.argv.includes('--update-baseline');

/* ── El manifiesto ────────────────────────────────────────────────────────────
 *
 * Un cron por fila, con lo que cuesta CADA corrida en peticiones al sistema de
 * origen. `sistema: 0` no es «no hace nada»: es «no toca el sistema», y para
 * varios eso es cierto sólo mientras no haya trabajo — está dicho en el motivo.
 *
 * `sistema: null` significa SIN MEDIR. No se inventa un número: se cuenta como
 * deuda en su propia línea del baseline y se baja midiendo, no estimando.
 *
 * La cadencia se compara contra producción tal cual: si alguien la aprieta, el
 * gate lo dice con el número viejo y el nuevo a la vista. */
const CRONS = [
  // ── Los que hablan con el sistema en cada corrida ──────────────────────────
  {
    job: 'cortes-caja-30s', slug: 'sync-cortes-caja', cadencia: '30 seconds',
    corridasDia: 1920, sistema: 6,
    motivo: 'Cada 30 s de 7 a 22 SV porque quien corta la caja revisa la diferencia EN EL MOMENTO '
          + 'y rehace el corte; la cadencia es requisito del usuario y no se espacia. '
          + 'Son 6 listados, uno por sala: desde v2.671.1 la sesión de cada sala sobrevive a la '
          + 'corrida, antes eran 13 (un ingreso + un cambio de sala por cada listado).',
  },
  {
    job: 'barrer-traslados-recibidos', slug: 'barrer-traslados-recibidos', cadencia: '0 12-23,0-3 * * *',
    corridasDia: 16, sistema: 13,
    motivo: 'Un ingreso + un cambio de sala y una lectura de cola por cada sala con tarjetas '
          + 'abiertas (6 hoy). Cada hora y no más seguido: lo único que cubre —que alguien reciba '
          + 'un traslado a mano en el sistema— deja el producto YA en la sala, no hay nada trabado.',
  },
  {
    job: 'continuar-traslados-pedido', slug: 'trasladar-pedido-erp', cadencia: '* * * * *',
    corridasDia: 1440, sistema: 0,
    motivo: 'Cada minuto, pero sin corrida en curso contesta NADA_QUE_CONTINUAR mirando SOLO la '
          + 'base: cero peticiones al sistema. Cuando hay un despacho a medias, esa corrida sí '
          + 'trabaja —y es exactamente cuando tiene que hacerlo—.',
  },
  {
    job: 'reintentar-ingreso-pedido', slug: 'trasladar-pedido-erp', cadencia: '*/10 * * * *',
    corridasDia: 144, sistema: 0,
    motivo: 'Igual: `recepciones_por_reintentar` es una consulta a la base y devuelve vacío casi '
          + 'siempre. Sólo toca el sistema cuando hay una recepción que se cortó.',
  },
  {
    job: 'drain-cliente-erp-queue', slug: 'push-cliente-erp', cadencia: '3,13,23,33,43,53 * * * *',
    corridasDia: 144, sistema: null,
    motivo: 'SIN MEDIR. Vacía la cola de fichas de cliente; con la cola vacía no debería tocar el '
          + 'sistema, pero no está comprobado.',
  },
  {
    job: 'sync-dte-inv-all-1min', slug: 'sync-dte-sales', cadencia: '* 12-23,0-5 * * *',
    corridasDia: 1080, sistema: null,
    motivo: 'SIN MEDIR, y es el segundo candidato después de los cortes: cada minuto, 18 h al día, '
          + 'recorriendo sucursales para ventas e inventario.',
  },
  {
    job: 'refresh-inv-mv-2min', slug: 'sync-dte-sales', cadencia: '*/2 12-23,0-5 * * *',
    corridasDia: 540, sistema: null, motivo: 'SIN MEDIR.',
  },
  {
    job: 'dte-resync-mes-hora', slug: 'sync-dte-sales', cadencia: '0 12-23,0-5 * * *',
    corridasDia: 18, sistema: null, motivo: 'SIN MEDIR.',
  },
  {
    job: 'sync-products-10min', slug: 'sync-products', cadencia: '*/10 * * * *',
    corridasDia: 144, sistema: null, motivo: 'SIN MEDIR.',
  },
  {
    job: 'sync-purchases-10min', slug: 'sync-erp-purchases', cadencia: '*/10 * * * *',
    corridasDia: 144, sistema: null, motivo: 'SIN MEDIR.',
  },
  {
    job: 'check-sales-alerts-5min', slug: 'check-sales-alerts', cadencia: '*/5 12-23,0-5 * * *',
    corridasDia: 216, sistema: 0, motivo: 'Mira la base, no el sistema.',
  },
  {
    job: 'check-sync-health-alerts-20min', slug: 'check-sync-health-alerts', cadencia: '*/20 12-23,0-5 * * *',
    corridasDia: 54, sistema: 0, motivo: 'Mira la base, no el sistema.',
  },
  // ── Los diarios, semanales y mensuales ─────────────────────────────────────
  // Su volumen es irrelevante para el presupuesto (una corrida por día o menos),
  // pero están declarados igual: lo que el gate cuida en ellos es que SIGAN
  // EXISTIENDO y que no fallen en silencio.
  { job: 'sincronizar-fichas-clientes-2130-sv', slug: 'sincronizar-fichas-clientes', cadencia: '30 3 * * *', corridasDia: 1, sistema: null, motivo: 'Corrida nocturna de fichas.' },
  { job: 'regularizar-dte-2230-sv',             slug: 'regularizar-dte',             cadencia: '30 4 * * *', corridasDia: 1, sistema: null, motivo: 'Envío nocturno a Hacienda.' },
  { job: 'cortes-caja-repaso-diario',           slug: 'sync-cortes-caja',            cadencia: '40 5 * * *', corridasDia: 1, sistema: null, motivo: 'Repaso del día, con movimientos forzados.' },
  { job: 'sync-numero-control-daily',           slug: 'sync-numero-control',         cadencia: '0 7 * * *',  corridasDia: 1, sistema: null, motivo: 'Repaso diario.' },
  { job: 'check-purchases-reconciliation-daily', slug: 'check-purchases-reconciliation', cadencia: '20 7 * * *', corridasDia: 1, sistema: null, motivo: 'Cuadre diario de compras.' },
  { job: 'check-sales-reconciliation-daily',    slug: 'check-sales-reconciliation',  cadencia: '30 7 * * *', corridasDia: 1, sistema: null, motivo: 'Cuadre diario de ventas.' },
  { job: 'consolidate-timesheets-daily',        slug: 'consolidate-timesheets',      cadencia: '0 8 * * *',  corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'sync-purchase-emails-daily',          slug: 'sync-purchase-emails',        cadencia: '0 9 * * *',  corridasDia: 1, sistema: 0, motivo: 'Lee correo, no el sistema.' },
  { job: 'apply-scheduled-employee-events-daily', slug: 'apply-scheduled-employee-events', cadencia: '0 11 * * *', corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'check-doc-expiry-daily',              slug: 'check-doc-expiry',            cadencia: '0 13 * * *', corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'check-employee-doc-expiry-daily',     slug: 'check-employee-doc-expiry',   cadencia: '30 13 * * *', corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'notify-new-products-daily',           slug: 'notify-new-products-daily',   cadencia: '0 14 * * 1-6', corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'ccf-repaso-22h-sv',                   slug: 'check-sales-alerts',          cadencia: '0 4 * * *',  corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'heal-dte-sync',                       slug: 'heal-dte-sync',               cadencia: '0 */2 * * *', corridasDia: 12, sistema: null, motivo: 'SIN MEDIR. Repara huecos del sync.' },
  { job: 'backup-critical-tables-weekly',       slug: 'backup-critical-tables',      cadencia: '0 8 * * 0',  corridasDia: 0, sistema: 0, motivo: 'Semanal. Ya estuvo 17 días muerto sin que nadie lo viera.' },
  { job: 'auto-copy-weekly-roster',             slug: 'auto-copy-weekly-roster',     cadencia: '0 16 * * 6', corridasDia: 0, sistema: 0, motivo: 'Semanal.' },
  { job: 'auto-copy-roster-saturday',           slug: 'auto-copy-weekly-roster',     cadencia: '0 6 * * 6',  corridasDia: 0, sistema: 0, motivo: 'Semanal.' },
  { job: 'purchases-fastbackfill-semanal',      slug: 'sync-erp-purchases',          cadencia: '0 9 * * 0',  corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Semanal.' },
  { job: 'auto-calculate-minmax-monthly',       slug: 'auto-calculate-minmax',       cadencia: '0 9 1 * *',  corridasDia: 0, sistema: 0, motivo: 'Mensual, sólo base.' },
  { job: 'corte-z-mensual',                     slug: 'sync-corte-z',                cadencia: '0 9 1 * *',  corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual.' },
  { job: 'dte-resync-month-popular', slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud1',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud2',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud3',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud4',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud5',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
];

/* Los crons que NO invocan una edge function quedan fuera a propósito: no le
 * piden nada al sistema de origen, y vigilarlos es trabajo de otro gate. */

// ── Utilidades ───────────────────────────────────────────────────────────────
const rojo  = (s) => `\x1b[31m${s}\x1b[0m`;
const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const gris  = (s) => `\x1b[90m${s}\x1b[0m`;

function archivosTs(dir) {
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|jsx)$/.test(p)) out.push(p);
    }
  })(dir);
  return out;
}

/* `fetch(` sin plazo.
 *
 * Una edge function vive 150 s (400 en el plan actual). Un `fetch` sin
 * `AbortSignal.timeout` que quede colgado se lleva TODO ese presupuesto y la
 * corrida muere sin hacer su trabajo — y como el cron no espera la respuesta,
 * muere en silencio. Se cuenta por llamada, con el paréntesis balanceado para
 * no confundir el `signal` de la llamada de al lado. */
function fetchsSinPlazo() {
  const hallazgos = [];
  for (const f of archivosTs('supabase/functions').filter(f => f.endsWith('.ts'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bfetch\s*\(/g)) {
      let i = m.index + m[0].length, prof = 1;
      while (i < s.length && prof > 0) {
        const c = s[i];
        if (c === '(') prof++; else if (c === ')') prof--;
        i++;
      }
      const llamada = s.slice(m.index, i);
      if (!/AbortSignal\s*\.\s*timeout/.test(llamada))
        hallazgos.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
    }
  }
  return hallazgos;
}

/* Sondeos desde el navegador.
 *
 * El otro lado de la carga: no lo que el portal le pide al sistema de origen,
 * sino lo que le pide a su propia base **una vez por cada pantalla abierta**.
 * Un `setInterval` de 10 s en una vista que alguien deja abierta toda la mañana
 * son ~3.600 consultas por pestaña, y no aparecen en ningún cron.
 *
 * Se cuentan sólo los que tocan la red: un intervalo que hace avanzar un reloj
 * en pantalla no le cuesta nada a nadie. El período se imprime para poder
 * juzgarlos, pero lo que el gate vigila es que no aparezcan más. */
function sondeosDelNavegador() {
  const hallazgos = [];
  for (const f of archivosTs('src')) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/setInterval\s*\(/g)) {
      let i = m.index + m[0].length, prof = 1;
      while (i < s.length && prof > 0) {
        const c = s[i];
        if (c === '(') prof++; else if (c === ')') prof--;
        i++;
      }
      const llamada = s.slice(m.index, i);
      if (!/supabase|fetch\(|fetch[A-Z]|refetch|recargar|cargar[A-Z]|load[A-Z]|invoke\(/.test(llamada)) continue;
      const ms = llamada.match(/,\s*([0-9_*\s]+)\)\s*$/);
      hallazgos.push({
        sitio: `${f}:${s.slice(0, m.index).split('\n').length}`,
        cada: ms ? ms[1].trim() : 'no literal',
      });
    }
  }
  return hallazgos;
}

/* Qué funciones hablan con el sistema de origen. Sale del código —su host o los
 * módulos compartidos que lo envuelven—, no de una lista a mano: una lista a
 * mano se desincroniza el día que alguien escribe una función nueva. */
function funcionesQueTocanElSistema() {
  const out = new Set();
  for (const f of archivosTs('supabase/functions')) {
    const slug = f.split('/')[2];
    const s = readFileSync(f, 'utf8');
    if (/clientesdte3\.oss\.com\.sv|_shared\/erp-/.test(s)) out.add(slug);
  }
  return out;
}

/* Una clave que falta vale INFINITO, no `undefined`.
 *
 * Se llenó sola en la primera corrida con un chequeo nuevo: `Math.min(8,
 * undefined)` es NaN, el baseline quedó con `null` y a la corrida siguiente
 * TODO era mayor que `null`, o sea rojo permanente por un chequeo que estaba
 * bien. Un tope que no existe todavía tiene que dejar pasar y anotarse, no
 * bloquear. */
const TOPES = ['peticionesDia', 'fetchSinPlazo', 'cronsSinMedir', 'sondeosNavegador'];
const guardado = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const baseline = Object.fromEntries(TOPES.map(k =>
  [k, Number.isFinite(guardado[k]) ? guardado[k] : Infinity]));

const fallos = [];
const avisos = [];
const medido = {};

// ══ SECCIÓN A · Local, sin red ═══════════════════════════════════════════════
console.log('\n  \x1b[1mA · Lo que se puede ver sin salir a la red\x1b[0m\n');

// A1 · El presupuesto declarado
const conNumero = CRONS.filter(c => c.sistema !== null);
const sinMedir  = CRONS.filter(c => c.sistema === null);
const peticionesDia = conNumero.reduce((n, c) => n + c.corridasDia * c.sistema, 0);
medido.peticionesDia = peticionesDia;
medido.cronsSinMedir = sinMedir.length;

const topeP = baseline.peticionesDia;
console.log(`  peticiones al sistema por día (declaradas): ${peticionesDia.toLocaleString('es')} (tope ${Number(topeP).toLocaleString('es')})`);
for (const c of [...conNumero].filter(c => c.sistema > 0).sort((a, b) => b.corridasDia * b.sistema - a.corridasDia * a.sistema))
  console.log(gris(`      ${String(c.corridasDia * c.sistema).padStart(6)}  ${c.job} — ${c.corridasDia} corridas × ${c.sistema}`));
if (peticionesDia > topeP)
  fallos.push(`el presupuesto de peticiones subió: ${peticionesDia} contra ${topeP}. `
            + 'Si es una cadencia nueva o un costo nuevo, hay que decidirlo, no absorberlo.');

console.log(`\n  crons sin medir su costo: ${sinMedir.length} (tope ${baseline.cronsSinMedir})`);
for (const c of sinMedir) console.log(gris(`      ${c.job} → ${c.slug}`));
if (sinMedir.length > baseline.cronsSinMedir)
  fallos.push(`hay ${sinMedir.length} crons sin medir y el tope es ${baseline.cronsSinMedir}. `
            + 'Un cron nuevo se mide antes de entrar, no después.');

// A2 · `fetch` sin plazo
const sinPlazo = fetchsSinPlazo();
medido.fetchSinPlazo = sinPlazo.length;
console.log(`\n  fetch sin AbortSignal.timeout: ${sinPlazo.length} (tope ${baseline.fetchSinPlazo})`);
for (const h of sinPlazo.slice(0, 8)) console.log(gris(`      ${h}`));
if (sinPlazo.length > 8) console.log(gris(`      … y ${sinPlazo.length - 8} más`));
if (sinPlazo.length > baseline.fetchSinPlazo)
  fallos.push(`hay ${sinPlazo.length} fetch sin plazo y el tope es ${baseline.fetchSinPlazo}. `
            + 'Uno colgado se lleva la corrida entera, y en un cron eso muere en silencio.');

// A4 · Sondeos desde el navegador
const sondeos = sondeosDelNavegador();
medido.sondeosNavegador = sondeos.length;
console.log(`\n  sondeos con red desde el navegador: ${sondeos.length} (tope ${baseline.sondeosNavegador})`);
for (const h of [...sondeos].sort((a, b) => String(a.cada).length - String(b.cada).length))
  console.log(gris(`      cada ${String(h.cada).padStart(9)}  ${h.sitio}`));
if (sondeos.length > baseline.sondeosNavegador)
  fallos.push(`hay ${sondeos.length} sondeos con red en el navegador y el tope es ${baseline.sondeosNavegador}. `
            + 'Cada uno corre una vez por pestaña abierta: no aparece en ningún cron y se multiplica por gente.');

// A3 · Todo cron declarado apunta a una función que existe, y el manifiesto
// sabe cuáles hablan con el sistema.
const enDisco = new Set(readdirSync('supabase/functions', { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name));
const tocan = funcionesQueTocanElSistema();
for (const c of CRONS) {
  if (!enDisco.has(c.slug))
    fallos.push(`el cron ${c.job} apunta a «${c.slug}», que no existe en supabase/functions/. `
              + 'Un slug mal escrito no da error: el cron dispara al vacío para siempre.');
  // `sistema: 0` sobre una función que SÍ sabe hablar con el sistema es casi
  // siempre cierto —lo toca sólo cuando hay trabajo— pero es justo el número
  // que uno pondría por descuido. Se exige que el motivo se haga cargo.
  if (c.sistema === 0 && tocan.has(c.slug) && !/sistema/i.test(c.motivo))
    avisos.push(`${c.job} declara que no toca el sistema, pero ${c.slug} sí lo hace en el código, `
              + 'y el motivo no lo explica.');
}

// ══ SECCIÓN B · Contra producción ════════════════════════════════════════════
if (!SOLO_LOCAL) {
  console.log('\n  \x1b[1mB · Lo que sólo sabe producción\x1b[0m\n');
  let canal;
  try {
    canal = abrirCanal('eficiencia-gate');
    const crons = canal.consultar(`
      SELECT j.jobname, j.schedule, j.active,
             substring(j.command from 'functions/v1/([a-z0-9-]+)') AS slug,
             (SELECT count(*) FROM cron.job_run_details d
               WHERE d.jobid = j.jobid AND d.start_time > now() - interval '24 hours') AS corridas,
             (SELECT count(*) FROM cron.job_run_details d
               WHERE d.jobid = j.jobid AND d.start_time > now() - interval '24 hours'
                 AND d.status <> 'succeeded') AS fallidas,
             (SELECT left(d.return_message, 90) FROM cron.job_run_details d
               WHERE d.jobid = j.jobid AND d.start_time > now() - interval '24 hours'
                 AND d.status <> 'succeeded'
               ORDER BY d.start_time DESC LIMIT 1) AS ultimo_fallo
        FROM cron.job j
       WHERE j.command ILIKE '%functions/v1/%'`);

    const salientes = canal.consultar(`
      SELECT count(*) FILTER (WHERE status_code IS DISTINCT FROM 200) AS no_ok,
             count(*) FILTER (WHERE timed_out) AS colgadas,
             count(*) AS total,
             min(created)::text AS desde
        FROM net._http_response WHERE created > now() - interval '24 hours'`);

    const porNombre = new Map(crons.map(c => [c.jobname, c]));
    const declarados = new Set(CRONS.map(c => c.job));

    // B1 · Un cron que nadie declaró
    for (const c of crons) {
      if (!c.active) continue;
      if (!declarados.has(c.jobname))
        fallos.push(`el cron ${c.jobname} (${c.schedule} → ${c.slug}) está activo y NO está en el manifiesto. `
                  + 'Su costo no lo está mirando nadie.');
    }

    // B2 · Cadencia y existencia de lo declarado
    for (const d of CRONS) {
      const p = porNombre.get(d.job);
      if (!p || !p.active) {
        fallos.push(`el cron ${d.job} está declarado y NO está activo en producción. `
                  + 'Una protección que se apagó sola no avisa: hay que decidir si vuelve o se borra del manifiesto.');
        continue;
      }
      if (p.schedule !== d.cadencia)
        fallos.push(`el cron ${d.job} cambió de cadencia: declarada «${d.cadencia}», en producción «${p.schedule}». `
                  + 'Si el cambio es a propósito, el manifiesto y su motivo se actualizan en el mismo commit.');
      /* ── Fallar por una tasa, no por un tropiezo ────────────────────────
       *
       * La primera corrida de este gate se puso roja por 4 corridas fallidas, y
       * las 4 eran `job startup timeout` en dos minutos de la tarde anterior,
       * repartidas entre crons distintos: el planificador no pudo arrancar el
       * trabajo, nada que ver con el trabajo en sí. Sobre 2.863 corridas eso es
       * 0,07%.
       *
       * Un gate que se pone rojo por eso es un gate que alguien va a empezar a
       * saltear —y entonces deja de proteger justo cuando importe—. Lo que sí
       * tiene que ser rojo es lo SOSTENIDO: una función que quedó con el JWT
       * puesto falla el 100% de las veces, no el 0,07%. */
      const tasa = Number(p.corridas) ? Number(p.fallidas) / Number(p.corridas) : 0;
      if (Number(p.fallidas) > 0 && tasa > 0.05)
        fallos.push(`el cron ${d.job} falló en ${p.fallidas} de ${p.corridas} corridas `
                  + `(${(tasa * 100).toFixed(1)}%): ${p.ultimo_fallo ?? 'sin mensaje'}`);
      else if (Number(p.fallidas) > 0)
        avisos.push(`${d.job}: ${p.fallidas} de ${p.corridas} corridas fallidas `
                  + `(${(tasa * 100).toFixed(2)}%, por debajo del 5% que pone esto en rojo) — ${p.ultimo_fallo ?? 'sin mensaje'}`);
      // Un cron que debería haber corrido y no corrió ni una vez.
      if (d.corridasDia >= 24 && Number(p.corridas) === 0)
        fallos.push(`el cron ${d.job} no corrió NI UNA VEZ en 24 h y debería correr ~${d.corridasDia}. `
                  + 'El silencio no es éxito.');
    }

    // B3 · Las llamadas salientes
    const s = salientes[0] ?? {};
    console.log(`  llamadas salientes en la ventana que guarda la base: ${Number(s.total ?? 0).toLocaleString('es')} `
              + gris(`(desde ${s.desde ?? '?'})`));
    console.log(`      distintas de 200: ${s.no_ok ?? '?'} · colgadas por plazo: ${s.colgadas ?? '?'}`);
    if (Number(s.no_ok ?? 0) > 0)
      fallos.push(`hay ${s.no_ok} llamada(s) saliente(s) que no contestaron 200. `
                + 'Un 401 acá significa que una función volvió a quedar con verify_jwt y el cron '
                + 'está fallando ANTES de ejecutar una línea — ya pasó tres veces.');
    if (Number(s.colgadas ?? 0) > 0)
      fallos.push(`hay ${s.colgadas} llamada(s) saliente(s) que se colgaron hasta el plazo.`);

    // Cuánto se disparó de verdad, contra lo declarado.
    /* Los disparos REALES incluyen los que la condición horaria del propio cron
     * descarta sin llamar a nadie —`cortes-caja-30s` dispara 2.864 veces y sólo
     * ~1.920 caen dentro de su ventana de 7 a 22—, así que los dos números no
     * tienen por qué coincidir. Se imprimen juntos igual: la diferencia entre
     * ellos ES la ventana, y verla de vez en cuando evita creer que un cron
     * corre menos de lo que corre. */
    console.log('\n  disparos reales en 24 h contra las corridas declaradas (útiles):');
    for (const d of [...CRONS].sort((a, b) => b.corridasDia - a.corridasDia).slice(0, 6)) {
      const p = porNombre.get(d.job);
      if (p) console.log(gris(`      ${String(p.corridas).padStart(5)} reales · ${String(d.corridasDia).padStart(5)} declaradas  ${d.job}`));
    }
  } catch (e) {
    fallos.push(`no se pudo consultar producción: ${e.message}${e.detalleCli ? `\n${e.detalleCli}` : ''}`);
  } finally {
    canal?.cerrar();
  }
}

// ══ Cierre ═══════════════════════════════════════════════════════════════════
if (REGENERAR) {
  const nuevo = {
    ...Object.fromEntries(TOPES.map(k => [k, Math.min(medido[k], baseline[k])])),
    nota: 'Sólo BAJA. Un número que sube es una decisión, y una decisión se escribe en el manifiesto '
        + 'con su motivo — no se absorbe regenerando este archivo.',
    actualizado: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(nuevo, null, 2) + '\n');
  console.log(`\n  baseline actualizado: ${JSON.stringify({ ...nuevo, nota: undefined })}`);
}

if (avisos.length) {
  console.log('\n  \x1b[33m⚠ Para mirar\x1b[0m');
  for (const a of avisos) console.log(`      · ${a}`);
}

if (fallos.length) {
  console.log(`\n${rojo('  ✗ gate:eficiencia en rojo')}\n`);
  for (const f of fallos) console.log(`      · ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`\n${verde('  ✓ gate:eficiencia en verde')}\n`);
