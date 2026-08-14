// El período de una vista: el formato `inicio|fin` y cómo se corre.
//
// ── Por qué vive fuera de `PeriodPicker` ───────────────────────────────────
// El formato lo define el canónico —`PeriodPicker` emite y recibe la cadena
// `YYYY-MM-DD|YYYY-MM-DD`— pero **correrlo** lo necesita quien compone ese
// picker con `PeriodStepper`, y un archivo de componente no puede exportar
// funciones sueltas sin romper el refresco rápido de Vite. Así que la lectura
// del formato vive acá y el componente la importa: sigue habiendo UNA
// definición, que es lo único que importaba.
//
// Las fechas se calculan en hora de El Salvador (UTC−6, sin horario de verano),
// no con la del equipo: la fecha de un corte, de una venta o de un turno es la
// de la sala, y un navegador en otro huso mostraría el día equivocado sin
// avisar.

export const pad = (n) => String(n).padStart(2, '0');

/** Hoy en El Salvador, descompuesto. */
export function svNow() {
    const sv = new Date(Date.now() - 6 * 3600_000);
    return { y: sv.getUTCFullYear(), m: sv.getUTCMonth(), d: sv.getUTCDate() };
}

/** Hoy en El Salvador, como `YYYY-MM-DD`. */
export function svToday() {
    const { y, m, d } = svNow();
    return `${y}-${pad(m + 1)}-${pad(d)}`;
}

const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m: m - 1, d }; };
const isoDe = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const ultimoDiaDe = (y, m) => new Date(y, m + 1, 0).getDate();

/**
 * Qué ES este período y de a cuánto se corre.
 *
 * Pedido del usuario (2026-08-14): «que ese elemento sea inteligente, y se
 * adapte según el contexto: si es por mes, pasa el mes; si el día, el día».
 * Componer `PeriodStepper` con `PeriodPicker` deja las flechas sin saber cuánto
 * mover, y un paso fijo se equivoca en los dos sentidos — un día de a un mes
 * salta 30 días, un mes de a un día deja de ser un mes.
 *
 * La unidad se DEDUCE del rango, que es el único sitio donde está dicha:
 *
 *   14/08 → 14/08   un día         → ±1 día
 *   01/08 → 31/08   un mes entero  → ±1 mes
 *   01/01 → 31/12   un año         → ±1 año
 *   01/06 → 31/08   3 meses        → ±3 meses
 *   08/08 → 14/08   7 días         → ±7 días
 */
export function granularidadDePeriodo(value) {
    const [s, e] = String(value || '').split('|');
    if (!s || !e) return { unidad: 'período', paso: 'dia', n: 1 };
    if (s === e) return { unidad: 'día', paso: 'dia', n: 1 };
    const A = parseISO(s), B = parseISO(e);
    if (A.d === 1 && B.d === ultimoDiaDe(B.y, B.m)) {
        const meses = (B.y - A.y) * 12 + (B.m - A.m) + 1;
        if (meses === 12 && A.m === 0) return { unidad: 'año', paso: 'anio', n: 1 };
        if (meses === 1) return { unidad: 'mes', paso: 'mes', n: 1 };
        return { unidad: 'período', paso: 'mes', n: meses };
    }
    const dias = Math.round((Date.UTC(B.y, B.m, B.d) - Date.UTC(A.y, A.m, A.d)) / 86400000) + 1;
    return { unidad: 'período', paso: 'dia', n: dias };
}

/** El mismo período, corrido `dir` (±1) veces su propia unidad. */
export function correrPeriodo(value, dir) {
    const [s, e] = String(value || '').split('|');
    if (!s || !e) return value;
    const g = granularidadDePeriodo(value);
    const A = parseISO(s), B = parseISO(e);

    if (g.paso === 'dia') {
        // En UTC: sumar días sobre una fecha local cruza mal las noches en que
        // cambia el huso, y acá el salto tiene que ser exacto.
        const mover = (p) => {
            const d = new Date(Date.UTC(p.y, p.m, p.d + dir * g.n));
            return isoDe(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        };
        return `${mover(A)}|${mover(B)}`;
    }

    // Por meses el fin se RECALCULA al último día del mes que toque: así «enero
    // entero» + 1 da «febrero entero» y no «del 1 al 31 de febrero».
    const salto = (g.paso === 'anio' ? 12 : g.n) * dir;
    const ini = new Date(A.y, A.m + salto, 1);
    const fin = new Date(B.y, B.m + salto, 1);
    return `${isoDe(ini.getFullYear(), ini.getMonth(), 1)}`
         + `|${isoDe(fin.getFullYear(), fin.getMonth(), ultimoDiaDe(fin.getFullYear(), fin.getMonth()))}`;
}

/** El período que contiene a HOY, con la misma forma que el que se le pasa. */
export function periodoDeHoy(value) {
    const g = granularidadDePeriodo(value);
    const { y, m } = svNow();
    if (g.paso === 'mes' && g.n === 1) return `${isoDe(y, m, 1)}|${isoDe(y, m, ultimoDiaDe(y, m))}`;
    if (g.paso === 'anio') return `${y}-01-01|${y}-12-31`;
    return `${svToday()}|${svToday()}`;
}

/** `true` si el período ya llega a hoy — o sea, no hay «siguiente» que mirar. */
export function periodoAlcanzaHoy(value) {
    const fin = String(value || '').split('|')[1];
    return !!fin && fin >= svToday();
}
