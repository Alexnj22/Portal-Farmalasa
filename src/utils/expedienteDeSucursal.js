/**
 * El expediente legal de una sucursal: qué documentos le tocan (según si
 * inyecta, si lleva libros controlados, si es alquilada…), en qué estado está
 * cada uno —falta, vencido, vence en N días, al día— y cuánto está completo.
 * Vivía dentro de `views/branch-tabs/TabExpediente.jsx`; se mudó para que la
 * ficha de la app cuente y nombre el expediente igual que el portal.
 *
 * `modal` es el formulario del PORTAL que edita cada documento: la app no lo
 * usa, pero viaja con el documento para que el portal no tenga que volver a
 * decidirlo.
 */
import { categoriaDeDocumento } from '../data/constants';
import { rotuloCategoriaSrs } from './edicionDeSucursal';
import { diaDe, diasEntre } from './fecha';

/** Un dato de texto del registro, o null si está vacío. */
const texto = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/** Lo que se muestra de un dato vacío. */
export const SIN_DATO = 'Sin dato';

/** Faltan 45 días o menos: se avisa. */
export const DIAS_DE_AVISO_DOCUMENTO = 45;

/**
 * El estado de un documento: MISSING · EXPIRED · WARNING · OK.
 *
 * Se cuenta en DÍAS DE CALENDARIO de El Salvador (`diaDe` + `diasEntre`), no
 * en milisegundos: `new Date('2026-10-30')` es medianoche de Greenwich, o sea
 * las 6 pm del 29 en la sala, y un permiso que vencía el 30 salía «Vencido»
 * desde la tarde del 29. Vence el día que dice el papel, y ese día todavía
 * vale (`Vence en 0d`).
 */
export function estadoDeDocumento(url, expDate, hoy = new Date()) {
    if (!url) return { type: 'MISSING', label: 'Falta documento', variant: 'warning' };
    const vence = diaDe(expDate);
    const dia = diaDe(hoy);
    if (vence && dia) {
        const diff = diasEntre(dia, vence);
        if (diff < 0) return { type: 'EXPIRED', label: 'Vencido', variant: 'danger', dias: diff };
        if (diff <= DIAS_DE_AVISO_DOCUMENTO) return { type: 'WARNING', label: `Vence en ${diff}d`, variant: 'chart-4', dias: diff };
    }
    return { type: 'OK', label: 'Al día', variant: 'success' };
}

/** La fecha que cuenta para el vencimiento: la de un documento que no vence no cuenta. */
export const vencimientoEfectivo = (doc) => (doc.hasExpiration === false ? null : doc.expDate);

/**
 * Las filas del equipo de enfermería de una sala. La lista vigente es
 * `legal.nursingRegents` (una fila por persona, con sus documentos); las salas
 * que todavía no se migraron sólo tienen `legal.nurses`, una lista de ids. Es
 * la MISMA lectura que `idsDeEnfermeria` (edicionDeSucursal): si existe
 * `nursingRegents` manda ella, si no, se arma desde `nurses`. Las filas de
 * `nursingRegents` NO se filtran, porque su índice es el que usan los renglones
 * del expediente (`nurse_carne_<i>`) para encontrar dónde subir el archivo.
 */
export function filasDeEnfermeria(legal) {
    const l = legal || {};
    if (Array.isArray(l.nursingRegents)) return l.nursingRegents.map((n) => n || {});
    if (!Array.isArray(l.nurses)) return [];
    return l.nurses
        .filter((v) => v !== undefined && v !== null && v !== '')
        .map((employeeId) => ({ employeeId }));
}

const estaActivo = (e) => !!e && String(e.status || '').toUpperCase() !== 'INACTIVO';
const porId = (empleados, id) => (id === undefined || id === null || id === ''
    ? null
    : (empleados || []).find((e) => String(e.id) === String(id)) || null);

/**
 * Quién cubre las plazas que exige la norma: regente, referente de
 * farmacovigilancia y el equipo de enfermería. Una persona dada de baja
 * (`INACTIVO`) o que ya no existe NO cuenta como asignada: la plaza está
 * vacía aunque su id siga escrito en la ficha de la sala.
 *
 * Lo leen la pestaña Personal y el punto de alerta de esa pestaña: si cada uno
 * resolviera por su lado, el punto podría decir «todo bien» sobre una tarjeta
 * que dice «Falta Regente».
 */
export function personalNormativoDeSucursal(legal, empleados) {
    const l = legal || {};
    const activo = (id) => { const e = porId(empleados, id); return estaActivo(e) ? e : null; };
    const enfermeria = filasDeEnfermeria(l)
        .map((fila, indice) => ({ fila, indice, empleado: activo(fila.employeeId) }))
        .filter((x) => x.empleado);
    return {
        regente: activo(l.regentEmployeeId),
        referente: activo(l.pharmacovigilanceEmployeeId || l.farmacovigilanciaId),
        enfermeria,
    };
}

/** Los renglones del expediente que, si faltan, dejan la sala sin poder operar. */
export const DOCUMENTOS_CRITICOS = ['srs', 'regente_cred', 'farmaco'];

/**
 * El punto de la pestaña Expediente: 'critical' · 'warning' · null. Sale de
 * los MISMOS documentos y el MISMO estado que pinta el expediente: vencido es
 * crítico; faltar uno de `DOCUMENTOS_CRITICOS` también; faltar otro o estar
 * por vencer es aviso.
 */
export function alertaDelExpediente(b, hoy = new Date()) {
    const { permisos, personal, infra, propios } = documentosDeSucursal(b);
    let nivel = null;
    for (const doc of [...permisos, ...personal, ...infra, ...propios]) {
        const { type } = estadoDeDocumento(doc.url, vencimientoEfectivo(doc), hoy);
        if (type === 'EXPIRED' || (type === 'MISSING' && DOCUMENTOS_CRITICOS.includes(doc.id))) return 'critical';
        if (type === 'MISSING' || type === 'WARNING') nivel = 'warning';
    }
    // La recarga de extintores no es un documento —no hay archivo que subir—
    // pero vence y la avisa `check-doc-expiry`: cuenta para el punto igual.
    const extintores = b?.settings?.legal?.extinguisherExpiration;
    if (extintores) {
        const { type } = estadoDeDocumento(true, extintores, hoy);
        if (type === 'EXPIRED') return 'critical';
        if (type === 'WARNING') nivel = 'warning';
    }
    return nivel;
}


/**
 * Los documentos de la sucursal en sus tres grupos fijos más los propios (los
 * que se agregaron a mano, con su categoría). Devuelve también el avance.
 */
export function documentosDeSucursal(b) {
    const legal = b?.settings?.legal || {};
    const rent = b?.settings?.rent || {};
    const propertyType = b?.settings?.propertyType || b?.propertyType || 'OWNED';
    const nurses = filasDeEnfermeria(legal);
    const customDocs = b?.settings?.customDocs || [];
    const hasInjections = !!legal.injections;
    const hasControlledBooks = !!legal.controlledBooks;

    // `datos`: los datos del registro que acompañan al documento (vacío = «Sin dato»).
    /** @type {Array<{ id: string, title: string, url: any, expDate: any, hasExpiration?: boolean, modal: string, datos?: Array<{ rotulo: string, valor: string | null }> }>} */
    const permisos = [
        {
            id: 'srs', title: 'Licencia CSSP / DNM', url: legal.srsPermitUrl, expDate: legal.srsExpiration, hasExpiration: true, modal: 'editSrsPermit',
            datos: [
                { rotulo: 'Resolución', valor: texto(legal.srsPermit) },
                { rotulo: 'Categoría SRS', valor: rotuloCategoriaSrs(legal.srsCategoria) },
                { rotulo: 'Inscripción SRS', valor: texto(legal.srsInscripcion) },
            ],
        },
        { id: 'alcaldia', title: 'Solvencia Municipal', url: legal.municipalUrl, expDate: legal.municipalExpiration, hasExpiration: true, modal: 'editBranchLegal' },
    ];
    if (hasControlledBooks) permisos.push({
        id: 'libros', title: 'Resolución Libros Controlados', url: legal.controlledBooksUrl, expDate: legal.controlledBooksExp || null, hasExpiration: true, modal: 'editBranchLegal',
        datos: [{ rotulo: 'Resolución', valor: texto(legal.controlledBooksRes) }],
    });
    if (hasInjections) permisos.push({ id: 'inyecciones', title: 'Permiso Área Inyecciones', url: legal.nursingServicePermitUrl, expDate: legal.nursingServicePermitExp, hasExpiration: true, modal: 'editNursingRegents' });

    const personal = [
        { id: 'regente_cred', title: 'Credencial JVQF (Regente)', url: legal.regentCredentialUrl, expDate: legal.regentCredentialExp, hasExpiration: true, modal: 'editPharmacyRegent' },
        { id: 'regente_insc', title: 'Inscripción CSSP (Regente)', url: legal.regentInscriptionUrl, expDate: null, modal: 'editPharmacyRegent' },
        { id: 'farmaco', title: 'Autorización Farmacovigilancia', url: legal.farmacovigilanciaAuthUrl, expDate: legal.pharmacovigilanceExp, hasExpiration: true, modal: 'editPharmacovigilance' },
    ];
    if (hasInjections) {
        nurses.forEach((nurse, i) => {
            personal.push({ id: `nurse_carne_${i}`, title: `Carné JVQE (Enfermería ${i + 1})`, url: nurse.carneUrl, expDate: null, modal: 'editNursingRegents' });
            personal.push({ id: `nurse_lic_${i}`, title: `Licencia (Enfermería ${i + 1})`, url: nurse.licenciaUrl, expDate: null, modal: 'editNursingRegents' });
            // La anualidad vence (`anualidadExp`): el aviso diario ya la miraba
            // y la pantalla no, así que avisaba algo que acá salía «Al día».
            personal.push({ id: `nurse_anualidad_${i}`, title: `Anualidad (Enfermería ${i + 1})`, url: nurse.anualidadUrl, expDate: nurse.anualidadExp || null, hasExpiration: true, modal: 'editNursingRegents' });
        });
    }

    const infra = [];
    if (propertyType === 'RENTED' || propertyType === 'ALQUILADO') {
        infra.push({ id: 'arrendamiento', title: 'Contrato de Arrendamiento', url: rent.contract?.documentUrl, expDate: rent.contract?.endDate, hasExpiration: true, modal: 'editBranchInmueble' });
    }
    if (hasInjections) {
        infra.push({ id: 'desechos', title: 'Contrato Desechos Bioinfecciosos', url: legal.wasteUrl, expDate: legal.wasteExpiration, hasExpiration: true, modal: 'editBranchLegal' });
    }
    infra.push({ id: 'fumigacion', title: 'Certificado de Fumigación', url: legal.fumigationUrl, issueDate: legal.lastFumigationDate, hasIssueDate: true, modal: 'editBranchLegal' });

    const propios = customDocs.map((doc) => ({
        id: doc.id, title: doc.title, url: doc.url,
        hasExpiration: doc.hasExpiration, expDate: doc.hasExpiration ? doc.expDate : null,
        hasIssueDate: doc.hasIssueDate, issueDate: doc.hasIssueDate ? doc.issueDate : null,
        // Lo guardado antes de v2.590.2 es el rótulo: se resuelve a la clave, o
        // un documento viejo no caería en ninguna sección y desaparecería.
        category: categoriaDeDocumento(doc.category),
        modal: 'editCustomDocument', aiSummary: doc.aiSummary, isCustom: true,
    }));

    const todos = [...permisos, ...personal, ...infra, ...propios];
    const subidos = todos.filter((d) => d.url).length;
    return {
        permisos, personal, infra, propios,
        total: todos.length, subidos,
        avance: todos.length === 0 ? 100 : Math.round((subidos / todos.length) * 100),
    };
}

// ── Subir un documento del expediente ──
// Cada renglón del expediente que tiene un campo propio en `settings` se sube
// por `updateBranch`, que versiona el archivo (el anterior pasa a `old/` y a
// `branch_documents` como HISTÓRICO). Los de enfermería y los documentos
// propios viven en otras listas y siguen en el portal.
const CAMPO_LEGAL = {
    srs: 'srsPermit', alcaldia: 'municipal', libros: 'controlledBooks', inyecciones: 'nursingServicePermit',
    regente_cred: 'regentCredential', regente_insc: 'regentInscription', farmaco: 'farmacovigilanciaAuth',
    desechos: 'waste', fumigacion: 'fumigation',
};

// Lo que acepta el bucket `documents` (su `allowed_mime_types` y `file_size_limit`).
export const TIPOS_DEL_EXPEDIENTE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const TOPE_DEL_EXPEDIENTE = 10 * 1024 * 1024;

/** ¿Este renglón se puede subir desde la app? */
export const seSubeDesdeLaApp = (docId) => docId in CAMPO_LEGAL || docId === 'arrendamiento' || !!archivoDeEnfermera(docId);

// Los renglones de cada enfermera (`nurse_carne_0`, `nurse_lic_1`…) y el campo
// de su fila en `legal.nursingRegents` donde `updateBranch` busca el archivo.
const CAMPO_DE_ENFERMERA = { carne: 'carneFile', lic: 'licenciaFile', anualidad: 'anualidadFile' };
function archivoDeEnfermera(docId) {
    const m = /^nurse_(carne|lic|anualidad)_(\d+)$/.exec(String(docId));
    return m ? { campo: CAMPO_DE_ENFERMERA[m[1]], indice: Number(m[2]) } : null;
}
/** ¿Se puede quitar? Sólo los legales: el contrato se reemplaza, no se quita. */
export const seQuitaDesdeLaApp = (docId) => docId in CAMPO_LEGAL;

/** Por qué el archivo no entra, o null si entra. */
export function problemaDelArchivo({ tipo, tamano }) {
    if (!TIPOS_DEL_EXPEDIENTE.includes(tipo)) return 'Sólo se aceptan PDF o fotos (JPG, PNG o WEBP).';
    if (tamano != null && tamano > TOPE_DEL_EXPEDIENTE) return 'El archivo pasa de 10 MB.';
    return null;
}

/**
 * Los ajustes con el archivo nuevo puesto donde `updateBranch` lo busca
 * (`legal.<campo>File` o `rent.contract.documentFile`), o con su URL en null
 * para quitarlo (`archivo === null`). Devuelve null si el renglón no se sube acá.
 */
export function ajustesConArchivo(settings, docId, archivo) {
    const s = { ...(settings || {}) };
    if (docId in CAMPO_LEGAL) {
        const campo = CAMPO_LEGAL[docId];
        s.legal = archivo === null
            ? { ...(s.legal || {}), [`${campo}Url`]: null }
            : { ...(s.legal || {}), [`${campo}File`]: archivo };
        return s;
    }
    const enf = archivoDeEnfermera(docId);
    if (enf && archivo) {
        // Desde `filasDeEnfermeria`: si la sala todavía sólo tiene `nurses`,
        // el renglón que se ve en el expediente tiene que poder subirse igual
        // (y con eso la sala pasa a `nursingRegents`).
        const lista = filasDeEnfermeria(s.legal);
        if (!lista[enf.indice]) return null;
        lista[enf.indice] = { ...lista[enf.indice], [enf.campo]: archivo };
        s.legal = { ...(s.legal || {}), nursingRegents: lista };
        return s;
    }
    if (docId === 'arrendamiento' && archivo) {
        const rent = s.rent || {};
        s.rent = { ...rent, contract: { ...(rent.contract || {}), documentFile: archivo } };
        return s;
    }
    return null;
}

// ── Documentos propios (los que la sala agrega a mano) ──────────────────────
// La misma forma que arma el portal (`addCustomDocument`/`editCustomDocument`
// en `UnifiedModal`) y la misma ruta en el bucket, para que un documento
// agregado desde la app y otro desde la oficina sean el mismo dato.

/** Dónde se guarda el archivo de un documento propio. */
export const rutaDelDocumentoPropio = (branchId, docId, ext, ahora = Date.now()) =>
    `branches/${branchId}/customDocs/${docId}_${ahora}.${ext}`;

/** El documento tal como se guarda en `settings.customDocs`. */
export function documentoPropio({ id, datos, url = null, aiSummary = null }) {
    return {
        id,
        title: String(datos.title || '').trim(),
        category: categoriaDeDocumento(datos.category),
        hasIssueDate: !!datos.hasIssueDate,
        issueDate: datos.hasIssueDate ? (datos.issueDate || null) : null,
        hasExpiration: !!datos.hasExpiration,
        expDate: datos.hasExpiration ? (datos.expDate || null) : null,
        url,
        aiSummary,
    };
}

/** Los ajustes con el documento agregado (o reemplazado, si ya existía su id). */
export function ajustesConDocumentoPropio(settings, doc) {
    const actuales = settings?.customDocs || [];
    const existe = actuales.some(d => d.id === doc.id);
    return { ...(settings || {}), customDocs: existe ? actuales.map(d => (d.id === doc.id ? doc : d)) : [...actuales, doc] };
}

/** Los ajustes sin ese documento propio. */
export const ajustesSinDocumentoPropio = (settings, docId) =>
    ({ ...(settings || {}), customDocs: (settings?.customDocs || []).filter(d => d.id !== docId) });

/** Por qué no se puede guardar el documento propio, o null. */
export const problemaDelDocumentoPropio = (datos) => (!String(datos?.title || '').trim()
    ? 'El nombre del documento es obligatorio.'
    : datos.hasExpiration && !datos.expDate ? 'Falta la fecha de vencimiento.'
    : datos.hasIssueDate && !datos.issueDate ? 'Falta la fecha de emisión.'
    : null);
