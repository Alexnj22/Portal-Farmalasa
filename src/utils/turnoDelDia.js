/* Un día de horario, resuelto UNA sola vez.
 *
 * Un día dentro de `employee_rosters.schedule_data` puede traer un turno del
 * catálogo (`shiftId`), horas propias (`customStart`/`customEnd`), o las dos
 * cosas. Hasta el 2026-08-27 cada consumidor lo resolvía por su cuenta y **con
 * reglas distintas**:
 *
 * | quién leía                          | turno del catálogo | horas propias | `isOff` ausente |
 * |-------------------------------------|--------------------|---------------|-----------------|
 * | `consolidate-timesheets` (planilla) | sí                 | sí            | trabaja         |
 * | las 44 h de la pantalla             | sí                 | sí            | trabaja         |
 * | `getTodayScheduleConfig` (kiosco)   | sí                 | **NO**        | trabaja         |
 * | `empleados_en_turno()` (avisos)     | **NO**             | sí            | **LIBRE**       |
 *
 * Las consecuencias no se leían como un defecto de horarios. Un día guardado
 * sólo con horas propias —que la pantalla pinta «Manual» y cuenta en las 44 h—
 * era DÍA LIBRE para el kiosco: pedía autorización de supervisor para marcar y
 * la asistencia lo daba por ausente. Y la función de SQL invertía el valor por
 * defecto: sin la clave `isOff` daba el día por libre, al revés de JavaScript,
 * donde lo ausente es falso. Es la misma regla que ya costó
 * `get_traslados_por_recibir`: **el predicado se escribe en la verdad de
 * JavaScript**, porque la verdad de JavaScript es la que escribió el dato.
 *
 * Este archivo es el único lugar donde vive esa resolución. Su gemelo de SQL es
 * `public.turno_del_dia(jsonb, jsonb)` y se movió en la misma migración; los dos
 * están anclados sobre los mismos casos en `tests/unit/turnoDelDia.test.js`.
 *
 * **Sin dependencias, a propósito** — igual que `utils/semana.js`. Lo importan
 * el kiosco, la planilla de la pantalla y el calendario, y ninguno tiene que
 * arrastrar íconos por leer un horario.
 */

// ── Lo que manda el Reglamento Interno de Trabajo ────────────────────────────
// Art. 16 · las horas diurnas van de las 6 a las 19; las nocturnas, de las 19 a
// las 6 del día siguiente. La jornada diurna no excede de 8 h diarias ni la
// nocturna de 7. La semana diurna no excede de 44 h ni la nocturna de 39. Una
// jornada con MÁS DE CUATRO horas nocturnas se considera nocturna entera.
// Art. 19 · un día de descanso remunerado por semana.
// Art. 21 · entre el fin de una jornada y el inicio de la siguiente, ocho horas.
export const HORAS_SEMANA_DIURNA   = 44;
export const HORAS_SEMANA_NOCTURNA = 39;
export const HORAS_JORNADA_DIURNA  = 8;
export const HORAS_JORNADA_NOCTURNA = 7;
export const DESCANSOS_POR_SEMANA  = 1;
export const HORAS_ENTRE_JORNADAS  = 8;
export const INICIO_NOCTURNO = 19 * 60;   // 19:00
export const FIN_NOCTURNO    =  6 * 60;   // 06:00
// Toda pausa alimenticia del reglamento dura una hora. Es el valor por defecto,
// no un tope: el turno puede declarar la suya.
export const MINUTOS_DE_PAUSA = 60;

/* Clave del día dentro de `employee_rosters.schedule_data` y de
 * `schedule_coverage.day_of_week`.
 *
 * **Domingo es 0**, que es lo que devuelve `Date.getDay()` y lo que hay
 * guardado: medido sobre las 103 filas que había en producción, las únicas
 * claves que existen son "0".."6" y no hay ni una "7".
 *
 * Existía por escrito la convención contraria en seis lugares, y el resultado
 * era que el domingo era invisible: el kiosco buscaba una clave inexistente,
 * daba el día por libre y pedía autorización de supervisor en cada marcaje
 * dominical. No escribirla a mano de nuevo. */
export const claveDeDia = (date) => String(new Date(date).getDay());

/** "HH:MM" → minutos desde medianoche. Lo que no parece una hora vale 0. */
export const aMinutos = (hora) => {
    if (!hora) return 0;
    const [h, m] = String(hora).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h * 60 + m;
};

/** minutos desde medianoche → "HH:MM" (24 h, para guardar). */
export const aHora = (mins) => {
    const m = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** La hora de un turno puede venir como `start_time` ("07:00:00") o `start`
 *  ("07:00"), según por dónde entró a memoria. Las dos formas son la misma. */
const horaDelTurno = (turno, extremo) => {
    if (!turno) return null;
    const crudo = extremo === 'inicio'
        ? (turno.start_time ?? turno.start)
        : (turno.end_time   ?? turno.end);
    if (!crudo) return null;
    return String(crudo).substring(0, 5);
};

/**
 * Resuelve QUÉ trabaja una persona un día concreto.
 *
 * @param {object|string|null} datosDelDia  el valor de `schedule_data[clave]`
 * @param {Array}  turnos                   el catálogo (`shifts`)
 * @returns {{
 *   trabaja: boolean, inicio: string|null, fin: string|null,
 *   turnoId: string|null, nombre: string, esManual: boolean,
 *   pausa: {inicio: string, minutos: number}|null,
 *   lactancia: {inicio: string, minutos: number}|null,
 *   minutosBrutos: number, minutosPagados: number,
 *   minutosNocturnos: number, esJornadaNocturna: boolean,
 *   cruzaMedianoche: boolean,
 * }}
 */
export function resolverTurnoDelDia(datosDelDia, turnos) {
    const libre = {
        trabaja: false, inicio: null, fin: null, turnoId: null,
        nombre: '', esManual: false, pausa: null, lactancia: null,
        minutosBrutos: 0, minutosPagados: 0,
        minutosNocturnos: 0, esJornadaNocturna: false, cruzaMedianoche: false,
    };

    let dia = datosDelDia;
    if (typeof dia === 'string') {
        try { dia = JSON.parse(dia || 'null'); } catch { return libre; }
    }
    if (!dia || typeof dia !== 'object') return libre;

    // La verdad de JavaScript: ausente, null, false, 0 y "" son todos «no está
    // libre». Escribirlo al revés es lo que hacía invisible al día en SQL.
    if (dia.isOff || dia.isOffDay) return libre;

    const turnoId = dia.shiftId ?? dia.shift_id ?? null;
    const turno = turnoId != null && turnoId !== ''
        ? (turnos || []).find(t => String(t.id) === String(turnoId))
        : null;

    // Las horas propias del día MANDAN sobre las del catálogo: así es como se
    // guarda un cambio de turno aprobado o una corrección de Talento Humano.
    const inicio = dia.customStart || horaDelTurno(turno, 'inicio');
    const fin    = dia.customEnd   || horaDelTurno(turno, 'fin');
    if (!inicio || !fin) return libre;

    let iMin = aMinutos(inicio);
    let fMin = aMinutos(fin);
    const cruzaMedianoche = fMin < iMin;
    if (cruzaMedianoche) fMin += 1440;
    if (fMin === iMin) return libre;   // entrada = salida no es una jornada

    // ── Pausa alimenticia ────────────────────────────────────────────────────
    // Manda `hasLunch` del día. La HORA sale del día y, si no la trae, del
    // turno: desde 2026-08-27 el catálogo guarda la pausa de cada turno
    // (`lunch_start` / `lunch_minutes`) para no volver a marcarla a mano en
    // cada celda. La DURACIÓN se toma igual: día, turno, y una hora por defecto.
    let pausa = null;
    if (dia.hasLunch) {
        const hora = dia.lunchStart || dia.lunch_start || turno?.lunch_start;
        if (hora) {
            pausa = {
                inicio: String(hora).substring(0, 5),
                minutos: Number(dia.lunchMinutes ?? turno?.lunch_minutes ?? MINUTOS_DE_PAUSA),
            };
        }
    }

    // ── Lactancia ────────────────────────────────────────────────────────────
    // RIT: «serán contadas como hora efectiva de trabajo y remunerada como
    // tal». O sea que NO se descuenta — sólo parte el bloque en la pantalla.
    let lactancia = null;
    if (dia.hasLactation) {
        const hora = dia.lactationStart || dia.lactation_start;
        if (hora) {
            lactancia = {
                inicio: String(hora).substring(0, 5),
                minutos: Number(dia.lactationMinutes ?? MINUTOS_DE_PAUSA),
            };
        }
    }

    const minutosBrutos  = fMin - iMin;
    const minutosPagados = minutosBrutos - (pausa?.minutos || 0);
    const minutosNocturnos = minutosNocturnosDe(iMin, fMin);

    return {
        trabaja: true,
        inicio, fin,
        turnoId: turnoId != null && turnoId !== '' ? String(turnoId) : null,
        nombre: turno?.name || 'Manual',
        esManual: !turno,
        pausa, lactancia,
        minutosBrutos, minutosPagados, minutosNocturnos,
        // RIT Art. 16 · más de cuatro horas nocturnas vuelven nocturna a toda
        // la jornada, y con eso baja el tope de 8 h a 7.
        esJornadaNocturna: minutosNocturnos > 4 * 60,
        cruzaMedianoche,
    };
}

/** Minutos de un tramo que caen en la franja nocturna (19:00–06:00).
 *  `fin` puede pasar de 1440 cuando la jornada cruza la medianoche.
 *
 *  Se cruzan intervalos en vez de recorrer minuto a minuto: es la misma cuenta
 *  y no reserva nada. Recorrer el día minuto a minuto es justo lo que hacía el
 *  cálculo de cobertura del calendario, y costaba 20.160 `Set` por semana. */
export function minutosNocturnosDe(iMin, fMin) {
    let nocturnos = 0;
    for (let dia = -1; dia <= 1; dia++) {
        const base = dia * 1440;
        // 19:00 → medianoche, y medianoche → 06:00.
        for (const [a, b] of [[base + INICIO_NOCTURNO, base + 1440], [base, base + FIN_NOCTURNO]]) {
            nocturnos += Math.max(0, Math.min(fMin, b) - Math.max(iMin, a));
        }
    }
    return nocturnos;
}

/** Los tramos en que se parte una jornada, para pintarla. */
export function tramosDeLaJornada(resuelto) {
    if (!resuelto?.trabaja) return [];
    let inicio = aMinutos(resuelto.inicio);
    let fin    = aMinutos(resuelto.fin);
    if (fin < inicio) fin += 1440;

    const cortes = [];
    if (resuelto.pausa) {
        let s = aMinutos(resuelto.pausa.inicio);
        if (s < inicio) s += 1440;
        cortes.push({ tipo: 'pausa', inicio: s, fin: s + resuelto.pausa.minutos, etiqueta: 'almuerzo' });
    }
    if (resuelto.lactancia) {
        let s = aMinutos(resuelto.lactancia.inicio);
        if (s < inicio) s += 1440;
        cortes.push({ tipo: 'lactancia', inicio: s, fin: s + resuelto.lactancia.minutos, etiqueta: 'lactancia' });
    }
    cortes.sort((a, b) => a.inicio - b.inicio);

    const tramos = [];
    let cursor = inicio;
    for (const corte of cortes) {
        if (cursor < corte.inicio) tramos.push({ tipo: 'trabajo', inicio: cursor, fin: corte.inicio });
        tramos.push(corte);
        cursor = Math.max(cursor, corte.fin);
    }
    if (cursor < fin) tramos.push({ tipo: 'trabajo', inicio: cursor, fin });
    return tramos;
}

/** Lo que el reglamento no deja pasar en UN día. Devuelve textos, no códigos:
 *  quien los lee es quien arma el horario, no un programa. */
export function reparosDelDia(resuelto, { horaDeApertura = null, horaDeCierre = null } = {}) {
    const reparos = [];
    if (!resuelto?.trabaja) return reparos;

    const horas = resuelto.minutosPagados / 60;
    const tope  = resuelto.esJornadaNocturna ? HORAS_JORNADA_NOCTURNA : HORAS_JORNADA_DIURNA;
    if (horas > tope) {
        reparos.push(resuelto.esJornadaNocturna
            ? `La jornada es nocturna y dura ${redondear(horas)} h: el reglamento la limita a ${HORAS_JORNADA_NOCTURNA}.`
            : `La jornada dura ${redondear(horas)} h y el reglamento la limita a ${HORAS_JORNADA_DIURNA}.`);
    }

    if (resuelto.pausa) {
        let ini = aMinutos(resuelto.inicio);
        let fin = aMinutos(resuelto.fin); if (fin < ini) fin += 1440;
        let p   = aMinutos(resuelto.pausa.inicio); if (p < ini) p += 1440;
        // La pausa va DENTRO de la jornada, y nada más. La ventana fija de
        // 11:00 a 14:30 que había acá rechazaba las pausas del propio
        // reglamento, que las tiene a las 18:00 y a las 19:00.
        if (p < ini || p + resuelto.pausa.minutos > fin) {
            reparos.push('La pausa alimenticia queda fuera de la jornada.');
        }
        if (resuelto.lactancia) {
            let l = aMinutos(resuelto.lactancia.inicio); if (l < ini) l += 1440;
            // RIT: «Las interrupciones en la jornada laboral no podrán ser
            // utilizadas en la hora de almuerzo». Es solapamiento, no igualdad:
            // comparar sólo la hora de inicio dejaba pasar 12:00 contra 12:30.
            if (l < p + resuelto.pausa.minutos && p < l + resuelto.lactancia.minutos) {
                reparos.push('La lactancia cae dentro de la pausa alimenticia, y el reglamento no lo permite.');
            }
        }
    }

    if (resuelto.lactancia) {
        let ini = aMinutos(resuelto.inicio);
        let fin = aMinutos(resuelto.fin); if (fin < ini) fin += 1440;
        let l   = aMinutos(resuelto.lactancia.inicio); if (l < ini) l += 1440;
        if (l < ini || l + resuelto.lactancia.minutos > fin) {
            reparos.push('La lactancia queda fuera de la jornada.');
        }
    }

    if (horaDeApertura != null && horaDeCierre != null) {
        let ini = aMinutos(resuelto.inicio);
        let fin = aMinutos(resuelto.fin); if (fin < ini) fin += 1440;
        if (ini < horaDeApertura || fin > horaDeCierre) {
            reparos.push('El turno se sale del horario de atención de la sala.');
        }
    }

    return reparos;
}

/** RIT Art. 21 · entre el fin de una jornada y el inicio de la siguiente deben
 *  mediar ocho horas. Con turnos rotativos es el reparo que más se escapa:
 *  cerrar a las 22:00 y abrir a las 7:00 del día siguiente deja nueve, pero
 *  cerrar a las 22:00 y entrar a las 6:00 deja ocho justas.
 *  `dias` viene en orden cronológico. */
export function descansoInsuficiente(dias) {
    const faltas = [];
    for (let i = 1; i < dias.length; i++) {
        const previo = dias[i - 1], actual = dias[i];
        if (!previo?.resuelto?.trabaja || !actual?.resuelto?.trabaja) continue;
        let finPrevio = aMinutos(previo.resuelto.fin);
        if (finPrevio < aMinutos(previo.resuelto.inicio)) finPrevio += 1440;  // cruzó
        const inicioActual = aMinutos(actual.resuelto.inicio) + 1440;         // día siguiente
        const horas = (inicioActual - finPrevio) / 60;
        if (horas < HORAS_ENTRE_JORNADAS) {
            faltas.push({ desde: previo.fecha, hasta: actual.fecha, horas: redondear(horas) });
        }
    }
    return faltas;
}

const redondear = (n) => Number(n.toFixed(1));
