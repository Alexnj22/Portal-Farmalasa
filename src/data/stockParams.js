// Bloque 6.A — capa de datos, entidad "stockParams" (MIN·MAX). Extraído
// de TabMinMax.jsx: 23 llamadas supabase.from(). La inmensa mayoría son
// upserts/updates a product_stock_params con la misma clave compuesta
// (erp_product_id, erp_sucursal_id) — se consolidan en
// upsertStockParams/updateStockParams genéricos (el caller sigue
// armando el payload/patch exacto que ya armaba antes).
import { supabase } from '../supabaseClient';

const ONCONFLICT = 'erp_product_id,erp_sucursal_id';

// ── product_stock_params ─────────────────────────────────────────────────────

export function upsertStockParams(payload) {
    return supabase.from('product_stock_params').upsert(payload, { onConflict: ONCONFLICT });
}

export function upsertStockParamsBulk(rows) {
    return supabase.from('product_stock_params').upsert(rows, { onConflict: ONCONFLICT });
}

export function updateStockParams(erpProductId, erpSucursalId, patch) {
    return supabase.from('product_stock_params').update(patch)
        .eq('erp_product_id', erpProductId).eq('erp_sucursal_id', erpSucursalId);
}

export function updateStockParamsBulk(erpProductIds, erpSucursalId, patch) {
    return supabase.from('product_stock_params').update(patch)
        .in('erp_product_id', erpProductIds).eq('erp_sucursal_id', erpSucursalId);
}

export function fetchStockParams(erpProductId, erpSucursalId, columns) {
    return supabase.from('product_stock_params').select(columns)
        .eq('erp_product_id', erpProductId).eq('erp_sucursal_id', erpSucursalId).single();
}

// Polling de bodega (reemplaza postgres_changes — ver comentario en el caller)
export function fetchStockParamsUpdates(erpSucursalId, sinceIso) {
    return supabase.from('product_stock_params')
        .select('erp_product_id, min_units, max_units, manual_min, manual_max, draft_status, draft_min, draft_max, updated_at')
        .eq('erp_sucursal_id', erpSucursalId)
        .gt('updated_at', sinceIso)
        .order('updated_at', { ascending: true });
}

// ── TabSinVenta.jsx (3 sitios — productos descartados de las sugerencias) ────

export function fetchMinMaxIgnored(erpSucursalId) {
    return supabase.from('minmax_ignored').select('erp_product_id').eq('erp_sucursal_id', erpSucursalId);
}

export function upsertMinMaxIgnored(erpSucursalId, erpProductId) {
    return supabase.from('minmax_ignored').upsert(
        { erp_sucursal_id: erpSucursalId, erp_product_id: erpProductId },
        { onConflict: 'erp_sucursal_id,erp_product_id' }
    );
}

export function deleteMinMaxIgnored(erpSucursalId, erpProductId) {
    return supabase.from('minmax_ignored')
        .delete()
        .eq('erp_sucursal_id', erpSucursalId)
        .eq('erp_product_id', erpProductId);
}

// ── Config / empleado / historial ────────────────────────────────────────────

export function fetchStockConfig() {
    return supabase.from('stock_config').select('analysis_days,approaching_pct').eq('id', 1).single();
}

export function fetchEmployeeByEmail(email) {
    return supabase.from('employees').select('id,name,photo_url').eq('email', email).maybeSingle();
}

export function fetchEmployeesBasic() {
    return supabase.from('employees').select('name,photo_url');
}

export function fetchAuditLogsForProduct(actions, erpProductId, erpSucursalId) {
    return supabase.from('audit_logs')
        .select('id,user_name,user_id,action,details,created_at')
        .in('action', actions)
        .eq('target_id', String(erpProductId))
        .or(`details->>sucursal_id.eq.${erpSucursalId},action.eq.MINMAX_ZERO_ALL_BRANCHES`)
        .order('created_at', { ascending: false })
        .limit(80);
}

// ── MinMaxView.jsx (2 sitios) ─────────────────────────────────────────────────

export function fetchStockConfigFull() {
    return supabase.from('stock_config').select('*').eq('id', 1).maybeSingle();
}

// ── ConfigPanel.jsx (guardar configuración Min/Max) ─────────────────────────

export function updateStockConfig(payload) {
    return supabase.from('stock_config').update(payload).eq('id', 1);
}

export function fetchErpSucursalIdForBranchLocked(branchId) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id').eq('branch_id', branchId).maybeSingle();
}

// ── ItemSections.jsx (1 de sus 2 sitios; el otro reutiliza updateStockParams) ─

export function fetchStockParamsForRevision(productIds, sucursalIds) {
    return supabase.from('product_stock_params')
        .select('erp_product_id, erp_sucursal_id, units_sold_6m, daily_velocity, min_units, max_units, manual_min, manual_max, abc_class')
        .in('erp_product_id', productIds)
        .in('erp_sucursal_id', sucursalIds);
}

// ── ExpandedPanel.jsx (2 sitios) ──────────────────────────────────────────────

export function fetchStockParamsHistory(erpProductId, erpSucursalId) {
    return supabase.from('product_stock_params_history')
        .select('captured_at, min_units, max_units, daily_velocity, velocity_30d, abc_class, demand_variability')
        .eq('erp_product_id', erpProductId)
        .eq('erp_sucursal_id', erpSucursalId)
        .order('captured_at', { ascending: false })
        .limit(5);
}

export function fetchProductCostHistory(erpProductId) {
    return supabase.from('product_cost_history')
        .select('fecha, proveedor, precio_unitario, cantidad, lote, fecha_vencimiento')
        .eq('erp_product_id', erpProductId)
        .order('fecha', { ascending: false })
        .limit(6);
}
