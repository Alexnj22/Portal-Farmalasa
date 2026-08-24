/**
 * La SEMANA del portal: dónde empieza, cómo se llama y cómo se compara.
 *
 * Vive aparte de `scheduleHelpers` desde el 2026-08-21, y no por gusto: ese
 * archivo arrastra `lucide-react` y la matemática de horas de la planilla, y
 * las tres pantallas que estrenaron filtro de semana —Solicitudes, Traslados y
 * la capa de datos de traslados— no necesitan nada de eso. Importarlo entero
 * les metía ~1 kB gzip en el cierre estático de una vista que ya estaba sobre
 * su techo (`npm run gate:bundle`).
 *
 * Sin dependencias a propósito. Si alguna vez necesita un ícono, va en otro
 * lado.
 *
 * ── La regla que hay detrás de las cinco ───────────────────────────────────
 * Una fecha sin hora se trabaja en hora LOCAL, siempre. `new Date('2026-08-18')`
 * la lee como UTC, y en El Salvador (UTC−6) eso retrocede un día: la semana
 * empezaría el domingo por la tarde. Por eso todas construyen con
 * `new Date(y, m - 1, d)` y ninguna pasa la cadena al constructor.
 */

// Lo escrito sobre esta área:
// `docs/HORARIOS-LA-SEMANA-EL-DIA-Y-LA-COPIA-AUTOMATICA-2026-08-24.md` — por qué
// domingo es 0 y no 7 (y cómo esa discrepancia hacía invisible el domingo en
// seis lugares), y qué copia sola la corrida del sábado.

export const getLocalMonday = (dateStr) => {
    let y, m, day;
    if (!dateStr) {
        const today = new Date();
        y = today.getFullYear(); m = today.getMonth(); day = today.getDate();
    } else {
        const parts = dateStr.split('-');
        y = Number(parts[0]); m = Number(parts[1]) - 1; day = Number(parts[2]);
    }
    const d = new Date(y, m, day);
    const dayOfWeek = d.getDay();
    const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    d.setDate(diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

/**
 * El rótulo de una semana: «18 - 24 Ago '26».
 *
 * Recibe el LUNES (lo que devuelve `getLocalMonday`) y nombra los siete días.
 * Vivía escrita dentro de `SchedulesView`, y cuando Solicitudes y Traslados
 * estrenaron su propio filtro de semana la copia obvia habría sido un tercer
 * `formatWeekRange` — o sea, tres pantallas diciendo «la semana del…» con tres
 * formatos que se separan al primer retoque. Vive acá, al lado de la función
 * que decide dónde empieza la semana, porque son la misma decisión.
 *
 * Se ahorra lo que se repite: si los dos extremos caen en el mismo mes, el mes
 * se dice una vez; si caen en el mismo año, el año se dice una vez.
 */
export const formatWeekRange = (dateStr) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end   = new Date(y, m - 1, d + 6);
    const d1 = String(start.getDate()).padStart(2, '0'), m1 = MESES_CORTOS[start.getMonth()], y1 = String(start.getFullYear()).slice(-2);
    const d2 = String(end.getDate()).padStart(2, '0'),   m2 = MESES_CORTOS[end.getMonth()],   y2 = String(end.getFullYear()).slice(-2);
    if (y1 !== y2) return `${d1} ${m1} '${y1} - ${d2} ${m2} '${y2}`;
    if (m1 !== m2) return `${d1} ${m1} - ${d2} ${m2} '${y2}`;
    return `${d1} - ${d2} ${m1} '${y2}`;
};

/**
 * Correr una semana hacia atrás o hacia adelante, desde su lunes.
 *
 * `new Date(y, m-1, d + 7*n)` deja que el propio `Date` cruce el mes y el año,
 * y trabaja en hora LOCAL — que es lo que hay que hacer con una fecha sin hora.
 * Sumarle 7 días a la cadena a mano, o pasarla por `new Date('2026-08-18')`,
 * la lee como UTC y en El Salvador (UTC−6) retrocede un día.
 */
export const shiftWeek = (dateStr, semanas) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const x = new Date(y, m - 1, d + semanas * 7);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * ¿Cae esta marca de tiempo dentro de la semana que empieza en `lunes`?
 *
 * Compara contra el lunes de LA marca, no contra un rango: así el corte usa la
 * misma definición de semana que el resto de la pantalla —una sola función
 * decide dónde empieza— y no hay forma de que el borde del domingo a medianoche
 * quede de un lado en un sitio y del otro en otro.
 */
export const enLaSemanaDe = (lunes, iso) => {
    if (!iso) return false;
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return false;
    const suLunes = getLocalMonday(
        `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
    return suLunes === lunes;
};

/**
 * Los dos extremos de una semana, como instantes, para mandárselos a la base.
 *
 * `enLaSemanaDe` sirve cuando la lista ya está entera en el navegador. Cuando
 * la consulta trae un TOPE —`fetchTrasladosHistorial` pide `.range(0, 200)`—
 * el corte tiene que viajar a la base, porque un tope se aplica ANTES del
 * filtro: recortar en el navegador dejaría «las de esa semana **entre las 201
 * más nuevas**», que para una semana vieja es la lista vacía, sin error y sin
 * nada visible que lo explique.
 *
 * Los extremos se arman con `new Date(y, m-1, d)`, o sea medianoche LOCAL, que
 * es la misma frontera que usa `enLaSemanaDe`. Construirlos desde la cadena
 * (`new Date('2026-08-18')`) los leería como UTC y en El Salvador (UTC−6)
 * empezaría la semana seis horas antes — el domingo por la tarde.
 */
export const rangoDeSemana = (lunes) => {
    const [y, m, d] = lunes.split('-').map(Number);
    return {
        desde: new Date(y, m - 1, d).toISOString(),
        hasta: new Date(y, m - 1, d + 7).toISOString(),
    };
};
