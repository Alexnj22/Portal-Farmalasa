// La edición del horario —una celda del día y el catálogo de turnos—, dicha
// una vez para el portal (`InlineDayEditor`, `TabShifts`) y la app.
//
// Vivía dentro de los dos componentes del portal. La app necesita exactamente
// la misma cuenta: qué turnos del catálogo caben en el horario de la sala ese
// día, qué se guarda cuando se elige «libre» o un turno sin horas, cómo se
// agrupa el catálogo y qué reparos tiene un turno nuevo. Una copia de cualquiera
// de esas reglas en la app nace distinta (es lo que ya pasó con la cobertura
// del día), y un día guardado con otra forma lo lee distinto el kiosco.
//
// El día en sí lo sigue resolviendo `resolverTurnoDelDia` (un día de horario se
// resuelve en UN solo sitio): acá sólo se arma lo que se le pasa y lo que sale.
import { aMinutos, resolverTurnoDelDia, reparosDelDia } from './turnoDelDia';
import { tokenMatch } from './searchUtils';

const hhmm = (t) => (t ? String(t).substring(0, 5) : '');
const horaLimpia = (t) => String(t || '').replace(/[^0-9:]/g, '').trim();

/** El horario semanal guardado de una sala (objeto, o texto JSON viejo). */
function horarioDeLaSala(sala) {
    let sch = sala?.weekly_hours || sala?.settings?.schedule;
    if (typeof sch === 'string') { try { sch = JSON.parse(sch); } catch { sch = null; } }
    return sch && typeof sch === 'object' ? sch : null;
}

/**
 * El horario de atención de una sala UN día (`dia` = 0 domingo … 6 sábado).
 * `hayHorario` dice si la sala lo tiene configurado; `cerrada`, si ese día no
 * abre. Los minutos de cierre pasan de 1440 cuando cruza la medianoche.
 */
export function limitesDeLaSalaElDia(sala, dia) {
    const lim = { apertura: 1440, cierre: 0, cerrada: false, hayHorario: false, nombre: sala?.name || 'la sucursal' };
    const d = horarioDeLaSala(sala)?.[dia];
    if (!d) return lim;
    if (d.isClosed || d.isOff || d.isOpen === false) return { ...lim, cerrada: true, hayHorario: true };
    const ini = horaLimpia(d.start || d.open);
    const fin = horaLimpia(d.end || d.close);
    if (!ini || !fin) return lim;
    const a = aMinutos(ini);
    let c = aMinutos(fin);
    if (c < a) c += 1440;
    return { ...lim, apertura: a, cierre: c, hayHorario: true };
}

/** El horario de atención de una sala en toda la semana: la apertura más temprana y el cierre más tardío. */
export function limitesDeLaSalaEnLaSemana(sala) {
    let apertura = 1440, cierre = 0, hayHorario = false;
    Object.values(horarioDeLaSala(sala) || {}).forEach((d) => {
        if (!d?.isOpen || !d.start || !d.end) return;
        const ini = horaLimpia(d.start), fin = horaLimpia(d.end);
        if (!ini || !fin) return;
        const a = aMinutos(ini);
        let c = aMinutos(fin);
        if (c < a) c += 1440;
        apertura = Math.min(apertura, a);
        cierre = Math.max(cierre, c);
        hayHorario = true;
    });
    return { apertura, cierre, hayHorario, nombre: sala?.name };
}

const esActivo = (t) => t.is_active !== false && t.isActive !== false;
const esGlobal = (t) => (!t.branch_id && !t.branchId) || String(t.branch_id) === 'null' || String(t.branchId) === 'null';
const iniDe = (t) => hhmm(t.start_time) || t.start;
const finDe = (t) => hhmm(t.end_time) || t.end;

/**
 * Los turnos del catálogo que se pueden asignar ese día en esa sala: activos,
 * globales, que caben dentro del horario de atención, sin repetir (el catálogo
 * agrupa por nombre + horas). Si la sala no tiene horario o cierra, ninguno.
 */
export function turnosQueCabenElDia(turnos, limites) {
    if (!turnos || !limites?.hayHorario || limites.cerrada) return [];
    const vistos = new Set();
    return turnos.filter((t) => esGlobal(t) && esActivo(t)).filter((t) => {
        const a = aMinutos(iniDe(t));
        let c = aMinutos(finDe(t));
        if (c < a) c += 1440;
        return a >= limites.apertura && c <= limites.cierre;
    }).filter((t) => {
        const k = `${t.name}_${t.start_time || t.start}_${t.end_time || t.end}`;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
    });
}

/** Las horas (y la pausa) que trae un turno del catálogo al elegirlo. */
export function horasDelTurno(turno) {
    if (!turno) return null;
    return {
        inicio: iniDe(turno), fin: finDe(turno),
        conPausa: Boolean(turno.lunch_start),
        pausa: turno.lunch_start ? hhmm(turno.lunch_start) : null,
    };
}

/**
 * Lo que se escribe para un día. `turno` es el id del catálogo, `'OFF'` para
 * libre, o vacío para horas propias. Un día sin turno y sin hora de entrada
 * queda libre. Es la forma exacta que leen el kiosco, la planilla y la grilla.
 */
export function datosDelDiaParaGuardar({ turno, inicio, fin, conPausa, pausa, conLactancia, lactancia }) {
    const libreElegido = turno === 'OFF';
    const id = (libreElegido || turno === 'NO_SHIFTS') ? '' : (turno || '');
    const libre = libreElegido || (!id && !inicio);
    return {
        shiftId: id,
        customStart: libre ? '' : (inicio || ''),
        customEnd: libre ? '' : (fin || ''),
        hasLunch: libre ? false : Boolean(conPausa),
        lunchStart: (conPausa && !libre) ? pausa : null,
        hasLactation: libre ? false : Boolean(conLactancia),
        lactationStart: (conLactancia && !libre) ? lactancia : null,
        isOff: libre,
    };
}

/** Lo que el reglamento y la sala no dejan guardar en un día con horas. */
export function reparosDeLaCelda({ turno, inicio, fin, conPausa, pausa, conLactancia, lactancia }, turnos, limites) {
    if (turno === 'OFF' || turno === 'NO_SHIFTS') return [];
    if (inicio && fin && aMinutos(inicio) === aMinutos(fin)) return ['La hora de entrada y la de salida no pueden ser la misma.'];
    const r = resolverTurnoDelDia({
        shiftId: turno || '', customStart: inicio, customEnd: fin,
        hasLunch: conPausa, lunchStart: pausa, hasLactation: conLactancia, lactationStart: lactancia, isOff: false,
    }, turnos || []);
    return reparosDelDia(r, limites?.hayHorario && !limites.cerrada
        ? { horaDeApertura: limites.apertura, horaDeCierre: limites.cierre } : {});
}

/**
 * El catálogo agrupado como lo pinta el portal: un grupo por nombre + horas
 * (puede haber varias filas con lo mismo), filtrado por activos/archivados y
 * por búsqueda, ordenado por hora de entrada.
 */
export function gruposDelCatalogo(turnos, { archivados = false, busqueda = '' } = {}) {
    const mapa = {};
    (turnos || []).filter((t) => (archivados ? !esActivo(t) : esActivo(t)))
        .filter((t) => !busqueda || tokenMatch(busqueda, t.name))
        .forEach((t) => {
            const k = `${t.name}_${t.start_time || t.start}_${t.end_time || t.end}`;
            if (!mapa[k]) {
                mapa[k] = {
                    groupId: k, name: t.name, start: iniDe(t) || '', end: finDe(t) || '',
                    lunchStart: t.lunch_start ? hhmm(t.lunch_start) : '',
                    lunchMinutes: t.lunch_minutes ?? 60, all_ids: [t.id], shifts_data: [t],
                };
            } else { mapa[k].all_ids.push(t.id); mapa[k].shifts_data.push(t); }
        });
    return Object.values(mapa).sort((a, b) => aMinutos(a.start) - aMinutos(b.start));
}

/**
 * La revisión de un turno nuevo o editado: el nombre que toma solo (Apertura,
 * Enlace, Cierre), los reparos del reglamento y si choca con otro turno activo
 * de las mismas horas (eso sí bloquea).
 */
export function revisionDelTurno(form, turnos, editando = null) {
    let nombre = 'Turno estándar';
    const alertas = [];
    let bloqueante = false;
    if (form?.start && form?.end) {
        const a = aMinutos(form.start);
        let c = aMinutos(form.end);
        if (c < a) c += 1440;
        nombre = a <= 480 ? 'Apertura' : c >= 1020 ? 'Cierre' : 'Enlace';
        const r = resolverTurnoDelDia({
            customStart: form.start, customEnd: form.end,
            hasLunch: Boolean(form.lunchStart), lunchStart: form.lunchStart, lunchMinutes: form.lunchMinutes,
        }, []);
        reparosDelDia(r).forEach((texto) => alertas.push({ type: 'warning', text: texto }));
        const repetido = (turnos || []).some((t) => esActivo(t)
            && iniDe(t) === form.start && finDe(t) === form.end
            && (editando ? !editando.all_ids.includes(t.id) : true));
        if (repetido) { alertas.push({ type: 'error', text: 'Ya existe un turno con exactamente estas mismas horas.' }); bloqueante = true; }
    }
    return {
        autoName: nombre, activeAlerts: alertas, hasBlockingError: bloqueante,
        primerReparo: alertas.find((x) => x.type === 'error')?.text || alertas[0]?.text || null,
    };
}
