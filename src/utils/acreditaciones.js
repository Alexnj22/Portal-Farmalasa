/**
 * Qué acreditación le corresponde a una persona según su profesión.
 *
 * ── Cuatro juntas, y una NO es del CSSP ─────────────────────────────────────
 *
 * Las tres de salud dependen del **Consejo Superior de Salud Pública**: la
 * Junta de Vigilancia de la Profesión Médica, la de Enfermería y la Químico
 * Farmacéutica. **Contaduría no**: es el Consejo de Vigilancia de la Profesión
 * de Contaduría Pública y Auditoría, otro organismo, con su propio registro.
 *
 * Por eso son cuatro entradas separadas y no un «número de junta» genérico:
 * meterlas en una sola pantalla que diga «CSSP» sería afirmar algo falso sobre
 * la cuarta, y el día que alguien vaya a verificarla va a ir al lugar
 * equivocado.
 *
 * ── Se DETECTA, no se pregunta a ciegas ─────────────────────────────────────
 *
 * El cargo y la profesión ya están escritos en la ficha; volver a preguntar
 * «¿es enfermero?» es pedir que alguien acierte algo que el portal sabe. Lo que
 * sí se pregunta es si TIENE la acreditación, que es lo que el portal no puede
 * saber.
 *
 * La detección es deliberadamente ANCHA (cargo o profesión, con o sin tildes):
 * ofrecer un campo de más es un campo que se deja vacío; ofrecer uno de menos
 * es una acreditación que nadie carga y que el aviso de vencimientos nunca
 * vigila.
 */

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Las cuatro acreditaciones profesionales. `campo` es la columna donde vive su
 * número; `doc` la categoría del documento que la respalda.
 */
export const ACREDITACIONES = [
    {
        id: 'QUIMICO',
        junta: 'JVPQF',
        organismo: 'Consejo Superior de Salud Pública',
        label: 'Químico Farmacéutico — JVPQF',
        campo: 'pharmacist_license_number',
        doc: 'SRS',
        detecta: ({ cargo, profesion }) =>
            (/regente/.test(cargo) && !/enfermer/.test(cargo)) ||
            /quimic.*farmac|farmac.*quimic/.test(profesion),
    },
    {
        id: 'ENFERMERIA',
        junta: 'JVPE',
        organismo: 'Consejo Superior de Salud Pública',
        label: 'Enfermería — JVPE',
        campo: 'nursing_license_number',
        doc: 'ENFERMERIA',
        // Técnico y licenciado en enfermería se acreditan los dos: la junta
        // registra ambos niveles, así que la detección no distingue.
        detecta: ({ cargo, profesion }) => /enfermer/.test(cargo) || /enfermer/.test(profesion),
    },
    {
        id: 'MEDICO',
        junta: 'JVPM',
        organismo: 'Consejo Superior de Salud Pública',
        label: 'Médico — JVPM',
        campo: 'medico_license_number',
        doc: 'MEDICO',
        detecta: ({ cargo, profesion }) =>
            /\bmedic/.test(cargo) || /\bmedic|doctor en medicina|cirujano/.test(profesion),
    },
    {
        id: 'CONTADURIA',
        junta: 'CVPCPA',
        // NO es del CSSP. Ver el encabezado.
        organismo: 'Consejo de Vigilancia de la Profesión de Contaduría Pública y Auditoría',
        label: 'Contaduría Pública — CVPCPA',
        campo: 'contador_license_number',
        doc: 'CONTADURIA',
        detecta: ({ cargo, profesion }) =>
            /contad|auditor/.test(cargo) || /contad|auditor/.test(profesion),
    },
];

/** Las que le corresponden a esta persona por cargo o profesión. */
export function acreditacionesDe({ cargo, profesion } = {}) {
    const ctx = { cargo: norm(cargo), profesion: norm(profesion) };
    return ACREDITACIONES.filter(a => a.detecta(ctx));
}

/**
 * ── ISSS y AFP no se tramitan igual, y por eso el aviso es distinto ─────────
 *
 * Al **ISSS lo inscribe el patrono**: si la persona no lo tiene, el pendiente
 * es de la empresa y no hay nada que orientarle.
 *
 * La **AFP la elige el trabajador** y sólo él puede afiliarse: ahí el portal
 * sí puede orientar, y el aviso va a la persona.
 *
 * Confundirlos haría que el portal le pida a alguien que haga un trámite que no
 * puede hacer, o que la empresa espere por algo que le toca a ella.
 */
export const TRAMITES = {
    isss: {
        label: 'ISSS',
        quienLoHace: 'la empresa',
        orientacion: 'Lo inscribe el patrono. El pendiente es de la empresa, no de la persona.',
    },
    afp: {
        label: 'AFP',
        quienLoHace: 'la persona',
        orientacion: 'La elige el trabajador y sólo él puede afiliarse. Desde enero de 2023 el NUP es el número de DUI.',
    },
};

export const ESTADO_PREVISIONAL_OPTIONS = [
    { value: 'TIENE',      label: 'Sí, ya tiene' },
    { value: 'NO_TIENE',   label: 'No tiene' },
    { value: 'EN_TRAMITE', label: 'En trámite' },
];

/**
 * Qué hay que hacer con el ISSS y la AFP de esta persona.
 *
 * `null` (nadie preguntó) NO devuelve pendiente: devuelve «sin preguntar», que
 * es otra cosa. Tratar el silencio como «no tiene» haría que el portal empiece
 * trámites que nadie pidió — y hoy las 49 fichas están en silencio.
 */
export function pendientesPrevisionales(datos = {}) {
    const out = [];
    for (const clave of ['isss', 'afp']) {
        const estado = datos[`${clave}_estado`];
        if (!estado) { out.push({ ...TRAMITES[clave], clave, estado: 'SIN_PREGUNTAR' }); continue; }
        if (estado === 'NO_TIENE' || estado === 'EN_TRAMITE') {
            out.push({ ...TRAMITES[clave], clave, estado });
        }
    }
    return out;
}

/**
 * ── Provisional y definitiva ────────────────────────────────────────────────
 *
 * Una acreditación profesional no aparece el día de la graduación: en las
 * juntas del Consejo Superior de Salud Pública hay una inscripción **con
 * carácter provisional** para quien ya terminó la carrera y todavía no tiene el
 * título, y la **definitiva** se otorga cuando presenta el título.
 *
 * Lo verificado y lo que NO, porque la diferencia importa:
 *
 * - **Enfermería (JVPE)** — verificado en el formulario de solicitud de la
 *   propia junta: pide declarar «Egresado(a) de la Institución … el día …», o
 *   sea que la provisional es para EGRESADOS y la definitiva llega con el
 *   título.
 * - **Médico (JVPM)** — el usuario lo describió así: durante la práctica se
 *   trabaja con sello provisional. Coincide con lo de enfermería.
 * - **Químico farmacéutico (JVPQF)** y **Contaduría (CVPCPA)** — **NO
 *   verificado**. Puede que funcione igual y puede que no. Por eso la pantalla
 *   no afirma cuándo se obtiene cada una: sólo pregunta cuál tiene esta
 *   persona, que es un dato que Talento Humano sí conoce.
 *
 * Y por eso la opción existe para las cuatro. Ofrecerla de más cuesta un campo
 * que se deja en «Definitiva»; ofrecerla de menos deja a alguien sin poder
 * anotar el sello con el que está trabajando hoy.
 */
export const TIPO_ACREDITACION_OPTIONS = [
    { value: 'DEFINITIVA',  label: 'Definitiva' },
    { value: 'PROVISIONAL', label: 'Provisional — todavía sin el título' },
];

/**
 * El tipo de acreditación que tiene esta persona para esa junta.
 *
 * Devuelve `null` cuando nadie contestó. No se asume «definitiva»: es
 * exactamente el error de [[feedback_null_no_es_no_tiene]] —el silencio no es
 * una respuesta— y acá la consecuencia es que nadie vigilaría el reemplazo de
 * un sello que caduca al graduarse.
 */
export function tipoDeAcreditacion(datos, id) {
    return datos?.acreditaciones?.[id]?.tipo || null;
}

/** Las que están con sello provisional hoy, de entre las que le corresponden. */
export function acreditacionesProvisionales(datos, aplicables = []) {
    return aplicables.filter(a => tipoDeAcreditacion(datos, a.id) === 'PROVISIONAL');
}

/**
 * Pasar una acreditación de provisional a definitiva.
 *
 * Devuelve el parche —no escribe— con el número anterior GUARDADO. Se conserva
 * a propósito: si mañana alguien tiene que explicar con qué sello se trabajó
 * durante la práctica, el dato tiene que existir. Sobrescribirlo en silencio
 * sería borrar el historial de una credencial profesional.
 *
 * El número nuevo se vacía para que se teclee el de la definitiva: dejar el
 * viejo puesto es cómo un número provisional termina archivado como definitivo.
 */
export function promoverADefinitiva(datos, id, campo, hoy) {
    const previo = datos?.acreditaciones?.[id] || {};
    return {
        [campo]: '',
        acreditaciones: {
            ...(datos?.acreditaciones || {}),
            [id]: {
                ...previo,
                tipo: 'DEFINITIVA',
                provisional_numero: previo.provisional_numero ?? (datos?.[campo] || null),
                definitiva_desde: hoy,
            },
        },
    };
}

/** Parche para dejar anotado el tipo, sin tocar el resto de la ficha. */
export function fijarTipoAcreditacion(datos, id, tipo) {
    return {
        acreditaciones: {
            ...(datos?.acreditaciones || {}),
            [id]: { ...(datos?.acreditaciones?.[id] || {}), tipo },
        },
    };
}
