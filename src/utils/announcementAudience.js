// Único punto de verdad para "¿este aviso aplica al usuario actual?" —
// antes duplicado (y divergente) entre useSyncMonitor.js y NotificationBell.jsx.
// Espejo de getTargetAudience en AnnouncementsView.jsx (fuente canónica de
// creación): target_value es escalar para BRANCH/ROLE (branch_id / nombre de
// rol) y array para EMPLOYEE (ids de empleado). ROLE se resuelve por NOMBRE,
// no por role_id — así es como AnnouncementsView.jsx lo escribe.
export function announcementAppliesToUser(ann, user, roles) {
    if (!user) return false;
    const type = ann.targetType ?? ann.target_type;
    const value = ann.targetValue ?? ann.target_value;

    if (type === 'GLOBAL') return true;
    if (type === 'BRANCH') return String(value) === String(user.branchId);
    if (type === 'ROLE') {
        const roleName = (roles || []).find(r => String(r.id) === String(user.role))?.name;
        return !!roleName && roleName === value;
    }
    if (type === 'EMPLOYEE') return Array.isArray(value) && value.map(String).includes(String(user.id));
    return false;
}
