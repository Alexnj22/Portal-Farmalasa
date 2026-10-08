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

/** Faltan 45 días o menos: se avisa. */
export const DIAS_DE_AVISO_DOCUMENTO = 45;

/** El estado de un documento: MISSING · EXPIRED · WARNING · OK. */
export function estadoDeDocumento(url, expDate, hoy = new Date()) {
    if (!url) return { type: 'MISSING', label: 'Falta documento', variant: 'warning' };
    if (expDate) {
        const diff = Math.ceil((new Date(expDate).getTime() - new Date(hoy).getTime()) / (1000 * 60 * 60 * 24));
        if (diff < 0) return { type: 'EXPIRED', label: 'Vencido', variant: 'danger', dias: diff };
        if (diff <= DIAS_DE_AVISO_DOCUMENTO) return { type: 'WARNING', label: `Vence en ${diff}d`, variant: 'chart-4', dias: diff };
    }
    return { type: 'OK', label: 'Al día', variant: 'success' };
}

/** La fecha que cuenta para el vencimiento: la de un documento que no vence no cuenta. */
export const vencimientoEfectivo = (doc) => (doc.hasExpiration === false ? null : doc.expDate);

/**
 * Los documentos de la sucursal en sus tres grupos fijos más los propios (los
 * que se agregaron a mano, con su categoría). Devuelve también el avance.
 */
export function documentosDeSucursal(b) {
    const legal = b?.settings?.legal || {};
    const rent = b?.settings?.rent || {};
    const propertyType = b?.settings?.propertyType || b?.propertyType || 'OWNED';
    const nurses = legal.nursingRegents || [];
    const customDocs = b?.settings?.customDocs || [];
    const hasInjections = !!legal.injections;
    const hasControlledBooks = !!legal.controlledBooks;

    /** @type {Array<{ id: string, title: string, url: any, expDate: any, hasExpiration?: boolean, modal: string }>} */
    const permisos = [
        { id: 'srs', title: 'Licencia CSSP / DNM', url: legal.srsPermitUrl, expDate: legal.srsExpiration, hasExpiration: true, modal: 'editSrsPermit' },
        { id: 'alcaldia', title: 'Solvencia Municipal', url: legal.municipalUrl, expDate: legal.municipalExpiration, hasExpiration: true, modal: 'editBranchLegal' },
    ];
    if (hasControlledBooks) permisos.push({ id: 'libros', title: 'Resolución Libros Controlados', url: legal.controlledBooksUrl, expDate: null, modal: 'editBranchLegal' });
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
            personal.push({ id: `nurse_anualidad_${i}`, title: `Anualidad (Enfermería ${i + 1})`, url: nurse.anualidadUrl, expDate: null, modal: 'editNursingRegents' });
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
export const seSubeDesdeLaApp = (docId) => docId in CAMPO_LEGAL || docId === 'arrendamiento';
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
    if (docId === 'arrendamiento' && archivo) {
        const rent = s.rent || {};
        s.rent = { ...rent, contract: { ...(rent.contract || {}), documentFile: archivo } };
        return s;
    }
    return null;
}
