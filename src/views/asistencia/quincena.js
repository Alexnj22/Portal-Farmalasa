// ── La quincena y las horas de la auditoría de asistencia ────────────────────
//
// Extraídas de `AttendanceAuditView.jsx` (1,497 líneas) por el mismo motivo que
// ya movió a `data/attendanceAudit.js` sus tres hermanas: **son matemática pura
// y adentro de la vista no se podían probar**. El comentario que quedó allá lo
// dice explícitamente; esto termina esa mudanza.
//
// Lo que decide este archivo no es cosmético: de acá salen las fechas del
// período que se paga. Un borde mal puesto mueve un día de trabajo de una
// quincena a la otra.
//
// **Todo se calcula restando seis horas a UTC, nunca con la hora local.** El
// portal corre en navegadores de El Salvador pero también en crons que viven en
// UTC, y una fecha local a las 02:00 SV ya es el día siguiente allá. Restar el
// huso a mano es lo que hace que las dos den lo mismo.

const SV = 6 * 3600000;

/** Ahora, corrido a la hora de El Salvador para poder leerlo con `getUTC*`. */
const ahoraSV = (t = Date.now()) => new Date(t - SV);

/** El lunes de la semana en curso, en `YYYY-MM-DD`. */
export function getMondayOfCurrentWeek(ahora = Date.now()) {
    const cst = ahoraSV(ahora);
    // `(getUTCDay() + 6) % 7` convierte domingo=0 en 6, así que la semana
    // arranca el LUNES. Con `getUTCDay()` a secas, el domingo saltaría a la
    // semana siguiente y el turno de ese día quedaría en el período equivocado.
    cst.setUTCDate(cst.getUTCDate() - (cst.getUTCDay() + 6) % 7);
    return cst.toISOString().slice(0, 10);
}

/** Una hora ISO, en 12 horas y hora de El Salvador. `–` si no hay. */
export function fmtTimeCSTStr(isoStr) {
    if (!isoStr) return '–';
    const d = new Date(new Date(isoStr).getTime() - SV);
    if (Number.isNaN(d.getTime())) return '–';
    const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${String(h % 12 || 12).padStart(2, '0')}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Un `HH:MM` de horario, en 12 horas. No lleva huso: ya es hora de pared. */
export function formatTime12h(t) {
    if (!t) return '–';
    let [h, m] = String(t).split(':');
    h = parseInt(h, 10);
    if (Number.isNaN(h)) return '–';
    return `${String(h % 12 || 12).padStart(2, '0')}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── De dónde vino cada marcación ────────────────────────────────────────────
// Las tres son excluyentes en la pantalla pero NO en el dato: una marcación
// insertada automáticamente y después editada a mano es las dos cosas. El orden
// en que la vista las pregunta es lo que decide qué distintivo gana.
export const isEditedPunch  = (p) => !!(p?.details?.manualAudit || p?.details?.editedBy || p?.details?.auditedByName);
export const isAutoPunch    = (p) => !!(p?.details?.autoInserted);
/** Pendiente de revisión de RRHH, y sólo si NO la puso el sistema: una que el
 *  sistema insertó ya tiene su propio distintivo y no espera a nadie. */
export const isPendingPunch = (p) => !!(p?.details?.pendingHRReview && !p?.details?.autoInserted);

// ── Los bordes del período que se paga ──────────────────────────────────────
// Del 1 al 15, y del 16 al último día del mes. El último día se pregunta, no se
// asume: 28, 29, 30 y 31 son todos posibles y febrero cambia según el año.

/** La quincena en curso, por su día de inicio. */
export function getCurrentQuincenaStart(ahora = Date.now()) {
    const cst = ahoraSV(ahora);
    const y = cst.getUTCFullYear(), m = String(cst.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}-${cst.getUTCDate() <= 15 ? '01' : '16'}`;
}

/** El último día de la quincena que arranca en `start`. */
export function getQuincenaEnd(start) {
    const d = new Date(start + 'T12:00:00Z');
    if (d.getUTCDate() === 1) return `${start.slice(0, 7)}-15`;
    const lastDay = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
    return `${start.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
}

export function prevQuincena(start) {
    const d = new Date(start + 'T12:00:00Z');
    if (d.getUTCDate() === 1) {
        const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 16));
        return prev.toISOString().slice(0, 10);
    }
    return `${start.slice(0, 7)}-01`;
}

export function nextQuincena(start) {
    const d = new Date(start + 'T12:00:00Z');
    if (d.getUTCDate() === 1) return `${start.slice(0, 7)}-16`;
    const nxt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return nxt.toISOString().slice(0, 10);
}
