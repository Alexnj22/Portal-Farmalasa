// Bloque 6.A — capa de datos, entidad "branches" (sucursales, kioscos,
// gastos, documentos, historial). Extraído de branchSlice.js: 15
// llamadas supabase.from() (los supabase.storage.from() de subida de
// documentos quedan fuera — acceso a bucket, no a tabla).
// Lo escrito sobre este módulo:
// `docs/SUCURSALES-EL-EXPEDIENTE-DE-CADA-SALA-2026-08-24.md` — las TRES
// numeraciones que tiene cada sala y por qué la equivocada no da error, por qué
// los documentos se versionan en vez de pisarse, y de dónde sale el personal
// mínimo.
import { supabase } from '../supabaseClient';

// ── Sucursal ─────────────────────────────────────────────────────────────────

export function insertBranch(dbPayload) {
    return supabase.from('branches').insert([dbPayload]).select().single();
}

export function updateBranch(branchId, patch) {
    return supabase.from('branches').update(patch).eq('id', branchId);
}

export function updateBranchReturning(branchId, patch) {
    return supabase.from('branches').update(patch).eq('id', branchId).select().single();
}

export function deleteBranch(branchId) {
    return supabase.from('branches').delete().eq('id', branchId);
}

// ── Documentos / historial ───────────────────────────────────────────────────

export function insertBranchDocument(payload) {
    return supabase.from('branch_documents').insert([payload]);
}

export function fetchBranchDocuments(branchId) {
    return supabase.from('branch_documents').select('*').eq('branch_id', branchId).order('created_at', { ascending: false });
}

// Por RPC y no leyendo `audit_logs`: la bitácora entera no puede estar abierta
// para que esta vista muestre el historial de UNA sucursal. El filtro va del
// lado del servidor, junto con el permiso.
export function fetchAuditLogsForBranch(branchId) {
    return supabase.rpc('audit_log_de_sucursal', { p_branch_id: String(branchId) });
}

// ── Kioscos ──────────────────────────────────────────────────────────────────

export function fetchActiveKioskDeviceCount(branchId) {
    return supabase.from('kiosk_devices').select('*', { count: 'exact', head: true })
        .eq('branch_id', branchId).eq('status', 'ACTIVE');
}

export function insertKioskDevice(payload) {
    return supabase.from('kiosk_devices').insert([payload]).select().single();
}

export function updateKioskDevice(deviceId, patch) {
    return supabase.from('kiosk_devices').update(patch).eq('id', deviceId);
}

export function fetchBranchKiosks(branchId) {
    return supabase.from('kiosk_devices').select('*').eq('branch_id', branchId);
}

// ── Gastos de sucursal ───────────────────────────────────────────────────────

export function fetchBranchExpenseRecord(branchId, expenseType, billingMonth) {
    return supabase.from('branch_expenses').select('id')
        .eq('branch_id', branchId).eq('expense_type', expenseType).eq('billing_month', billingMonth).maybeSingle();
}

export function updateBranchExpense(expenseId, patch) {
    return supabase.from('branch_expenses').update(patch).eq('id', expenseId);
}

export function insertBranchExpense(payload) {
    return supabase.from('branch_expenses').insert([payload]);
}

// ── TabExpenses.jsx (gráfica de tendencia — últimos pagos) ─────────────────

export function fetchBranchExpensesHistory(branchId) {
    return supabase.from('branch_expenses')
        .select('billing_month, amount, expense_type')
        .eq('branch_id', branchId)
        .eq('status', 'PAGADO')
        .order('billing_month', { ascending: true })
        .limit(100);
}
