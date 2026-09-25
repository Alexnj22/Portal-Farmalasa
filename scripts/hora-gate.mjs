/**
 * gate:hora — toda hora que ve una persona sale en 12 horas, y sale de
 * `src/utils/hora.js`.
 *
 * ── El reporte que lo trajo ─────────────────────────────────────────────────
 *
 * 23-sep: «necesito que las horas sean 12 horas siempre. No en un lado 12 y en
 * otras 24». Ese día se escribió `hora.js` y se pasaron los AVISOS. El 24-sep:
 * «necesito que en todo el portal se trabaje en 12 horas y no en 24. corrígelo,
 * y verifica la regla» — la regla existía en un archivo y nada la obligaba:
 * el resto del portal seguía con cinco formatos, y el peor era el invisible.
 *
 * ── Por qué el modo de falla es invisible ──────────────────────────────────
 *
 * `toLocaleTimeString([], …)` y `toLocaleString()` sin idioma usan el del
 * NAVEGADOR: con el teléfono en «español (El Salvador)» sale «1:06 p. m.», y
 * con el de la computadora en «español» a secas sale «13:06». Quien probó la
 * pantalla vio 12 horas; quien la usa ve 24. Lo mismo `'es'`/`'es-ES'`, que son
 * de 24 horas por definición, y una hora de la base («13:06:00») cortada con
 * `.slice(0, 5)` y pintada tal cual.
 *
 * ── Qué pide ───────────────────────────────────────────────────────────────
 *
 * Fuera de `hora.js` no se formatea una hora:
 *   h12-falso      `hour12: false` / `hourCycle: 'h23'|'h24'`
 *   hora-a-mano    `toLocaleTimeString(`, o `toLocaleString`/`DateTimeFormat`
 *                  con `hour:` — usar `hora12` / `fechaHora12`
 *   fecha-sin-idioma `toLocaleString()` sin opciones sobre una fecha: trae la
 *                  hora en el formato del navegador
 *   time-string    `toTimeString()` (24 h, siempre)
 *   hhmm-crudo     una hora de la base cortada a «HH:MM» y pintada
 *   hh24           `HH24` en una edge function (texto que sale a una persona)
 *
 * Y fuera de `fecha.js` no se calcula el DÍA de la sala (2026-09-25, U1 de
 * `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`). Había veinte copias de «hoy»
 * con cuatro reglas, y cuatro usaban UTC: después de las 6 pm decían mañana.
 *   hoy-utc        `new Date().toISOString()` cortado a fecha — es el día de
 *                  Greenwich, no el de la sala: usar `hoySV()`
 *   desfase-a-mano restar las 6 horas a mano — usar `diaSV`/`relojSV`
 *   zona-a-mano    `timeZone: 'America/El_Salvador'` o `'en-CA'` para sacar
 *                  el día — usar `hoySV()`/`diaSV()`
 *   copia-de-hoy   una función propia `hoySV`/`hoyISO`/`svToday`/`svNow`
 *   (sólo en `src/`: las funciones del servidor tienen su propia copia y
 *   todavía no un canónico compartido)
 *
 * Bloqueante en CERO. Lo legítimo va en EXCEPCIONES **con su motivo**: una hora
 * que es un DATO y no un texto (el `value` de un `<input type="time">`, una
 * clave de comparación, el cuerpo de una petición) no es una hora que alguien lee.
 *
 * Uso:
 *   node scripts/hora-gate.mjs            todo `src/` y `supabase/functions/`
 *   node scripts/hora-gate.mjs --hook     sólo lo que el índice conoce
 *   node scripts/hora-gate.mjs --listar   imprime también lo exceptuado
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivosIndexados, leerDelIndice } from './lib/git-index.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const soloIndexado = process.argv.includes('--hook');
const listarTodo   = process.argv.includes('--listar');

/* El canónico. Es el único que puede formatear una hora. */
const CANONICOS = new Set(['src/utils/hora.js', 'src/utils/fecha.js']);

/* ── Excepciones: archivo → { categoria: [motivo, cuenta] } ─────────────────
 * La cuenta importa: una excepción por archivo a secas se traga el defecto
 * nuevo que aparezca en ese mismo archivo (se comprobó en `gate:nombre`). */
const EXCEPCIONES = {
    'src/utils/bolsaComprobante.js': {
        'hora-a-mano': ['`enHoraDeLaSala` devuelve {fecha, hora:"HH:MM"} como DATO (clave de la salida, anclado en su prueba); lo que se imprime pasa por `horaDeColumna`', 1],
        'h12-falso':   ['el mismo `enHoraDeLaSala`: necesita el reloj de 24 h para que la hora-dato compare y ordene', 1],
        'zona-a-mano': ['el mismo `enHoraDeLaSala`: saca fecha Y hora de una sola lectura con la zona; partirlo en dos lecturas no ganaría nada', 2],
    },
    'src/utils/ticketCampos.js': {
        'zona-a-mano': ['`selloDeTiempo`/`selloCorto` FORMATEAN la fecha para el papel (dd/mm/aaaa) en la zona de la sala: es presentación, no el cálculo del día', 2],
    },
    'src/views/BranchesView.jsx': {
        'time-string': ['`currentTime.timeStr` es la clave con la que `isBranchOpenNow` compara contra `weekly_hours` (HH:MM); no se pinta', 2],
        'hhmm-crudo':  ['el mismo `timeStr`: dato de comparación, no texto', 1],
    },
};

const RE_FECHA = /date|fecha|_at\b|At\b|\bdt\b|\bd\b|\bts\b|time|hora|stamp|momento|cuando|when|inicio|fin\b|created|updated/i;

function reglas(texto, ruta) {
    const hallazgos = [];
    const lineas = texto.split('\n');
    const esFuncion = ruta.startsWith('supabase/functions/');
    const add = (i, cat, msg) => hallazgos.push({ linea: i + 1, cat, msg, fuente: lineas[i].trim().slice(0, 140) });

    lineas.forEach((l, i) => {
        const codigo = l.replace(/\/\/.*$/, '');
        if (/^\s*(\*|\/\*)/.test(l)) return; // comentario de bloque
        if (/hour12:\s*false|hourCycle:\s*['"]h2[34]['"]/.test(codigo)) add(i, 'h12-falso', 'reloj de 24 horas forzado');
        if (/toLocaleTimeString\s*\(/.test(codigo)) add(i, 'hora-a-mano', 'toLocaleTimeString — usar hora12()');
        if (/toTimeString\s*\(/.test(codigo)) add(i, 'time-string', 'toTimeString da 24 horas');
        if (/\bHH:mm|HH24/.test(codigo) && (esFuncion || /format\s*\(|to_char/.test(codigo))) add(i, 'hh24', 'formato de 24 horas');

        // toLocaleString / DateTimeFormat con `hour:` en la misma llamada (mira
        // hasta 6 renglones hacia adelante, que es lo que ocupan las opciones).
        const m = /(toLocaleString|toLocaleDateString|DateTimeFormat)\s*\(/.exec(codigo);
        if (m) {
            const tramo = lineas.slice(i, i + 6).join(' ');
            const desde = tramo.indexOf(m[0]);
            let prof = 0, fin = desde;
            for (let k = desde + m[0].length - 1; k < tramo.length; k++) {
                if (tramo[k] === '(') prof++;
                else if (tramo[k] === ')') { prof--; if (prof === 0) { fin = k; break; } }
            }
            const args = tramo.slice(desde + m[0].length, fin);
            if (/\bhour\s*:/.test(args)) add(i, 'hora-a-mano', `${m[1]} con hour — usar hora12()/fechaHora12()`);
            else if (m[1] === 'toLocaleString' && /^\s*(\[\s*\]|undefined)?\s*$/.test(args)) {
                const receptor = codigo.slice(0, codigo.indexOf(m[0]));
                if (/Date\(|new Date/.test(receptor) || RE_FECHA.test(receptor.split(/[\s({[,]/).pop() || '')) {
                    add(i, 'fecha-sin-idioma', 'toLocaleString() sobre una fecha: hora en el formato del navegador');
                }
            }
        }

        // Una hora de la base cortada a HH:MM y pintada: en JSX `{…}` o en un
        // `${…}` de plantilla. Las asignaciones a datos (`start: x.slice(0,5)`)
        // no son pantalla y no cuentan.
        for (const c of codigo.matchAll(/\.(slice|substring)\(\s*0\s*,\s*5\s*\)/g)) {
            // ¿Lo que se corta es una HORA? Se mira lo que va justo antes: la
            // última palabra de hora tiene que ir después de la última «fecha»
            // (`fechaCorta(x.fecha).slice(0, 5)` es un «14/08», no una hora).
            const antes = codigo.slice(Math.max(0, c.index - 40), c.index);
            const h = Math.max(...['hora', 'time', 'start', 'end', 'inicio', 'desde', 'hasta'].map((w) => antes.toLowerCase().lastIndexOf(w)));
            if (h < 0 || h < antes.toLowerCase().lastIndexOf('fecha')) continue;
            const previo = codigo.slice(0, c.index);
            const enPlantilla = previo.lastIndexOf('${') > previo.lastIndexOf('}');
            const enJsx = /(^|[>}\s])\{[^}]*$/.test(previo) && !/=\s*\{[^}]*$/.test(previo);
            const helper = /const\s+hhmm\s*=/.test(codigo);
            if (enPlantilla || enJsx || helper) { add(i, 'hhmm-crudo', 'hora de la base pintada como HH:MM — usar hora12()'); break; }
        }
        if (/const\s+hhmm\s*=/.test(codigo) && !/(slice|substring)\(/.test(codigo)) add(i, 'hhmm-crudo', 'helper hhmm propio — usar hora12()');
        if (!esFuncion) {
            if (/new Date\(\)\s*\.toISOString\(\)\s*\.\s*(slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\))/.test(codigo)) add(i, 'hoy-utc', 'hoy en UTC: después de las 6 pm dice mañana — usar hoySV()');
            if (/\b6\s*\*\s*(3600_?000|60\s*\*\s*60\s*\*\s*1000|3600\b)/.test(codigo)) add(i, 'desfase-a-mano', 'desfase de El Salvador escrito a mano — usar diaSV()/relojSV() de utils/fecha');
            if (/America\/El_Salvador|['"]en-CA['"]/.test(codigo)) add(i, 'zona-a-mano', 'día de la sala sacado con la zona a mano — usar hoySV()/diaSV()');
            if (/(const|let|function)\s+(hoySV|hoyISO|svToday|svNow|todaySV)\b/.test(codigo)) add(i, 'copia-de-hoy', 'copia propia de «hoy» — importar de utils/fecha');
        }
        if (/getHours\(\)/.test(codigo) && /padStart\(2/.test(codigo) && /:\$\{|\+ ?':' ?\+/.test(codigo)) add(i, 'hhmm-crudo', 'HH:MM armado a mano');
    });
    return hallazgos;
}

function listar(dir) {
    const out = [];
    for (const n of readdirSync(join(RAIZ, dir))) {
        const r = join(dir, n);
        const s = statSync(join(RAIZ, r));
        if (s.isDirectory()) { if (n !== 'node_modules' && n !== 'generated') out.push(...listar(r)); }
        else if (/\.(jsx?|tsx?|mjs)$/.test(n) && !/\.test\./.test(n)) out.push(r);
    }
    return out;
}

const archivos = soloIndexado
    ? [...archivosIndexados(RAIZ, ['src', 'supabase/functions'])]
        .filter((f) => /\.(jsx?|tsx?|mjs)$/.test(f) && !f.includes('/generated/') && !/\.test\./.test(f))
    : [...listar('src'), ...listar('supabase/functions')].map((f) => relative(RAIZ, join(RAIZ, f)));
const delIndice = soloIndexado ? leerDelIndice(RAIZ, archivos) : null;

let total = 0, exceptuados = 0;
const porArchivo = [];
for (const ruta of archivos) {
    if (CANONICOS.has(ruta)) continue;
    const texto = soloIndexado ? delIndice.get(ruta) : readFileSync(join(RAIZ, ruta), 'utf8');
    if (texto == null) continue;
    const h = reglas(texto, ruta);
    if (!h.length) continue;
    const exc = EXCEPCIONES[ruta] || {};
    const porCat = {};
    for (const x of h) (porCat[x.cat] ||= []).push(x);
    const malos = [];
    for (const [cat, lista] of Object.entries(porCat)) {
        const e = exc[cat];
        if (e && lista.length <= e[1]) { exceptuados += lista.length; if (listarTodo) lista.forEach((x) => console.log(`  (exceptuado) ${ruta}:${x.linea} [${cat}] ${e[0]}`)); }
        else malos.push(...lista);
    }
    if (malos.length) { porArchivo.push([ruta, malos]); total += malos.length; }
}

for (const [ruta, lista] of porArchivo) {
    for (const x of lista) console.log(`${ruta}:${x.linea}  [${x.cat}] ${x.msg}\n      ${x.fuente}`);
}
for (const [ruta, cats] of Object.entries(EXCEPCIONES)) {
    for (const [cat, [motivo, cuenta]] of Object.entries(cats)) {
        if (!motivo || !cuenta) { console.log(`EXCEPCIÓN sin motivo o cuenta: ${ruta} [${cat}]`); total++; }
    }
}
console.log(`\ngate:hora — ${total} hallazgo(s) en ${porArchivo.length} archivo(s), ${exceptuados} exceptuado(s).`);
process.exit(total ? 1 : 0);
