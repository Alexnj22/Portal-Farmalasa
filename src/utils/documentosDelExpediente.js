import { getExpiryBadge } from './documentExpiry';
/**
 * Cómo se LLAMA un documento del expediente, y a qué grupo pertenece.
 *
 * ── Por qué existe (2026-09-04) ────────────────────────────────────────────
 *
 * Lo reportó una captura de «Mis documentos»: una tarjeta titulada «Del
 * expediente» con la palabra **`DUI_COMPLETO`** debajo. O sea que la pantalla
 * mostraba el rótulo de la CATEGORÍA como nombre y la clave cruda de la base
 * como archivo — exactamente al revés de lo que la persona necesita leer.
 *
 * Y la clave cruda no era un descuido de esa vista: **está guardada así**.
 * `EmployeeFormModal` escribe el título con
 *
 *     title: documentCategories.find(c => c.key === category)?.label || category
 *
 * y las tres categorías del DUI (`DUI_FRENTE`, `DUI_REVERSO`, `DUI_COMPLETO`)
 * más la del menor (`DOCUMENTO_IDENTIDAD`) **no están en `documentCategories`**:
 * se dibujan en su propio bloque agrupado. El `find` falla, el `|| category`
 * convierte «no encontré» en un dato, y lo guarda. Medido en producción el
 * 2026-09-04: de los 8 documentos que existen, **4 tienen la clave como
 * título** y 4 el rótulo bueno — el mismo campo diciendo dos cosas distintas.
 *
 * Es la regla del proyecto sobre `? :` encima de un `find` que puede fallar
 * (CLAUDE.md, «un rótulo no es una clave»), y la corrección es la misma: que el
 * rótulo salga de UN catálogo, y que quien no lo encuentre no invente.
 *
 * ── Qué resuelve, y qué no ─────────────────────────────────────────────────
 *
 * `nombreDeDocumento` nunca devuelve una clave: si la categoría no está en el
 * catálogo y el título guardado también es una clave, la humaniza. Eso arregla
 * las 4 filas que YA están escritas sin migración, que es lo que corresponde —
 * una migración arreglaría el pasado y dejaría el defecto vivo para la próxima.
 *
 * Los documentos sueltos (`EXTRA_…`) son la excepción a propósito: ahí el
 * título lo escribe una persona y ES el dato, así que manda sobre el catálogo.
 */


// ── El catálogo ────────────────────────────────────────────────────────────
//
// Los veinte primeros son, palabra por palabra, los que `EmployeeFormModal`
// tenía escritos dentro de su `useMemo` de `documentCategories`. Viven acá para
// que la lista sea una sola: escrita en dos lados, el día que alguien corrija
// un rótulo lo corrige en uno — que es `feedback_lista_a_mano_se_desincroniza`
// aplicado a un catálogo que además se GUARDA en la base.
//
// Los cuatro últimos son los que faltaban, y su ausencia es todo el bug: se
// dibujan en el bloque agrupado del documento de identidad, donde el rótulo lo
// pone la maqueta («Frente», «Reverso», «Documento completo (las dos caras)»).
// Ese rótulo sirve DENTRO del bloque, que ya dice que se trata del DUI. Suelto
// en una lista de documentos no dice de qué es el frente, así que acá se nombra
// entero.
export const ROTULOS = {
    // Al entrar
    SOLICITUD_EMPLEO: 'Solicitud de empleo',
    OFERTA_EMPLEO: 'Oferta de empleo',
    DECLARACION_ETICA: 'Declaración de responsabilidades éticas',
    CONSTANCIA_INDUCCION: 'Constancia de inducción de personal',
    CV: 'Currículum Vitae — con sus atestados',
    CONTRATO: 'Contrato de Trabajo Firmado',
    ACUSE_MTPS: 'Acuse sellado del Ministerio de Trabajo',
    COPIA_NIT: 'Copia del NIT',
    // Cada año
    CERTIFICADO_MEDICO_ANUAL: 'Certificado médico anual — heces y orina',
    EXAMEN_MEDICO: 'Examen Médico Previo — Art. 117 (se repite cada año hasta los 18)',
    ANUALIDAD_JVPQF: 'Anualidad JVPQF — solvencia del año en curso',
    ANUALIDAD_JVPE: 'Anualidad JVPE — solvencia del año en curso',
    // ISSS y AFP
    TARJETA_ISSS: 'Copia de la tarjeta del ISSS',
    TARJETA_AFP: 'Copia de la tarjeta de la AFP',
    // Seguro de vida colectivo — el certificado de cada asegurado. La póliza y
    // los pagos de cada año son de la EMPRESA y viven aparte
    // (`seguro_vida_poliza`, `seguro_vida_pagos`).
    CERTIFICADO_SEGURO_VIDA: 'Certificado del asegurado — Seguro de vida colectivo',
    // Para ejercer
    CONTRATO_REGENCIA: 'Contrato de Regencia',
    // Sólo si aplica
    LICENCIA_MOTO: 'Licencia de Motocicleta',
    LICENCIA_CARRO: 'Licencia de Automóvil',
    CERTIFICACION_DISCAPACIDAD: 'Certificación de Discapacidad — ISRI / CONAIPD',
    // Acreditaciones (se suben en su propia sección: ahí el archivo trae el
    // número y el vencimiento)
    SRS: 'Carné JVPQF — Regente / Químico Farmacéutico',
    // El certificado de acreditación que entrega la junta: es otro papel que
    // el carné y va en el mismo apartado (pedido del usuario, 2026-10-24).
    CERTIFICADO_JVPQF: 'Certificado de acreditación — JVPQF',
    ENFERMERIA: 'Carné de Enfermería — JVPE',
    MEDICO: 'Carné médico — JVPM',
    CONTADURIA: 'Acreditación de Contaduría — CVPCPA',
    DEPENDIENTE_FARMACIA: 'Acreditación de dependiente de farmacia — CSSP',
    // Identidad — los que faltaban
    DUI_COMPLETO: 'DUI — las dos caras',
    DUI_FRENTE: 'DUI — frente',
    DUI_REVERSO: 'DUI — reverso',
    DOCUMENTO_IDENTIDAD: 'Documento de identidad',
};

// ── El grupo: por qué la persona tiene este papel ──────────────────────────
//
// Son las mismas cinco secciones de `SECCIONES_DE_DOCUMENTOS` más las dos que
// viven fuera de esa lista (identidad y acreditaciones). No es decoración: en
// «Mis documentos» la lista es plana y sin el grupo un carné de junta y una
// copia del NIT se leen como la misma clase de cosa.
export const GRUPOS = {
    SOLICITUD_EMPLEO: 'Al entrar', CV: 'Al entrar', CONTRATO: 'Al entrar',
    ACUSE_MTPS: 'Al entrar', COPIA_NIT: 'Al entrar',
    OFERTA_EMPLEO: 'Al entrar', DECLARACION_ETICA: 'Al entrar', CONSTANCIA_INDUCCION: 'Al entrar',

    CERTIFICADO_MEDICO_ANUAL: 'Cada año', EXAMEN_MEDICO: 'Cada año',
    ANUALIDAD_JVPQF: 'Cada año', ANUALIDAD_JVPE: 'Cada año',

    TARJETA_ISSS: 'ISSS y AFP', TARJETA_AFP: 'ISSS y AFP',

    CERTIFICADO_SEGURO_VIDA: 'Seguro de vida',

    CONTRATO_REGENCIA: 'Para ejercer',
    SRS: 'Para ejercer', CERTIFICADO_JVPQF: 'Para ejercer', ENFERMERIA: 'Para ejercer', MEDICO: 'Para ejercer',
    CONTADURIA: 'Para ejercer', DEPENDIENTE_FARMACIA: 'Para ejercer',

    LICENCIA_MOTO: 'Sólo si aplica', LICENCIA_CARRO: 'Sólo si aplica',
    CERTIFICACION_DISCAPACIDAD: 'Sólo si aplica',

    DUI_COMPLETO: 'Identidad', DUI_FRENTE: 'Identidad',
    DUI_REVERSO: 'Identidad', DOCUMENTO_IDENTIDAD: 'Identidad',
};

// Una clave del catálogo: MAYÚSCULAS, dígitos y guiones bajos, y nada más. Es
// lo que distingue un título ESCRITO por alguien de uno que quedó guardado
// porque un `find` falló.
const PARECE_CLAVE = (t) => typeof t === 'string' && /^[A-Z0-9_]+$/.test(t.trim()) && t.trim().length > 1;

// Un documento suelto: lo agrega la persona con el botón «agregar», su clave se
// inventa con la hora (`EXTRA_1756…`) y su título ES el dato.
const esSuelto = (categoria) => typeof categoria === 'string' && categoria.startsWith('EXTRA_');

/** El rótulo del catálogo, o `null`. NUNCA la clave: quien no encuentra, no inventa. */
export const rotuloDeCategoria = (categoria) => ROTULOS[categoria] || null;

/** El grupo al que pertenece la categoría, o `null`. */
export const grupoDeCategoria = (categoria) => GRUPOS[categoria] || null;

/**
 * Cómo se llama este documento en pantalla. Nunca devuelve una clave cruda.
 *
 * El orden importa y cada escalón tiene su motivo:
 *   1. un documento SUELTO manda con su título — ahí el título es el dato;
 *   2. el catálogo, que es la verdad para todo lo que el portal pide;
 *   3. el título guardado, si de verdad es un rótulo y no una clave;
 *   4. la clave humanizada, para una categoría que nadie declaró todavía.
 */
export function nombreDeDocumento(doc) {
    if (!doc) return 'Documento';
    const titulo = typeof doc.title === 'string' ? doc.title.trim() : '';
    if (esSuelto(doc.category) && titulo) return titulo;
    const delCatalogo = rotuloDeCategoria(doc.category);
    if (delCatalogo) return delCatalogo;
    if (titulo && !PARECE_CLAVE(titulo)) return titulo;
    return humanizar(doc.category || titulo);
}

/** `DUI_COMPLETO` → `Dui completo`. El último recurso, no el camino normal. */
export function humanizar(clave) {
    if (!clave) return 'Documento';
    const limpio = String(clave).replace(/_/g, ' ').trim().toLowerCase();
    return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : 'Documento';
}

/**
 * El rótulo con el que se GUARDA un documento nuevo.
 *
 * Recibe la lista por cargo porque ésa es la que manda: un mismo documento
 * puede tener un matiz distinto según la ficha, y el catálogo de acá es el piso.
 * Lo que NO puede pasar —y pasaba— es que devuelva la clave.
 */
export function rotuloDelDocumento(categoria, listaDeLaFicha = []) {
    return listaDeLaFicha.find(c => c.key === categoria)?.label
        || rotuloDeCategoria(categoria)
        || humanizar(categoria);
}

// ── El ícono y el tinte: qué CLASE de papel es ─────────────────────────────
//
// `EmployeeDocumentsList` ya elegía ícono por categoría (`docIcon`) y la lista
// de «Mis documentos» dibujaba la misma carpeta para los cuatro documentos de
// una persona — o sea que el ícono no distinguía nada justo donde más se
// escanea. Vive acá para que las dos pantallas elijan igual: es el mismo
// documento visto desde dos lados, y `feedback_el_arreglo_de_un_canonico_no_
// llega_a_su_gemelo` es exactamente esto.
//
// El tinte va por GRUPO y no por categoría: veinticuatro colores no son un
// código, son ruido. Cinco grupos sí se aprenden, y es el sitio donde §17.0
// admite color — el ícono identifica, el fondo de la tarjeta no se toca.
const TINTES = {
    'Al entrar':      { iconBg: 'bg-chart-1/10', iconCls: 'text-chart-1-text' },
    'Cada año':       { iconBg: 'bg-warning/10', iconCls: 'text-warning-text' },
    'ISSS y AFP':     { iconBg: 'bg-chart-9/10', iconCls: 'text-chart-9-text' },
    'Seguro de vida': { iconBg: 'bg-chart-9/10', iconCls: 'text-chart-9-text' },
    'Para ejercer':   { iconBg: 'bg-success/10', iconCls: 'text-success-text' },
    'Sólo si aplica': { iconBg: 'bg-chart-4/10', iconCls: 'text-chart-4-text' },
    Identidad:        { iconBg: 'bg-brand/10',   iconCls: 'text-brand-text'   },
};
const TINTE_POR_DEFECTO = { iconBg: 'bg-surface-card-hover', iconCls: 'text-content-3' };

/** El tinte del squircle según el grupo del documento. Nunca `undefined`. */
export const tinteDeCategoria = (categoria) =>
    TINTES[grupoDeCategoria(categoria)] || TINTE_POR_DEFECTO;

// ── Qué archivo es, cuando la fila no guardó su nombre ─────────────────────
//
// Cinco de los ocho documentos de producción no tienen `file_name`, y la ficha
// decía «Documento adjunto» — que no distingue un PDF de una foto ni dice si
// hay algo raro. La extensión de la URL guardada sí lo dice, y es gratis.
export function descripcionDelArchivo(nombre, url) {
    const limpio = typeof nombre === 'string' ? nombre.trim() : '';
    if (limpio) return limpio;
    const ruta = String(url || '').split('?')[0];
    if (/\.pdf$/i.test(ruta)) return 'Archivo PDF';
    if (/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(ruta)) return 'Imagen';
    return 'Documento adjunto';
}

// El ícono de la categoría. Es la versión completa del `docIcon` que vivía
// dentro de `EmployeeDocumentsList`: ahí cubría cuatro casos y todo lo demás
// caía en la hoja genérica, que es como cuatro documentos distintos de una
// misma persona terminaban dibujando el mismo papel.
const ICONOS = {
    DUI_COMPLETO: 'CreditCard', DUI_FRENTE: 'CreditCard', DUI_REVERSO: 'CreditCard',
    DOCUMENTO_IDENTIDAD: 'CreditCard',

    SRS: 'Award', CERTIFICADO_JVPQF: 'Award', ENFERMERIA: 'Award', MEDICO: 'Award', CONTADURIA: 'Award',
    DEPENDIENTE_FARMACIA: 'Award',

    ANUALIDAD_JVPQF: 'Receipt', ANUALIDAD_JVPE: 'Receipt',

    LICENCIA_MOTO: 'Bike', LICENCIA_CARRO: 'Car',

    CERTIFICADO_MEDICO_ANUAL: 'Stethoscope', EXAMEN_MEDICO: 'Stethoscope',

    TARJETA_ISSS: 'ShieldCheck', TARJETA_AFP: 'ShieldCheck',

    // Nombres que existen también en `apps/mobile/tema/iconos.js`: uno que la
    // app no traduce sale con el genérico.
    CERTIFICADO_SEGURO_VIDA: 'ShieldCheck',

    DECLARACION_ETICA: 'PenLine', CONSTANCIA_INDUCCION: 'BookOpen', OFERTA_EMPLEO: 'Mail',

    CERTIFICACION_DISCAPACIDAD: 'Accessibility',

    CONTRATO: 'ScrollText', CONTRATO_REGENCIA: 'ScrollText',
};

/** El ícono de la categoría. `FileText` para lo que no tiene uno propio. */
export const nombreDelIconoDeCategoria = (categoria) => ICONOS[categoria] || 'FileText';


// ── El expediente que se edita (portal y app) ──────────────────────────────
// Se mudaron de `EmployeeFormModal` el 2026-10-07 para que la app edite el
// expediente con las MISMAS secciones, la misma regla de versiones y los
// mismos niveles de estudio.

export const SECCIONES_DE_DOCUMENTOS = [
    {
        id: 'ingreso',
        titulo: 'Al entrar',
        bajada: 'Lo que la empresa pide para admitir a alguien y lo que exige el contrato.',
        // La oferta, la declaración ética y la constancia de inducción se
        // sumaron el 2026-10-14 (pedido del usuario). La declaración ética se
        // firma junto con el contrato; por eso va pegada a él.
        claves: ['SOLICITUD_EMPLEO', 'OFERTA_EMPLEO', 'CV', 'CONTRATO', 'DECLARACION_ETICA',
                 'CONSTANCIA_INDUCCION', 'ACUSE_MTPS', 'COPIA_NIT'],
    },
    {
        id: 'anual',
        titulo: 'Cada año',
        bajada: 'Caducan: hay que volver a traerlos, y el portal avisa antes de que venzan.',
        claves: ['CERTIFICADO_MEDICO_ANUAL', 'EXAMEN_MEDICO', 'ANUALIDAD_JVPQF', 'ANUALIDAD_JVPE'],
    },
    {
        /* El ISSS y la AFP son su propia sección, y no un apartado de «ejercer
         * la profesión» como estuvieron un rato. Lo señaló el usuario: «no tiene
         * sentido el ISSS y AFP ahí».
         *
         * No habilitan a nadie a ejercer nada — los tiene cualquier persona que
         * trabaja, sea regente o dependiente. Y no se tramitan igual, que es la
         * distinción que el portal ya hace en Contrato: al ISSS lo inscribe el
         * PATRONO, la AFP la elige el TRABAJADOR. */
        id: 'prevision',
        titulo: 'ISSS y AFP',
        bajada: 'La copia de cada tarjeta es la prueba de la afiliación. Al ISSS lo inscribe la empresa; la AFP la elige la persona.',
        claves: ['TARJETA_ISSS', 'TARJETA_AFP'],
    },
    {
        /* El seguro de vida colectivo (MAPFRE). Lo de la persona es UN papel —
         * su certificado de asegurado, que no cambia ni vence—. La póliza y el
         * pago de cada noviembre son de la empresa: se cargan una vez para todos
         * en Personal › Seguro de vida, y de ahí sale si la persona está
         * solvente. */
        id: 'seguro',
        titulo: 'Seguro de vida colectivo',
        bajada: 'El certificado de asegurado de la persona. La póliza y el pago de cada año se cargan una vez para todos en Personal › Seguro de vida.',
        claves: ['CERTIFICADO_SEGURO_VIDA'],
    },
    {
        id: 'ejercer',
        titulo: 'Para ejercer su profesión',
        bajada: 'Lo que habilita a la persona ante su junta de vigilancia.',
        claves: ['CONTRATO_REGENCIA'],
    },
    {
        /* La certificación de discapacidad se movió acá desde «ejercer la
         * profesión», donde tampoco pertenecía: no habilita a ejercer nada, es
         * una condición de la persona con efectos legales propios. */
        id: 'siaplica',
        titulo: 'Sólo si aplica',
        bajada: 'Dependen de la persona: aparecen cuando su ficha dice que los tiene.',
        claves: ['LICENCIA_MOTO', 'LICENCIA_CARRO', 'CERTIFICACION_DISCAPACIDAD'],
    },
];

export const HISTORIAL_MAXIMO = 10;

/* ── Cuáles guardan el ARCHIVO anterior, y cuáles sólo la traza ─────────
 *
 * La lista creció el 2026-08-31, y conviene el registro porque **cambia una
 * decisión anterior del mismo usuario**.
 *
 * Antes decía: *«esto sólo es necesario para el médico, y nada más como
 * historial de texto —cuándo se actualizó y quién— para los otros»*. El
 * razonamiento era que el contrato o una licencia sólo importan en su
 * versión vigente.
 *
 * Lo que faltaba era una palabra: **recontrataciones**. *«Archivos que se
 * van anexando como historial: solicitud de empleo, contrato de trabajo,
 * acuse de recibido del MT, certificado médico anual, anualidad. Los demás
 * sólo se actualiza el documento y se guarda la fecha / historial de
 * actualización. Ya que pueden haber recontrataciones, y otros temas.»*
 *
 * Y ahí el contrato deja de tener «una versión vigente»: alguien que entra,
 * sale y vuelve tiene DOS contratos, y los dos son ciertos. El de 2024 no
 * es una versión vieja del de 2026 — es el que prueba lo que pasó en 2024,
 * y es el que pide una inspección o una demanda. Lo mismo la solicitud de
 * cada ingreso y el acuse de cada uno.
 *
 * El criterio que separa las dos listas, dicho de una vez: **¿el papel de
 * antes sigue probando algo por su cuenta?** El certificado médico de 2025
 * prueba que ese año se cumplió; el contrato de la primera contratación
 * prueba esa relación laboral; la anualidad de cada año prueba ese año. En
 * cambio una licencia de conducir vencida o un DUI reemplazado no prueban
 * nada que el vigente no diga mejor.
 *
 * Los que no están acá conservan igual la TRAZA —cuándo se cambió y quién—,
 * que pesa dos campos y contesta «¿esto quién lo tocó?». */
// La oferta, la declaración ética y la inducción (2026-10-14) son de cada
// ingreso, igual que el contrato: en una recontratación las dos son ciertas.
//
// El DUI entró el 2026-10-22, y contradice lo de arriba a propósito. Pedido del
// usuario al renovarse el DUI de una persona: «que quede registro o historial
// de los cambios». El DUI vencido no prueba nada que el vigente no diga mejor
// —eso sigue siendo cierto—, pero sin el archivo no se puede ver QUÉ decía el
// documento con el que se firmaron los papeles de antes, y la traza sola
// («lo cambió Fulana el 22-oct») no contesta eso.
export const CON_ARCHIVO_ANTERIOR = new Set([
    'SOLICITUD_EMPLEO', 'CONTRATO', 'ACUSE_MTPS',
    'OFERTA_EMPLEO', 'DECLARACION_ETICA', 'CONSTANCIA_INDUCCION',
    'CERTIFICADO_MEDICO_ANUAL', 'EXAMEN_MEDICO',
    'ANUALIDAD_JVPQF', 'ANUALIDAD_JVPE',
    'DUI_FRENTE', 'DUI_REVERSO', 'DUI_COMPLETO',
]);

/* ── El certificado médico vale por AÑO CALENDARIO ─────────────────────────
 *
 * Decisión del usuario, 2026-10-13: *«que la fecha del documento sólo tome el
 * año, es válido para todo ese año»*. El certificado de 2026 cubre 2026 entero,
 * no «un año desde que se hizo el examen» — así que lo que se pide es el AÑO y
 * el vencimiento se deriva: el 31 de diciembre de ese año. Guardarlo como
 * fecha (y no como un número aparte) mantiene vivo todo lo que ya lee
 * `expiry_date`: el aviso de documentos por vencer, la lista de la ficha y las
 * exportaciones. */
export const POR_ANIO_CALENDARIO = new Set(['CERTIFICADO_MEDICO_ANUAL']);

/** `2026` → `'2026-12-31'`. */
export const vencimientoDelAnio = (anio) => {
    const n = Number(anio);
    return Number.isInteger(n) && n >= 2000 && n <= 2100 ? `${n}-12-31` : '';
};

/** `'2026-12-31'` (o cualquier fecha ISO) → `2026`; `null` si no hay. */
export const anioDelVencimiento = (fecha) => {
    const m = /^(\d{4})-/.exec(String(fecha || ''));
    return m ? Number(m[1]) : null;
};

/**
 * El año que CUBRE un certificado, leído de su vencimiento guardado.
 *
 * Con la regla nueva el vencimiento es el 31 de diciembre de ese año. Los que
 * se guardaron antes del 2026-10-13 llevan «un año desde la emisión» (los
 * cuatro de producción: emitidos en junio de 2026, vencen en junio de 2027), así
 * que su año es el ANTERIOR al del vencimiento. Sin esta lectura, un
 * certificado de 2026 se mostraría como «válido todo 2027».
 */
export const anioQueCubre = (fecha) => {
    const anio = anioDelVencimiento(fecha);
    if (!anio) return null;
    return /-12-31$/.test(String(fecha)) ? anio : anio - 1;
};

export const EDUCATION_OPTIONS = [
    { value: 'BASICA', label: 'Educación básica' },
    { value: 'BACHILLERATO_GENERAL', label: 'Bachillerato general' },
    { value: 'BACHILLERATO_TECNICO', label: 'Bachillerato técnico' },
    { value: 'TECNICO_SUPERIOR', label: 'Técnico superior' },
    { value: 'UNIVERSITARIO', label: 'Universitario' },
];
// Niveles donde el select de Especialidad aplica
export const LEVELS_WITH_SPECIALTY = ['BACHILLERATO_TECNICO', 'TECNICO_SUPERIOR'];
// Niveles donde "¿Actualmente estudiando?" siempre se muestra
export const LEVELS_WITH_STUDY_TOGGLE = ['BACHILLERATO_TECNICO', 'TECNICO_SUPERIOR', 'UNIVERSITARIO'];
// Niveles donde el campo Profesión/Título se muestra — Bachillerato Técnico y
// Técnico Superior quedan fuera: su "título" ya es la especialidad de arriba,
// no una profesión aparte.
export const LEVELS_WITH_PROFESSION = ['UNIVERSITARIO'];

/**
 * Pone un archivo (o un cambio) en un documento del expediente y devuelve la
 * lista nueva. Se archiva sólo cuando de verdad se REEMPLAZA un archivo por
 * otro: la traza (cuándo y quién) va siempre; el archivo anterior, sólo en los
 * documentos de `CON_ARCHIVO_ANTERIOR`. Quitar un archivo no archiva nada.
 *
 * @param {any[]} lista
 * @param {string} categoria
 * @param {any} patch
 * Cuando llega un archivo NUEVO se anota quién lo subió y cuándo
 * (`subido_por`, `subido_por_id`, `subido_el`). Pedido del usuario el
 * 2026-10-13: *«cada documento se debe ver quién lo subió»*. Hasta hoy sólo la
 * traza de un reemplazo decía quién — el documento vigente no lo decía nunca.
 *
 * @param {{ quien?: string, quienId?: string|null, hoy?: string, listaDeLaFicha?: any[] }} [opciones]
 */
export function documentoReemplazado(lista, categoria, patch, { quien = '', quienId = null, hoy, listaDeLaFicha = [] } = {}) {
    const docs = [...(lista || [])];
    const idx = docs.findIndex(d => d.category === categoria);
    const base = idx >= 0 ? docs[idx] : { category: categoria, title: rotuloDelDocumento(categoria, listaDeLaFicha), file_name: '', url: null, expiry_date: '' };
    const llegaOtro = Object.prototype.hasOwnProperty.call(patch, 'url') && !!patch.url && !!base.url && patch.url !== base.url;
    const traza = {
        reemplazado_el: hoy,
        por: quien || '',
        ...(CON_ARCHIVO_ANTERIOR.has(categoria)
            ? { url: base.url, file_name: base.file_name || '', expiry_date: base.expiry_date || '',
                ...(base.subido_por ? { subido_por: base.subido_por, subido_el: base.subido_el || '' } : {}) }
            : {}),
    };
    const historial = llegaOtro ? [traza, ...(base.historial || [])].slice(0, HISTORIAL_MAXIMO) : (base.historial || []);
    // Un archivo que entra por primera vez o que reemplaza a otro. Quitarlo
    // (`url: null`) no cambia quién subió el que había.
    const subeUnArchivo = Object.prototype.hasOwnProperty.call(patch, 'url') && !!patch.url && patch.url !== base.url;
    const autoria = subeUnArchivo
        ? { subido_por: quien || '', subido_por_id: quienId || null, subido_el: hoy || '' }
        : {};
    const nuevo = { ...base, ...patch, ...autoria, historial };
    if (idx >= 0) docs[idx] = nuevo; else docs.push(nuevo);
    return docs;
}

/**
 * Lo que se le pasa a `documentoReemplazado` cuando ENTRA un archivo a una
 * casilla (`subida` = `{ url, file_name }`).
 *
 * Un archivo que REEMPLAZA a otro no hereda su vencimiento (2026-10-22): lo
 * heredaba, y como la lectura sólo llena una fecha vacía, el papel renovado
 * quedaba con la del anterior —el DUI de una persona se volvió a subir con su
 * renovación y la tarjeta siguió diciendo «vencido»—. La fecha que alguien
 * escribió ANTES de subir el primer archivo sí se respeta. El formulario del
 * portal lo hace en `handleDocFile`; esto es lo mismo para la app.
 */
export function parcheDeArchivoNuevo(anterior, subida, ahora = new Date().toISOString()) {
    return { ...subida, uploaded_at: ahora, ...(anterior?.url ? { expiry_date: '' } : {}) };
}

/** Las caras del DUI vencen cuando vence el DUI. */
export const CARAS_DEL_DUI = new Set(['DUI_FRENTE', 'DUI_REVERSO', 'DUI_COMPLETO']);

/**
 * Pone el vencimiento del DUI (`dui_fecha_vencimiento` de la ficha) en sus
 * caras cargadas. Lo dice el lector —o, si confirmó lo que había, la ficha—,
 * no el archivo anterior. Devuelve la misma lista si no hay nada que cambiar.
 */
export function carasConElVencimientoDelDui(lista, vence) {
    if (!vence) return lista;
    let cambio = false;
    const nueva = (lista || []).map(d => {
        if (CARAS_DEL_DUI.has(d?.category) && d.url && d.expiry_date !== vence) { cambio = true; return { ...d, expiry_date: vence }; }
        return d;
    });
    return cambio ? nueva : lista;
}

/** El estado de un documento: lo que dice la píldora de la tarjeta. */
export function estadoDelDocumento(doc, { conVencimiento = true } = {}) {
    if (!doc?.url) return { label: 'Pendiente', variant: 'warning', listo: false };
    const vence = conVencimiento ? getExpiryBadge(doc.expiry_date) : null;
    // Un documento por vencer todavía cuenta como entregado; uno vencido, no.
    if (vence) return { label: vence.label, variant: vence.variant, listo: vence.daysLeft >= 0 };
    return { label: 'Completo', variant: 'success', listo: true };
}

// ── Cómo llega cada papel (2026-10-15: vivía en el formulario del portal; la
// app lo necesita para el expediente del teléfono) ──────────────────────────

/* ── Documentos que no caben en un solo archivo ─────────────────────────────
 *
 * Pedido del usuario: «las licencias, carnés de las juntas tienen 2 lados… y el
 * currículum tiene múltiples hojas». Hasta hoy cada documento era UN archivo, y
 * el reverso de una licencia no tenía dónde ir: o se perdía, o alguien lo subía
 * encima del frente —que además archiva el frente como si fuera una versión
 * vieja, porque el portal lee un reemplazo donde hubo un agregado—.
 *
 * Son dos listas y no una porque son dos cosas distintas:
 *
 *  · DOS CARAS es un número FIJO y con nombre. Una licencia tiene frente y
 *    reverso, no «hojas»: nombrarlos es lo que hace que alguien note que le
 *    falta el reverso. Un botón «agregar hoja» sobre una licencia no dice nada.
 *  · VARIAS HOJAS es abierto y sin nombre. Un currículum tiene las que tenga.
 *
 * El DUI no está acá: sus dos caras son categorías propias desde antes
 * (`DUI_FRENTE`/`DUI_REVERSO`) porque además se leen juntas con un modelo, y
 * mudarlo sería tocar ese circuito para no ganar nada. */
export const DOS_CARAS = new Set([
    'LICENCIA_MOTO', 'LICENCIA_CARRO',
    'SRS', 'ENFERMERIA', 'MEDICO', 'CONTADURIA',
    'TARJETA_ISSS', 'TARJETA_AFP',
]);

/* ── Las dos caras en un solo archivo (2026-10-29) ──────────────────────────
 *
 * Lo mismo que el DUI con `DUI_COMPLETO`: Talento Humano recibe un PDF o una
 * foto con frente y reverso juntos, y obligar a partirlo es trabajo manual.
 * Quien carga lo elige (`una_pieza: true` en la entrada); no se adivina por el
 * tipo de archivo — un JPG puede traer las dos caras y un PDF una sola.
 *
 * Un reverso cargado GANA sobre la marca: si hay dos archivos, son dos caras
 * por separado, y así la marca nunca puede esconder un reverso que existe. */
export function enUnaPieza(doc) {
    return !!doc?.una_pieza && !doc?.hojas?.[0]?.url;
}

/** ¿Le falta el reverso? Nunca a uno que no es de dos caras ni a uno en una pieza. */
export function faltaElReverso(categoria, doc) {
    return DOS_CARAS.has(categoria) && !enUnaPieza(doc) && !doc?.hojas?.[0]?.url;
}
/* ── Documentos que NO son de una sola persona ──────────────────────────────
 *
 * El acuse sellado del Ministerio de Trabajo por una recontratación nombra a
 * TODOS los que entran en esa tanda: es un papel de la empresa, no de cada
 * quien. Subirlo a una ficha y después repetirlo ficha por ficha era el único
 * camino, y nada decía a quiénes cubre.
 *
 * Es una lista y no un `if` sobre `ACUSE_MTPS` porque el mecanismo es general:
 * el día que aparezca otro papel colectivo se agrega acá y funciona. Hoy hay
 * uno solo, que es el que nombró el usuario. */
export const COMPARTIBLES = new Set(['ACUSE_MTPS']);

export const VARIAS_HOJAS = new Set([
    'CV', 'CONTRATO', 'SOLICITUD_EMPLEO', 'ACUSE_MTPS', 'CONTRATO_REGENCIA',
    'OFERTA_EMPLEO', 'DECLARACION_ETICA', 'CONSTANCIA_INDUCCION',
    'CERTIFICACION_DISCAPACIDAD', 'CERTIFICADO_MEDICO_ANUAL', 'EXAMEN_MEDICO',
]);

/* Los papeles que NO vencen.
 *
 * *«hay documentos que no vencen, el CV no vence, sólo se puede actualizar»*
 * (usuario, 2026-08-30). Hasta hoy el campo de vencimiento salía en TODOS menos
 * los cuatro del DUI, que lo apagaban con una bandera en cada llamada — o sea
 * que la respuesta vivía repartida en los sitios donde se dibuja el documento,
 * y un documento nuevo nacía con el campo puesto sin que nadie lo decidiera.
 *
 * Acá está la lista entera, en un solo lugar, y el criterio con el que se armó:
 * **se quita el campo sólo cuando el papel no puede traer una fecha**. Un campo
 * opcional de más es ruido; uno de menos pierde un dato, y encima lo saca del
 * aviso de documentos por vencer.
 *
 *   · CV, solicitud de empleo, acuse del Ministerio — son constancias de un
 *     hecho que ya pasó. No caducan: se reemplazan por una versión nueva.
 *   · NIT, tarjeta del ISSS, tarjeta de la AFP — son números de afiliación de
 *     por vida. La tarjeta se repone, el número no vence.
 *   · DUI (entero, frente, reverso, y el documento alterno del menor) — el DUI
 *     sí vence, pero su fecha vive en la FICHA (`dui_expiry`) al lado del
 *     número, no en cada archivo.
 *   · Contrato de trabajo — un contrato a plazo termina, y esa fecha ya es
 *     `contract_end_date` de la ficha, con sus prórrogas. Pedirla otra vez acá
 *     crearía dos verdades para el mismo hecho, que es exactamente lo que se
 *     corrigió con el rótulo de los cargos.
 *
 * Los que SÍ quedan con campo son los que traen la fecha impresa: las dos
 * licencias, los cuatro carnés de junta, las dos anualidades, la acreditación
 * de dependiente, la certificación de discapacidad, el contrato de regencia y
 * los dos exámenes médicos —el anual y el del menor—, que son justamente los
 * que el aviso de vencimientos tiene que ver. */
export const SIN_VENCIMIENTO = new Set([
    'CV', 'CONTRATO', 'SOLICITUD_EMPLEO', 'ACUSE_MTPS',
    'COPIA_NIT', 'TARJETA_ISSS', 'TARJETA_AFP',
    'DOCUMENTO_IDENTIDAD', 'DUI_COMPLETO', 'DUI_FRENTE', 'DUI_REVERSO',
    // 2026-10-14: la oferta, la declaración ética y la inducción son
    // constancias de un hecho; el certificado del seguro «es único y no
    // cambia» (usuario) — lo que vence cada año es el PAGO de la póliza, que
    // es de la empresa y se vigila aparte.
    'OFERTA_EMPLEO', 'DECLARACION_ETICA', 'CONSTANCIA_INDUCCION', 'CERTIFICADO_SEGURO_VIDA',
    // La inscripción en la junta no caduca: lo que se renueva cada año es la
    // anualidad, que tiene su propio documento.
    'CERTIFICADO_JVPQF',
]);
