// Dos acciones de la ficha que no son novedades comunes, escritas una vez para
// el portal (`FormVacationRecall`, `FormRehireEmployee` en `UnifiedModal`) y la
// app (`app/empleado/ingreso-vacaciones.js`, `app/empleado/recontratar.js`).
// La escritura es del store: `vacationRecallEmployee` y `rehireEmployee`.

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

/** Fecha de ingreso, sucursal y cargo son obligatorios. */
export const recontratacionCompleta = (f = {}) => !!(f.rehire_hire_date && f.rehire_branch_id && f.rehire_role_id);

/** Lo que se le manda a `rehireEmployee`. */
export const datosDeRecontratacion = (f = {}) => ({
    hire_date: f.rehire_hire_date,
    branch_id: f.rehire_branch_id,
    role_id: f.rehire_role_id,
    secondary_role_id: f.rehire_secondary_role_id || null,
    contract_type: f.rehire_contract_type || 'INDEFINIDO',
    weekly_contracted_hours: f.rehire_weekly_hours || 44,
    base_salary: f.rehire_base_salary || null,
    notes: f.rehire_notes || '',
});

/** Las sucursales agrupadas por área, en el orden del formulario. */
export const AREAS_DE_SUCURSAL = [['FARMACIA', 'Farmacias'], ['BODEGA', 'Bodega'], ['ADMINISTRATIVA', 'Administración'], ['EXTERNA', 'Personal Externo']];
export const sucursalesPorArea = (sucursales = []) => AREAS_DE_SUCURSAL
    .map(([tipo, rotulo]) => ({ tipo, rotulo, salas: sucursales.filter((b) => (b.type || 'FARMACIA') === tipo) }))
    .filter((g) => g.salas.length);
