/**
 * Las reglas de una solicitud PERSONAL (vacaciones, permiso, incapacidad,
 * cambio de turno, anticipo, constancia, horas extra) — lo que decide si se
 * puede pedir y qué se guarda.
 *
 * Vivían dentro de `views/solicitudes/ModalNuevaPersonal.jsx`. Se mudaron el
 * 2026-10-01 cuando la app empezó a crear estas solicitudes: escritas dos
 * veces, el día que cambie una regla (la antigüedad, el solape con una
 * incapacidad) el teléfono dejaría pedir lo que el portal frena. Ahora las dos
 * pantallas preguntan acá.
 *
 * Todo es puro: recibe la persona, sus solicitudes y la fecha de hoy.
 */
import { fechaTexto } from './fecha';

export const TIPOS_PERSONALES = ['VACATION', 'PERMIT', 'DISABILITY', 'SHIFT_CHANGE', 'ADVANCE', 'CERTIFICATE', 'OVERTIME'];

export const CERT_TYPES = [
    { key: 'LABORAL',  label: 'Constancia Laboral',    desc: 'Confirma la relación de trabajo' },
    { key: 'SALARIO',  label: 'Constancia de Salario', desc: 'Incluye el salario mensual' },
    { key: 'BANCARIA', label: 'Constancia Bancaria',   desc: 'Para gestión o apertura de cuenta' },
];

const fmtCorto = (d) => (d ? fechaTexto(d, { day: '2-digit', month: 'short' }) : '');
export const periodoDe = (d) => `${fmtCorto(d.startDate)} – ${fmtCorto(d.endDate)}`;

/** Días de un rango, contando los dos extremos. */
export function diasDe(inicio, fin) {
    if (!inicio || !fin) return 0;
    const a = new Date(`${inicio}T00:00:00`);
    const b = new Date(`${fin}T00:00:00`);
    return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

/** El último día de una incapacidad de `dias` días que empieza en `inicio`. */
export function finDeIncapacidad(inicio, dias) {
    if (!inicio || !(Number(dias) >= 1)) return null;
    const d = new Date(`${inicio}T00:00:00`);
    d.setDate(d.getDate() + Number(dias) - 1);
    return d.toISOString().split('T')[0];
}

/**
 * La antigüedad para las vacaciones: hace falta un año cumplido. La ventana
 * aniversario + 90 días es informativa (no frena).
 */
export function antiguedadDe(hireDate, ahora = new Date()) {
    if (!hireDate) return null;
    const hoy = new Date(ahora); hoy.setHours(0, 0, 0, 0);
    const ingreso = new Date(`${hireDate}T12:00:00`); ingreso.setHours(0, 0, 0, 0);
    const msAnio = 365.25 * 24 * 3600 * 1000;
    const aniosExactos = (hoy.getTime() - ingreso.getTime()) / msAnio;
    const mesesTotales = Math.floor((hoy.getTime() - ingreso.getTime()) / (30.44 * 24 * 3600 * 1000));
    const anios = Math.floor(aniosExactos);
    const meses = mesesTotales - anios * 12;

    if (aniosExactos < 1) {
        const primerAniv = new Date(ingreso); primerAniv.setFullYear(ingreso.getFullYear() + 1);
        const faltan = Math.ceil((primerAniv.getTime() - hoy.getTime()) / (24 * 3600 * 1000));
        return { habilitado: false, anios, meses, faltan, ingreso: hireDate };
    }
    const ultimoAniv = new Date(ingreso); ultimoAniv.setFullYear(ingreso.getFullYear() + anios);
    const finVentana = new Date(ultimoAniv); finVentana.setDate(finVentana.getDate() + 90);
    const proxAniv = new Date(ingreso); proxAniv.setFullYear(ingreso.getFullYear() + anios + 1);
    return {
        habilitado: true, anios, meses, ingreso: hireDate,
        enVentana: hoy <= finVentana,
        inicioVentana: ultimoAniv.toISOString().split('T')[0],
        finVentana: finVentana.toISOString().split('T')[0],
        proxAniv: proxAniv.toISOString().split('T')[0],
    };
}

const metaDe = (r) => (typeof r.metadata === 'object' && r.metadata !== null
    ? r.metadata
    : (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })());

/** Las incapacidades APROBADAS que todavía no terminaron. */
export function incapacidadesVigentes(solicitudes = [], hoy) {
    return (solicitudes || [])
        .filter((r) => r.type === 'DISABILITY' && r.status === 'APPROVED')
        .map((r) => { const m = metaDe(r); return { startDate: m.startDate, endDate: m.endDate }; })
        .filter((d) => d.startDate && d.endDate && d.endDate >= hoy);
}

export const choqueEnDia = (incapacidades, fecha) =>
    incapacidades.find((d) => fecha >= d.startDate && fecha <= d.endDate) ?? null;

/** Estricto a propósito: una incapacidad nueva puede empezar el día que termina la anterior. */
export const choqueEnRango = (incapacidades, desde, hasta) =>
    incapacidades.find((d) => desde < d.endDate && hasta > d.startDate) ?? null;

/**
 * Lo que falta para poder enviar la solicitud, con el campo al que pertenece:
 * `{ texto, campo }`, o `null` si se puede (2026-11-14). `campo` es una clave
 * del formulario —`empleado`, `nota`, `periodo`, `permiso`, `companero`,
 * `fecha`, `monto`, `constancia`, `horas`, `inicio`, `dias`— o `null` cuando
 * no hay campo que lo arregle (la antigüedad, unas vacaciones ya aprobadas).
 * La pantalla la usa para decirlo al lado del botón y llevar hasta el campo.
 *
 * @param {object} ctx — empleadoId, tipo, payload, nota, antiguedad,
 *   vacacionAprobada, incapacidades, companeroOcupado, anioActual
 */
export function faltaParaEnviar({
    empleadoId, tipo, payload = {}, nota = '', antiguedad, vacacionAprobada = false,
    incapacidades = [], companeroOcupado = null, anioActual = new Date().getFullYear(),
}) {
    const f = (texto, campo = null) => ({ texto, campo });
    if (!empleadoId) return f('Elige a nombre de quién va la solicitud.', 'empleado');
    if (!String(nota).trim()) return f('El motivo es obligatorio.', 'nota');

    if (tipo === 'VACATION') {
        if (!payload.startDate || !payload.endDate) return f('Selecciona el período de vacaciones.', 'periodo');
        if (!antiguedad?.habilitado) return f('Todavía no se cumple 1 año en la empresa para pedir vacaciones.');
        if (vacacionAprobada) return f('Ya hay vacaciones aprobadas para este período.');
        if (payload.startDate.slice(0, 4) < String(anioActual)) return f('No se pueden elegir fechas de años anteriores.', 'periodo');
        if (payload.endDate < payload.startDate) return f('El último día no puede ser antes del primero.', 'periodo');
    }
    if (tipo === 'PERMIT') {
        if (!(payload.permissionDates || []).length) return f('Selecciona al menos un día de permiso.', 'permiso');
        const chocado = payload.permissionDates.find((d) => choqueEnDia(incapacidades, d));
        if (chocado) return f(`El día ${fmtCorto(chocado)} cae dentro de una incapacidad vigente (${periodoDe(choqueEnDia(incapacidades, chocado))}).`, 'permiso');
    }
    if (tipo === 'SHIFT_CHANGE') {
        if (!payload.targetEmployeeId || !payload.date) {
            return f('Selecciona el compañero y la fecha del cambio.', !payload.targetEmployeeId ? 'companero' : 'fecha');
        }
        const propio = choqueEnDia(incapacidades, payload.date);
        if (propio) return f(`Hay una incapacidad del ${periodoDe(propio)} — no se puede cambiar turno esa fecha.`, 'fecha');
        if (companeroOcupado) return f(`El compañero está ${companeroOcupado.motivo} en esa fecha.`, 'companero');
    }
    if (tipo === 'ADVANCE' && (!payload.amount || Number(payload.amount) <= 0)) return f('Ingresa el monto del anticipo.', 'monto');
    if (tipo === 'CERTIFICATE' && !payload.certificateType) return f('Selecciona el tipo de constancia.', 'constancia');
    if (tipo === 'OVERTIME') {
        if (!payload.date) return f('Selecciona la fecha de las horas extra.', 'fecha');
        if (!payload.hours || Number(payload.hours) <= 0) return f('Ingresa cuántas horas.', 'horas');
    }
    if (tipo === 'DISABILITY') {
        const fin = finDeIncapacidad(payload.startDate, payload.days);
        if (!payload.startDate || !fin) return f('Ingresa la fecha de inicio y la cantidad de días.', !payload.startDate ? 'inicio' : 'dias');
        const solape = choqueEnRango(incapacidades, payload.startDate, fin);
        if (solape) return f(`Ya hay una incapacidad aprobada del ${periodoDe(solape)} — esas fechas se solapan.`, 'inicio');
    }
    return null;
}

/**
 * El motivo por el que la solicitud NO se puede enviar, o `null` si se puede.
 * Los mismos textos que mostraba el portal (y que muestra la app). Es el
 * texto de `faltaParaEnviar`.
 *
 * @param {object} ctx — empleadoId, tipo, payload, nota, antiguedad,
 *   vacacionAprobada, incapacidades, companeroOcupado, anioActual
 */
export function motivoParaNoEnviar(ctx) {
    return faltaParaEnviar(ctx)?.texto ?? null;
}

/** El compañero no puede cambiar turno el día que está de permiso, vacaciones o incapacidad. */
export function companeroNoDisponible(eventos = [], fecha) {
    if (!eventos?.length || !fecha) return null;
    const b = eventos.find((ev) => fecha >= ev.date && fecha <= (ev.metadata?.endDate || ev.date));
    const rotulos = { DISABILITY: 'incapacitado', PERMIT: 'con permiso', VACATION: 'de vacaciones' };
    return b ? { motivo: rotulos[b.type] || 'no disponible' } : null;
}
