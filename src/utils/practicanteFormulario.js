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

// El patrón por defecto del horario de la práctica — ver «El horario de la
// práctica» al final del archivo.
export const HORARIO_VACIO = { dias: [1, 2, 3, 4, 5], entrada: '08:00', salida: '12:00', pausa_inicio: '', pausa_minutos: 0 };

export const PASANTIA_VACIA = {
    institucion_educativa: '', tutor_nombre: '', tutor_telefono: '',
    supervisor_employee_id: '', fecha_inicio: '', fecha_fin: '',
    horas_requeridas: '', estado: 'ACTIVO', notas: '',
    horario: null,
};

/** Sólo los campos de la pasantía de una fila de `practicantes`. */
export function pasantiaDe(p) {
    const f = formularioDePracticante(p);
    return { ...Object.fromEntries(Object.keys(PASANTIA_VACIA).map((k) => [k, f[k]])),
        horario: p?.horario ? { ...HORARIO_VACIO, ...p.horario, pausa_inicio: p.horario.pausa_inicio || '' } : null };
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
    return { ...filaDePracticante(formularioCompleto(persona, pasantia), convenioUrl),
        employee_id: employeeId, horario: horarioParaGuardar(pasantia?.horario) };
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

// ── El horario de la práctica (2026-11-03) ──────────────────────────────────
//
// Un patrón por semana —qué días, entrada, salida, pausa— y no una semana a la
// vez: es «la forma fácil» que pidió el usuario. La base lo convierte en sus
// semanas de Horarios y turnos (`aplicar_horario_de_practica`); acá vive la
// cuenta de horas y la fecha en que termina, que la pantalla dice antes de
// guardar. Los días son los de `claveDeDia`: 0 = domingo … 6 = sábado.
// (HORARIO_VACIO vive arriba, junto a PASANTIA_VACIA: `pasantiaDe` lo lee.)

export const DIAS_DE_LA_SEMANA = [
    { dia: 1, corto: 'L', nombre: 'lunes' }, { dia: 2, corto: 'M', nombre: 'martes' },
    { dia: 3, corto: 'M', nombre: 'miércoles' }, { dia: 4, corto: 'J', nombre: 'jueves' },
    { dia: 5, corto: 'V', nombre: 'viernes' }, { dia: 6, corto: 'S', nombre: 'sábado' },
    { dia: 0, corto: 'D', nombre: 'domingo' },
];

const aMin = (h) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const redondea = (n) => Math.round(n * 10) / 10;
const isoDe = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const UN_DIA = 86400000;

/** Horas de UN día del patrón (salida − entrada − pausa). 0 si está mal escrito. */
export function horasDelDiaDePractica(horario) {
    const e = aMin(horario?.entrada), s = aMin(horario?.salida);
    if (e == null || s == null || s <= e) return 0;
    const pausa = horario?.pausa_inicio ? Number(horario?.pausa_minutos || 0) : 0;
    return Math.max(0, (s - e - pausa) / 60);
}

/** Horas por semana del patrón. */
export function horasPorSemanaDePractica(horario) {
    return horasDelDiaDePractica(horario) * (horario?.dias?.length || 0);
}

/** Lo que se guarda en `practicantes.horario`, o `null` si no hay patrón válido. */
export function horarioParaGuardar(horario) {
    if (!horario || !horario.dias?.length || !horasDelDiaDePractica(horario)) return null;
    const conPausa = !!horario.pausa_inicio && Number(horario.pausa_minutos) > 0;
    return {
        dias: [...new Set(horario.dias.map(Number))].sort((a, b) => a - b),
        entrada: horario.entrada, salida: horario.salida,
        pausa_inicio: conPausa ? horario.pausa_inicio : null,
        pausa_minutos: conPausa ? Number(horario.pausa_minutos) : 0,
    };
}

/**
 * Cuándo termina la práctica si cumple su horario.
 *
 * Cuenta las horas que faltan (`horasRequeridas − horasCumplidas`) día por día
 * del patrón, desde hoy (o desde el inicio si todavía no empezó). Devuelve el
 * día en que se completa y si eso cae ANTES o DESPUÉS de `fechaFin` — que es lo
 * que hay que saber: un horario que no alcanza a cubrir las horas antes de la
 * fecha del convenio es una práctica que no termina a tiempo.
 *
 * @returns {null | { fecha: string|null, alcanza: boolean|null, faltan: number,
 *   horasSemana: number, horasHastaElFin: number|null }}
 */
export function finDeLaPractica({ horario, fechaInicio, fechaFin, horasRequeridas, horasCumplidas = 0, hoy }) {
    const porDia = horasDelDiaDePractica(horario);
    const meta = Number(horasRequeridas || 0);
    if (!porDia || !horario?.dias?.length || !meta || !fechaInicio) return null;
    const faltan = Math.max(0, meta - Number(horasCumplidas || 0));
    const dias = new Set(horario.dias.map(Number));
    const inicio = new Date(`${fechaInicio}T12:00:00Z`);
    const hoyD = new Date(`${hoy || isoDe(new Date())}T12:00:00Z`);
    const desde = inicio > hoyD ? inicio : hoyD;

    let fecha = faltan === 0 ? isoDe(desde) : null;
    let acumula = 0;
    for (let d = desde, i = 0; !fecha && i < 3660; i++, d = new Date(d.getTime() + UN_DIA)) {
        if (dias.has(d.getUTCDay())) {
            acumula += porDia;
            if (acumula >= faltan - 1e-9) fecha = isoDe(d);
        }
    }
    let horasHastaElFin = null;
    if (fechaFin) {
        horasHastaElFin = 0;
        const fin = new Date(`${fechaFin}T12:00:00Z`);
        for (let d = desde; d <= fin; d = new Date(d.getTime() + UN_DIA)) {
            if (dias.has(d.getUTCDay())) horasHastaElFin += porDia;
        }
    }
    return {
        fecha, faltan, horasSemana: porDia * dias.size,
        alcanza: fechaFin && fecha ? fecha <= fechaFin : null,
        horasHastaElFin,
    };
}

/**
 * Lo que el horario no debería tener, con su artículo. El practicante no es un
 * trabajador, pero la jornada del menor la limita el Código de Trabajo
 * (Art. 116: 6 horas diarias y 34 semanales para menores de 18) y la del
 * adulto se mide contra la jornada ordinaria (Art. 161: 8 diarias, 44
 * semanales). Los primeros tres avisos impiden guardar un horario; los de
 * tope sólo avisan.
 */
export function avisosDelHorarioDePractica(horario, { esMenor = false } = {}) {
    const avisos = [];
    if (!horario) return avisos;
    const e = aMin(horario.entrada), s = aMin(horario.salida);
    if (!horario.dias?.length) avisos.push('Elige al menos un día.');
    if (e == null || s == null || s <= e) avisos.push('La salida tiene que ser después de la entrada.');
    if (horario.pausa_inicio && Number(horario.pausa_minutos) > 0) {
        const p = aMin(horario.pausa_inicio);
        if (p != null && e != null && s != null && (p < e || p + Number(horario.pausa_minutos) > s)) {
            avisos.push('La pausa tiene que caer dentro de la jornada.');
        }
    }
    const dia = horasDelDiaDePractica(horario), semana = horasPorSemanaDePractica(horario);
    const [topeDia, topeSemana, art] = esMenor ? [6, 34, '116'] : [8, 44, '161'];
    const quien = esMenor ? ' para un menor de edad' : '';
    if (dia > topeDia) avisos.push(`${redondea(dia)} h al día pasan de ${topeDia} h${quien} (Código de Trabajo, Art. ${art}).`);
    if (semana > topeSemana) avisos.push(`${redondea(semana)} h a la semana pasan de ${topeSemana} h${quien} (Código de Trabajo, Art. ${art}).`);
    return avisos;
}
