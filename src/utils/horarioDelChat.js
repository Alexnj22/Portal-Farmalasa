// El horario que ve el cliente en el chat, dicho en palabras (2026-10-12).
//
// La base decide si la farmacia está abierta (`farmacia_estado()`) y a qué hora
// abre o cierra cada sala (`horario_de_sala()`: especial > feriado con horario
// de domingo > semanal). Acá sólo se TRADUCE eso a texto — para la vista
// previa de los mensajes automáticos y para la píldora del encabezado — con
// las mismas palabras que usa el servidor al mandar el mensaje:
//   {cierra} → «10:00 p. m.»
//   {abre}   → «mañana a las 7:00 a. m.»
//
// Todo en hora de El Salvador (UTC−6 todo el año, sin horario de verano): la
// fecha de «hoy» no puede salir del reloj del navegador, que puede estar en
// otra zona.

import { hora12, rango12 } from './hora';
import { diaSV } from './fecha';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const MARCADORES_DEL_CHAT = [
    { clave: '{abre}', rotulo: 'Cuándo abre', ayuda: 'La próxima apertura, por ejemplo «mañana a las 7:00 a. m.»' },
    { clave: '{cierra}', rotulo: 'Hora de cierre', ayuda: 'La hora de cierre de hoy, por ejemplo «10:00 p. m.»' },
];
export const LARGO_MAXIMO_MENSAJE = 500;

/** `YYYY-MM-DD` de un instante, en El Salvador. */
export function fechaSV(ms = Date.now()) {
    return diaSV(ms);
}

/** «HH:MM» (o «HH:MM:SS») → «7:00 a. m.» / «10:00 p. m.» (el canónico `hora12`). Vacío si no se lee. */
export function horaLegible(hhmm) {
    const m = /^\s*(\d{1,2}:\d{2})/.exec(String(hhmm || ''));
    return m ? hora12(m[1]) : '';
}

/** Días entre dos fechas `YYYY-MM-DD` (b − a). */
function diasEntre(a, b) {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Cómo se nombra un día visto desde hoy: «hoy», «mañana», «el lunes», «el 25 de diciembre». */
export function nombreDelDia(fecha, hoy = fechaSV()) {
    const d = diasEntre(hoy, fecha);
    if (d === 0) return 'hoy';
    if (d === 1) return 'mañana';
    const f = new Date(`${fecha}T00:00:00Z`);
    if (d > 1 && d < 7) return `el ${DIAS[f.getUTCDay()]}`;
    return `el ${f.getUTCDate()} de ${MESES[f.getUTCMonth()]}`;
}

/**
 * La próxima apertura (`'YYYY-MM-DDTHH:MI'` de `farmacia_estado`) en palabras.
 * `conArticulo`: «mañana a las 7:00 a. m.» (el mensaje) o «mañana 7:00 a. m.» (la píldora).
 */
export function cuandoAbre(abre, { hoy = fechaSV(), conArticulo = true } = {}) {
    if (!abre) return '';
    const [fecha, hora] = String(abre).split('T');
    const h = horaLegible(hora);
    if (!fecha || !h) return '';
    return `${nombreDelDia(fecha, hoy)}${conArticulo ? ' a las ' : ' '}${h}`;
}

/**
 * El mensaje como lo recibiría el cliente con el estado `estado`. Si el estado
 * no trae el dato que pide un marcador (por ejemplo {abre} con la farmacia
 * abierta), el marcador se devuelve como `faltante` para que la vista previa
 * lo pinte distinto en vez de inventar una hora.
 *
 * Devuelve trozos `{ texto, marcador?: bool, faltante?: bool }`.
 */
export function trozosDelMensaje(texto, estado, { hoy = fechaSV() } = {}) {
    const valores = {
        '{abre}': cuandoAbre(estado?.abre, { hoy }),
        '{cierra}': horaLegible(estado?.cierra),
    };
    return String(texto || '').split(/(\{abre\}|\{cierra\})/).filter((t) => t !== '').map((t) => {
        if (!(t in valores)) return { texto: t };
        return valores[t] ? { texto: valores[t], marcador: true } : { texto: t, marcador: true, faltante: true };
    });
}

/** El estado de la farmacia en una línea, para la píldora del encabezado. */
export function textoDelEstado(estado, { hoy = fechaSV() } = {}) {
    if (!estado) return null;
    if (estado.abierta) {
        const c = horaLegible(estado.cierra);
        return { tono: 'success', texto: c ? `Farmacia en línea · hasta las ${c}` : 'Farmacia en línea', feriado: estado.feriado || null };
    }
    const a = cuandoAbre(estado.abre, { hoy, conArticulo: false });
    return { tono: 'neutral', texto: a ? `Fuera de horario · abre ${a}` : 'Fuera de horario', feriado: estado.feriado || null };
}

// ── Feriados y el horario que aplicaría ─────────────────────────────────────

/**
 * Los feriados NACIONALES (`municipality` nulo) que caen entre `desde` y
 * `desde + dias`, con los recurrentes llevados al año que toque. Ordenados.
 */
export function proximosFeriados(feriados, { desde = fechaSV(), dias = 60 } = {}) {
    const hasta = new Date(Date.parse(`${desde}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
    const anio = Number(desde.slice(0, 4));
    const vistos = new Map();
    (feriados || []).forEach((h) => {
        if (h?.municipality || !h?.holiday_date) return;
        const fechas = h.is_recurring
            ? [anio, anio + 1].map((y) => `${y}${String(h.holiday_date).slice(4, 10)}`)
            : [String(h.holiday_date).slice(0, 10)];
        fechas.forEach((f) => {
            if (f >= desde && f <= hasta && !vistos.has(f)) vistos.set(f, { fecha: f, nombre: h.name });
        });
    });
    return [...vistos.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** «07:00» / «7:00 AM» / «18:00 PM» → «HH:MM» (las horas de `weekly_hours` vienen escritas a mano). */
export function horaDelHorario(t) {
    const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/**
 * El horario de DOMINGO de una sala (`weekly_hours`), que es el que usa un
 * feriado sin horario especial. `null` si ese día no abre o no está escrito —
 * la misma lectura que `horario_de_sala()`.
 */
export function horarioDeDomingo(weeklyHours) {
    let wh = weeklyHours;
    if (typeof wh === 'string') { try { wh = JSON.parse(wh); } catch { wh = null; } }
    const d = wh?.[0] ?? wh?.['0'];
    if (!d || d.isOpen !== true) return null;
    const abre = horaDelHorario(d.start), cierra = horaDelHorario(d.end);
    return abre && cierra ? { abre, cierra } : null;
}

/** «7:00 a. m. – 4:00 p. m.» (el canónico `rango12`). */
export function rangoLegible(abre, cierra) {
    return rango12(horaDelHorario(abre), horaDelHorario(cierra));
}

/** «lunes 2 de noviembre» */
export function fechaLarga(fecha) {
    const f = new Date(`${fecha}T00:00:00Z`);
    if (Number.isNaN(f.getTime())) return fecha;
    return `${DIAS[f.getUTCDay()]} ${f.getUTCDate()} de ${MESES[f.getUTCMonth()]}`;
}
