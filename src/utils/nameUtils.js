// Nombre corto para listados/avatares: SIEMPRE primer nombre + primer apellido,
// aunque el empleado tenga 2-3 nombres o 2-3 apellidos.
// Usa first_names/last_names (campos separados, fuente confiable) cuando existen;
// si el registro es legado y solo tiene `name` concatenado, hace un best-effort.
export function shortEmployeeName(emp) {
    if (!emp) return 'Personal';

    const firstToken = (str) => (str || '').trim().split(/\s+/)[0] || '';
    const first = firstToken(emp.first_names);
    const last = firstToken(emp.last_names);
    if (first || last) return `${first} ${last}`.trim();

    const fullName = (emp.name || '').trim();
    if (!fullName) return 'Personal';
    const parts = fullName.split(/\s+/);
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
    return `${parts[0]} ${parts[2]}`;
}
