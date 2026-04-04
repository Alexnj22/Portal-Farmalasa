import { supabase } from '../../supabaseClient';

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
 * Resuelve el aprobador designado para una solicitud siguiendo la jerarquía:
 * 1. Empleados con el rol padre (parent_role_id) en la misma sucursal, activos y disponibles
 * 2. Empleados con el rol padre secundario (secondary_parent_role_id)
 * 3. Cualquier admin activo en la misma sucursal
 * Retorna el UUID del aprobador o null si no se encuentra ninguno.
 */
const resolveApprover = async (employeeId, branchId, roleId) => {
    try {
        // Obtener roles padre del cargo del empleado
        const { data: role } = await supabase
            .from('roles')
            .select('parent_role_id, secondary_parent_role_id')
            .eq('id', roleId)
            .single();

        if (!role) return null;

        // Buscar empleados activos con un rol dado en la misma sucursal
        const findCandidates = async (targetRoleId) => {
            const { data } = await supabase
                .from('employees')
                .select('id')
                .eq('role_id', targetRoleId)
                .eq('branch_id', branchId)
                .eq('status', 'ACTIVO')
                .neq('id', employeeId);
            return data || [];
        };

        // Nivel 1: parent_role_id
        if (role.parent_role_id) {
            const candidates = await findCandidates(role.parent_role_id);
            for (const c of candidates) {
                if (!(await isUnavailable(c.id))) return c.id;
            }
        }

        // Nivel 2: secondary_parent_role_id
        if (role.secondary_parent_role_id) {
            const candidates = await findCandidates(role.secondary_parent_role_id);
            for (const c of candidates) {
                if (!(await isUnavailable(c.id))) return c.id;
            }
        }

        // Nivel 3: cualquier admin activo en la sucursal
        const { data: admins } = await supabase
            .from('employees')
            .select('id')
            .eq('branch_id', branchId)
            .eq('is_admin', true)
            .eq('status', 'ACTIVO')
            .neq('id', employeeId);

        return admins?.[0]?.id || null;
    } catch (err) {
        console.error('Error resolviendo aprobador:', err);
        return null;
    }
};

/**
 * Crea un anuncio interno dirigido al empleado notificándole el resultado
 * de su solicitud. No lanza error si falla — la notificación es no-bloqueante.
 */
const notifyEmployee = async (employeeId, approverId, requestType, status, approverNote) => {
    try {
        const typeLabel = REQUEST_TYPES[requestType]?.label || requestType;
        const isApproved = status === 'APPROVED';

        await supabase.from('announcements').insert([{
            title: isApproved ? 'Solicitud Aprobada' : 'Solicitud Rechazada',
            message: isApproved
                ? `Tu solicitud de ${typeLabel} fue aprobada.${approverNote ? ` Nota del aprobador: "${approverNote}"` : ''}`
                : `Tu solicitud de ${typeLabel} fue rechazada.${approverNote ? ` Motivo: "${approverNote}"` : ''}`,
            target_type: 'EMPLOYEE',
            target_value: [String(employeeId)],
            read_by: [],
            is_archived: false,
            created_by: approverId,
            priority: isApproved ? 'NORMAL' : 'HIGH',
        }]);
    } catch (err) {
        console.error('Error enviando notificación al empleado:', err);
        // No-fatal: no interrumpir el flujo principal
    }
};

// ── Slice ───────────────────────────────────────────────────────────────────

const SELECT_FIELDS = `
    id, type, status, note, metadata,
    approver_note, created_at, updated_at,
    employee:employee_id ( id, name, code, role_id, branch_id ),
    approver:approver_id ( id, name, code )
`;

export const createRequestsSlice = (set, get) => ({
    // ── State ──────────────────────────────────────────────────────────────
    requests: [],
    isLoadingRequests: false,

    // ── Fetch ──────────────────────────────────────────────────────────────
    fetchRequests: async (employeeId = null) => {
        set({ isLoadingRequests: true });
        try {
            let query = supabase
                .from('approval_requests')
                .select(SELECT_FIELDS)
                .order('created_at', { ascending: false });

            if (employeeId) query = query.eq('employee_id', employeeId);

            const { data, error } = await query;
            if (error) throw error;

            set({ requests: data || [] });
        } catch (err) {
            console.error('Error cargando solicitudes:', err);
        } finally {
            set({ isLoadingRequests: false });
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

            const approverId = emp
                ? await resolveApprover(employeeId, emp.branch_id, emp.role_id)
                : null;

            const { data, error } = await supabase
                .from('approval_requests')
                .insert([{
                    employee_id: employeeId,
                    approver_id: approverId,
                    type,
                    status: 'PENDING',
                    note,
                    metadata: payload,
                }])
                .select(SELECT_FIELDS)
                .single();

            if (error) throw error;

            set((state) => ({ requests: [data, ...state.requests] }));

            await get().appendAuditLog('SOLICITUD_CREADA', employeeId, {
                dimension: 'HR',
                new_value: `Solicitud de ${REQUEST_TYPES[type]?.label || type}`,
            });

            return data;
        } catch (err) {
            console.error('createRequest error:', err);
            return null;
        }
    },

    // ── Approve ────────────────────────────────────────────────────────────
    approveRequest: async (requestId, approverId, approverNote = '') => {
        try {
            // Obtener el employeeId antes de actualizar (para la notificación)
            const req = get().requests.find(r => r.id === requestId);

            const { error } = await supabase
                .from('approval_requests')
                .update({
                    status: 'APPROVED',
                    approver_id: approverId,
                    approver_note: approverNote,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', requestId);

            if (error) throw error;

            set((state) => ({
                requests: state.requests.map(r =>
                    r.id === requestId
                        ? { ...r, status: 'APPROVED', approver_note: approverNote }
                        : r
                ),
            }));

            // Notificar al empleado via anuncio interno
            if (req?.employee?.id) {
                await notifyEmployee(req.employee.id, approverId, req.type, 'APPROVED', approverNote);
            }

            return true;
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
                await notifyEmployee(req.employee.id, approverId, req.type, 'REJECTED', approverNote);
            }

            return true;
        } catch (err) {
            console.error('Error rechazando solicitud:', err);
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
