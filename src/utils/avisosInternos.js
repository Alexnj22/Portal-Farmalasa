/**
 * Avisos internos (los que publica Talento Humano o la supervisión): a quién
 * le llegan, cuántos lo leyeron y en qué sección van. Vivía en
 * `AnnouncementsView`; se mudó el 2026-10-05 para que la app los gestione con
 * la misma regla.
 */

/** A quién le llega un aviso, según su destino. */
export function audienciaDeAviso(empleados, tipo, valor) {
    const list = empleados || [];
    if (tipo === 'GLOBAL') return list;
    if (tipo === 'BRANCH') return list.filter((e) => String(e.branchId) === String(valor));
    if (tipo === 'ROLE') return list.filter((e) => e.role === valor);
    if (tipo === 'EMPLOYEE') {
        const set = new Set((valor || []).map(String));
        return list.filter((e) => set.has(String(e.id)));
    }
    return [];
}

/** El aviso con su audiencia, quién lo leyó, el % y el rótulo del destino. */
export function avisoConLectura(ann, empleados, nombreDeSala = new Map()) {
    const audience = audienciaDeAviso(empleados, ann.targetType, ann.targetValue);
    const totalExpected = audience.length;
    const readIds = (ann.readBy || []).map((r) => String(typeof r === 'object' ? r.employeeId : r));
    const readSet = new Set(readIds);
    const isFullyRead = totalExpected > 0 && readSet.size >= totalExpected;
    const readPercentage = totalExpected > 0 ? Math.round((readIds.length / totalExpected) * 100) : 0;
    let badgeText = '';
    if (ann.targetType === 'GLOBAL') badgeText = 'Global';
    else if (ann.targetType === 'BRANCH') badgeText = nombreDeSala.get(String(ann.targetValue)) || 'Sucursal';
    else if (ann.targetType === 'ROLE') badgeText = ann.targetValue;
    else if (ann.targetType === 'EMPLOYEE') badgeText = `${Array.isArray(ann.targetValue) ? ann.targetValue.length : 0} Personal`;
    return {
        ...ann, audience, readIds, readSet, totalExpected, readPercentage,
        isCompleted: ann.isArchived || isFullyRead, badgeText, badgeType: ann.targetType,
    };
}

/** En qué pestaña va: archivado (o leído por todos), programado, o activo. */
export function seccionDeAviso(a, ahora = new Date()) {
    if (a.isCompleted) return 'ARCHIVED';
    if (a.scheduledFor && new Date(a.scheduledFor) > ahora) return 'SCHEDULED';
    return 'ACTIVE';
}
