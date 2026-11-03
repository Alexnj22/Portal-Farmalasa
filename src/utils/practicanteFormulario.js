// El formulario del practicante — sus campos, su validación y la fila que se
// guarda. Vivía dentro de `PracticanteModal` (portal); la app nativa da de alta
// y edita practicantes con la MISMA regla, así que la regla vive acá. Dos
// copias de «qué hace válido a un practicante» se separan solas: una deja
// pasar un menor sin documento y la otra no, y nadie se entera.
//
// Edad decide el documento (Art. 23.2 CT: el DUI no se tramita hasta los 18):
// adulto → DUI (validado con su dígito); menor → documento alterno obligatorio.
// Sin fecha de nacimiento se asume adulto, como en el alta de empleado.
import { calcAge, MINOR_AGE } from './ageUtils';
import { isValidDUIAlgorithm, maskDui } from './duiUtils';
import { OTRA_ESPECIALIDAD } from './educationCatalogs';

export const ESTADOS_DE_PRACTICANTE = [
    { value: 'ACTIVO', label: 'Activo' },
    { value: 'FINALIZADO', label: 'Finalizado' },
    { value: 'CANCELADO', label: 'Cancelado' },
];

export const FORMULARIO_PRACTICANTE_VACIO = {
    first_names: '', last_names: '', birth_date: '', dui: '', alt_identity_document: '', phone: '',
    branch_id: '', institucion_educativa: '', tutor_nombre: '', tutor_telefono: '',
    supervisor_employee_id: '', fecha_inicio: '', fecha_fin: '',
    horas_requeridas: '', estado: 'ACTIVO', notas: '',
};

/** El formulario lleno con una fila de `practicantes` (o vacío para el alta). */
export function formularioDePracticante(p) {
    if (!p) return { ...FORMULARIO_PRACTICANTE_VACIO };
    return {
        first_names: p.first_names || '',
        last_names: p.last_names || '',
        birth_date: p.birth_date || '',
        dui: p.dui || '',
        alt_identity_document: p.alt_identity_document || '',
        phone: p.phone || '',
        branch_id: p.branch_id != null ? String(p.branch_id) : '',
        institucion_educativa: p.institucion_educativa || '',
        tutor_nombre: p.tutor_nombre || '',
        tutor_telefono: p.tutor_telefono || '',
        supervisor_employee_id: p.supervisor_employee_id || '',
        fecha_inicio: p.fecha_inicio || '',
        fecha_fin: p.fecha_fin || '',
        horas_requeridas: p.horas_requeridas != null ? String(p.horas_requeridas) : '',
        estado: p.estado || 'ACTIVO',
        notas: p.notas || '',
    };
}

/**
 * Qué le falta al formulario. `tieneConvenio`: hay convenio firmado (uno nuevo
 * elegido o el que ya estaba guardado) — sin él no se registra a nadie.
 */
export function validarPracticante(form, { tieneConvenio }) {
    const age = calcAge(form.birth_date);
    const esMenor = age !== null && age < MINOR_AGE;
    const duiInvalido = !esMenor && !!form.dui && !isValidDUIAlgorithm(form.dui);
    const faltaDocumentoAlterno = esMenor && !String(form.alt_identity_document || '').trim();
    const fechasInvalidas = !!form.fecha_inicio && !!form.fecha_fin
        && new Date(`${form.fecha_fin}T00:00:00`) <= new Date(`${form.fecha_inicio}T00:00:00`);
    const faltaInstitucion = !form.institucion_educativa || form.institucion_educativa === OTRA_ESPECIALIDAD;
    const valido = !!(String(form.first_names || '').trim() && String(form.last_names || '').trim() && form.branch_id
        && !faltaInstitucion && String(form.tutor_nombre || '').trim()
        && form.fecha_inicio && form.fecha_fin && !fechasInvalidas && !duiInvalido && !faltaDocumentoAlterno && tieneConvenio);
    return { esMenor, duiInvalido, faltaDocumentoAlterno, fechasInvalidas, faltaInstitucion, faltaConvenio: !tieneConvenio, valido };
}

/** La fila que se guarda en `practicantes`. */
export function filaDePracticante(form, convenioUrl) {
    const { esMenor } = validarPracticante(form, { tieneConvenio: true });
    const t = (v) => String(v ?? '').trim();
    return {
        first_names: t(form.first_names),
        last_names: t(form.last_names),
        birth_date: form.birth_date || null,
        dui: !esMenor && form.dui ? maskDui(form.dui) : null,
        alt_identity_document: esMenor ? t(form.alt_identity_document) : (t(form.alt_identity_document) || null),
        phone: t(form.phone) || null,
        branch_id: parseInt(form.branch_id, 10),
        institucion_educativa: t(form.institucion_educativa),
        tutor_nombre: t(form.tutor_nombre),
        tutor_telefono: t(form.tutor_telefono) || null,
        supervisor_employee_id: form.supervisor_employee_id || null,
        fecha_inicio: form.fecha_inicio,
        fecha_fin: form.fecha_fin,
        horas_requeridas: form.horas_requeridas !== '' && form.horas_requeridas != null ? Number(form.horas_requeridas) : null,
        estado: form.estado,
        notas: t(form.notas) || null,
        convenio_url: convenioUrl,
    };
}

// ── La pasantía dentro de la ficha (2026-11-03) ─────────────────────────────
//
// Desde que el practicante tiene ficha en `employees` (`tipo_ficha =
// 'practicante'`), la PERSONA —nombre, DUI, nacimiento, teléfono, dirección,
// sala— se captura en el formulario de empleado, con la misma lectura del DUI.
// Lo que sigue viviendo en `practicantes` es la pasantía: institución, tutor,
// fechas, horas, estado, convenio y notas. Las columnas de identidad de
// `practicantes` se COPIAN de la ficha al guardar (son NOT NULL y las lee la
// tarjeta), así que la ficha es la verdad y la copia se rehace cada vez.

export const TIPO_FICHA_PRACTICANTE = 'practicante';

export const PASANTIA_VACIA = {
    institucion_educativa: '', tutor_nombre: '', tutor_telefono: '',
    supervisor_employee_id: '', fecha_inicio: '', fecha_fin: '',
    horas_requeridas: '', estado: 'ACTIVO', notas: '',
};

/** Sólo los campos de la pasantía de una fila de `practicantes`. */
export function pasantiaDe(p) {
    const f = formularioDePracticante(p);
    return Object.fromEntries(Object.keys(PASANTIA_VACIA).map((k) => [k, f[k]]));
}

/** El formulario completo que entienden `validarPracticante`/`filaDePracticante`,
 *  armado con la persona de la ficha y la pasantía. */
function formularioCompleto(persona = {}, pasantia = {}) {
    return {
        ...FORMULARIO_PRACTICANTE_VACIO,
        ...pasantia,
        first_names: persona.first_names || '',
        last_names: persona.last_names || '',
        birth_date: persona.birth_date || '',
        dui: persona.dui || '',
        alt_identity_document: persona.alt_identity_document || '',
        phone: persona.phone || '',
        branch_id: persona.branch_id != null ? String(persona.branch_id) : '',
    };
}

/**
 * Qué impide guardar la pasantía, dicho para quien lo va a leer. `null` = se
 * puede. La persona (nombre, DUI) la valida el formulario de empleado; acá
 * sólo lo que es de la práctica, más la sala, que sin ella la fila no entra.
 */
export function motivoPasantiaIncompleta(persona, pasantia, { tieneConvenio }) {
    const v = validarPracticante(formularioCompleto(persona, pasantia), { tieneConvenio });
    if (!persona?.branch_id) return 'Falta la sucursal donde hace la práctica (pestaña Práctica).';
    if (v.faltaInstitucion) return 'Falta la institución educativa (pestaña Práctica).';
    if (!String(pasantia?.tutor_nombre || '').trim()) return 'Falta el tutor de la institución (pestaña Práctica).';
    if (!pasantia?.fecha_inicio || !pasantia?.fecha_fin) return 'Faltan las fechas de la práctica (pestaña Práctica).';
    if (v.fechasInvalidas) return 'La fecha de fin de la práctica tiene que ser posterior a la de inicio.';
    if (v.faltaConvenio) return 'Falta el convenio con la institución (pestaña Práctica).';
    return null;
}

/** La fila de `practicantes` con la persona de la ficha y su `employee_id`. */
export function filaDePracticanteDesdeFicha(persona, pasantia, convenioUrl, employeeId) {
    return { ...filaDePracticante(formularioCompleto(persona, pasantia), convenioUrl), employee_id: employeeId };
}

/**
 * La ficha de un practicante lista para el formulario de empleado: le agrega
 * su pasantía (`pasantia`, `pasantia_id`, `pasantia_convenio_url`) desde la
 * fila de `practicantes` que la nombra. Se usa al ABRIR la ficha desde
 * cualquier lado —Practicantes, Personal, su perfil—: sin esto, editarla desde
 * Personal pediría un convenio que ya está guardado.
 */
export function fichaConPasantia(ficha, practicantes, fila = null) {
    if (!ficha || (ficha.tipo_ficha ?? ficha.tipoFicha) !== TIPO_FICHA_PRACTICANTE) return ficha;
    if (ficha.pasantia) return ficha;
    const p = fila || (practicantes || []).find((x) => x.employee_id && String(x.employee_id) === String(ficha.id));
    if (!p) return { ...ficha, pasantia: { ...PASANTIA_VACIA } };
    return { ...ficha, pasantia: pasantiaDe(p), pasantia_id: p.id, pasantia_convenio_url: p.convenio_url || null };
}
