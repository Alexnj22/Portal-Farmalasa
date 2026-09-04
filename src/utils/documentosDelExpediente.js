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

import {
    Receipt, Award, CreditCard, FileText, Car, Bike,
    Stethoscope, ShieldCheck, ScrollText, Accessibility,
} from 'lucide-react';

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
    // Para ejercer
    CONTRATO_REGENCIA: 'Contrato de Regencia',
    // Sólo si aplica
    LICENCIA_MOTO: 'Licencia de Motocicleta',
    LICENCIA_CARRO: 'Licencia de Automóvil',
    CERTIFICACION_DISCAPACIDAD: 'Certificación de Discapacidad — ISRI / CONAIPD',
    // Acreditaciones (se suben en su propia sección: ahí el archivo trae el
    // número y el vencimiento)
    SRS: 'Carné JVPQF — Regente / Químico Farmacéutico',
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

    CERTIFICADO_MEDICO_ANUAL: 'Cada año', EXAMEN_MEDICO: 'Cada año',
    ANUALIDAD_JVPQF: 'Cada año', ANUALIDAD_JVPE: 'Cada año',

    TARJETA_ISSS: 'ISSS y AFP', TARJETA_AFP: 'ISSS y AFP',

    CONTRATO_REGENCIA: 'Para ejercer',
    SRS: 'Para ejercer', ENFERMERIA: 'Para ejercer', MEDICO: 'Para ejercer',
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
    DUI_COMPLETO: CreditCard, DUI_FRENTE: CreditCard, DUI_REVERSO: CreditCard,
    DOCUMENTO_IDENTIDAD: CreditCard,

    SRS: Award, ENFERMERIA: Award, MEDICO: Award, CONTADURIA: Award,
    DEPENDIENTE_FARMACIA: Award,

    ANUALIDAD_JVPQF: Receipt, ANUALIDAD_JVPE: Receipt,

    LICENCIA_MOTO: Bike, LICENCIA_CARRO: Car,

    CERTIFICADO_MEDICO_ANUAL: Stethoscope, EXAMEN_MEDICO: Stethoscope,

    TARJETA_ISSS: ShieldCheck, TARJETA_AFP: ShieldCheck,

    CERTIFICACION_DISCAPACIDAD: Accessibility,

    CONTRATO: ScrollText, CONTRATO_REGENCIA: ScrollText,
};

/** El ícono de la categoría. `FileText` para lo que no tiene uno propio. */
export const iconoDeCategoria = (categoria) => ICONOS[categoria] || FileText;
