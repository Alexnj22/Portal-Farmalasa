import { supabase } from '../../supabaseClient';

// ============================================================================
// 📋 SOLICITUDES — Employee-initiated requests requiring admin approval
// ============================================================================

export const REQUEST_TYPES = {
    VACATION:      { label: 'Vacaciones',          color: 'bg-amber-100 text-amber-800',   border: 'border-amber-200' },
    PERMIT:        { label: 'Permiso / Licencia',  color: 'bg-purple-100 text-purple-800', border: 'border-purple-200' },
    SHIFT_CHANGE:  { label: 'Cambio de Turno',     color: 'bg-cyan-100 text-cyan-800',     border: 'border-cyan-200' },
    OVERTIME:      { label: 'Horas Extra',         color: 'bg-orange-100 text-orange-800', border: 'border-orange-200' },
    ADVANCE:       { label: 'Anticipo Salarial',   color: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-200' },
    CERTIFICATE:   { label: 'Constancia Laboral',  color: 'bg-blue-100 text-blue-800',     border: 'border-blue-200' },
};

export const REQUEST_STATUS = {
    PENDING:   { label: 'Pendiente',  color: 'bg-yellow-100 text-yellow-700', border: 'border-yellow-200', dot: 'bg-yellow-400' },
    APPROVED:  { label: 'Aprobada',   color: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
    REJECTED:  { label: 'Rechazada',  color: 'bg-red-100 text-red-700',      border: 'border-red-200',     dot: 'bg-red-500' },
    CANCELLED: { label: 'Cancelada',  color: 'bg-slate-100 text-slate-500',  border: 'border-slate-200',   dot: 'bg-slate-400' },
};

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
                .select(`
                    id, type, status, note, metadata,
                    approver_note, created_at, updated_at,
                    employee:employees!approval_requests_employee_id_fkey ( id, name, code, role_id, branch_id ),
                    approver:employees!approval_requests_approver_id_fkey ( id, name, code )
                `)
                .order('created_at', { ascending: false });

            if (employeeId) {
                query = query.eq('employee_id', employeeId);
            }

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
    createRequest: async (employeeId, type, note, metadata = {}) => {
        try {
            const { data, error } = await supabase
                .from('approval_requests')
                .insert([{
                    employee_id: employeeId,
                    type,
                    status: 'PENDING',
                    note,
                    metadata,
                }])
                .select(`
                    id, type, status, note, metadata,
                    approver_note, created_at, updated_at,
                    employee:employees!approval_requests_employee_id_fkey ( id, name, code, role_id, branch_id ),
                    approver:employees!approval_requests_approver_id_fkey ( id, name, code )
                `)
                .single();

            if (error) throw error;

            set((state) => ({ requests: [data, ...state.requests] }));

            await get().appendAuditLog('SOLICITUD_CREADA', employeeId, {
                dimension: 'HR',
                new_value: `Solicitud de ${REQUEST_TYPES[type]?.label || type}`,
            });

            return data;
        } catch (err) {
            console.error('Error creando solicitud:', err);
            return null;
        }
    },

    // ── Approve ────────────────────────────────────────────────────────────
    approveRequest: async (requestId, approverId, approverNote = '') => {
        try {
            const { data, error } = await supabase
                .from('approval_requests')
                .update({
                    status: 'APPROVED',
                    approver_id: approverId,
                    approver_note: approverNote,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', requestId)
                .select()
                .single();

            if (error) throw error;

            set((state) => ({
                requests: state.requests.map(r =>
                    r.id === requestId ? { ...r, status: 'APPROVED', approver_note: approverNote } : r
                ),
            }));

            return true;
        } catch (err) {
            console.error('Error aprobando solicitud:', err);
            return false;
        }
    },

    // ── Reject ─────────────────────────────────────────────────────────────
    rejectRequest: async (requestId, approverId, approverNote = '') => {
        try {
            const { data, error } = await supabase
                .from('approval_requests')
                .update({
                    status: 'REJECTED',
                    approver_id: approverId,
                    approver_note: approverNote,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', requestId)
                .select()
                .single();

            if (error) throw error;

            set((state) => ({
                requests: state.requests.map(r =>
                    r.id === requestId ? { ...r, status: 'REJECTED', approver_note: approverNote } : r
                ),
            }));

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
