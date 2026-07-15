// Bloque 6.A — capa de datos, entidad "vacationPlans" (plan anual de
// vacaciones). Extraído de vacationPlanSlice.js: 14 llamadas
// supabase.from(). El update de approval_requests reutiliza
// updateApprovalRequest de data/requests.js (mismo query exacto).
import { supabase } from '../supabaseClient';

export function fetchVacationHeaders() {
    return supabase.from('vacation_plan_headers')
        .select('id, year, status, ai_generated, notes, created_at, updated_at')
        .order('year', { ascending: false });
}

export function updateVacationHeaderStatus(headerId, status) {
    return supabase.from('vacation_plan_headers')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', headerId);
}

export function updateVacationPlansBulkPreApprove(headerId) {
    return supabase.from('vacation_plans')
        .update({ status: 'PRE_APPROVED', updated_at: new Date().toISOString() })
        .eq('plan_header_id', headerId)
        .eq('status', 'DRAFT');
}

export function fetchVacationChangeRequests() {
    return supabase.from('approval_requests')
        .select('id, employee_id, status, note, approver_note, metadata, created_at')
        .eq('type', 'VACATION_CHANGE')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false });
}

export function updateVacationPlan(planId, patch, returning = false) {
    const q = supabase.from('vacation_plans').update(patch).eq('id', planId);
    return returning ? q.select().single() : q;
}

export function fetchVacationPlans(year, branchId) {
    let q = supabase.from('vacation_plans')
        .select('id, year, plan_header_id, employee_id, branch_id, start_date, end_date, days, status, notes, metadata, change_requested_start, change_requested_end, created_at')
        .eq('year', year)
        .order('start_date', { ascending: true });
    if (branchId) q = q.eq('branch_id', branchId);
    return q;
}

export function fetchOverlappingVacationPlans(branchId, year) {
    return supabase.from('vacation_plans')
        .select('id, employee_id, start_date, end_date')
        .eq('branch_id', branchId)
        .eq('year', year)
        .neq('status', 'CANCELLED');
}

export function insertVacationPlan(payload) {
    return supabase.from('vacation_plans').insert([payload]).select().single();
}
