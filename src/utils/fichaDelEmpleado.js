// La ficha del empleado: lo que comparten el alta y la edición del portal
// (`EmployeeFormModal`) y los de la app (`apps/mobile/app/empleado/editar.js`).
//
// Vive acá desde el 2026-10-15 (paridad de la app): estaba escrito dentro del
// formulario del portal, y la app —que no puede importar un componente web—
// lo iba a necesitar igual. Dos copias de «qué se copia al enlazar con una
// ficha que ya existe» se separan solas la primera vez que se corrija una, y
// esa regla en particular es la que evita BORRARLE el expediente a alguien.
//
// Sin navegador: lo usan los dos lados.
import { OTRA_ESPECIALIDAD } from './educationCatalogs';

// ── Enlazar con una ficha que ya existe ─────────────────────────────────────

/* ── Lo que NO se copia al enlazar con una ficha que ya existe ─────────────
 *
 * `id` es el más importante y el menos obvio: con `id` puesto, el modal deja de
 * ser un alta y se va por el camino de EDITAR, que es otro guardado. El enlace
 * viaja aparte, en `enlazar_con_id`.
 *
 * `name` se arma solo de nombres + apellidos. `photo` es una URL firmada que
 * caduca —la foto entra como vista previa, más abajo—. Y `status` no se hereda:
 * quien vuelve entra ACTIVO, no con el estado que tenía el día que se fue. El
 * resto —horas debidas, bloqueos, horario— es historia de la ficha vieja y la
 * conserva ella; no es algo que se esté dando de alta hoy. */
export const NO_SE_HEREDA = new Set([
    'id', 'created_at', 'name', 'photo', 'status',
    'hours_owed', 'weekly_schedule', 'exceptions',
    'blocked_until', 'blocked_reason', 'blocked_at', 'blocked_by',
]);

/* Los tres que se respetan si ya estaban elegidos: son justamente los que uno
 * cambia MIENTRAS enlaza —se puede estar reincorporando a alguien en otra sala
 * o con otro cargo—, así que lo tecleado gana. Todo lo demás viene de la ficha,
 * porque todo lo demás es la misma persona. */
export const ELEGIBLES_AL_ENLAZAR = ['branch_id', 'role_id', 'secondary_role_id'];

/**
 * Trae la ficha de quien ya trabajaba acá.
 *
 * ── Por qué copia TODO y no sólo tres campos ───────────────────────────────
 *
 * Copiaba sala, cargo y foto, y nada más. El usuario lo vio en pantalla: «si
 * agrego a un empleado que ya está, ¿por qué no se ponen los datos que ya están
 * guardados?».
 *
 * Y lo que había no era sólo incómodo: era PELIGROSO. El aviso de esa misma
 * tarjeta dice —con razón— que al guardar «lo que esa ficha tenía escrito antes
 * se reemplaza». Con el formulario en blanco, eso significa reemplazar el DUI,
 * la dirección, el salario y el banco de esa persona **por vacío**. O sea que el
 * camino natural —elegir a quien vuelve y guardar— le borraba el expediente, sin
 * ningún error y sin que nada en la pantalla lo dijera.
 *
 * Traer la ficha entera arregla las dos cosas de una vez: se ve lo que ya está,
 * y lo que se guarda encima es lo mismo que había salvo lo que alguien cambie a
 * propósito.
 *
 * @param {object} prev   el formulario de ahora
 * @param {string} val    id elegido (cadena vacía = se quitó el enlace)
 * @param {object|null} ficha  la ficha de esa persona, si se encontró
 */
/**
 * ¿Ya hay alguien registrado con este mismo nombre completo?
 *
 * ── A quién NO se acusa ────────────────────────────────────────────────────
 *
 * A la ficha que se está editando, y —desde el 2026-08-28— a la que se acaba de
 * ENLAZAR. Faltaba la segunda, y el aviso salía siempre: decía «si es la misma
 * persona, enlázala abajo» sobre alguien a quien ya se había enlazado ahí mismo,
 * dos centímetros más abajo en la pantalla.
 *
 * Antes no se notaba porque enlazar dejaba el formulario vacío, así que no había
 * nombre con qué chocar. Al empezar a traer la ficha entera —que es lo que se
 * pidió— el nombre pasó a venir de esa misma ficha, y el choque quedó
 * garantizado: el aviso saltaba el 100% de las veces.
 *
 * La exclusión ya existía en el chequeo del DUI repetido, con este mismo motivo
 * escrito al lado. No llegó a su gemelo — es
 * [[feedback_el_arreglo_de_un_canonico_no_llega_a_su_gemelo]].
 *
 * Lo que SÍ se sigue avisando: que exista un TERCERO con ese nombre. Ahí el
 * aviso es correcto y sigue haciendo falta.
 */
export function hayHomonimo(formData, employees) {
    if (!formData?.first_names || !formData?.last_names) return false;
    const norm = (str) => (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const nombreActual = `${norm(formData.first_names)} ${norm(formData.last_names)}`;
    return (employees || []).some(emp => {
        if (String(emp.id) === String(formData.id)) return false;
        if (formData.enlazar_con_id && String(emp.id) === String(formData.enlazar_con_id)) return false;
        return norm(emp.name) === nombreActual;
    });
}

/**
 * Los doce campos que el padrón del navegador NO puede traer.
 *
 * ── Por qué hace falta pedirlos aparte ─────────────────────────────────────
 *
 * `employees_safe` —de donde sale la lista de personal— deja DOCE columnas
 * afuera a propósito: el DUI y sus datos de expedición, el documento alterno,
 * los números de ISSS y AFP, el salario, el banco, la cuenta, el código de
 * carné y el PIN del kiosco. Salieron el 2026-08-24 porque viajaban a cualquier
 * sesión y porque esa lista se guarda en `localStorage` de computadoras
 * compartidas.
 *
 * O sea que «traer la ficha entera» al enlazar traía **dos tercios** de la
 * ficha, y el tercio que falta es el que más cuesta volver a teclear. Lo
 * reportó el usuario: «guardé algunos datos de Carlos Renderos, pero al abrirlo
 * de nuevo no me salen». Verificado contra la base: los datos SÍ estaban
 * guardados — lo que fallaba era leerlos de vuelta.
 *
 * ── Y el que hacía daño de verdad: el CÓDIGO ───────────────────────────────
 *
 * El formulario en blanco se autogenera un código de carné de cuatro dígitos.
 * Si al enlazar no llega el de la persona, ese aleatorio se queda — y guardar
 * **le cambia el código con el que entra al portal y marca en el kiosco**. Sin
 * error, sin aviso, y sin que nada en la pantalla lo insinúe.
 *
 * Cada RPC decide por su cuenta qué devuelve según quien pregunta: sin la llave
 * del expediente vuelven vacías, y el formulario simplemente no completa esos
 * campos — que es lo mismo que pasaba antes, no una regresión.
 */
export const vacioParaEnlazar = (v) => v === null || v === undefined || String(v).trim() === '';

/* El código de carné es la EXCEPCIÓN: se toma siempre el de la persona.
 *
 * El resto sólo llena lo que quedó vacío, para no pisar lo que alguien haya
 * escrito mientras la consulta viajaba. Pero el código nunca está vacío —el
 * formulario en blanco se autogenera uno de cuatro dígitos al azar— así que con
 * esa regla el aleatorio se quedaría, y guardar le cambiaría a la persona el
 * código con el que entra al portal y marca en el kiosco.
 *
 * Un código autogenerado no es la elección de nadie: es un relleno. El de quien
 * ya trabajaba acá sí. */
export const SIEMPRE_DE_LA_FICHA = new Set(['code', 'kiosk_pin']);

/* Lo que vino de la ficha enlazada, para poder DESHACERLO al cambiar de
 * persona (2026-10-14). Enlazar con A y después corregir a B dejaba los datos de
 * A donde B tenía `null` —el bucle salta los nulos— y, en los protegidos, donde
 * B no estaba vacía la regla «sólo llena lo vacío» dejaba la cuenta y el sueldo
 * de A. Guardar los escribía sobre B. Al cambiar, se vacía todo lo que sigue
 * valiendo lo que trajo A; lo que alguien ya corrigió a mano se respeta. */
export function soltarFichaAnterior(prev) {
    const traido = prev?._deLaFicha || {};
    const next = { ...prev };
    for (const [campo, valor] of Object.entries(traido)) {
        if (next[campo] === valor) next[campo] = Array.isArray(valor) ? [] : '';
    }
    delete next._deLaFicha;
    delete next._fichaCargada;
    delete next._fichaFallo;
    return next;
}

export function aplicarFichaEnlazada(prevOriginal, val, ficha) {
    const cambia = prevOriginal?.enlazar_con_id && String(prevOriginal.enlazar_con_id) !== String(val);
    const prev = cambia ? soltarFichaAnterior(prevOriginal) : prevOriginal;
    // Los datos protegidos de la ficha todavía no llegaron: hasta que lleguen,
    // no se puede guardar (ver `motivoNoGuardable`).
    const next = { ...prev, enlazar_con_id: val, _fichaCargada: null, _fichaFallo: null, _deLaFicha: {} };
    if (!val) { delete next._deLaFicha; delete next._fichaCargada; delete next._fichaFallo; return next; }
    if (!ficha) return next;

    for (const [campo, valor] of Object.entries(ficha)) {
        if (NO_SE_HEREDA.has(campo)) continue;
        if (ELEGIBLES_AL_ENLAZAR.includes(campo) && prev[campo]) continue;
        if (valor === null || valor === undefined) continue;
        next[campo] = valor;
        next._deLaFicha[campo] = valor;
    }

    /* La foto entra como vista previa y no como archivo: no hay `File` que
     * subir, la imagen ya está guardada.
     *
     * ── La condición mira `file`, NO `photoPreview` ────────────────────────
     *
     * Miraba los dos, y por eso al CAMBIAR de persona enlazada la foto se
     * quedaba en la del anterior: después del primer enlace ya había vista
     * previa, así que la guarda la daba por «puesta a mano» y no la tocaba. Lo
     * vio el usuario: «cambié de persona a enlazar y la foto no se actualizó
     * (los datos sí)» — o sea la cara de alguien sobre el expediente de otro.
     *
     * `file` es el discriminador correcto y ya existía: se llena SÓLO cuando
     * alguien eligió una imagen o la tomó con el teléfono. Una vista previa sin
     * archivo no puede venir de otro lado que de un enlace, así que pisarla es
     * exactamente lo que hay que hacer. */
    if (!prev.file) {
        next.photoPreview = ficha.photo || ficha.photo_url || null;
    }
    return next;
}

/**
 * Lo que el padrón no trae de la ficha enlazada (el código, el DUI, el sueldo,
 * la cuenta: ver `traerLoQueFaltaDeLaFicha` en `data/employees.js`) entra SÓLO
 * donde el formulario está vacío —para no pisar lo que alguien escribió
 * mientras la consulta viajaba—, salvo el código y el PIN, que siempre son los
 * de la persona (`SIEMPRE_DE_LA_FICHA`). Marca la ficha como cargada: hasta
 * entonces no se guarda.
 *
 * Devuelve `prev` tal cual si mientras tanto se eligió OTRA ficha.
 */
export function completarConLoProtegido(prev, val, fuera = {}) {
    if (String(prev?.enlazar_con_id) !== String(val)) return prev;
    const next = { ...prev, _fichaCargada: val, _fichaFallo: null, _deLaFicha: { ...(prev._deLaFicha || {}) } };
    for (const [k, v] of Object.entries(fuera || {})) {
        if (SIEMPRE_DE_LA_FICHA.has(k) || vacioParaEnlazar(prev[k])) {
            next[k] = v;
            next._deLaFicha[k] = v;
        }
    }
    return next;
}

/**
 * Por qué no se puede guardar un ENLACE todavía (o `null` si sí se puede).
 * Enlazar sin los datos protegidos de la ficha escribía el sueldo, la cuenta y
 * el ISSS en blanco y un código aleatorio encima de los de la persona.
 */
export function motivoDelEnlace(form) {
    if (!form?.enlazar_con_id) return null;
    if (String(form._fichaCargada) === String(form.enlazar_con_id)) return null;
    return String(form._fichaFallo) === String(form.enlazar_con_id)
        ? 'No se pudieron leer el sueldo, la cuenta y el código de la ficha que enlazas. Quítala y vuelve a elegirla.'
        : 'Cargando los datos de la ficha que enlazas…';
}

/**
 * Las fichas con las que se puede enlazar un alta: todas menos las INACTIVAS,
 * ordenadas por nombre, con su sala y su cargo para distinguir homónimos.
 * Sólo al dar de alta: en edición la ficha ya es una.
 */
export function fichasParaEnlazar(employees = [], branches = [], roles = []) {
    const nombreDeSala = (id) => (branches || []).find(b => String(b.id) === String(id))?.name || 'Sin sala';
    const nombreDeCargo = (id) => (roles || []).find(r => String(r.id) === String(id))?.name || 'Sin cargo';
    return [...(employees || [])]
        .filter(e => e.status !== 'INACTIVO')
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'))
        .map(e => ({
            value: String(e.id),
            label: `${e.name} · ${nombreDeSala(e.branch_id ?? e.branchId)} · ${nombreDeCargo(e.role_id)}`,
        }));
}

// ── Las listas cerradas de la ficha ─────────────────────────────────────────

export const GENDER_OPTIONS = [{ value: 'F', label: 'Femenino' }, { value: 'M', label: 'Masculino' }];
export const BLOOD_TYPE_OPTIONS = [{ value: 'O+', label: 'O+ (Positivo)' }, { value: 'O-', label: 'O- (Negativo)' }, { value: 'A+', label: 'A+' }, { value: 'A-', label: 'A-' }, { value: 'B+', label: 'B+' }, { value: 'B-', label: 'B-' }, { value: 'AB+', label: 'AB+' }, { value: 'AB-', label: 'AB-' }];
export const MARITAL_STATUS_OPTIONS = [{ value: 'SOLTERO', label: 'Soltero/a' }, { value: 'CASADO', label: 'Casado/a' }, { value: 'DIVORCIADO', label: 'Divorciado/a' }, { value: 'VIUDO', label: 'Viudo/a' }, { value: 'ACOMPAÑADO', label: 'Acompañado/a' }];

// Art. 23 nº10 CT: el numeral pide «cantidad, CALIDAD Y ESTADO». Es una lista
// cerrada y no texto libre porque el valor de este campo está en poder
// compararlo el día de la devolución, y «bueno», «Bueno» y «b» no se comparan.
export const ESTADO_HERRAMIENTA_OPTIONS = [
    { value: 'NUEVO', label: 'Nuevo' },
    { value: 'BUENO', label: 'Bueno' },
    { value: 'USADO', label: 'Usado' },
    { value: 'DETERIORADO', label: 'Deteriorado' },
];
// Art. 23 nº9 CT: «forma, PERÍODO y lugar de pago».
export const PERIODO_PAGO_OPTIONS = [
    { value: 'SEMANAL', label: 'Semanal' },
    { value: 'QUINCENAL', label: 'Quincenal' },
    { value: 'MENSUAL', label: 'Mensual' },
];
// El documento de identidad (DUI frente/reverso para adultos, o el documento
// alterno para menores — Art. 23.2). La última opción es «otro»: lo que se
// escriba ahí es el valor.
export const ALT_ID_DOCUMENT_TYPE_OPTIONS = [
    { value: 'PARTIDA_NACIMIENTO', label: 'Partida de Nacimiento' },
    { value: 'CARNET_MINORIDAD', label: 'Carné de Minoridad' },
    { value: 'PASAPORTE', label: 'Pasaporte' },
    { value: OTRA_ESPECIALIDAD, label: 'Otro documento legal...' },
];
// Compartido entre "Avisar a" (Ficha Médica) y Personas Dependientes.
export const PARENTESCO_OPTIONS = [
    { value: 'CONYUGE', label: 'Cónyuge / pareja' },
    { value: 'HIJO_A', label: 'Hijo/a' },
    { value: 'PADRE', label: 'Padre' },
    { value: 'MADRE', label: 'Madre' },
    { value: 'HERMANO_A', label: 'Hermano/a' },
    { value: 'ABUELO_A', label: 'Abuelo/a' },
    { value: 'NIETO_A', label: 'Nieto/a' },
    { value: 'SUEGRO_A', label: 'Suegro/a' },
    { value: 'CUNADO_A', label: 'Cuñado/a' },
    { value: 'TIO_A', label: 'Tío/a' },
    { value: 'SOBRINO_A', label: 'Sobrino/a' },
    { value: 'PRIMO_A', label: 'Primo/a' },
    { value: 'OTRO', label: 'Otro' },
];
// Escala de 3 niveles usada en El Salvador (ISRI / Encuesta Nacional de Salud) para
// clasificar severidad de discapacidad — no es un catálogo abierto, es una escala fija.
export const DISABILITY_GRADE_OPTIONS = [
    { value: 'LEVE', label: 'Leve' },
    { value: 'MODERADA', label: 'Moderada' },
    { value: 'SEVERA', label: 'Severa' },
];
export const AFP_OPTIONS = [
    { value: 'CRECER', label: 'AFP Crecer' },
    { value: 'CONFIA', label: 'AFP Confía' },
];
export const ACCOUNT_TYPE_OPTIONS = [
    { value: 'AHORRO',     label: 'Cuenta de ahorro' },
    { value: 'CORRIENTE',  label: 'Cuenta corriente' },
    { value: 'ELECTRONICA',label: 'Cuenta electrónica' },
];

// ── Validaciones de formato ─────────────────────────────────────────────────

export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '');

// Numeración de El Salvador: 8 dígitos, celular inicia en 6/7, fijo en 2.
// (No valida contra un rango exacto por operador — solo el primer dígito.)
export const isValidSVPhone = (phone) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length !== 8) return false;
    return /^[267]/.test(digits);
};

// Nombres/Apellidos: solo letras (con acentos/Ñ), espacios, guiones y apóstrofes;
// mínimo 2 caracteres. Cubre "apellido de casada" (ej. "Pérez de García") sin
// necesitar un campo aparte — es texto libre normal.
export const isValidPersonName = (val) => {
    const v = (val || '').trim();
    if (v.length < 2) return false;
    return /^[A-Za-zÀ-ÖØ-öø-ÿÑñ'’\-\s.]+$/.test(v);
};

/** «0000-0000» mientras se escribe un teléfono (la máscara `PHONE` del portal). */
export const mascaraTelefono = (value) => {
    const v = String(value || '').replace(/\D/g, '').substring(0, 8);
    return v.length > 4 ? `${v.substring(0, 4)}-${v.substring(4)}` : v;
};

// Rango laboral válido: 16-90 (calcAge compartido en utils/ageUtils.js).
export const MIN_WORK_AGE = 16;
export const MAX_WORK_AGE = 90;

/**
 * El código de carné que se propone en un alta: cuatro dígitos que el
 * SERVIDOR confirma libres (`codigoDeCarneLibre`, que se recibe para no atar
 * este archivo a la red). Ninguna respuesta afirmativa en 12 intentos devuelve
 * `null`: no se inventa un código, porque dos personas con el mismo código son
 * dos con la misma contraseña del portal.
 */
export async function proponerCodigoDeCarne(codigoDeCarneLibre) {
    for (let i = 0; i < 12; i++) {
        const candidato = String(Math.floor(1000 + Math.random() * 9000));
        if (await codigoDeCarneLibre(candidato) === true) return candidato;
    }
    return null;
}
