// Bloque 6.A — capa de datos, entidad "dashboard" (widgets/preferencias
// del tablero principal). Extraído de DashboardView.jsx: 9 llamadas
// supabase.from().
import { supabase } from '../supabaseClient';

export function fetchUserDashboardPrefs(userId) {
    return supabase.from('user_dashboard_prefs')
        .select('layout, sizes, widgets, mobile_layout, mobile_sizes')
        .eq('user_id', userId)
        .maybeSingle();
}

export function upsertUserDashboardPrefs(payload) {
    return supabase.from('user_dashboard_prefs').upsert(payload, { onConflict: 'user_id' });
}

export function fetchSalesBranchIdsSince(sinceDateStr) {
    return supabase.from('branch_hourly_sales').select('branch_id').gte('sale_date', sinceDateStr);
}

export function fetchPendingApprovalRequests() {
    return supabase.from('approval_requests')
        .select('id, type, employee_id, metadata, created_at')
        .eq('status', 'PENDING').order('created_at', { ascending: false }).limit(8);
}

export function fetchActiveLeaveRequests() {
    return supabase.from('approval_requests')
        .select('id, type, employee_id, metadata')
        .eq('status', 'APPROVED').in('type', ['VACATION', 'DISABILITY', 'PERMIT']);
}

export function fetchTodayHourlySales(dateStr) {
    return supabase.from('branch_hourly_sales')
        .select('branch_id, sale_hour, transaction_count, total_sales')
        .eq('sale_date', dateStr);
}

export function fetchBranchHourlySalesRange(branchId, sinceDateStr) {
    return supabase.from('branch_hourly_sales')
        .select('sale_hour, transaction_count, sale_date')
        .eq('branch_id', branchId).gte('sale_date', sinceDateStr);
}

export function fetchRecentCotizaciones(sinceDateStr) {
    return supabase.from('cotizaciones')
        .select('id, numero, fecha, customer_name, total, status')
        .gte('fecha', sinceDateStr)
        .order('fecha', { ascending: false })
        .limit(50);
}

export function fetchTodayInvoicesSummary(dateStr) {
    return supabase.from('sales_invoices')
        .select('id, tipo_documento, total')
        .eq('fecha', dateStr)
        .neq('estado', 'NULA');
}
