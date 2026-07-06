// Vencimiento de documentos del expediente de empleado (employee_documents JSONB).
// Umbrales y lógica compartidos entre EmployeeFormModal (badge por documento) y
// StaffManagementView (chip de listado + tooltip de "Pendiente") — RTS 11.02.04:24
// §6.3.1 exige acreditación vigente para TODO el personal, no solo Regente/Enfermería,
// así que esto aplica a cualquier categoría de documento con expiry_date.
export const DOC_EXPIRY_WARN_DAYS = 60;
export const DOC_EXPIRY_DANGER_DAYS = 30;

// Días restantes hasta expiry_date ('YYYY-MM-DD'), negativo si ya venció. null si no hay fecha.
export function daysUntilExpiry(expiryDateStr) {
    if (!expiryDateStr) return null;
    const expDate = new Date(expiryDateStr + 'T00:00:00');
    if (isNaN(expDate.getTime())) return null;
    return Math.ceil((expDate - new Date()) / 86400000);
}

// Badge visual para un solo documento — mismo cálculo que usaba EmployeeFormModal inline.
export function getExpiryBadge(expiryDateStr) {
    const daysLeft = daysUntilExpiry(expiryDateStr);
    if (daysLeft === null) return null;
    if (daysLeft < 0) return { label: 'Vencido', className: 'text-red-600 bg-red-100 border-red-300', daysLeft };
    if (daysLeft <= DOC_EXPIRY_DANGER_DAYS) return { label: `Vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`, className: 'text-red-600 bg-red-100 border-red-300', daysLeft };
    if (daysLeft <= DOC_EXPIRY_WARN_DAYS) return { label: `Vence pronto (${daysLeft} días)`, className: 'text-amber-600 bg-amber-100 border-amber-300', daysLeft };
    return null;
}

// Escanea employee_documents y devuelve los que están vencidos o por vencer (dentro del
// umbral de aviso), ordenados por urgencia (más próximo/vencido primero).
export function getExpiringDocuments(employeeDocuments) {
    const docs = Array.isArray(employeeDocuments) ? employeeDocuments : [];
    return docs
        .filter(d => d?.url && d?.expiry_date)
        .map(d => ({ ...d, daysLeft: daysUntilExpiry(d.expiry_date) }))
        .filter(d => d.daysLeft !== null && d.daysLeft <= DOC_EXPIRY_WARN_DAYS)
        .sort((a, b) => a.daysLeft - b.daysLeft);
}

// Fecha límite de pago de la anualidad CSSP (JVPQF/JVPE/cualquier profesión bajo su
// paraguas): 31 de marzo, igual para todos los profesionales de salud inscritos —
// confirmado por avisos recurrentes de cssp.gob.sv ("tienen los tres primeros meses
// del año para pagar su anualidad... tienen hasta el 31 de marzo"), no es un artículo
// del Código de Salud sino un instructivo administrativo del CSSP. Devuelve la próxima
// ocurrencia (si ya pasó este año, la del año siguiente) como 'YYYY-MM-DD', para
// autocompletar el expiry_date del slot de Anualidad al subir el comprobante — si el
// usuario ya escribió/detectó una fecha distinta, esta NUNCA la pisa (solo se usa como
// default cuando el campo está vacío).
export function getNextAnnualidadCsspDueDate(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const thisYearDue = new Date(`${year}-03-31T12:00:00`);
    const dueYear = referenceDate.getTime() > thisYearDue.getTime() ? year + 1 : year;
    return `${dueYear}-03-31`;
}
