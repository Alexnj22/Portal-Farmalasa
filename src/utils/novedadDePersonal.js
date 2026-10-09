// Una acción de personal (novedad) sobre la ficha de alguien — traslado, cambio
// de cargo, ajuste salarial, vacaciones, incapacidad, permiso, apoyo temporal,
// cambio de código, inducción, baja, recontratación. Las REGLAS del formulario,
// escritas una vez para el portal (`FormNovedad.jsx`) y la app
// (`app/empleado/accion.js`). La escritura es la misma en los dos:
// `registerEmployeeEvent` / `editEmployeeEvent` del store.
import { EVENT_TYPES } from '../data/constants';
import { buscarCargo } from './roles';

/** Las acciones que se ofrecen: los turnos van por Horarios y las sanciones por su propio diálogo. */
export const opcionesDeNovedad = () => Object.keys(EVENT_TYPES)
    .filter((key) => key !== 'SHIFT_CHANGE')
    .filter((key) => !EVENT_TYPES[key].soloPorSancion)
    .map((key) => ({ value: key, label: EVENT_TYPES[key].label }));

/** Qué es cada tipo, para decidir campos y validaciones. */
export function rasgosDeNovedad(type, formData = {}) {
    const esApoyo = type === 'SUPPORT';
    return {
        esCargo: type === 'PROMOTION',
        esSalario: type === 'SALARY',
        esBaja: type === 'TERMINATION',
        esVacacion: type === 'VACATION',
        esIncapacidad: type === 'DISABILITY',
        esCodigo: type === 'CODE_CHANGE',
        esPermiso: type === 'PERMIT',
        esApoyo,
        esTraslado: type === 'TRANSFER' || esApoyo || !!formData?.isTransferAndPromotion,
        // Rango continuo de días (inicio y fin).
        esRango: ['VACATION', 'DISABILITY', 'SUPPORT'].includes(type),
    };
}

/** Si cambia de cargo o de sala hacia una plaza con tope ya llena: quiénes la ocupan. */
export function plazaOcupada({ type, formData = {}, empleado, empleados = [], roles = [] }) {
    const r = rasgosDeNovedad(type, formData);
    if (!r.esCargo && !r.esTraslado) return null;
    const sala = r.esTraslado ? formData.targetBranchId : (empleado?.branchId || empleado?.branch_id);
    const cargo = r.esCargo ? formData.newRole : empleado?.role;
    if (!cargo) return null;
    const config = buscarCargo(roles, cargo);
    if (!config || config.max_limit >= 99) return null;
    const ocupantes = empleados.filter((e) => {
        if (e.status !== 'ACTIVO') return false;
        if (e.role !== cargo) return false;
        if (String(e.id) === String(empleado?.id)) return false;
        if (config.scope === 'BRANCH') return String(e.branchId || e.branch_id) === String(sala);
        return true;
    });
    return ocupantes.length >= config.max_limit
        ? { role: cargo, limit: config.max_limit, scope: config.scope, occupants: ocupantes }
        : null;
}

/** El asueto que cae ese día, si cae alguno (los recurrentes se comparan por mes y día). */
export function asuetoDelDia(fecha, asuetos = []) {
    if (!fecha) return null;
    const [, m, d] = fecha.split('-');
    const md = `${m}-${d}`;
    return asuetos.find((h) => (h.is_recurring ? String(h.holiday_date).endsWith(md) : h.holiday_date === fecha)) || null;
}

const masDias = (fecha, n) => {
    const d = new Date(`${fecha}T12:00:00`);
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
};

/**
 * El fin que la ley pone solo: vacaciones 15 días continuos, maternidad 112
 * (Art. 309). Para las demás, null (lo elige quien llena).
 */
export function finPorLey(type, fecha, tipoDeIncapacidad = null) {
    if (!fecha) return null;
    if (type === 'VACATION') return masDias(fecha, 14);
    if (type === 'DISABILITY' && tipoDeIncapacidad === 'MATERNIDAD') return masDias(fecha, 111);
    return null;
}

/** El fin de una incapacidad común a partir de cuántos días dio el médico. */
export const finPorDias = (fecha, dias) => (fecha && dias > 0 ? masDias(fecha, dias - 1) : null);

/** El día en que regresa: el siguiente al último de ausencia. */
export const diaDeRegreso = (fin) => (fin ? masDias(fin, 1) : null);

/** Cuántos días cubre el período, contando los dos extremos. */
export function diasDelPeriodo(inicio, fin) {
    if (!inicio || !fin) return 0;
    return Math.ceil((new Date(`${fin}T12:00:00`) - new Date(`${inicio}T12:00:00`)) / 86400000) + 1;
}

/** La advertencia de los días que dicta la ley, si el período no los respeta. */
export function avisoDeDiasDeLey(type, tipoDeIncapacidad, inicio, fin) {
    const n = diasDelPeriodo(inicio, fin);
    if (!fin) return null;
    if (type === 'VACATION' && n !== 15) return 'El código de trabajo dicta 15 días continuos.';
    if (type === 'DISABILITY' && tipoDeIncapacidad === 'MATERNIDAD' && n !== 112) return 'El Art. 309 dicta 112 días (16 semanas) para maternidad.';
    return null;
}

/** Cambios de ficha que pueden programarse: con fecha futura se aplican ese día a las 5:00 a.m. */
export const TIPOS_PROGRAMABLES = ['PROMOTION', 'TRANSFER', 'SALARY', 'CODE_CHANGE', 'TERMINATION'];

/** ¿Este archivo es obligatorio? (la boleta de la incapacidad y el finiquito). */
export const respaldoObligatorio = (type) => type === 'DISABILITY' || type === 'TERMINATION';

/**
 * ¿Se puede guardar? `{ ok, motivo }` — `motivo` sólo cuando hay algo que
 * decirle a quien llena (los campos vacíos se ven solos).
 */
export function validarNovedad({ formData = {}, empleado, empleados = [], roles = [], asuetos = [] }) {
    const type = formData.type;
    if (!type) return { ok: false, motivo: null };
    const r = rasgosDeNovedad(type, formData);
    const plaza = plazaOcupada({ type, formData, empleado, empleados, roles });
    if (plaza) return { ok: false, motivo: `Plaza Ocupada: Límite de ${plaza.role} alcanzado.` };
    if (r.esPermiso && !(formData.permissionDates || []).length) return { ok: false, motivo: null };
    if (!r.esPermiso && !formData.date) return { ok: false, motivo: null };
    const asueto = r.esVacacion ? asuetoDelDia(formData.date, asuetos) : null;
    if (asueto) return { ok: false, motivo: `No se puede iniciar vacaciones en asueto (${asueto.name}).` };
    if (r.esRango && !formData.endDate) return { ok: false, motivo: null };
    if (r.esTraslado && !formData.targetBranchId) return { ok: false, motivo: null };
    if (r.esCargo && !formData.newRole) return { ok: false, motivo: null };
    if (r.esSalario && !formData.newSalary) return { ok: false, motivo: null };
    if (r.esIncapacidad && (!formData.disabilityType || !formData.certificateNumber)) return { ok: false, motivo: null };
    if (r.esBaja && !formData.terminationReason) return { ok: false, motivo: null };
    if (r.esCodigo && !formData.newCode) return { ok: false, motivo: null };
    if (r.esCodigo && formData.hasConflict) return { ok: false, motivo: 'El código ya está en uso por otro empleado.' };
    if (!formData.note || !formData.note.trim()) return { ok: false, motivo: null };
    return { ok: true, motivo: null };
}

/** La antigüedad dicha en años y meses («2 años 3 meses»). */
export function antiguedad(fechaDeIngreso, ahora = Date.now()) {
    if (!fechaDeIngreso) return '—';
    const ms = ahora - new Date(fechaDeIngreso).getTime();
    const anios = Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
    const meses = Math.floor((ms % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24 * 30.44));
    if (anios > 0) return `${anios} año${anios !== 1 ? 's' : ''} ${meses > 0 ? `${meses} mes${meses !== 1 ? 'es' : ''}` : ''}`.trim();
    return `${meses} mes${meses !== 1 ? 'es' : ''}`;
}
