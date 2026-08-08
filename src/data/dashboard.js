// Bloque 6.A — capa de datos, entidad "dashboard" (widgets/preferencias
// del tablero principal). Extraído de DashboardView.jsx: 9 llamadas
// supabase.from().
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export function fetchUserDashboardPrefs(userId) {
    return supabase.from('user_dashboard_prefs')
        .select('layout, sizes, widgets, mobile_layout, mobile_sizes')
        .eq('user_id', userId)
        .maybeSingle();
}

export function upsertUserDashboardPrefs(payload) {
    return supabase.from('user_dashboard_prefs').upsert(payload, { onConflict: 'user_id' });
}

// ─── Canon del tablero — el acomodo publicado de las pestañas temáticas ──────
//
// Tres filas como mucho (`comercial`, `rrhh`, `operacion`; el CHECK de la tabla
// no admite otra), así que no hay nada que paginar.
export function fetchDashboardCanon() {
    return supabase.from('dashboard_canon').select('tab_id, orden, medidas, updated_at');
}

// El payload NO lleva `updated_at` ni `updated_by`: los sella el trigger
// `dashboard_canon_sellar` con el reloj y la identidad del servidor. Mandarlos
// desde acá sería ofrecerle al cliente que firme por otro.
export function upsertDashboardCanon({ tabId, orden, medidas }) {
    return supabase.from('dashboard_canon')
        .upsert({ tab_id: tabId, orden, medidas }, { onConflict: 'tab_id' });
}

export function fetchUserTheme(userId) {
    return supabase.from('user_dashboard_prefs')
        .select('theme')
        .eq('user_id', userId)
        .maybeSingle();
}

export function upsertUserTheme(userId, theme) {
    return supabase.from('user_dashboard_prefs').upsert({ user_id: userId, theme }, { onConflict: 'user_id' });
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

// Paginado desde el 2026-07-28. Medido: el dia mas cargado de los ultimos 120
// tuvo **865 facturas** — el 86% del cap de 1000 de PostgREST. No estaba roto,
// pero un feriado o una sucursal mas y el corte llegaba sin aviso: el widget
// cuenta `rows.length` y suma `total`, asi que se habrian falseado LAS DOS
// cifras, hacia abajo y sin error.
export function fetchTodayInvoicesSummary(dateStr) {
    return fetchAllRows(() => supabase.from('sales_invoices')
        .select('id, tipo_documento, total')
        .eq('fecha', dateStr)
        .neq('estado', 'NULA'));
}
