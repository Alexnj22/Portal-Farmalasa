import { supabase } from '../../supabaseClient';
import { useToastStore } from '../toastStore';

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
    DISABILITY:   { label: 'Incapacidad',        color: 'bg-red-100 text-red-800',        border: 'border-red-200' },
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
        const { data: events } = await supabase
            .from('employee_events')
            .select('date, metadata')
            .eq('employee_id', employeeId)
            .in('type', ['VACATION', 'DISABILITY'])
            .lte('date', today);

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
        const { data: allRoles } = await supabase
            .from('roles')
            .select('id, name, parent_role_id, secondary_parent_role_id');

        if (!allRoles) return null;
        const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r]));

        const findAvailableInRole = async (targetRoleId) => {
            const { data } = await supabase
                .from('employees')
                .select('id')
                .eq('role_id', targetRoleId)
                .eq('branch_id', branchId)
                .eq('status', 'ACTIVO')
                .neq('id', employeeId);

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
        const { data: admins } = await supabase
            .from('employees')
            .select('id')
            .eq('branch_id', branchId)
            .eq('is_admin', true)
            .eq('status', 'ACTIVO')
            .neq('id', employeeId);

        if (admins?.[0]?.id) return admins[0].id;

        // Último fallback: cualquier admin global
        const { data: globalAdmins } = await supabase
            .from('employees')
            .select('id')
            .eq('is_admin', true)
            .eq('status', 'ACTIVO')
            .neq('id', employeeId)
            .limit(1);

        return globalAdmins?.[0]?.id || null;
    } catch (err) {
        console.error('Error resolviendo aprobador:', err);
        return null;
    }
};

const resolveNextApprover = async (level, branchId, excludeId = null) => {
    try {
        const findBySystemRole = async (roles, sameBranch = false) => {
            for (const role of roles) {
                let q = supabase.from('employees')
                    .select('id')
                    .eq('system_role', role)
                    .eq('status', 'ACTIVO');
                if (sameBranch && branchId) q = q.eq('branch_id', branchId);
                if (excludeId) q = q.neq('id', excludeId);
                const { data } = await q;
                for (const c of (data || [])) {
                    if (!(await isUnavailable(c.id))) return c.id;
                }
            }
            return null;
        };

        // Resuelve role IDs por nombre (ilike) para evitar IDs hardcodeados
        const findByRoleName = async (namePattern, sameBranch = false) => {
            const { data: matchedRoles } = await supabase
                .from('roles').select('id').ilike('name', `%${namePattern}%`);
            const roleIds = (matchedRoles || []).map(r => r.id);
            if (!roleIds.length) return null;
            for (const roleId of roleIds) {
                let q = supabase.from('employees')
                    .select('id')
                    .eq('role_id', roleId)
                    .eq('status', 'ACTIVO');
                if (sameBranch && branchId) q = q.eq('branch_id', branchId);
                if (excludeId) q = q.neq('id', excludeId);
                const { data } = await q;
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
            return await findByRoleName('Talento Humano')
                || await findByRoleName('RRHH')
                || await findBySystemRole(['ADMIN'])
                || await findBySystemRole(['SUPERADMIN'])
                || (await supabase.from('employees')
                    .select('id')
                    .eq('is_admin', true)
                    .eq('status', 'ACTIVO')
                    .limit(1)).data?.[0]?.id
                || null;
        }

        return null;
    } catch { return null; }
};

/**
 * Crea un anuncio interno dirigido al empleado notificándole el resultado
 * de su solicitud. No lanza error si falla — la notificación es no-bloqueante.
 */
const notifyEmployee = async (employeeId, approverId, requestType, status, approverNote, reqMetadata = {}) => {
    try {
        const typeLabel = REQUEST_TYPES[requestType]?.label || requestType;
        const isApproved = status === 'APPROVED';
        const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' }) : null;

        await supabase.from('announcements').insert([{
            title: isApproved ? `${typeLabel} aprobada` : `${typeLabel} rechazada`,
            message: isApproved
                ? `Tu solicitud de ${typeLabel} fue aprobada.${approverNote ? ` Nota: "${approverNote}"` : ''}`
                : `Tu solicitud de ${typeLabel} fue rechazada.${approverNote ? ` Motivo: "${approverNote}"` : ''}`,
            target_type: 'EMPLOYEE',
            target_value: [String(employeeId)],
            read_by: [],
            is_archived: false,
            created_by: approverId,
            priority: isApproved ? 'NORMAL' : 'HIGH',
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
        }]);
    } catch (err) {
        console.error('Error enviando notificación al empleado:', err);
    }
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
            const dayId   = d.getDay(); // 0=Dom, 1=Lun … 6=Sab
            if (!weekMap[weekKey]) weekMap[weekKey] = [];
            weekMap[weekKey].push(dayId);
        }

        for (const [weekStart, dayIds] of Object.entries(weekMap)) {
            const { data: roster } = await supabase
                .from('employee_rosters')
                .select('schedule_data')
                .eq('employee_id', employeeId)
                .eq('week_start_date', weekStart)
                .maybeSingle();

            const raw = roster?.schedule_data || {};
            const sched = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...raw };

            for (const dayId of dayIds) {
                sched[dayId] = { shiftId: 'LIBRE', note: 'Incapacidad' };
            }

            await supabase.from('employee_rosters').upsert(
                { employee_id: employeeId, week_start_date: weekStart, schedule_data: sched },
                { onConflict: 'employee_id, week_start_date' }
            );
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
            const weekKey = getMondayISO(d.toISOString().split('T')[0]);
            const dayId   = d.getDay();
            if (!weekMap[weekKey]) weekMap[weekKey] = [];
            weekMap[weekKey].push(dayId);
        }
        for (const [weekStart, dayIds] of Object.entries(weekMap)) {
            const { data: roster } = await supabase
                .from('employee_rosters').select('schedule_data')
                .eq('employee_id', employeeId).eq('week_start_date', weekStart).maybeSingle();
            const raw = roster?.schedule_data || {};
            const sched = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...raw };
            for (const dayId of dayIds) {
                sched[dayId] = { shiftId: 'LIBRE', note: 'Vacaciones' };
            }
            await supabase.from('employee_rosters').upsert(
                { employee_id: employeeId, week_start_date: weekStart, schedule_data: sched },
                { onConflict: 'employee_id, week_start_date' }
            );
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

        const { data: branchEmps } = await supabase
            .from('employees')
            .select('id')
            .eq('branch_id', branchId)
            .eq('status', 'ACTIVO')
            .neq('id', employeeId);

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
            const { data: rosters } = await supabase
                .from('employee_rosters')
                .select('employee_id, schedule_data')
                .eq('week_start_date', weekStart)
                .in('employee_id', branchEmpIds);

            const weekStartDate = new Date(weekStart + 'T00:00:00');
            for (let offset = 0; offset < 7; offset++) {
                const checkD = new Date(weekStartDate);
                checkD.setDate(weekStartDate.getDate() + offset);
                const dateISO = checkD.toISOString().split('T')[0];
                if (dateISO < startDate || dateISO > endDate) continue;

                const dayId = checkD.getDay();
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

        await supabase.from('announcements').insert([{
            title: 'Cobertura de Horario Reducida',
            message: `La incapacidad de ${employeeName} (${fmtD(startDate)}–${fmtD(endDate)}) deja la sucursal con solo ${count} colaborador${count !== 1 ? 'es' : ''} disponible${count !== 1 ? 's' : ''}. Revisa el horario y ajusta según sea necesario.`,
            target_type: 'EMPLOYEE',
            target_value: [String(thId)],
            read_by: [],
            is_archived: false,
            created_by: approverId,
            priority: 'HIGH',
        }]);
    } catch (err) {
        console.error('Error enviando alerta de cobertura:', err);
    }
};

// ── Slice ───────────────────────────────────────────────────────────────────

const SIMPLE_SELECT = 'id, type, status, note, metadata, approver_note, created_at, updated_at, employee_id, approver_id, current_level, approvals';

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
                const { data: branchEmps } = await supabase
                    .from('employees')
                    .select('id')
                    .eq('branch_id', branchId)
                    .eq('status', 'ACTIVO');
                branchEmpIds = (branchEmps || []).map(e => e.id);
            }

            // 1. Fetch solicitudes sin joins
            let query = supabase
                .from('approval_requests')
                .select(SIMPLE_SELECT)
                .order('created_at', { ascending: false });

            if (employeeId) query = query.eq('employee_id', employeeId);
            if (branchEmpIds && branchEmpIds.length > 0) query = query.in('employee_id', branchEmpIds);
            if (approverId) query = query.eq('approver_id', approverId);

            const { data: requests, error } = await query;
            if (error) throw error;

            // 2. IDs únicos de empleados y aprobadores
            const empIds = [...new Set([
                ...(requests || []).map(r => r.employee_id),
                ...(requests || []).map(r => r.approver_id).filter(Boolean),
            ])];

            // 3. Fetch empleados por IDs
            let empRows = [];
            if (empIds.length > 0) {
                const { data } = await supabase
                    .from('employees')
                    .select('id, name, code, role_id, branch_id, system_role')
                    .in('id', empIds);
                empRows = data || [];
            }

            // 4. Combinar en memoria
            const empMap = Object.fromEntries(empRows.map(e => [e.id, e]));

            // 4b. Fetch adicional para aprobadores que no estén en empMap
            const missingIds = [...new Set(
                (requests || []).map(r => r.approver_id).filter(id => id && !empMap[id])
            )];
            if (missingIds.length > 0) {
                const { data: extra } = await supabase
                    .from('employees')
                    .select('id, name, code, role_id, branch_id, system_role')
                    .in('id', missingIds);
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
            const { data: emp } = await supabase
                .from('employees')
                .select('role_id, branch_id')
                .eq('id', employeeId)
                .single();

            // SHIFT_CHANGE: enrutar directamente al compañero para aprobación de par
            if (type === 'SHIFT_CHANGE' && payload.targetEmployeeId) {
                const { data: peerEmp } = await supabase
                    .from('employees').select('name').eq('id', payload.targetEmployeeId).single();

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
                const { data: peerData, error: peerError } = await supabase
                    .from('approval_requests')
                    .insert([{
                        employee_id: employeeId,
                        approver_id: payload.targetEmployeeId,
                        type,
                        status: 'PENDING',
                        note,
                        metadata: enrichedPayload,
                        current_level: 1,
                    }])
                    .select(SIMPLE_SELECT)
                    .single();
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
                return enrichedPeer;
            }

            // DISABILITY: va directamente a Talento Humano, sin pasar por la jerarquía intermedia
            const approverId = emp
                ? (type === 'DISABILITY'
                    ? await resolveNextApprover(3, emp.branch_id, employeeId)
                    : await resolveApprover(employeeId, emp.branch_id, emp.role_id))
                : null;

            const finalMetadata = type === 'DISABILITY'
                ? { ...payload, priority: 'URGENT' }
                : payload;

            const { data, error } = await supabase
                .from('approval_requests')
                .insert([{
                    employee_id: employeeId,
                    approver_id: approverId,
                    type,
                    status: 'PENDING',
                    note,
                    metadata: finalMetadata,
                }])
                .select(SIMPLE_SELECT)
                .single();

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
        const { error } = await supabase
            .from('approval_requests')
            .update({ status: 'APPROVED', approver_id: approverId, approver_note: approverNote, approvals: newApprovals, updated_at: new Date().toISOString() })
            .eq('id', requestId);
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
                }).catch(() => {});

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
                const { data: peerEmp } = await supabase.from('employees').select('system_role').eq('id', approverId).single();
                const peerIsJefe = ['JEFE', 'SUBJEFE'].includes(peerEmp?.system_role);
                const nextApprover = peerIsJefe ? null : await resolveNextApprover('JEFE_SUCURSAL', req.employee?.branch_id, approverId);

                if (!nextApprover) {
                    return await get()._runFinalApproval(requestId, req, approverId, approverNote, newApprovals,
                        peerIsJefe ? 'Cambio de turno aprobado.' : 'Aprobado (sin jefe disponible en sucursal).');
                }

                // Avanzar a nivel 2 → jefe de sucursal
                const { error: adv } = await supabase.from('approval_requests')
                    .update({ current_level: 2, approver_id: nextApprover, approvals: newApprovals, updated_at: new Date().toISOString() })
                    .eq('id', requestId);
                if (adv) throw adv;

                set(state => ({
                    requests: state.requests.map(r =>
                        r.id === requestId ? { ...r, current_level: 2, approver_id: nextApprover, approvals: newApprovals } : r
                    ),
                }));
                await supabase.from('announcements').insert([{
                    title: 'Nueva Solicitud Pendiente',
                    message: `Cambio de turno de ${req.employee?.name} aprobado por el compañero — requiere tu aprobación final`,
                    target_type: 'EMPLOYEE', target_value: [String(nextApprover)],
                    read_by: [], is_archived: false, created_by: approverId, priority: 'HIGH',
                }]);
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

                const { error } = await supabase.from('approval_requests')
                    .update({ current_level: nextLevel, approver_id: nextApprover, approvals: newApprovals, updated_at: new Date().toISOString() })
                    .eq('id', requestId);
                if (error) throw error;

                set(state => ({
                    requests: state.requests.map(r =>
                        r.id === requestId ? { ...r, current_level: nextLevel, approver_id: nextApprover, approvals: newApprovals } : r
                    ),
                }));
                await supabase.from('announcements').insert([{
                    title: 'Nueva Solicitud Pendiente',
                    message: `Solicitud de ${REQUEST_TYPES[req.type]?.label} de ${req.employee?.name} — Nivel ${nextLevel} de ${maxLevels}`,
                    target_type: 'EMPLOYEE', target_value: [String(nextApprover)],
                    read_by: [], is_archived: false, created_by: approverId, priority: 'HIGH',
                }]);
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

            const { error } = await supabase
                .from('approval_requests')
                .update({
                    status: 'REJECTED',
                    approver_id: approverId,
                    approver_note: approverNote,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', requestId);

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
            const { data: reqData } = await supabase
                .from('approval_requests')
                .select(SIMPLE_SELECT)
                .eq('id', requestId)
                .single();
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
            const { data: reqData } = await supabase
                .from('approval_requests')
                .select(SIMPLE_SELECT)
                .eq('id', requestId)
                .single();
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
            const { error } = await supabase
                .from('approval_requests')
                .update({
                    status: 'CANCELLED',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', requestId);

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
