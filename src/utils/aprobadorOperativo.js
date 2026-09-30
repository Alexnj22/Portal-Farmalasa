/**
 * A quién se le avisa de una solicitud operativa (facturación, ajuste de
 * inventario): SIEMPRE Supervisión de Ventas, la primera que esté activa y no
 * de vacaciones ni incapacitada; si no hay, alguien de dirección (rango ≥ 4).
 * La jefatura se entera del resultado.
 *
 * Estaba escrita DOS veces —en `WidgetAnnulmentRequest.jsx` y en
 * `WidgetInventoryMovement.jsx`— y se mudó acá el 2026-09-30 con la app.
 * Antes el último recurso era `system_role IN ('ADMIN','SUPERADMIN')`, que
 * resolvía a UNA persona; el rango del cargo da las tres.
 */
export const SUPERVISION_DE_VENTAS = 13;

export function supervisorQueResuelve(employees = []) {
    const disponible = employees.find(e => {
        if (e.status !== 'ACTIVO') return false;
        if (e.role_id !== SUPERVISION_DE_VENTAS && e.roleId !== SUPERVISION_DE_VENTAS) return false;
        const ev = e.activeEventType ?? e.active_event_type;
        return !ev || !['VACATION', 'DISABILITY'].includes(ev);
    });
    if (disponible) return disponible;
    return employees.find(e => Number(e.rango ?? 0) >= 4);
}
