// La lactancia sale de la maternidad (RIT Cap. X, Arts. 59–61). No se escribe a
// mano: se DERIVA de la incapacidad por maternidad (`employee_events`
// type 'DISABILITY', `metadata.disabilityType` 'MATERNIDAD').
//
// Gemelo de `public.lactancia_periodo(date, jsonb)` /
// `public.lactancia_hasta(uuid, date)` en la base. Los casos de
// `tests/unit/lactancia.test.js` valen para los dos: cambiar uno exige cambiar
// el otro y volver a enfrentarlos (`CASOS_DE_LACTANCIA`).
//
//   desde = el día siguiente al fin de la maternidad (`endDate`; sin él,
//           inicio + 111, los 112 días del Art. 59)
//   hasta = parto + 6 meses − 1 día (Art. 61), con el parto real si existe,
//           si no el probable; recortado por `lactanciaTerminadaEl`.
//   Sin fecha de parto, o con desde > hasta: no hay lactancia.

/** Días de maternidad (Art. 59): 16 semanas. */
export const DIAS_DE_MATERNIDAD = 112;
/** Semanas que la maternidad tiene que cubrir DESPUÉS del parto (Art. 59). */
export const SEMANAS_DESPUES_DEL_PARTO = 10;
/** Meses de lactancia desde el parto (Art. 61). */
export const MESES_DE_LACTANCIA = 6;
/** Minutos de lactancia por día, partibles en dos pausas (Art. 61). */
export const MINUTOS_DE_LACTANCIA = 60;

/** Las novedades que ya no valen: corregidas o anuladas. */
const ESTADOS_QUE_NO_CUENTAN = new Set(['CANCELLED', 'SUPERSEDED', 'ANULADA']);

/** 'AAAA-MM-DD' o null — lo demás (ausente, null, '') vale como ausente. */
const fecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

const aUTC = (f) => { const [y, m, d] = f.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const deUTC = (d) => d.toISOString().slice(0, 10);

/** `f` más `n` días. */
export function masDias(f, n) {
    const d = aUTC(f);
    d.setUTCDate(d.getUTCDate() + n);
    return deUTC(d);
}

/** `f` más `n` meses, como Postgres: si el día no existe, el último del mes
 *  (31-ago + 6 meses = 28-feb). */
export function masMeses(f, n) {
    const [y, m, d] = f.split('-').map(Number);
    const total = (m - 1) + n;
    const anio = y + Math.floor(total / 12);
    const mes = ((total % 12) + 12) % 12;
    const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    return deUTC(new Date(Date.UTC(anio, mes, Math.min(d, ultimo))));
}

const metaDe = (ev) => {
    const m = ev?.metadata;
    if (typeof m === 'string') { try { return JSON.parse(m) || {}; } catch { return {}; } }
    return m || {};
};

/** El parto que manda: el real si se conoce, si no el probable. */
export const fechaDelParto = (meta = {}) => fecha(meta.fechaPartoReal) || fecha(meta.fechaPartoProbable);

/**
 * El período de lactancia de una maternidad: `{ desde, hasta }` o null.
 * Gemelo exacto de `public.lactancia_periodo(p_inicio, p_metadata)`.
 *
 * @param {string|null} inicio  la fecha del evento (`employee_events.date`)
 * @param {any} meta            su `metadata`
 */
export function periodoDeLactancia(inicio, meta = {}) {
    const ini = fecha(inicio);
    if (!ini || meta?.disabilityType !== 'MATERNIDAD') return null;
    const parto = fechaDelParto(meta);
    if (!parto) return null;
    const desde = masDias(fecha(meta.endDate) || masDias(ini, DIAS_DE_MATERNIDAD - 1), 1);
    let hasta = masDias(masMeses(parto, MESES_DE_LACTANCIA), -1);
    const terminada = fecha(meta.lactanciaTerminadaEl);
    if (terminada && terminada < hasta) hasta = terminada;
    return desde <= hasta ? { desde, hasta } : null;
}

/** ¿Es una maternidad que todavía vale (ni corregida ni anulada)? */
export const esMaternidadVigente = (ev) => !!ev && ev.type === 'DISABILITY'
    && metaDe(ev).disabilityType === 'MATERNIDAD'
    && !ESTADOS_QUE_NO_CUENTAN.has(String(metaDe(ev).status || ''));

/**
 * La lactancia que cubre `dia` según el historial de la persona:
 * `{ desde, hasta, eventoId }` o null. Gemelo de `public.lactancia_hasta`.
 *
 * @param {any[]} eventos  `emp.history` (o filas de `employee_events`)
 * @param {string} dia     'AAAA-MM-DD'
 */
export function lactanciaVigente(eventos = [], dia) {
    let mejor = null;
    for (const ev of eventos || []) {
        if (!esMaternidadVigente(ev)) continue;
        const p = periodoDeLactancia(ev.date, metaDe(ev));
        if (!p || dia < p.desde || dia > p.hasta) continue;
        if (!mejor || p.hasta > mejor.hasta) mejor = { ...p, eventoId: ev.id };
    }
    return mejor;
}

/**
 * El aviso del Art. 59 cuando el parto real llega después del probable: la
 * maternidad tiene que cubrir 10 semanas después del parto. null si ya las
 * cubre (o si falta algún dato).
 */
export function avisoDelParto(meta = {}) {
    const real = fecha(meta.fechaPartoReal);
    const fin = fecha(meta.endDate);
    if (!real || !fin) return null;
    const minimo = masDias(real, SEMANAS_DESPUES_DEL_PARTO * 7);
    return fin < minimo ? { finMinimo: minimo } : null;
}

/**
 * Los casos que enfrentan a los dos gemelos. Cada uno: inicio, metadata y lo
 * esperado (`null` = sin lactancia).
 */
export const CASOS_DE_LACTANCIA = [
    // Lo normal: parto probable, sin real.
    { nombre: 'probable', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20', fechaPartoProbable: '2026-05-31' }, esperado: { desde: '2026-08-21', hasta: '2026-11-29' } },
    // El real manda sobre el probable.
    { nombre: 'real manda', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-30', fechaPartoProbable: '2026-05-31', fechaPartoReal: '2026-06-10' }, esperado: { desde: '2026-08-31', hasta: '2026-12-09' } },
    // Sin endDate: los 112 días desde el inicio.
    { nombre: 'sin fin', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', fechaPartoProbable: '2026-05-31' }, esperado: { desde: '2026-08-21', hasta: '2026-11-29' } },
    // Terminada antes por Talento Humano.
    { nombre: 'terminada antes', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20', fechaPartoProbable: '2026-05-31', lactanciaTerminadaEl: '2026-10-15' }, esperado: { desde: '2026-08-21', hasta: '2026-10-15' } },
    // Terminada antes de empezar: no hay.
    { nombre: 'terminada antes de empezar', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20', fechaPartoProbable: '2026-05-31', lactanciaTerminadaEl: '2026-08-01' }, esperado: null },
    // Un «terminada» después del fin natural no la alarga.
    { nombre: 'terminada después', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20', fechaPartoProbable: '2026-05-31', lactanciaTerminadaEl: '2027-03-01' }, esperado: { desde: '2026-08-21', hasta: '2026-11-29' } },
    // Sin fecha de parto: no se puede derivar.
    { nombre: 'sin parto', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20' }, esperado: null },
    // Vacío y null valen como ausente (la verdad de JavaScript).
    { nombre: 'parto vacío', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20', fechaPartoReal: '', fechaPartoProbable: '2026-05-31' }, esperado: { desde: '2026-08-21', hasta: '2026-11-29' } },
    { nombre: 'parto null', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20', fechaPartoReal: null, fechaPartoProbable: null }, esperado: null },
    // Otra incapacidad: nunca.
    { nombre: 'enfermedad', inicio: '2026-05-01', meta: { disabilityType: 'ENFERMEDAD_COMUN', endDate: '2026-08-20', fechaPartoProbable: '2026-05-31' }, esperado: null },
    // Fin de mes: 31-ago + 6 meses = 28-feb (como Postgres), menos un día.
    { nombre: 'fin de mes', inicio: '2026-07-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-10-20', fechaPartoProbable: '2026-08-31' }, esperado: { desde: '2026-10-21', hasta: '2027-02-27' } },
    // Bisiesto: 31-ago-2027 + 6 meses = 29-feb-2028.
    { nombre: 'bisiesto', inicio: '2027-07-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2027-10-20', fechaPartoProbable: '2027-08-31' }, esperado: { desde: '2027-10-21', hasta: '2028-02-28' } },
    // La maternidad se alargó tanto que pasa los 6 meses: no hay.
    { nombre: 'maternidad larga', inicio: '2026-01-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-01', fechaPartoProbable: '2026-02-01' }, esperado: null },
    // Fecha con hora: se toma el día.
    { nombre: 'con hora', inicio: '2026-05-01', meta: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20T00:00:00', fechaPartoProbable: '2026-05-31T12:00:00Z' }, esperado: { desde: '2026-08-21', hasta: '2026-11-29' } },
];
