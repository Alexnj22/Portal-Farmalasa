// Bloque 6.A — capa de datos, entidad "requests" (solicitudes de
// empleado + resolución de aprobador). Extraído de requestsSlice.js: 36
// llamadas supabase.from(). Este archivo enruta aprobaciones subiendo
// recursivamente por la jerarquía de roles — cada función de lookup de
// empleados se dejó separada aun cuando se parecen, porque difieren en
// qué filtros son condicionales vs. fijos (cambiar eso sería alterar el
// comportamiento de enrutamiento, no solo mover el query). employee_rosters
// (lectura puntual + upsert) reutiliza fetchEmployeeRosterSchedule/
// upsertWeeklyRoster ya definidos en data/employees.js y data/system.js.
import { supabase } from '../supabaseClient';

export const REQUEST_SIMPLE_SELECT = 'id, type, status, note, metadata, approver_note, created_at, updated_at, employee_id, approver_id, current_level, approvals';

// EmployeeDetailView.jsx — tab Solicitudes (solo lectura, historial del empleado)
export function fetchEmployeeApprovalRequestsDetail(employeeId) {
    return supabase.from('approval_requests')
        .select('id, type, status, note, approver_note, created_at, updated_at')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });
}

// ── Disponibilidad del empleado (vacaciones/incapacidad vigentes) ──────────
//
// Pregunta, no pide. Antes se traía los eventos DE OTRA PERSONA y decidía en el
// cliente; eso obligaba a que `employee_events` estuviera abierta a cualquiera.
// El enrutador necesita un sí/no, no la tabla.
//
// Y el cierre de esa tabla habría sido un fallo CALLADO con la versión vieja: la
// lectura devolvería cero filas, `isUnavailable` diría «disponible» sin error, y
// la solicitud se iría a alguien de vacaciones.

export function fetchEmployeeUnavailable(employeeId) {
    return supabase.rpc('empleado_no_disponible', { p_employee_id: employeeId });
}

// ── Roles / candidatos a aprobador ──────────────────────────────────────────

export function fetchAllRolesHierarchy() {
    return supabase.from('roles').select('id, name, parent_role_id, secondary_parent_role_id');
}

export function fetchRolesByNamePattern(namePattern) {
    return supabase.from('roles').select('id').ilike('name', `%${namePattern}%`);
}

// Filtros fijos (branch_id siempre aplica) — usado por resolveApprover subiendo la jerarquía.
export function fetchActiveEmployeesInRoleAndBranch(roleId, branchId, excludeId) {
    return supabase.from('employees').select('id')
        .eq('role_id', roleId).eq('branch_id', branchId).eq('status', 'ACTIVO').neq('id', excludeId);
}

// Quién es "admin" para el enrutador de aprobadores. Estas tres consultaban
// `employees.is_admin`, una columna que NO EXISTE en la base: un `.eq()` contra
// una columna inexistente devuelve error, el llamador lo trata como "no hay
// nadie" y la solicitud se queda SIN APROBADOR. Y son justamente los fallbacks
// del enrutador, o sea el último recurso cuando no hay jefe ni supervisor.
// El criterio correcto es `system_role`, que es el que ya usa el resto del
// código (`WidgetAnnulmentRequest.jsx`): ADMIN y SUPERADMIN.
const ADMIN_SYSTEM_ROLES = ['ADMIN', 'SUPERADMIN'];

export function fetchBranchAdmins(branchId, excludeId) {
    return supabase.from('employees').select('id')
        .eq('branch_id', branchId).in('system_role', ADMIN_SYSTEM_ROLES).eq('status', 'ACTIVO').neq('id', excludeId);
}

export function fetchGlobalAdmins(excludeId) {
    return supabase.from('employees').select('id')
        .in('system_role', ADMIN_SYSTEM_ROLES).eq('status', 'ACTIVO').neq('id', excludeId).limit(1);
}

export function fetchAnyActiveAdmin() {
    return supabase.from('employees').select('id').in('system_role', ADMIN_SYSTEM_ROLES).eq('status', 'ACTIVO').limit(1);
}

export function fetchApprovalRolePermissions() {
    return supabase.from('role_permissions').select('role_id').eq('module_key', 'requests').eq('can_approve', true);
}

export function fetchActiveEmployeesInRoles(roleIds, excludeId) {
    return supabase.from('employees').select('id').in('role_id', roleIds).eq('status', 'ACTIVO').neq('id', excludeId).limit(1);
}

// Filtros condicionales (branch_id/excludeId solo si aplican) — usado por
// resolveNextApprover, donde sameBranch/excludeId varían según el nivel.
export function fetchActiveEmployeesBySystemRoleConditional(systemRole, branchId, excludeId, sameBranch) {
    let q = supabase.from('employees').select('id').eq('system_role', systemRole).eq('status', 'ACTIVO');
    if (sameBranch && branchId) q = q.eq('branch_id', branchId);
    if (excludeId) q = q.neq('id', excludeId);
    return q;
}

export function fetchActiveEmployeesByRoleIdConditional(roleId, branchId, excludeId, sameBranch) {
    let q = supabase.from('employees').select('id').eq('role_id', roleId).eq('status', 'ACTIVO');
    if (sameBranch && branchId) q = q.eq('branch_id', branchId);
    if (excludeId) q = q.neq('id', excludeId);
    return q;
}

// ── Cobertura de sucursal (empleados/rosters) ───────────────────────────────

export function fetchActiveBranchEmployeesExcluding(branchId, excludeId) {
    return supabase.from('employees').select('id').eq('branch_id', branchId).eq('status', 'ACTIVO').neq('id', excludeId);
}

export function fetchRostersForWeekByEmployees(weekStart, employeeIds) {
    return supabase.from('employee_rosters').select('employee_id, schedule_data').eq('week_start_date', weekStart).in('employee_id', employeeIds);
}

// ── fetchRequests ────────────────────────────────────────────────────────────

export function fetchBranchActiveEmployeeIds(branchId) {
    return supabase.from('employees').select('id').eq('branch_id', branchId).eq('status', 'ACTIVO');
}

/**
 * La lista del centro de solicitudes.
 *
 * `ownId` es lo que faltaba al fusionar «Mis Solicitudes» adentro de la vista
 * (2026-08-11): con `approverId` la consulta pedía «las que me toca decidir»,
 * y una solicitud PROPIA tiene a otro de aprobador, así que las mías quedaban
 * fuera de mi propia pantalla. No daba error — devolvía una lista sin ellas.
 *
 * `soloMiasId` es el alcance «sólo míos», y son DOS cosas: las que mandé y las
 * que me toca contestar como compañero (el primer nivel de un cambio de turno
 * lo responde el otro, no una jefatura). Sin la segunda mitad, encender el
 * alcance nuevo apagaba los cambios de turno sin decirlo.
 */
export function fetchApprovalRequestsList({ employeeId, branchEmpIds, approverId, ownId, soloMiasId }) {
    let q = supabase.from('approval_requests').select(REQUEST_SIMPLE_SELECT).order('created_at', { ascending: false });
    if (employeeId) q = q.eq('employee_id', employeeId);
    if (soloMiasId) return q.or(`employee_id.eq.${soloMiasId},approver_id.eq.${soloMiasId}`);
    if (branchEmpIds && branchEmpIds.length > 0) q = q.in('employee_id', branchEmpIds);
    if (approverId) {
        const ramas = [`approver_id.eq.${approverId}`, 'approver_id.is.null'];
        if (ownId) ramas.push(`employee_id.eq.${ownId}`);
        q = q.or(ramas.join(','));
    }
    return q;
}

export function fetchEmployeesByIds(ids, columns) {
    return supabase.from('employees').select(columns).in('id', ids);
}

/**
 * Los que `employees` esconde.
 *
 * `employees_select` no deja ver a quien tenga un cargo con `roles.is_su`, salvo
 * a sí mismo. Es lo que se quiso —un superusuario no figura en el directorio de
 * personal— pero el aprobador real del portal tiene uno de esos cargos, así que
 * la consulta de arriba devolvía la solicitud SIN su aprobador y la ficha
 * «Aprobó» quedaba en «Sin registro»: ni cara ni nombre. Medido el 2026-08-12
 * con la sesión de una vendedora: 8 de 8 solicitudes resueltas.
 *
 * La RPC es SECURITY DEFINER y devuelve sólo lo que se pinta —nombre, foto,
 * cargo y sala—, y sólo de quien participa de alguna solicitud. No trae `code`
 * a propósito: ese código es hoy la contraseña del carné.
 *
 * Es un COMPLEMENTO, no un reemplazo: `fetchEmployeesByIds` sigue trayendo las
 * columnas completas de todos los que sí se ven (el detalle muestra el código
 * de quien pide), y esto rellena únicamente los huecos.
 *
 * Dos entradas porque hay dos formas de nombrar a la misma persona: las
 * solicitudes de aprobación guardan un uuid, y Min/Max guarda el CORREO con el
 * que decidió. Cada fila vuelve con la `clave` que hizo juego, así el llamador
 * la guarda bajo la misma llave con la que la buscó.
 */
export function fetchPersonasDeSolicitudes(ids = [], claves = []) {
    return supabase.rpc('get_personas_de_solicitudes',
        { p_ids: ids, p_claves: claves });
}

// ── createRequest ────────────────────────────────────────────────────────────

export function fetchEmployeeApprovalInfo(employeeId) {
    return supabase.from('employees').select('role_id, branch_id').eq('id', employeeId).single();
}

export function fetchEmployeeName(employeeId) {
    return supabase.from('employees').select('name').eq('id', employeeId).single();
}

export function insertApprovalRequest(payload) {
    return supabase.from('approval_requests').insert([payload]).select(REQUEST_SIMPLE_SELECT).single();
}

// Variante "silenciosa" (sin .select() de vuelta) — usada por
// WidgetAnnulmentRequest.jsx en sus 4 formularios (annul/pay_change/
// vendor_change/client_change): el caller solo chequea { error }, nunca
// lee la fila insertada, así que no se agrega un round-trip extra.
export function insertApprovalRequestSilent(payload) {
    return supabase.from('approval_requests').insert(payload);
}

/**
 * Aplica en el ERP una solicitud de facturación aprobada.
 *
 * El navegador NO habla con el ERP: sus credenciales viven en un secreto de
 * Supabase, y quien tiene esa sesión puede anular cualquier factura de
 * cualquier sucursal. Toda la operación —verificar el permiso, traducir el id
 * del portal al del ERP, escribir, releer para confirmar y recién entonces
 * marcar APPROVED— pasa en la Edge Function.
 *
 * Devuelve `{ ok, aplicado }` o `{ ok:false, error }`. Nunca lanza: el llamador
 * decide qué mostrar.
 */
export async function aplicarSolicitudEnErp(requestId, approverNote = '') {
    try {
        const { data, error } = await supabase.functions.invoke('aplicar-solicitud-facturacion', {
            body: { request_id: requestId, approver_note: approverNote },
        });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };

        // `functions.invoke` marca error para cualquier status >= 400, pero el
        // motivo real viaja en el cuerpo — sin leerlo, todo fallo se ve como
        // un "Edge Function returned a non-2xx status code" indistinguible.
        let detalle = '';
        try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
        return { ok: false, error: detalle || error.message };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

/**
 * Aplica una carga o un descarte de inventario aprobado.
 *
 * Mismo reparto que arriba: el navegador no habla con el sistema de origen. Y
 * acá pesa más todavía, porque la sucursal es estado de la sesión de ese
 * sistema — dos aplicaciones simultáneas que compartieran sesión podrían
 * terminar moviendo existencias de la sucursal equivocada. Cada aplicación abre
 * la suya dentro de la Edge Function.
 *
 * Devuelve `{ ok, aplicado }` o `{ ok:false, error }`. Nunca lanza.
 */
export async function aplicarMovimientoInventarioEnErp(requestId, approverNote = '', aceptadas = null) {
    try {
        const { data, error } = await supabase.functions.invoke('aplicar-movimiento-inventario', {
            // `lineas_aceptadas` son ÍNDICES dentro de `metadata.items`, no las
            // líneas mismas: mandar las líneas sería dejar que el navegador
            // eligiera qué se mueve y en qué cantidad. El servidor las resuelve
            // contra lo que quedó guardado al crear la solicitud.
            body: { request_id: requestId, approver_note: approverNote,
                    ...(aceptadas ? { lineas_aceptadas: aceptadas } : {}) },
        });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };

        // El motivo real viaja en el cuerpo; sin leerlo todo fallo se ve como
        // un "non-2xx status code" indistinguible.
        let detalle = '';
        try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
        return { ok: false, error: detalle || error.message };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

/**
 * Cuántas solicitudes de facturación esperan decisión.
 *
 * El RLS ya recorta lo que cada quien puede ver, así que el número que sale
 * acá es el que esa persona podría resolver — no un total global que prometa
 * trabajo ajeno.
 */
// Devuelve las filas y no el conteo: es el MISMO viaje —las cuatro clases de
// solicitud, sólo las PENDING, que son pocas por definición— y con `type` y
// `created_at` la baldosa arma su franja (de qué son) y la antigüedad de la más
// vieja. Pedir `head: true` y después otra consulta para el desglose serían dos
// round-trips para lo que cabe en uno.
//
// Sin `fetchAllRows` a propósito: lo pendiente es una cola que alguien vacía. Si
// alguna vez pasara de 1000 filas, el problema no es la paginación.
export async function fetchSolicitudesFacturacionPendientes() {
    const { data, error } = await supabase
        .from('approval_requests')
        .select('id, type, created_at')
        .eq('status', 'PENDING')
        .in('type', ['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                     'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
        .order('created_at', { ascending: true });
    return { filas: data ?? [], error };
}

// ── approve/reject/cancel ────────────────────────────────────────────────────

export function updateApprovalRequest(requestId, patch) {
    return supabase.from('approval_requests').update(patch).eq('id', requestId);
}

/**
 * Decidir o avanzar una solicitud, pero SÓLO si sigue donde el aprobador la vio.
 *
 * `updateApprovalRequest` es un UPDATE por id a secas. La campana se sincroniza
 * sola entre pestañas —`notifications` viaja por realtime—, pero la lista de
 * Solicitudes no: `approval_requests` no está publicada, así que una pestaña
 * parada ahí sigue mostrando PENDIENTE con el botón vivo aunque la solicitud ya
 * se haya decidido en otra. Apretarlo otra vez volvía a disparar todo lo que
 * cuelga de aprobar: el evento en el legajo, el aviso al empleado, el aviso al
 * siguiente nivel.
 *
 * `desdeNivel` cierra el mismo hueco un escalón más abajo: una solicitud que ya
 * avanzó SIGUE siendo PENDING, así que el estado solo no alcanza — sin comparar
 * el nivel, la pestaña vieja la empuja de nuevo.
 *
 * Cuenta con `count: 'exact'` y NO con `.select()`: la representación de vuelta
 * pasa por la policy de LECTURA, y quien puede escribir no siempre puede releer
 * —el compañero de un cambio de turno es el caso—. Ahí `.select()` devolvería
 * cero filas y esto leería «ya resuelta» sobre algo que sí acaba de escribir.
 */
export function resolverApprovalRequest(requestId, patch, desdeNivel = null) {
    let q = supabase.from('approval_requests')
        .update(patch, { count: 'exact' })
        .eq('id', requestId)
        .eq('status', 'PENDING');
    if (desdeNivel != null) q = q.eq('current_level', desdeNivel);
    return q;
}

export function fetchApprovalRequestById(requestId) {
    return supabase.from('approval_requests').select(REQUEST_SIMPLE_SELECT).eq('id', requestId).single();
}

export function fetchEmployeeSystemRole(employeeId) {
    return supabase.from('employees').select('system_role').eq('id', employeeId).maybeSingle();
}

// ── SHIFT_CHANGE: patch de rosters publicados en la aprobación final ───────

export function fetchShiftsBasic() {
    return supabase.from('shifts').select('id, start_time, end_time');
}

export function fetchPublishedRostersForSwap(employeeIds, weekStart) {
    return supabase.from('employee_rosters')
        .select('id, employee_id, schedule_data')
        .in('employee_id', employeeIds)
        .eq('week_start_date', weekStart)
        .eq('status', 'PUBLISHED');
}

export function updateEmployeeRosterById(rosterId, patch) {
    return supabase.from('employee_rosters').update(patch).eq('id', rosterId);
}
