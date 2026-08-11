import { useToastStore } from '../toastStore';
import { notifyEmployees } from '../../utils/notify';
import {
    fetchEmployeeUnavailable, fetchAllRolesHierarchy, fetchRolesByNamePattern,
    fetchActiveEmployeesInRoleAndBranch, fetchBranchAdmins, fetchGlobalAdmins, fetchAnyActiveAdmin,
    fetchApprovalRolePermissions, fetchActiveEmployeesInRoles, fetchActiveEmployeesBySystemRoleConditional,
    fetchActiveEmployeesByRoleIdConditional, fetchActiveBranchEmployeesExcluding, fetchRostersForWeekByEmployees,
    fetchBranchActiveEmployeeIds, fetchApprovalRequestsList, fetchEmployeesByIds, fetchEmployeeApprovalInfo,
    fetchEmployeeName, insertApprovalRequest, updateApprovalRequest, fetchApprovalRequestById,
    fetchEmployeeSystemRole, fetchShiftsBasic, fetchPublishedRostersForSwap, updateEmployeeRosterById,
    aplicarSolicitudEnErp,
    aplicarMovimientoInventarioEnErp,
} from '../../data/requests';
import { fetchEmployeeRosterSchedule } from '../../data/employees';
import { upsertWeeklyRoster } from '../../data/system';

// ============================================================================
// 📋 SOLICITUDES — Employee-initiated requests requiring admin approval
// ============================================================================

// Bucket B (DESIGN.md §6) — categórico genuino, sin jerarquía de severidad
// entre tipos de solicitud. chart-1..9 asignados por hue más cercano al
// crudo original; 3 pares reusan token (mismo criterio que el crudo
// original, que ya repetía 'purple' entre PERMIT/VENDOR_CHANGE_REQUEST).
// `variante` es el nombre de la variante de `Badge`/`SegmentedControl`; el
// `color`/`border` de al lado es la MISMA paleta escrita a mano y queda solo
// para los sitios que aún no migraron. Se agregó el 2026-07-28 al migrar los
// chips (D3.5): sin él, cada vista sacaba el `chart-N` con un regex sobre la
// clase de Tailwind — que es adivinar el dato en vez de tenerlo.
export const REQUEST_TYPES = {
    VACATION:     { label: 'Vacaciones',         color: 'bg-warning/10 text-warning-text', border: 'border-warning/30', variante: 'warning' },
    PERMIT:       { label: 'Permiso / Licencia', color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
    SHIFT_CHANGE: { label: 'Cambio de Turno',    color: 'bg-chart-9/10 text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' },
    OVERTIME:     { label: 'Horas Extra',        color: 'bg-chart-4/10 text-chart-4-text', border: 'border-chart-4/30', variante: 'chart-4' },
    ADVANCE:      { label: 'Anticipo Salarial',  color: 'bg-success/10 text-success-text', border: 'border-success/30', variante: 'success' },
    CERTIFICATE:  { label: 'Constancia Laboral', color: 'bg-chart-1/10 text-chart-1-text', border: 'border-chart-1/30', variante: 'chart-1' },
    DISABILITY:             { label: 'Incapacidad',             color: 'bg-chart-6/10 text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' },
    SHIFT_EXCEPTION:        { label: 'Excepción Turno (Kiosk)', color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
    ANNULMENT_REQUEST:      { label: 'Anulación de Factura',    color: 'bg-chart-6/10 text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' },
    PAYMENT_CHANGE_REQUEST: { label: 'Cambio de Forma de Pago', color: 'bg-chart-9/10 text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' },
    VENDOR_CHANGE_REQUEST:  { label: 'Cambio de Vendedor',      color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
    CLIENT_CHANGE_REQUEST:  { label: 'Cambio de Cliente',       color: 'bg-chart-9/10 text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' },
    INVENTORY_LOAD_REQUEST:    { label: 'Carga de Inventario',    color: 'bg-chart-1/10 text-chart-1-text', border: 'border-chart-1/30', variante: 'chart-1' },
    INVENTORY_DISCARD_REQUEST: { label: 'Descarte de Inventario', color: 'bg-chart-6/10 text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' },
    // Faltaba, y se notaba: la Bandeja agrupa por tipo usando este rótulo, así
    // que un traslado pendiente encabezaba su sección con la clave cruda
    // `INVENTORY_TRANSFER_REQUEST`. Su pantalla propia es `/traslados` —acá se
    // ve para saber que existe, no para resolverlo.
    INVENTORY_TRANSFER_REQUEST:{ label: 'Traslado entre Salas',   color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
};

/**
 * Las cuatro solicitudes que hablan de una FACTURA, no del expediente de quien
 * las pide. Salen del widget «Solicitar Modificación a Facturación».
 *
 * Se distinguen del resto por dos cosas, y las dos estaban mal:
 *
 *  1. **Un solo nivel de aprobación.** El escalado genérico las llevaba a tres:
 *     supervisor → supervisor/admin → Talento Humano. RRHH no tiene nada que
 *     decidir sobre la anulación de una factura, y el widget ya le promete a
 *     quien la envía que resuelve Supervisión ("Supervisión fue notificada y
 *     revisará la solicitud").
 *  2. **No dejan rastro en el legajo.** `registerEmployeeEvent` las anotaba en
 *     `employee_events` con `type: 'ANNULMENT_REQUEST'`, o sea que pedir anular
 *     una venta quedaba en el historial laboral del vendedor junto a permisos,
 *     vacaciones e incapacidades. La tabla no tiene CHECK que lo frenara.
 */
export const FACTURACION_REQUEST_TYPES = new Set([
    'ANNULMENT_REQUEST',
    'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST',
    'CLIENT_CHANGE_REQUEST',
]);

/**
 * Las dos que mueven EXISTENCIAS: la carga y el descarte de inventario.
 *
 * Valen las mismas dos razones que para facturación —un nivel de aprobación, y
 * nada que anotar en el legajo de quien la pide— más una tercera propia:
 * aprobar ES sacar o meter producto de verdad, y no se puede deshacer con un
 * clic. Revertir un descarte es hacer una carga por la misma cantidad, con otro
 * asiento en el kardex.
 */
export const INVENTARIO_REQUEST_TYPES = new Set([
    'INVENTORY_LOAD_REQUEST',
    'INVENTORY_DISCARD_REQUEST',
]);

/** Las que se aplican en un sistema externo al aprobarlas. */
export const REQUEST_TYPES_QUE_SE_APLICAN = new Set([
    ...FACTURACION_REQUEST_TYPES,
    ...INVENTARIO_REQUEST_TYPES,
]);

// Bucket A — severidad real del estado de la solicitud.
export const REQUEST_STATUS = {
    PENDING:   { label: 'Pendiente',  color: 'bg-warning/10 text-warning-text',  border: 'border-warning/30',  dot: 'bg-warning', variante: 'warning' },
    APPROVED:  { label: 'Aprobada',   color: 'bg-success/10 text-success-text', border: 'border-success/30', dot: 'bg-success', variante: 'success' },
    REJECTED:  { label: 'Rechazada',  color: 'bg-danger/10 text-danger-text',   border: 'border-danger/30',  dot: 'bg-danger', variante: 'danger' },
    CANCELLED: { label: 'Cancelada',  color: 'bg-surface-card-hover text-content-3', border: 'border-divider', dot: 'bg-content-3', variante: 'neutral' },
};

// ── Helpers internos ────────────────────────────────────────────────────────

const parseMeta = (raw) =>
    typeof raw === 'object' && raw !== null
        ? raw
        : (() => { try { return JSON.parse(raw); } catch { return {}; } })();

/**
 * Verifica si un empleado está actualmente en vacaciones o incapacidad.
 * Consulta employee_events tipo VACATION o DISABILITY cuya fecha de inicio ≤ hoy
 * y cuya endDate ≥ hoy (o sin endDate = vigente indefinidamente).
 */
const isUnavailable = async (employeeId) => {
    // La decisión la toma el servidor. Antes esto se traía los eventos de la otra
    // persona y los evaluaba acá, lo que obligaba a que `employee_events`
    // estuviera abierta a cualquier autenticado.
    //
    // El fallo por defecto sigue siendo «disponible», igual que antes: si esto no
    // contesta, es mejor enrutar la solicitud a alguien que quizá esté de
    // vacaciones que dejarla sin aprobador. Pero ahora el error se REGISTRA — con
    // la versión vieja, cerrar la tabla habría devuelto cero filas y esta función
    // habría dicho «disponible» sin que nada lo dijera.
    try {
        const { data, error } = await fetchEmployeeUnavailable(employeeId);
        if (error) {
            console.error('isUnavailable: empleado_no_disponible falló:', error.message);
            return false;
        }
        return data === true;
    } catch {
        return false; // En caso de error, asumimos disponible
    }
};

/**
 * Resuelve el aprobador designado subiendo recursivamente por la jerarquía de roles
 * hasta encontrar un empleado disponible, con fallback a admin de sucursal y global.
 */
const resolveApprover = async (employeeId, branchId, roleId) => {
    try {
        // Cargar todos los roles de una vez para recorrer el árbol sin N queries
        const { data: allRoles, error: rolesErr } = await fetchAllRolesHierarchy();
        if (rolesErr) console.error('resolveApprover: fetch roles failed:', rolesErr.message);

        if (!allRoles) return null;
        const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r]));

        const findAvailableInRole = async (targetRoleId) => {
            const { data, error } = await fetchActiveEmployeesInRoleAndBranch(targetRoleId, branchId, employeeId);
            if (error) console.error('resolveApprover.findAvailableInRole failed:', error.message);

            for (const c of (data || [])) {
                if (!(await isUnavailable(c.id))) return c.id;
            }
            return null;
        };

        // Subir por la jerarquía hasta encontrar aprobador
        let currentRoleId = roleId;
        const visited = new Set();

        while (currentRoleId && !visited.has(currentRoleId)) {
            visited.add(currentRoleId);
            const role = roleMap[currentRoleId];
            if (!role) break;

            if (role.parent_role_id) {
                const found = await findAvailableInRole(role.parent_role_id);
                if (found) return found;

                if (role.secondary_parent_role_id) {
                    const found2 = await findAvailableInRole(role.secondary_parent_role_id);
                    if (found2) return found2;
                }

                currentRoleId = role.parent_role_id;
            } else {
                break; // Llegamos a la raíz
            }
        }

        // Fallback: cualquier admin activo en la sucursal
        const { data: admins, error: adminsErr } = await fetchBranchAdmins(branchId, employeeId);
        if (adminsErr) console.error('resolveApprover: fetch branch admins failed:', adminsErr.message);

        if (admins?.[0]?.id) return admins[0].id;

        // Último fallback: cualquier admin global
        const { data: globalAdmins, error: globalErr } = await fetchGlobalAdmins(employeeId);
        if (globalErr) console.error('resolveApprover: fetch global admins failed:', globalErr.message);

        return globalAdmins?.[0]?.id || null;
    } catch (err) {
        console.error('Error resolviendo aprobador:', err);
        return null;
    }
};

// Último fallback absoluto: si resolveApprover/resolveNextApprover no encontraron
// a nadie (o ni siquiera pudieron ejecutarse porque falló el fetch del empleado),
// esto garantiza que la solicitud NUNCA quede con approver_id null — antes eso
// la volvía invisible para todo aprobador, incluso admins (fetchRequests filtra
// por eq('approver_id', ...), que nunca matchea null).
const resolveFallbackApprover = async (excludeId) => {
    try {
        const { data: roleRows, error: roleErr } = await fetchApprovalRolePermissions();
        if (roleErr) console.error('resolveFallbackApprover: fetch role_permissions failed:', roleErr.message);
        const roleIds = (roleRows || []).map(r => r.role_id);
        if (!roleIds.length) return null;

        const { data: emps, error: empsErr } = await fetchActiveEmployeesInRoles(roleIds, excludeId);
        if (empsErr) console.error('resolveFallbackApprover: fetch employees failed:', empsErr.message);
        return emps?.[0]?.id || null;
    } catch (err) {
        console.error('Error resolviendo aprobador de último recurso:', err);
        return null;
    }
};

const resolveNextApprover = async (level, branchId, excludeId = null) => {
    try {
        const findBySystemRole = async (roles, sameBranch = false) => {
            for (const role of roles) {
                const { data, error } = await fetchActiveEmployeesBySystemRoleConditional(role, branchId, excludeId, sameBranch);
                if (error) console.error('resolveNextApprover.findBySystemRole failed:', error.message);
                for (const c of (data || [])) {
                    if (!(await isUnavailable(c.id))) return c.id;
                }
            }
            return null;
        };

        // Resuelve role IDs por nombre (ilike) para evitar IDs hardcodeados
        const findByRoleName = async (namePattern, sameBranch = false) => {
            const { data: matchedRoles, error: rolesErr } = await fetchRolesByNamePattern(namePattern);
            if (rolesErr) console.error('resolveNextApprover.findByRoleName: fetch roles failed:', rolesErr.message);
            const roleIds = (matchedRoles || []).map(r => r.id);
            if (!roleIds.length) return null;
            for (const roleId of roleIds) {
                const { data, error } = await fetchActiveEmployeesByRoleIdConditional(roleId, branchId, excludeId, sameBranch);
                if (error) console.error('resolveNextApprover.findByRoleName failed:', error.message);
                for (const c of (data || [])) {
                    if (!(await isUnavailable(c.id))) return c.id;
                }
            }
            return null;
        };

        if (level === 'JEFE_SUCURSAL') {
            return await findBySystemRole(['JEFE', 'SUBJEFE'], true)
                || await findBySystemRole(['ADMIN'], false);
        }

        if (level === 2) {
            // Supervisor por system_role o por nombre de cargo
            return await findBySystemRole(['SUPERVISOR'])
                || await findByRoleName('Supervisor')
                || await findBySystemRole(['ADMIN', 'SUPERADMIN']);
        }

        if (level === 3) {
            // Talento Humano por nombre de cargo, luego fallback a admins
            const byName = await findByRoleName('Talento Humano')
                || await findByRoleName('RRHH')
                || await findBySystemRole(['ADMIN'])
                || await findBySystemRole(['SUPERADMIN']);
            if (byName) return byName;

            const { data: anyAdmin, error: anyAdminErr } = await fetchAnyActiveAdmin();
            if (anyAdminErr) console.error('resolveNextApprover(level 3): fetch fallback admin failed:', anyAdminErr.message);
            return anyAdmin?.[0]?.id || null;
        }

        return null;
    } catch { return null; }
};

/**
 * Notifica al empleado el resultado de su solicitud vía el canal de
 * notificaciones (campana + push). No lanza error — es no-bloqueante.
 */
const notifyEmployee = async (employeeId, approverId, requestType, status, approverNote, reqMetadata = {}) => {
    const typeLabel = REQUEST_TYPES[requestType]?.label || requestType;
    const isApproved = status === 'APPROVED';
    await notifyEmployees([String(employeeId)], {
        type: 'REQUEST_DECIDED',
        title: isApproved ? `${typeLabel} aprobada` : `${typeLabel} rechazada`,
        body: isApproved
            ? `Tu solicitud de ${typeLabel} fue aprobada.${approverNote ? ` Nota: "${approverNote}"` : ''}`
            : `Tu solicitud de ${typeLabel} fue rechazada.${approverNote ? ` Motivo: "${approverNote}"` : ''}`,
        link: '/my-requests',
        push: true,
        metadata: {
            requestType,
            status,
            approverNote: approverNote || null,
            // Cambio de turno
            targetEmployeeName: reqMetadata.targetEmployeeName || null,
            date: reqMetadata.date || null,
            myShift: reqMetadata.myShift || null,
            targetShift: reqMetadata.targetShift || null,
            // Vacaciones / Permiso / Incapacidad
            startDate: reqMetadata.startDate || null,
            endDate: reqMetadata.endDate || null,
            days: reqMetadata.days || null,
            permissionDates: reqMetadata.permissionDates || null,
            // Anticipo
            amount: reqMetadata.amount || null,
            // Constancia
            certificateType: reqMetadata.certificateType || null,
        },
    });
};

// ── Helpers de Incapacidad ──────────────────────────────────────────────────

/** Devuelve la fecha de inicio de semana (lunes) en formato YYYY-MM-DD para una fecha dada */
const getMondayISO = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
    d.setDate(d.getDate() + diff);
    return d.toISOString().split('T')[0];
};

/**
 * Marca cada día de [startDate, endDate] como LIBRE/Incapacidad en employee_rosters.
 * Agrupa por semana para minimizar queries.
 */
const markDisabilityDaysInRoster = async (employeeId, startDate, endDate) => {
    try {
        const start = new Date(startDate + 'T00:00:00');
        const end   = new Date(endDate   + 'T00:00:00');

        // Agrupar días por semana → { weekStart: [dayId, ...] }
        const weekMap = {};
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const weekKey = getMondayISO(d.toISOString().split('T')[0]);
            const rawDay  = d.getDay();
            const dayId   = rawDay === 0 ? 7 : rawDay; // 7=Dom, 1=Lun … 6=Sab (matches kiosk reader)
            if (!weekMap[weekKey]) weekMap[weekKey] = [];
            weekMap[weekKey].push(dayId);
        }

        for (const [weekStart, dayIds] of Object.entries(weekMap)) {
            const { data: roster, error: rosterErr } = await fetchEmployeeRosterSchedule(employeeId, weekStart);
            if (rosterErr) console.error('markDisabilityDaysInRoster: fetch roster failed:', rosterErr.message);

            const raw = roster?.schedule_data || {};
            const sched = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...raw };

            for (const dayId of dayIds) {
                sched[dayId] = { shiftId: 'LIBRE', note: 'Incapacidad' };
            }

            await upsertWeeklyRoster({ employee_id: employeeId, week_start_date: weekStart, schedule_data: sched });
        }
        return true;
    } catch (err) {
        console.error('Error marcando días de incapacidad en roster:', err);
        return false;
    }
};

const markVacationDaysInRoster = async (employeeId, startDate, endDate) => {
    try {
        const start = new Date(startDate + 'T00:00:00');
        const end   = new Date(endDate   + 'T00:00:00');
        const weekMap = {};
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const weekKey  = getMondayISO(d.toISOString().split('T')[0]);
            const rawDay   = d.getDay();
            const dayId    = rawDay === 0 ? 7 : rawDay; // 7=Dom (matches kiosk reader)
            if (!weekMap[weekKey]) weekMap[weekKey] = [];
            weekMap[weekKey].push(dayId);
        }
        for (const [weekStart, dayIds] of Object.entries(weekMap)) {
            const { data: roster, error: rosterErr } = await fetchEmployeeRosterSchedule(employeeId, weekStart);
            if (rosterErr) console.error('markVacationDaysInRoster: fetch roster failed:', rosterErr.message);
            const raw = roster?.schedule_data || {};
            const sched = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...raw };
            for (const dayId of dayIds) {
                sched[dayId] = { shiftId: 'LIBRE', note: 'Vacaciones' };
            }
            await upsertWeeklyRoster({ employee_id: employeeId, week_start_date: weekStart, schedule_data: sched });
        }
        return true;
    } catch (err) {
        console.error('Error marcando días de vacaciones en roster:', err);
        return false;
    }
};

/**
 * Verifica la cobertura de la sucursal en el rango de incapacidad.
 * Si algún día queda con 0 o 1 empleados, envía alerta a Talento Humano.
 */
const checkAndAlertCoverage = async (employeeId, branchId, startDate, endDate, approverId, employeeName) => {
    try {
        if (!branchId) return;

        const { data: branchEmps, error: branchEmpsErr } = await fetchActiveBranchEmployeesExcluding(branchId, employeeId);
        if (branchEmpsErr) console.error('checkAndAlertCoverage: fetch branch employees failed:', branchEmpsErr.message);

        const branchEmpIds = (branchEmps || []).map(e => e.id);
        if (!branchEmpIds.length) {
            // Nadie más en la sucursal
            await _sendCoverageAlert(branchId, startDate, endDate, approverId, employeeName, 0);
            return;
        }

        const start = new Date(startDate + 'T00:00:00');
        const end   = new Date(endDate   + 'T00:00:00');

        // Semanas afectadas
        const weekStarts = new Set();
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            weekStarts.add(getMondayISO(d.toISOString().split('T')[0]));
        }

        let minCoverage = branchEmpIds.length;

        for (const weekStart of weekStarts) {
            const { data: rosters, error: rostersErr } = await fetchRostersForWeekByEmployees(weekStart, branchEmpIds);
            if (rostersErr) console.error('checkAndAlertCoverage: fetch rosters failed:', rostersErr.message);

            const weekStartDate = new Date(weekStart + 'T00:00:00');
            for (let offset = 0; offset < 7; offset++) {
                const checkD = new Date(weekStartDate);
                checkD.setDate(weekStartDate.getDate() + offset);
                const dateISO = checkD.toISOString().split('T')[0];
                if (dateISO < startDate || dateISO > endDate) continue;

                const rawDay = checkD.getDay();
                const dayId  = rawDay === 0 ? 7 : rawDay;
                let working = 0;
                for (const roster of (rosters || [])) {
                    const s = typeof roster.schedule_data === 'string'
                        ? JSON.parse(roster.schedule_data || '{}')
                        : roster.schedule_data || {};
                    const cell = s[dayId];
                    const sid  = typeof cell === 'object' ? cell?.shiftId : cell;
                    if (sid && sid !== 'LIBRE') working++;
                }
                minCoverage = Math.min(minCoverage, working);
            }
        }

        if (minCoverage < 2) {
            await _sendCoverageAlert(branchId, startDate, endDate, approverId, employeeName, minCoverage);
        }
    } catch (err) {
        console.error('Error verificando cobertura de incapacidad:', err);
    }
};

const _sendCoverageAlert = async (branchId, startDate, endDate, approverId, employeeName, count) => {
    try {
        const thId = await resolveNextApprover(3, branchId, null);
        if (!thId) return;

        const fmtD = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });

        await notifyEmployees([String(thId)], {
            type: 'SYSTEM',
            title: 'Cobertura de horario reducida',
            body: `La incapacidad de ${employeeName} (${fmtD(startDate)}–${fmtD(endDate)}) deja la sucursal con solo ${count} empleado${count !== 1 ? 'es' : ''} disponible${count !== 1 ? 's' : ''}. Revisa el horario y ajusta según sea necesario.`,
            link: '/schedules',
            push: true,
            branchId: branchId != null ? Number(branchId) : null,
        });
    } catch (err) {
        console.error('Error enviando alerta de cobertura:', err);
    }
};

// ── Slice ───────────────────────────────────────────────────────────────────

export const createRequestsSlice = (set, get) => ({
    // ── State ──────────────────────────────────────────────────────────────
    requests: [],
    isLoadingRequests: false,

    // ── Fetch ──────────────────────────────────────────────────────────────
    fetchRequests: async (employeeId = null, branchId = null, approverId = null) => {
        set({ isLoadingRequests: true });
        try {
            // Si se pide filtro por sucursal, obtener IDs de empleados de esa sucursal
            let branchEmpIds = null;
            if (branchId) {
                const { data: branchEmps, error: branchEmpsErr } = await fetchBranchActiveEmployeeIds(branchId);
                if (branchEmpsErr) console.error('fetchRequests: fetch branch employees failed:', branchEmpsErr.message);
                branchEmpIds = (branchEmps || []).map(e => e.id);
            }

            // 1. Fetch solicitudes sin joins
            // Incluye huérfanas (approver_id null) como red de seguridad — no deberían
            // existir tras el fallback de createRequest, pero si alguna se cuela no
            // debe quedar invisible para todo aprobador (RLS ya permite verlas: la
            // policy de SELECT da acceso total a can_approve, este filtro es solo UI).
            const { data: requests, error } = await fetchApprovalRequestsList({ employeeId, branchEmpIds, approverId });
            if (error) throw error;

            // 2. IDs únicos de empleados y aprobadores
            const empIds = [...new Set([
                ...(requests || []).map(r => r.employee_id),
                ...(requests || []).map(r => r.approver_id).filter(Boolean),
            ])];

            // 3. Fetch empleados por IDs
            let empRows = [];
            if (empIds.length > 0) {
                const { data, error: empErr } = await fetchEmployeesByIds(empIds, 'id, name, code, role_id, branch_id, system_role');
                if (empErr) console.error('fetchRequests: fetch employees failed:', empErr.message);
                empRows = data || [];
            }

            // 4. Combinar en memoria
            const empMap = Object.fromEntries(empRows.map(e => [e.id, e]));

            // 4b. Fetch adicional para aprobadores que no estén en empMap
            const missingIds = [...new Set(
                (requests || []).map(r => r.approver_id).filter(id => id && !empMap[id])
            )];
            if (missingIds.length > 0) {
                const { data: extra, error: extraErr } = await fetchEmployeesByIds(missingIds, 'id, name, code, role_id, branch_id, system_role');
                if (extraErr) console.error('fetchRequests: fetch missing approvers failed:', extraErr.message);
                (extra || []).forEach(e => { empMap[e.id] = e; });
            }

            const enriched = (requests || []).map(r => ({
                ...r,
                employee: empMap[r.employee_id] || null,
                approver: empMap[r.approver_id] || null,
            }));

            set({ requests: enriched, isLoadingRequests: false });
            return enriched;
        } catch (err) {
            console.error('Error cargando solicitudes:', err);
            set({ isLoadingRequests: false });
            return [];
        }
    },

    // ── Create ─────────────────────────────────────────────────────────────
    // payload: datos estructurados de la solicitud (fechas, turno destino, etc.)
    // note:    descripción/motivo libre del empleado
    createRequest: async (employeeId, type, payload = {}, note = '') => {
        try {
            // Obtener datos del empleado para resolver el aprobador
            const { data: emp, error: empErr } = await fetchEmployeeApprovalInfo(employeeId);
            if (empErr) console.error('createRequest: fetch employee failed (approver resolution will fall back):', empErr.message);

            // SHIFT_CHANGE: enrutar directamente al compañero para aprobación de par
            if (type === 'SHIFT_CHANGE' && payload.targetEmployeeId) {
                const { data: peerEmp, error: peerEmpErr } = await fetchEmployeeName(payload.targetEmployeeId);
                if (peerEmpErr) console.error('createRequest: fetch peer employee failed:', peerEmpErr.message);

                const myDayOfWeek = payload.date ? new Date(payload.date + 'T12:00:00').getDay() : null;
                const allEmps = get().employees || [];
                const myEmpStore     = allEmps.find(e => String(e.id) === String(employeeId));
                const targetEmpStore = allEmps.find(e => String(e.id) === String(payload.targetEmployeeId));
                const fmtShift = (s) => s?.start && s?.end ? `${s.start} → ${s.end}` : null;
                const myShift     = myDayOfWeek !== null ? fmtShift(myEmpStore?.weeklySchedule?.[myDayOfWeek])     : null;
                const targetShift = myDayOfWeek !== null ? fmtShift(targetEmpStore?.weeklySchedule?.[myDayOfWeek]) : null;

                const enrichedPayload = {
                    ...payload,
                    peerApprovalRequired: true,
                    targetEmployeeName: peerEmp?.name || '',
                    myShift:     myShift     || 'No especificado',
                    targetShift: targetShift || 'No especificado',
                };
                const { data: peerData, error: peerError } = await insertApprovalRequest({
                    employee_id: employeeId,
                    approver_id: payload.targetEmployeeId,
                    type,
                    status: 'PENDING',
                    note,
                    metadata: enrichedPayload,
                    current_level: 1,
                });
                if (peerError) throw peerError;
                const enrichedPeer = {
                    ...peerData,
                    employee: allEmps.find(e => String(e.id) === String(peerData.employee_id)) || null,
                    approver: allEmps.find(e => String(e.id) === String(peerData.approver_id)) || null,
                };
                set((state) => ({ requests: [enrichedPeer, ...state.requests] }));
                await get().appendAuditLog('SOLICITUD_CREADA', employeeId, {
                    dimension: 'HR',
                    new_value: `Solicitud de ${REQUEST_TYPES[type]?.label || type} (cambio de par)`,
                });
                // El aviso al compañero lo crea el trigger
                // `notificar_solicitud_creada`, en la misma transacción que la
                // solicitud — incluido el caso de nivel 1, que apunta a
                // /my-requests y no a /requests.
                return enrichedPeer;
            }

            // DISABILITY: va directamente a Talento Humano, sin pasar por la jerarquía intermedia
            const resolvedApproverId = emp
                ? (type === 'DISABILITY'
                    ? await resolveNextApprover(3, emp.branch_id, employeeId)
                    : await resolveApprover(employeeId, emp.branch_id, emp.role_id))
                : null;
            const approverId = resolvedApproverId || await resolveFallbackApprover(employeeId);

            const finalMetadata = type === 'DISABILITY'
                ? { ...payload, priority: 'URGENT' }
                : payload;

            const { data, error } = await insertApprovalRequest({
                employee_id: employeeId,
                approver_id: approverId,
                type,
                status: 'PENDING',
                note,
                metadata: finalMetadata,
            });

            if (error) throw error;

            // Enriquecer con employee/approver desde el store
            const allEmps = get().employees || [];
            const enriched = {
                ...data,
                employee: allEmps.find(e => String(e.id) === String(data.employee_id)) || null,
                approver: allEmps.find(e => String(e.id) === String(data.approver_id)) || null,
            };

            set((state) => ({ requests: [enriched, ...state.requests] }));

            await get().appendAuditLog('SOLICITUD_CREADA', employeeId, {
                dimension: 'HR',
                new_value: `Solicitud de ${REQUEST_TYPES[type]?.label || type}`,
            });

            // El aviso al aprobador lo crea el trigger
            // `notificar_solicitud_creada` junto con la fila. Antes salía de
            // acá, en una llamada aparte que podía no ejecutarse: si eso
            // pasaba, la solicitud quedaba registrada y nadie se enteraba.
            return enriched;
        } catch (err) {
            console.error('createRequest error:', err);
            return null;
        }
    },

    // ── Approve ────────────────────────────────────────────────────────────

    // Helper interno: ejecuta todos los efectos de una aprobación final en un solo lugar.
    // Cualquier lógica nueva por tipo (OVERTIME, ADVANCE, etc.) se agrega aquí.
    /**
     * Aprobar una solicitud de facturación = aplicarla en el ERP.
     *
     * Todo el trabajo sensible vive en la Edge Function: valida el permiso
     * contra el JWT, traduce el id del portal al del ERP, escribe, RELEE para
     * confirmar que quedó el valor pedido (el ERP contesta "Success" con el
     * mismo texto para dos operaciones distintas) y recién entonces marca
     * APPROVED. Acá solo se refleja el resultado y se avisa.
     *
     * Si el ERP no acepta, esto devuelve false y la solicitud sigue PENDING:
     * el supervisor ve el motivo y puede reintentar. Nunca queda una solicitud
     * "aprobada" sobre una factura que no cambió.
     */
    _aprobarFacturacion: async (requestId, req, approverId, approverNote) => {
        const { ok, error, aplicado } = await aplicarSolicitudEnErp(requestId, approverNote);

        if (!ok) {
            useToastStore.getState().showToast('No se aplicó el cambio', error, 'error');
            return false;
        }

        set(state => ({
            requests: state.requests.map(r =>
                r.id === requestId
                    ? { ...r, status: 'APPROVED', approver_id: approverId, approver_note: approverNote,
                        metadata: { ...parseMeta(r.metadata), erp_aplicado: aplicado } }
                    : r
            ),
        }));

        if (req.employee?.id) {
            await notifyEmployee(req.employee.id, approverId, req.type, 'APPROVED',
                approverNote, parseMeta(req.metadata));
        }

        useToastStore.getState().showToast(
            'Cambio aplicado',
            `${REQUEST_TYPES[req.type]?.label ?? 'Solicitud'} — ${aplicado?.correlativo ?? ''} actualizada.`,
            'success',
        );
        window.dispatchEvent(new CustomEvent('requests-updated'));
        return true;
    },

    /**
     * Aprobar una carga o un descarte = moverlo de verdad.
     *
     * Misma forma que `_aprobarFacturacion` y por el mismo motivo: la Edge
     * Function valida el permiso contra el JWT, abre su propia sesión, relee el
     * stock justo antes de escribir y recién entonces marca APPROVED. Si no
     * entra, esto devuelve false y la solicitud sigue PENDING con el motivo a
     * la vista.
     */
    _aprobarInventario: async (requestId, req, approverId, approverNote, aceptadas = null) => {
        const { ok, error, aplicado, lineas_rechazadas: rechazadas } =
            await aplicarMovimientoInventarioEnErp(requestId, approverNote, aceptadas);

        if (!ok) {
            useToastStore.getState().showToast('No se aplicó el movimiento', error, 'error');
            return false;
        }

        set(state => ({
            requests: state.requests.map(r =>
                r.id === requestId
                    ? { ...r, status: 'APPROVED', approver_id: approverId, approver_note: approverNote,
                        metadata: { ...parseMeta(r.metadata), erp_aplicado: aplicado,
                                    lineas_rechazadas: rechazadas ?? parseMeta(r.metadata).lineas_rechazadas } }
                    : r
            ),
        }));

        if (req.employee?.id) {
            await notifyEmployee(req.employee.id, approverId, req.type, 'APPROVED',
                approverNote, parseMeta(req.metadata));
        }

        const esCarga = req.type === 'INVENTORY_LOAD_REQUEST';
        const partes = [
            `${aplicado?.lineas ?? 0} ${aplicado?.lineas === 1 ? 'producto' : 'productos'}`,
            `${aplicado?.unidades ?? 0} ${aplicado?.unidades === 1 ? 'unidad' : 'unidades'}`,
        ];
        // Lo que quedó afuera se ANUNCIA. Un parcial que se avisa igual que un
        // completo se lee como completo, y quien pidió se entera recién cuando
        // busca el producto y no está.
        const fuera = rechazadas?.length ?? 0;
        if (fuera > 0) partes.push(`${fuera} ${fuera === 1 ? 'línea quedó' : 'líneas quedaron'} sin aplicar`);
        // Un recorte que no se anuncia se lee como que entró completo.
        if (aplicado?.concepto_recortado) partes.push('el detalle se guardó abreviado');

        useToastStore.getState().showToast(
            fuera > 0 ? (esCarga ? 'Carga aplicada en parte' : 'Descarte aplicado en parte')
                      : (esCarga ? 'Carga aplicada' : 'Descarte aplicado'),
            partes.join(' · '),
            'success',
        );
        window.dispatchEvent(new CustomEvent('requests-updated'));
        return true;
    },

    _runFinalApproval: async (requestId, req, approverId, approverNote, newApprovals, toastMsg) => {
        const { error } = await updateApprovalRequest(requestId, { status: 'APPROVED', approver_id: approverId, approver_note: approverNote, approvals: newApprovals, updated_at: new Date().toISOString() });
        if (error) throw error;

        set(state => ({
            requests: state.requests.map(r =>
                r.id === requestId ? { ...r, status: 'APPROVED', approver_note: approverNote, approvals: newApprovals } : r
            ),
        }));

        if (req.employee?.id) {
            const meta = parseMeta(req.metadata);
            await notifyEmployee(req.employee.id, approverId, req.type, 'APPROVED', approverNote, meta);

            // Ni una solicitud de facturación ni una de inventario son eventos
            // del legajo: hablan de una factura o de una existencia, no de la
            // persona. Ver REQUEST_TYPES_QUE_SE_APLICAN.
            const registerEmployeeEvent = get().registerEmployeeEvent;
            if (registerEmployeeEvent && !REQUEST_TYPES_QUE_SE_APLICAN.has(req.type)) {
                await registerEmployeeEvent(req.employee.id, {
                    type: req.type,
                    date: meta.startDate || meta.date || new Date().toISOString().split('T')[0],
                    endDate: meta.endDate,
                    note: req.note,
                    approvedBy: approverId,
                    fromRequest: req.id,
                    ...meta,
                }).catch(console.error);

                if (req.type === 'SHIFT_CHANGE' && meta.targetEmployeeId) {
                    const today = new Date().toISOString().split('T')[0];
                    await registerEmployeeEvent(meta.targetEmployeeId, {
                        type: 'SHIFT_CHANGE',
                        date: meta.date || today,
                        note: `Cambio de turno aprobado con ${req.employee?.name || ''}`,
                        approvedBy: approverId,
                        fromRequest: req.id,
                    }).catch(() => {});
                    await notifyEmployee(meta.targetEmployeeId, approverId, 'SHIFT_CHANGE', 'APPROVED', approverNote, {
                        targetEmployeeName: req.employee?.name,
                        date: meta.date,
                        myShift: meta.targetShift,
                        targetShift: meta.myShift,
                    });

                    // Patch both employees' PUBLISHED rosters for the swap day so that
                    // consolidate-timesheets honours the swapped hours.
                    if (meta.date) {
                        try {
                            const swapDate  = meta.date;
                            const swapDateD = new Date(swapDate + 'T12:00:00'); // local time, no Z
                            const dow       = swapDateD.getDay();               // local day (0=Sun)
                            const diffToMon = dow === 0 ? 6 : dow - 1;
                            const monD      = new Date(swapDateD);
                            monD.setDate(monD.getDate() - diffToMon);
                            const weekStart = `${monD.getFullYear()}-${String(monD.getMonth() + 1).padStart(2, '0')}-${String(monD.getDate()).padStart(2, '0')}`;
                            const dayKey    = String(dow === 0 ? 7 : dow); // 7=Dom (matches kiosk)

                            const [{ data: shiftsRows, error: shiftsErr }, { data: rosters, error: rostersErr }] = await Promise.all([
                                fetchShiftsBasic(),
                                fetchPublishedRostersForSwap([String(req.employee.id), String(meta.targetEmployeeId)], weekStart),
                            ]);
                            if (shiftsErr) console.error('SHIFT_CHANGE roster patch: fetch shifts failed:', shiftsErr.message);
                            if (rostersErr) console.error('SHIFT_CHANGE roster patch: fetch rosters failed:', rostersErr.message);

                            const shiftMap = new Map();
                            for (const s of shiftsRows || []) {
                                shiftMap.set(String(s.id), {
                                    start: String(s.start_time).substring(0, 5),
                                    end:   String(s.end_time).substring(0, 5),
                                });
                            }

                            const rosterA = rosters?.find(r => String(r.employee_id) === String(req.employee.id));
                            const rosterB = rosters?.find(r => String(r.employee_id) === String(meta.targetEmployeeId));

                            const resolveShiftTimes = (roster) => {
                                const dayData = roster?.schedule_data?.[dayKey];
                                if (!dayData) return null;
                                if (dayData.customStart && dayData.customEnd)
                                    return { start: dayData.customStart, end: dayData.customEnd };
                                const sid = dayData.shiftId && dayData.shiftId !== 'LIBRE'
                                    ? String(dayData.shiftId) : null;
                                return sid ? shiftMap.get(sid) || null : null;
                            };

                            const timesA = resolveShiftTimes(rosterA); // A's original shift
                            const timesB = resolveShiftTimes(rosterB); // B's original shift

                            const patchRoster = async (roster, newTimes) => {
                                if (!roster || !newTimes) return;
                                const updated = {
                                    ...(roster.schedule_data || {}),
                                    [dayKey]: {
                                        ...(roster.schedule_data?.[dayKey] || {}),
                                        isOff: false,
                                        customStart: newTimes.start,
                                        customEnd:   newTimes.end,
                                        exceptionNote: `Cambio de turno aprobado (solicitud #${req.id})`,
                                        exceptionDate: swapDate,
                                    },
                                };
                                await updateEmployeeRosterById(roster.id, { schedule_data: updated, updated_at: new Date().toISOString() });
                            };

                            // A works B's hours, B works A's hours
                            await Promise.all([
                                patchRoster(rosterA, timesB),
                                patchRoster(rosterB, timesA),
                            ]);
                        } catch (rosterErr) {
                            console.error('SHIFT_CHANGE: roster patch failed', rosterErr);
                            // Non-blocking — employee_events still records the swap
                        }
                    }
                }

                if (req.type === 'DISABILITY' && meta.startDate && meta.endDate) {
                    await markDisabilityDaysInRoster(req.employee.id, meta.startDate, meta.endDate);
                    await checkAndAlertCoverage(req.employee.id, req.employee?.branch_id, meta.startDate, meta.endDate, approverId, req.employee?.name || 'un empleado');
                }

                if (req.type === 'VACATION' && meta.startDate && meta.endDate) {
                    await markVacationDaysInRoster(req.employee.id, meta.startDate, meta.endDate);
                }
            }
        }

        if (toastMsg) useToastStore.getState().showToast('Aprobado', toastMsg, 'success');
        else useToastStore.getState().showToast('Solicitud Aprobada', `${REQUEST_TYPES[req.type]?.label || req.type} aprobada correctamente.`, 'success');
        window.dispatchEvent(new CustomEvent('requests-updated'));
        return true;
    },

    /**
     * @param aceptadas  Índices de `metadata.items` que SÍ entran, cuando el
     *                   aprobador dejó líneas afuera. `null` = entra todo.
     *                   Sólo lo entiende el inventario: una factura no tiene
     *                   líneas que aprobar por separado.
     */
    approveRequest: async (requestId, approverId, approverNote = '', _reqOverride = null, aceptadas = null) => {
        try {
            const req = _reqOverride || get().requests.find(r => r.id === requestId);
            if (!req) return false;

            // Un traslado NO se aprueba desde acá. Su confirmación relee la
            // existencia de la sala de origen y despacha; el camino genérico lo
            // marcaba APPROVED **sin mover nada**, y con eso desaparecía de las
            // tres pestañas de Traslados: de «por confirmar» por estado, y de
            // «por recibir» porque ese filtro exige un `erp_traslado` que nunca
            // se escribió. Producto que no salió, solicitud dada por resuelta y
            // ninguna pantalla donde volver a encontrarla.
            if (req.type === 'INVENTORY_TRANSFER_REQUEST') {
                useToastStore.getState().showToast(
                    'Se resuelve en Traslados',
                    'Este traslado se confirma en la pantalla de Traslados, que revisa la existencia de la sala antes de enviarlo.',
                    'error');
                return false;
            }

            // Facturación: aprobar ES aplicar el cambio en el ERP. No pasa por
            // el flujo genérico porque ese marca APPROVED primero y notifica
            // después — acá, si el ERP no acepta, la solicitud tiene que
            // quedarse PENDING. Rechazar no toca el ERP: eso sigue en
            // `rejectRequest`, que solo cambia el estado.
            if (FACTURACION_REQUEST_TYPES.has(req.type))
                return await get()._aprobarFacturacion(requestId, req, approverId, approverNote);

            // Inventario: igual, pero moviendo existencias. Rechazar tampoco
            // toca nada afuera — eso sigue en `rejectRequest`.
            if (INVENTARIO_REQUEST_TYPES.has(req.type))
                return await get()._aprobarInventario(requestId, req, approverId, approverNote, aceptadas);

            const currentLevel = req.current_level || 1;
            const nextLevel = currentLevel + 1;
            const newApprovals = [...(Array.isArray(req.approvals) ? req.approvals : []), {
                level: currentLevel, approverId, approverNote, approvedAt: new Date().toISOString(),
            }];

            // ── SHIFT_CHANGE nivel 1: el peer acaba de aprobar ─────────────────
            if (req.type === 'SHIFT_CHANGE' && currentLevel === 1) {
                const { data: peerEmp, error: peerEmpErr } = await fetchEmployeeSystemRole(approverId);
                if (peerEmpErr) console.error('approveRequest: fetch peer employee failed:', peerEmpErr.message);
                const peerIsJefe = ['JEFE', 'SUBJEFE'].includes(peerEmp?.system_role);
                const nextApprover = peerIsJefe ? null : await resolveNextApprover('JEFE_SUCURSAL', req.employee?.branch_id, approverId);

                if (!nextApprover) {
                    return await get()._runFinalApproval(requestId, req, approverId, approverNote, newApprovals,
                        peerIsJefe ? 'Cambio de turno aprobado.' : 'Aprobado (sin jefe disponible en sucursal).');
                }

                // Avanzar a nivel 2 → jefe de sucursal
                const { error: adv } = await updateApprovalRequest(requestId, { current_level: 2, approver_id: nextApprover, approvals: newApprovals, updated_at: new Date().toISOString() });
                if (adv) throw adv;

                set(state => ({
                    requests: state.requests.map(r =>
                        r.id === requestId ? { ...r, current_level: 2, approver_id: nextApprover, approvals: newApprovals } : r
                    ),
                }));
                await notifyEmployees([String(nextApprover)], {
                    type: 'REQUEST_PENDING',
                    title: 'Solicitud pendiente de aprobación final',
                    body: `Cambio de turno de ${req.employee?.name} aprobado por el compañero — requiere tu aprobación final.`,
                    link: '/requests',
                    push: true,
                });
                useToastStore.getState().showToast('Aprobado — Nivel 1', 'El compañero aprobó. Enviado al jefe de sucursal.', 'success');
                window.dispatchEvent(new CustomEvent('requests-updated'));
                return true;
            }

            const maxLevels = req.type === 'SHIFT_CHANGE' ? 2
                : req.type === 'DISABILITY' ? 1
                : REQUEST_TYPES_QUE_SE_APLICAN.has(req.type) ? 1   // Supervisión decide y cierra
                : 3;

            if (nextLevel <= maxLevels) {
                const nextApprover = await resolveNextApprover(nextLevel, req.employee?.branch_id, approverId);

                if (!nextApprover) {
                    // Sin siguiente aprobador → aprobación final directa
                    return await get()._runFinalApproval(requestId, req, approverId, approverNote, newApprovals,
                        'Solicitud aprobada (sin aprobador disponible en nivel siguiente).');
                }

                const { error } = await updateApprovalRequest(requestId, { current_level: nextLevel, approver_id: nextApprover, approvals: newApprovals, updated_at: new Date().toISOString() });
                if (error) throw error;

                set(state => ({
                    requests: state.requests.map(r =>
                        r.id === requestId ? { ...r, current_level: nextLevel, approver_id: nextApprover, approvals: newApprovals } : r
                    ),
                }));
                await notifyEmployees([String(nextApprover)], {
                    type: 'REQUEST_PENDING',
                    title: 'Nueva solicitud pendiente',
                    body: `Solicitud de ${REQUEST_TYPES[req.type]?.label} de ${req.employee?.name} — Nivel ${nextLevel} de ${maxLevels}.`,
                    link: '/requests',
                    push: true,
                });
                useToastStore.getState().showToast(
                    `Aprobado — Nivel ${currentLevel}`,
                    `Solicitud avanzada al nivel ${nextLevel}. Notificado el siguiente aprobador.`,
                    'success'
                );
                window.dispatchEvent(new CustomEvent('requests-updated'));
                return true;
            }

            // Aprobación final (último nivel completado)
            return await get()._runFinalApproval(requestId, req, approverId, approverNote, newApprovals);

        } catch (err) {
            console.error('Error aprobando solicitud:', err);
            return false;
        }
    },

    // ── Reject ─────────────────────────────────────────────────────────────
    rejectRequest: async (requestId, approverId, approverNote = '') => {
        try {
            const req = get().requests.find(r => r.id === requestId);

            const { error } = await updateApprovalRequest(requestId, {
                status: 'REJECTED',
                approver_id: approverId,
                approver_note: approverNote,
                updated_at: new Date().toISOString(),
            });

            if (error) throw error;

            set((state) => ({
                requests: state.requests.map(r =>
                    r.id === requestId
                        ? { ...r, status: 'REJECTED', approver_note: approverNote }
                        : r
                ),
            }));

            // Notificar al empleado via anuncio interno
            if (req?.employee?.id) {
                await notifyEmployee(req.employee.id, approverId, req.type, 'REJECTED', approverNote, parseMeta(req.metadata));
            }

            return true;
        } catch (err) {
            console.error('Error rechazando solicitud:', err);
            return false;
        }
    },

    // ── Peer approve/reject (fetch-enrich-then-delegate) ──────────────────
    approvePeerRequest: async (requestId, approverId, approverNote = '') => {
        try {
            const { data: reqData, error: reqErr } = await fetchApprovalRequestById(requestId);
            if (reqErr) console.error('approvePeerRequest: fetch request failed:', reqErr.message);
            if (!reqData) return false;
            const allEmps = get().employees || [];
            const enriched = {
                ...reqData,
                employee: allEmps.find(e => String(e.id) === String(reqData.employee_id)) || null,
                approver: allEmps.find(e => String(e.id) === String(reqData.approver_id)) || null,
            };
            set(state => ({ requests: [...state.requests.filter(r => r.id !== requestId), enriched] }));
            return await get().approveRequest(requestId, approverId, approverNote, enriched);
        } catch (err) {
            console.error('approvePeerRequest error:', err);
            return false;
        }
    },

    rejectPeerRequest: async (requestId, approverId, approverNote = '') => {
        try {
            const { data: reqData, error: reqErr } = await fetchApprovalRequestById(requestId);
            if (reqErr) console.error('rejectPeerRequest: fetch request failed:', reqErr.message);
            if (!reqData) return false;
            const allEmps = get().employees || [];
            const enriched = {
                ...reqData,
                employee: allEmps.find(e => String(e.id) === String(reqData.employee_id)) || null,
                approver: allEmps.find(e => String(e.id) === String(reqData.approver_id)) || null,
            };
            set(state => ({ requests: [...state.requests.filter(r => r.id !== requestId), enriched] }));
            return await get().rejectRequest(requestId, approverId, approverNote);
        } catch (err) {
            console.error('rejectPeerRequest error:', err);
            return false;
        }
    },

    // ── Cancel (by employee) ───────────────────────────────────────────────
    cancelRequest: async (requestId) => {
        try {
            const { error } = await updateApprovalRequest(requestId, {
                status: 'CANCELLED',
                updated_at: new Date().toISOString(),
            });

            if (error) throw error;

            set((state) => ({
                requests: state.requests.map(r =>
                    r.id === requestId ? { ...r, status: 'CANCELLED' } : r
                ),
            }));

            return true;
        } catch (err) {
            console.error('Error cancelando solicitud:', err);
            return false;
        }
    },
});
