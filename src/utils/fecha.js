// ─────────────────────────────────────────────────────────────────────────────
// El día en El Salvador — el canónico.
// ─────────────────────────────────────────────────────────────────────────────
//
// «¿Qué día es hoy?» estaba respondido VEINTE veces en el portal (medido el
// 2026-09-25, `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md` §E1), con cuatro reglas:
//
//   · restar 6 horas a mano                     → once copias
//   · la zona `America/El_Salvador` con `Intl`   → cuatro
//   · la hora del EQUIPO (`getFullYear()`…)       → tres: aciertan sólo si el
//     equipo está configurado en El Salvador
//   · `toISOString()`                            → cuatro: es UTC, así que
//     después de las 6 pm dicen que ya es mañana
//
// La última es un defecto, no un estilo: la lista de incapacidades vigentes
// al pedir un permiso daba por vencida, desde las 6 pm, la que terminaba ese
// mismo día; y los CSV de inventario y del directorio salían fechados mañana.
//
// ── Por qué el desplazamiento fijo y no `Intl` con la zona ─────────────────
// El Salvador es UTC−6 todo el año: no tiene horario de verano desde 1987. Con
// eso el desplazamiento fijo da lo mismo que la zona, no depende de que el
// motor traiga la base de datos de zonas horarias (el de React Native no
// siempre la trae) y cuesta una resta. Si algún día el país adoptara horario
// de verano, se cambia ACÁ y se mueven todos juntos — que es justo lo que no
// podía pasar con veinte copias. Las funciones del servidor usan la misma
// resta (`sync-cortes-caja`, `operar-caja`…).

const DESPLAZAMIENTO_SV_MS = 6 * 3600_000;

const dos = (n) => String(n).padStart(2, '0');

/**
 * Un instante leído como reloj de pared de El Salvador: un `Date` cuyos
 * campos `getUTC*` dan la fecha y la hora de la sala. Para quien necesita
 * hacer cuentas de calendario con ellos; para mostrar o comparar, las de abajo.
 */
export function relojSV(instante = Date.now()) {
    return new Date(new Date(instante).getTime() - DESPLAZAMIENTO_SV_MS);
}

/** El día de un instante en El Salvador, como `YYYY-MM-DD`. */
export function diaSV(instante = Date.now()) {
    return relojSV(instante).toISOString().slice(0, 10);
}

/** Hoy en El Salvador, como `YYYY-MM-DD`. A las 9 pm no dice que ya es mañana. */
export const hoySV = () => diaSV();

/** Ahora en El Salvador, descompuesto (`m` va de 0 a 11, como en `Date`). */
export function ahoraSV(instante = Date.now()) {
    const r = relojSV(instante);
    return {
        y: r.getUTCFullYear(), m: r.getUTCMonth(), d: r.getUTCDate(),
        h: r.getUTCHours(), min: r.getUTCMinutes(), s: r.getUTCSeconds(),
    };
}

/** La hora de pared de El Salvador como `HH:MM:SS`. */
export function horaSV(instante = Date.now()) {
    const { h, min, s } = ahoraSV(instante);
    return `${dos(h)}:${dos(min)}:${dos(s)}`;
}

/**
 * Corre un día `YYYY-MM-DD` n días (negativo = hacia atrás). Es aritmética de
 * calendario pura: no pasa por la hora del equipo, así que no se corre con
 * ningún cambio de horario.
 */
export function sumarDias(dia, n) {
    const [y, m, d] = String(dia).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** El lunes de la semana de un día `YYYY-MM-DD` (la semana arranca el lunes). */
export function lunesDe(dia) {
    const [y, m, d] = String(dia).slice(0, 10).split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return sumarDias(dia, -((dow + 6) % 7));
}

/** Cuántos días de calendario van de `desde` a `hasta` (`YYYY-MM-DD`). */
export function diasEntre(desde, hasta) {
    const a = Date.parse(`${String(desde).slice(0, 10)}T00:00:00Z`);
    const b = Date.parse(`${String(hasta).slice(0, 10)}T00:00:00Z`);
    return Math.round((b - a) / 86_400_000);
}

/** Cuántos días pasaron desde un día hasta hoy en la sala (negativo si es futuro). */
export const diasDesde = (dia) => diasEntre(dia, hoySV());

/** Cuántos días faltan de hoy en la sala hasta un día (negativo si ya pasó). */
export const diasHasta = (dia) => diasEntre(hoySV(), dia);

// ── Meses ────────────────────────────────────────────────────────────────────
// Un mes se escribe `YYYY-MM`. Las cuatro funciones de abajo estaban copiadas
// en las cinco vistas de libros y compras, cada una con su lista de nombres.

export const NOMBRES_DE_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** El mes de hoy en la sala, `YYYY-MM`. */
export const mesSV = () => hoySV().slice(0, 7);

/** Corre un mes (`YYYY-MM`, o un día del que se toma el mes) n meses. */
export function correrMes(mes, n) {
    const [y, m] = String(mes).slice(0, 7).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${t.getUTCFullYear()}-${dos(t.getUTCMonth() + 1)}`;
}

/** El último día de un mes, `YYYY-MM-DD`. */
export function ultimoDiaDelMes(mes) {
    const [y, m] = String(mes).slice(0, 7).split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** `[primer día, último día]` de un mes. */
export const rangoDelMes = (mes) => [`${String(mes).slice(0, 7)}-01`, ultimoDiaDelMes(mes)];

/** «Septiembre 2026». */
export function etiquetaMes(mes) {
    const [y, m] = String(mes).slice(0, 7).split('-').map(Number);
    return `${NOMBRES_DE_MES[m - 1]} ${y}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mostrar una fecha.
// ─────────────────────────────────────────────────────────────────────────────
//
// Una fecha llega de dos formas y son cosas distintas:
//
//   · un DÍA de calendario — una columna `date` de Postgres: `2026-03-01`
//   · un INSTANTE — un `timestamptz`, un `Date`, un número de milisegundos
//
// El defecto que esto cierra (2026-09-25): `new Date('2026-03-01')` lee el día
// como medianoche de GREENWICH, que en El Salvador todavía es el 28 de
// febrero. Así el vencimiento de un lote salía un día antes en Mín·Máx, y la
// fecha de ingreso de alguien que entró un día 1 salía en el mes anterior. Las
// pantallas que lo sabían escribían `+ 'T12:00:00'` a mano; las que no, no.
//
// Acá se decide UNA vez: un día se muestra tal cual es, y un instante se
// muestra con el día que era EN LA SALA —no en el reloj de quien mira—.

const SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** El día de calendario (`YYYY-MM-DD`) de una fecha o un instante; `null` si no es una fecha. */
export function diaDe(valor) {
    if (valor == null || valor === '') return null;
    if (typeof valor === 'string' && SOLO_DIA.test(valor)) return valor;
    const t = new Date(valor).getTime();
    return Number.isNaN(t) ? null : diaSV(t);
}

/**
 * Una fecha en texto, en español de El Salvador. `opciones` son las de
 * `Intl.DateTimeFormat` para la FECHA (día, mes, año, día de la semana);
 * la hora se pide a `hora.js`. Sin fecha válida devuelve `vacio`.
 */
export function fechaTexto(valor, opciones = {}, vacio = '') {
    const dia = diaDe(valor);
    if (!dia) return vacio;
    return new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-SV', { ...opciones, timeZone: 'UTC' });
}

/**
 * `25/09/2026`, o `25/09/26` con `anio: 'corto'`, o `25/09` con `anio: false`.
 * Es la forma de las tablas y del papel: se arma con dígitos y no depende del
 * idioma del navegador.
 */
export function fechaNumerica(valor, { anio = 'completo', vacio = '' } = {}) {
    const dia = diaDe(valor);
    if (!dia) return vacio;
    const [a, m, d] = dia.split('-');
    if (anio === false) return `${d}/${m}`;
    return `${d}/${m}/${anio === 'corto' ? a.slice(2) : a}`;
}
