// Dos acciones de la ficha que no son novedades comunes, escritas una vez para
// el portal (`FormVacationRecall`, `FormRehireEmployee` en `UnifiedModal`) y la
// app (`app/empleado/ingreso-vacaciones.js`, `app/empleado/recontratar.js`).
// La escritura es del store: `vacationRecallEmployee` y `rehireEmployee`.

import { contratoConPlazo } from './contrato';
import { finDeContrato } from './alertasDePersona';
import { diasEntre, fechaTexto, hoySV } from './fecha';

/** Las vacaciones que está gozando HOY (no canceladas), si las hay. */
export function vacacionEnCurso(empleado, hoy) {
    return (empleado?.history || []).find((h) => h.type === 'VACATION'
        && h.date <= hoy
        && (h.metadata?.endDate >= hoy || !h.metadata?.endDate)
        && h.metadata?.status !== 'CANCELLED') || null;
}

/** ¿La fecha del ingreso cae fuera del período de vacaciones? */
export const ingresoFueraDelPeriodo = (fecha, inicio, fin) => !!(fecha && inicio && fin && (fecha < inicio || fecha > fin));

/** Fecha, turno y motivo son obligatorios. */
export const ingresoCompleto = (f = {}) => !!(f.recall_date && f.recall_shift_id && f.recall_reason?.trim());

/** Los tipos de contrato que ofrece la recontratación (incluye medio tiempo). */
export const CONTRATOS_DE_RECONTRATACION = [
    { value: 'INDEFINIDO', label: 'Indefinido (Fijo)' },
    { value: 'TEMPORAL', label: 'Temporal / plazo fijo' },
    { value: 'MEDIO_TIEMPO', label: 'Medio tiempo (part-time)' },
    { value: 'SERVICIOS', label: 'Servicios profesionales' },
];

/** Las horas semanales al cambiar de contrato: medio tiempo son 22; al salir de él, vuelven las 44. */
export function horasAlCambiarContrato(tipo, horasActuales) {
    if (tipo === 'MEDIO_TIEMPO') return '22';
    if (horasActuales === '22') return '44';
    return horasActuales;
}

/** Los valores con que arranca el formulario. */
export const recontratacionInicial = (hoy) => ({ rehire_hire_date: hoy, rehire_contract_type: 'INDEFINIDO', rehire_weekly_hours: '44' });

// Art. 25 Código de Trabajo: un contrato a plazo SOLO es válido si cae en una
// de estas dos bases legales — no hay una tercera opción por ley. El motivo
// concreto (texto libre) sí es abierto y lo define la empresa caso por caso.
// Vive acá y no en `EmployeeFormModal` porque la recontratación también firma
// contratos a plazo y necesita el mismo catálogo.
export const TEMPORAL_LEGAL_BASIS_OPTIONS = [
    { value: 'TRANSITORIO_EVENTUAL', label: 'Labor transitoria, temporal o eventual por su naturaleza (Art. 25 lit. a)' },
    { value: 'TERMINACION_NEGOCIO', label: 'Circunstancia que terminará el negocio total o parcial (Art. 25 lit. b)' },
];

/** Jornada ordinaria semanal diurna: 44 h (Art. 161). El 1 es sólo un piso contra absurdos. */
export const horasValidas = (h) => {
    const n = Number(h);
    return Number.isInteger(n) && n >= 1 && n <= 44;
};

// ── Contrato vencido y contrato nuevo (2026-11-20) ──────────────────────────
//
// Un contrato a plazo vence y la persona sigue ACTIVA en el portal: nada lo
// cerraba. Pasó con un interinato que venció el 18 de noviembre y siguió con
// otro desde el 23: para recontratar había que dar de baja primero y después
// recontratar, dos pasos que nadie sabía que existían. Ahora, a quien tiene el
// contrato vencido se le registra el contrato nuevo de una vez: el store cierra
// el anterior por fin del plazo (Art. 48 ord. 1.º CT) y abre el nuevo.

const fechaCorta = (dia) => fechaTexto(dia, { day: 'numeric', month: 'long' });

/** El fin del contrato a plazo de quien sigue activo con él ya vencido (`AAAA-MM-DD`), o null. */
export function contratoVencido(empleado, hoy = hoySV()) {
    const c = finDeContrato(empleado, hoy);
    return c && c.dias < 0 ? c.fin : null;
}

/** Los días sin contrato entre el fin del anterior y el ingreso del nuevo (sin contar ninguno de los dos). */
export const diasSinContrato = (fin, ingreso) => (fin && ingreso ? diasEntre(fin, ingreso) - 1 : null);

/**
 * Quienes siguen activos con el contrato vencido, del que venció primero al
 * último: `[{ emp, fin, diasVencido }]`.
 */
export function contratosVencidos(empleados = [], hoy = hoySV()) {
    return (empleados || [])
        .map((emp) => {
            const fin = contratoVencido(emp, hoy);
            return fin ? { emp, fin, diasVencido: diasEntre(fin, hoy) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.fin.localeCompare(b.fin));
}

/**
 * Qué falta para poder recontratar, en palabras, o `null` si está completo.
 *
 * Un contrato a PLAZO exige fecha de fin, base legal y motivo (Art. 25). El
 * formulario no los pedía y `rehireEmployee` los guardaba en null: la ficha
 * quedaba TEMPORAL sin respaldo, que el Art. 25 presume indefinido.
 */
export function faltaParaRecontratar(f = {}, empleado = null) {
    if (!(f.rehire_hire_date && f.rehire_branch_id && f.rehire_role_id)) return 'Fecha de ingreso, sucursal y cargo son obligatorios.';
    const vencio = empleado ? contratoVencido(empleado) : null;
    if (vencio) {
        const dias = diasSinContrato(vencio, f.rehire_hire_date);
        if (dias < 0) return `El contrato nuevo tiene que empezar después del ${fechaCorta(vencio)}, cuando terminó el anterior.`;
        if (dias === 0) return 'Empieza al día siguiente del fin del anterior: eso es una prórroga, no un contrato nuevo.';
    }
    if (!horasValidas(f.rehire_weekly_hours ?? 44)) return 'Las horas semanales van de 1 a 44 (Art. 161).';
    const tipo = f.rehire_contract_type || 'INDEFINIDO';
    // La fecha de fin la pide todo contrato con plazo —Temporal y Servicios—,
    // la misma regla del alta (`contratoConPlazo`). La base legal y el motivo
    // son del Art. 25, o sea sólo del Temporal: Servicios es un contrato civil.
    if (contratoConPlazo(tipo)) {
        if (!f.rehire_contract_end_date) return 'Este contrato necesita su fecha de fin.';
        if (f.rehire_contract_end_date <= f.rehire_hire_date) return 'La fecha de fin tiene que ser posterior a la de ingreso.';
    }
    if (tipo === 'TEMPORAL') {
        if (!f.rehire_temporal_legal_basis) return 'Falta por qué es temporal (base legal del Art. 25).';
        if (!String(f.rehire_temporal_reason ?? '').trim()) return 'Falta el motivo concreto del contrato a plazo.';
    }
    return null;
}

/** ¿Se puede recontratar ya? */
export const recontratacionCompleta = (f = {}, empleado = null) => faltaParaRecontratar(f, empleado) === null;

/** Los valores con que arranca el contrato nuevo: el mismo contrato, sucursal, cargo y horas, desde hoy. */
export function contratoNuevoInicial(empleado, hoy = hoySV()) {
    const base = recontratacionInicial(hoy);
    return {
        ...base,
        rehire_contract_type: empleado?.contract_type || base.rehire_contract_type,
        rehire_weekly_hours: String(empleado?.weekly_contracted_hours ?? base.rehire_weekly_hours),
        rehire_branch_id: empleado?.branch_id ?? empleado?.branchId ?? null,
        rehire_role_id: empleado?.role_id ?? null,
        rehire_secondary_role_id: empleado?.secondary_role_id ?? null,
        rehire_temporal_legal_basis: empleado?.contract_temporal_legal_basis || null,
        rehire_temporal_reason: empleado?.contract_temporal_reason || '',
    };
}

/** La línea que explica qué va a pasar al guardar un contrato nuevo. */
export function avisoDeContratoNuevo(empleado, ingreso, hoy = hoySV()) {
    const fin = contratoVencido(empleado, hoy);
    if (!fin) return null;
    const dias = diasSinContrato(fin, ingreso);
    const sin = dias > 0 ? ` Quedan ${dias === 1 ? '1 día' : `${dias} días`} sin contrato.` : '';
    return `El contrato anterior terminó el ${fechaCorta(fin)}. Al guardar, se cierra por fin del plazo y empieza el nuevo.${sin}`;
}

/** Lo que se le manda a `rehireEmployee`. */
export const datosDeRecontratacion = (f = {}) => ({
    hire_date: f.rehire_hire_date,
    branch_id: f.rehire_branch_id,
    role_id: f.rehire_role_id,
    secondary_role_id: f.rehire_secondary_role_id || null,
    contract_type: f.rehire_contract_type || 'INDEFINIDO',
    weekly_contracted_hours: f.rehire_weekly_hours || 44,
    base_salary: f.rehire_base_salary || null,
    contract_end_date: f.rehire_contract_end_date || null,
    contract_temporal_legal_basis: f.rehire_temporal_legal_basis || null,
    contract_temporal_reason: String(f.rehire_temporal_reason ?? '').trim() || null,
    notes: f.rehire_notes || '',
});

/** Las sucursales agrupadas por área, en el orden del formulario. */
export const AREAS_DE_SUCURSAL = [['FARMACIA', 'Farmacias'], ['BODEGA', 'Bodega'], ['ADMINISTRATIVA', 'Administración'], ['EXTERNA', 'Personal Externo']];
export const sucursalesPorArea = (sucursales = []) => AREAS_DE_SUCURSAL
    .map(([tipo, rotulo]) => ({ tipo, rotulo, salas: sucursales.filter((b) => (b.type || 'FARMACIA') === tipo) }))
    .filter((g) => g.salas.length);
