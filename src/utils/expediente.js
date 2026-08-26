/**
 * Qué le falta a un expediente para estar completo.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Desde el 2026-08-26 una ficha se puede guardar con sólo el nombre: la regla
 * vieja apagaba Guardar sin DUI, género, estado civil, sala, cargo y código, y
 * el resultado medido fue que **48 de las 49 fichas no se podían ni abrir y
 * guardar** — para anotarle el teléfono a alguien había que traer primero su
 * DUI. Es [[feedback_una_verificacion_que_traba_la_accion_no_se_hace]]: la
 * regla era correcta y el momento estaba mal.
 *
 * Pero «se puede guardar» no es «está completo», y el usuario lo dijo así:
 * *«queda como borrador o algo, los datos siguen siendo requeridos»*. Este
 * archivo es ese «siguen siendo requeridos», y vive UNA vez porque lo miran
 * tres pantallas: el formulario (banner de pendientes), el listado de personal
 * (para saber a quién le falta) y quien decida más adelante si una ficha
 * incompleta se puede borrar. Si cada una tuviera su lista, dirían cosas
 * distintas de la misma persona —que es exactamente lo que pasó con «Centro de
 * comunicaciones» y el menú.
 *
 * ── No se deriva de si Guardar está apagado ─────────────────────────────────
 *
 * Son dos preguntas distintas y hay que resistir juntarlas: Guardar mira si lo
 * ESCRITO está bien escrito; esto mira si lo que la ley pide está PRESENTE. Un
 * expediente puede guardarse perfecto y estar incompleto, y ése es el estado
 * normal el día que entra alguien.
 */
import { MINOR_AGE } from './ageUtils';

// Los numerales del Art. 23 del Código de Trabajo que el expediente guarda, más
// lo que el portal necesita para que la persona pueda usarlo. El rótulo es el
// que se le muestra a quien lo tiene que completar, así que dice qué falta y no
// cómo se llama la columna.
const EXIGIDOS = [
    { campo: 'first_names',       label: 'Nombres' },
    { campo: 'last_names',        label: 'Apellidos' },
    { campo: 'gender',            label: 'Género',                       art: '23 nº1' },
    { campo: 'marital_status',    label: 'Estado familiar',              art: '23 nº1' },
    { campo: 'birth_date',        label: 'Fecha de nacimiento',          art: '23 nº1' },
    { campo: 'nationality',       label: 'Nacionalidad',                 art: '23 nº1' },
    { campo: 'address',           label: 'Dirección',                    art: '23 nº1' },
    { campo: 'department',        label: 'Departamento',                 art: '23 nº1' },
    { campo: 'municipality',      label: 'Municipio',                    art: '23 nº1' },
    { campo: 'distrito',          label: 'Distrito',                     art: '23 nº1' },
    { campo: 'profession',        label: 'Profesión u oficio',           art: '23 nº1' },
    { campo: 'dui_lugar_expedicion', label: 'Lugar de expedición del documento', art: '23 nº2' },
    { campo: 'dui_fecha_expedicion', label: 'Fecha de expedición del documento', art: '23 nº2' },
    { campo: 'role_id',           label: 'Cargo',                        art: '23 nº3' },
    { campo: 'contract_type',     label: 'Tipo de contrato',             art: '23 nº4' },
    { campo: 'hire_date',         label: 'Fecha de inicio de labores',   art: '23 nº5' },
    { campo: 'branch_id',         label: 'Área de trabajo',              art: '23 nº6' },
    { campo: 'base_salary',       label: 'Salario',                      art: '23 nº8' },
    { campo: 'periodo_pago',      label: 'Cada cuánto se le paga',       art: '23 nº9' },
    { campo: 'contrato_lugar_celebracion',  label: 'Lugar de la firma',  art: '23 nº13' },
    { campo: 'contrato_fecha_celebracion',  label: 'Fecha de la firma',  art: '23 nº13' },
    // No es del Art. 23: es la credencial con la que la persona entra al portal
    // y marca en el kiosco. Sin él la ficha existe y la persona no puede usar
    // nada.
    { campo: 'code',              label: 'Código de carné' },
];

const vacio = (v) => v === null || v === undefined || v === '' ||
    (Array.isArray(v) && v.length === 0);

/** Edad en años cumplidos, o `null` si no hay fecha. */
export function edadDe(fechaNacimiento) {
    if (!fechaNacimiento) return null;
    // `new Date('YYYY-MM-DD')` se lee como UTC y en El Salvador retrocede un
    // día. Ver DESIGN.md §33 y `utils/semana.js`.
    const [y, m, d] = String(fechaNacimiento).split('-').map(Number);
    if (!y || !m || !d) return null;
    const nac = new Date(y, m - 1, d);
    const hoy = new Date();
    let edad = hoy.getFullYear() - nac.getFullYear();
    const antes = hoy.getMonth() < nac.getMonth() ||
        (hoy.getMonth() === nac.getMonth() && hoy.getDate() < nac.getDate());
    if (antes) edad -= 1;
    return edad;
}

/**
 * Devuelve `[{ campo, label, art }]` con lo que falta. Vacío = completo.
 *
 * `datos` puede ser el `formData` del formulario o la fila de un empleado: los
 * nombres de campo son los mismos a propósito, para que las dos pantallas no
 * puedan discrepar.
 */
export function faltantesDelExpediente(datos) {
    if (!datos) return [];
    const faltan = EXIGIDOS.filter(e => vacio(datos[e.campo]));

    const edad = edadDe(datos.birth_date);
    const menor = edad !== null && edad < MINOR_AGE;

    // El documento de identidad: el número, y la imagen de los dos lados. A un
    // menor no se le pide DUI —en El Salvador no se tramita hasta los 18— sino
    // el documento alterno del Art. 23 nº2.
    if (menor) {
        if (vacio(datos.alt_identity_document)) faltan.push({ campo: 'alt_identity_document', label: 'Documento de identidad', art: '23 nº2' });
    } else if (vacio(datos.dui)) {
        faltan.push({ campo: 'dui', label: 'DUI', art: '23 nº2' });
    }

    const docs = datos.employee_documents || [];
    const tiene = (cat) => docs.some(d => d.category === cat && d.url);
    if (menor) {
        if (!tiene('DOCUMENTO_IDENTIDAD')) faltan.push({ campo: 'doc_identidad', label: 'Documento de identidad (imagen)' });
        // Art. 117: el examen médico previo de un menor no es una buena
        // práctica, es requisito para admitirlo, y se repite cada año.
        if (!tiene('EXAMEN_MEDICO')) faltan.push({ campo: 'examen_medico', label: 'Examen médico previo', art: '117' });
    } else if (!tiene('DUI_FRENTE') || !tiene('DUI_REVERSO')) {
        faltan.push({ campo: 'doc_dui', label: 'DUI (imagen de los dos lados)' });
    }

    // Un contrato a plazo sin base legal ni motivo escrito lo presume
    // indefinido el Art. 25, así que la fecha de fin no es opcional.
    if (datos.contract_type === 'TEMPORAL' && vacio(datos.contract_end_date)) {
        faltan.push({ campo: 'contract_end_date', label: 'Fecha de fin del contrato', art: '25' });
    }

    // Identidad previsional. `null` es «nadie preguntó» y por eso falta; un
    // «NO_TIENE» declarado NO falta — es una respuesta, y lo que sigue después
    // es el trámite, no el dato.
    if (vacio(datos.isss_estado)) faltan.push({ campo: 'isss_estado', label: 'Si tiene ISSS' });
    if (vacio(datos.afp_estado))  faltan.push({ campo: 'afp_estado',  label: 'Si tiene AFP' });

    return faltan;
}

/** ¿El expediente está a medias? Atajo legible para las pantallas. */
export const expedienteIncompleto = (datos) => faltantesDelExpediente(datos).length > 0;
