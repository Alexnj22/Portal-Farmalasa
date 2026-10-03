/**
 * «Mis documentos»: los papeles del expediente de la persona y los que viajan
 * con sus solicitudes (incapacidades, constancias, permisos), en UNA lista con
 * sus pestañas y su filtro. Vivía dentro de
 * `views/employee/EmployeeDocumentsView.jsx`; se mudó el 2026-10-02 para que la
 * app del teléfono muestre la misma lista.
 */
import { tokenMatch } from './searchUtils';
import { grupoDeCategoria, nombreDeDocumento } from './documentosDelExpediente';

export const ROTULO_TIPO_DOC = {
    DISABILITY: 'Incapacidad', CERTIFICATE: 'Constancia', VACATION: 'Vacaciones',
    PERMIT: 'Permiso', EXPEDIENTE: 'Del expediente', SHIFT_CHANGE: 'Cambio de turno',
};
export const ESTADO_DOC = {
    EN_EXPEDIENTE: 'En tu expediente', APPROVED: 'Aprobada', PENDING: 'Pendiente',
    REJECTED: 'Rechazada', CANCELLED: 'Cancelada',
};
export const ROTULO_CONSTANCIA = { LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' };
export const PESTANAS_DOCS = [
    { key: 'ALL', label: 'Todos' }, { key: 'EXPEDIENTE', label: 'Del expediente' },
    { key: 'DISABILITY', label: 'Incapacidades' }, { key: 'CERTIFICATE', label: 'Constancias' },
    { key: 'PERMIT', label: 'Permisos' },
];

const leerMeta = (m) => (typeof m === 'object' && m ? m : (() => { try { return JSON.parse(m); } catch { return {}; } })());

/** Las solicitudes propias que traen un documento (o son una constancia). */
export function solicitudesConDocumento(filas = []) {
    return filas.map((r) => ({ ...r, meta: leerMeta(r.metadata) }))
        .filter((r) => r.meta?.docUrl || r.type === 'CERTIFICATE');
}

/** Los documentos del expediente (`employee_documents` de la ficha), como filas de la lista. */
export function documentosDelExpediente(empleado) {
    return (empleado?.employee_documents || [])
        .filter((d) => d?.url)
        .map((d, i) => ({
            id: `expediente-${i}`, type: 'EXPEDIENTE', status: 'EN_EXPEDIENTE', note: null,
            created_at: d.uploaded_at || d.issue_date || empleado?.hire_date || new Date().toISOString(),
            meta: {
                docUrl: d.url, nombre: nombreDeDocumento(d), categoria: d.category || null,
                docName: d.file_name || null, issueDate: d.issue_date || null, expiryDate: d.expiry_date || null,
                versiones: Array.isArray(d.historial) ? d.historial.length : 0,
            },
        }));
}

/** Cuántos hay por pestaña; una pestaña sin documentos no se muestra (salvo «Todos»). */
export function pestanasDeDocumentos(todos) {
    const cuenta = (k) => (k === 'ALL' ? todos.length : todos.filter((d) => d.type === k).length);
    return PESTANAS_DOCS.map((t) => ({ ...t, cuenta: cuenta(t.key) })).filter((t) => t.cuenta > 0 || t.key === 'ALL');
}

/** El filtro: pestaña, estado, rango de fechas y búsqueda. */
export function filtrarDocumentos(todos, { pestana = 'ALL', estado = '', desde = '', hasta = '', busqueda = '' } = {}) {
    let lista = todos;
    if (pestana !== 'ALL') lista = lista.filter((d) => d.type === pestana);
    if (estado) lista = lista.filter((d) => d.status === estado);
    if (desde) lista = lista.filter((d) => String(d.created_at).slice(0, 10) >= desde);
    if (hasta) lista = lista.filter((d) => String(d.created_at).slice(0, 10) <= hasta);
    if (String(busqueda).trim()) {
        lista = lista.filter((d) => tokenMatch(busqueda, d.note, d.approver_note, ROTULO_TIPO_DOC[d.type],
            d.meta?.nombre, grupoDeCategoria(d.meta?.categoria), d.meta?.docName, ROTULO_CONSTANCIA[d.meta?.certificateType]));
    }
    return lista;
}
