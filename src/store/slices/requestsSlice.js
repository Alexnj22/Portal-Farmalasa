import { useToastStore } from '../toastStore';
import { notifyEmployees } from '../../utils/notify';
import {
    fetchEmployeeAvailabilityEvents, fetchAllRolesHierarchy, fetchRolesByNamePattern,
    fetchActiveEmployeesInRoleAndBranch, fetchBranchAdmins, fetchGlobalAdmins, fetchAnyActiveAdmin,
    fetchApprovalRolePermissions, fetchActiveEmployeesInRoles, fetchActiveEmployeesBySystemRoleConditional,
    fetchActiveEmployeesByRoleIdConditional, fetchActiveBranchEmployeesExcluding, fetchRostersForWeekByEmployees,
    fetchBranchActiveEmployeeIds, fetchApprovalRequestsList, fetchEmployeesByIds, fetchEmployeeApprovalInfo,
    fetchEmployeeName, insertApprovalRequest, updateApprovalRequest, fetchApprovalRequestById,
    fetchEmployeeSystemRole, fetchShiftsBasic, fetchPublishedRostersForSwap, updateEmployeeRosterById,
} from '../../data/requests';
import { fetchEmployeeRosterSchedule } from '../../data/employees';
import { upsertWeeklyRoster } from '../../data/system';

// ============================================================================
// 📋 SOLICITUDES — Employee-initiated requests requiring admin approval
// ============================================================================

export const REQUEST_TYPES = {
    VACATION:     { label: 'Vacaciones',         color: 'bg-amber-100 text-amber-800',    border: 'border-amber-200' },
    PERMIT:       { label: 'Permiso / Licencia', color: 'bg-purple-100 text-purple-800',  border: 'border-purple-200' },
    SHIFT_CHANGE: { label: 'Cambio de Turno',    color: 'bg-cyan-100 text-cyan-800',      border: 'border-cyan-200' },
    OVERTIME:     { label: 'Horas Extra',        color: 'bg-orange-100 text-orange-800',  border: 'border-orange-200' },
    ADVANCE:      { label: 'Anticipo Salarial',  color: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-200' },
    CERTIFICATE:  { label: 'Constancia Laboral', color: 'bg-blue-100 text-blue-800',      border: 'border-blue-200' },
    DISABILITY:             { label: 'Incapacidad',             color: 'bg-red-100 text-red-800',        border: 'border-red-200' },
    SHIFT_EXCEPTION:        { label: 'Excepción Turno (Kiosk)', color: 'bg-violet-100 text-violet-800',  border: 'border-violet-200' },
    ANNULMENT_REQUEST:      { label: 'Anulación de Factura',    color: 'bg-rose-100 text-rose-800',      border: 'border-rose-200' },
    PAYMENT_CHANGE_REQUEST: { label: 'Cambio de Forma de Pago', color: 'bg-sky-100 text-sky-800',        border: 'border-sky-200' },
    VENDOR_CHANGE_REQUEST:  { label: 'Cambio de Vendedor',      color: 'bg-purple-100 text-purple-800',  border: 'border-purple-200' },
    CLIENT_CHANGE_REQUEST:  { label: 'Cambio de Cliente',       color: 'bg-teal-100 text-teal-800',      border: 'border-teal-200' },
};

export const REQUEST_STATUS = {
    PENDING:   { label: 'Pendiente',  color: 'bg-yellow-100 text-yellow-700',  border: 'border-yellow-200',  dot: 'bg-yellow-400' },
    APPROVED:  { label: 'Aprobada',   color: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
    REJECTED:  { label: 'Rechazada',  color: 'bg-red-100 text-red-700',        border: 'border-red-200',     dot: 'bg-red-500' },
    CANCELLED: { label: 'Cancelada',  color: 'bg-slate-100 text-slate-500',    border: 'border-slate-200',   dot: 'bg-slate-400' },
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
    const today = new Date().toISOString().split('T')[0];
    try {
        const { data: events, error } = await fetchEmployeeAvailabilityEvents(employeeId);
        if (error) console.error('isUnavailable: fetch employee_events failed:', error.message);

        if (!events?.length) return false;

        return events.some(ev => {
            const meta = parseMeta(ev.metadata);
            if (meta?.status === 'CANCELLED' || meta?.status === 'SUPERSEDED') return false;
            return !meta?.endDate || meta.endDate >= today;
        });
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
                // El compañero debe enterarse YA de que su aprobación está pendiente
                await notifyEmployees([String(payload.targetEmployeeId)], {
                    type: 'REQUEST_PENDING',
                    title: 'Cambio de turno propuesto',
                    body: `${enrichedPeer.employee?.name || 'Un compañero'} te propone un cambio de turno${payload.date ? ` para el ${payload.date}` : ''}. Requiere tu aprobación.`,
                    link: '/my-requests',
                    push: true,
                });
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

            // Notificar al aprobador designado — antes nadie se enteraba
            if (approverId) {
                await notifyEmployees([String(approverId)], {
                    type: 'REQUEST_PENDING',
                    title: 'Nueva solicitud pendiente',
                    body: `Solicitud de ${REQUEST_TYPES[type]?.label || type} de ${enriched.employee?.name || 'un empleado'} espera tu decisión.`,
                    link: '/requests',
                    push: true,
                });
            }

            return enriched;
        } catch (err) {
            console.error('createRequest error:', err);
            return null;
        }
    },

    // ── Approve ────────────────────────────────────────────────────────────

    // Helper interno: ejecuta todos los efectos de una aprobación final en un solo lugar.
    // Cualquier lógica nueva por tipo (OVERTIME, ADVANCE, etc.) se agrega aquí.
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

            const registerEmployeeEvent = get().registerEmployeeEvent;
            if (registerEmployeeEvent) {
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

    approveRequest: async (requestId, approverId, approverNote = '', _reqOverride = null) => {
        try {
            const req = _reqOverride || get().requests.find(r => r.id === requestId);
            if (!req) return false;

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

            const maxLevels = req.type === 'SHIFT_CHANGE' ? 2 : req.type === 'DISABILITY' ? 1 : 3;

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
