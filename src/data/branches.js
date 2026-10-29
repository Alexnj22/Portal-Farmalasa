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
import { correrMes, mesSV } from '../utils/fecha';

// ── Sucursal ─────────────────────────────────────────────────────────────────

export function insertBranch(dbPayload) {
    return supabase.from('branches').insert([dbPayload]).select().single();
}

export function updateBranch(branchId, patch) {
    return supabase.from('branches').update(patch).eq('id', branchId);
}

// La fila VIVA, para comparar contra lo que hay en la base y no contra la copia
// en memoria (que puede tener horas): de ahí salen el documento a archivar y
// lo que se anota en la bitácora.
export function fetchBranchRow(branchId) {
    return supabase.from('branches').select('*').eq('id', branchId).single();
}

/**
 * Aplica SÓLO lo que cambió sobre la fila viva, bloqueada, en una sentencia
 * (`editar_sucursal`). `parches` = `[{ ruta: ['legal','srsPermitUrl'], valor }]`
 * dentro de `settings`; `columnas` = las columnas propias que cambiaron.
 * Devuelve `{ data: { antes, despues }, error }`.
 */
export function editarSucursal(branchId, columnas, parches) {
    return supabase.rpc('editar_sucursal', { p_id: Number(branchId), p_columnas: columnas || {}, p_parches: parches || [] });
}

export function deleteBranch(branchId) {
    return supabase.from('branches').delete().eq('id', branchId);
}

// ── Documentos / historial ───────────────────────────────────────────────────

// Acepta una fila o varias: varias van en UN solo INSERT, que entra entero o
// no entra (lo usa `updateBranch` para el historial de un guardado).
export function insertBranchDocument(payload) {
    return supabase.from('branch_documents').insert(Array.isArray(payload) ? payload : [payload]);
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
    return supabase.from('branch_expenses').select('id, receipt_url')
        .eq('branch_id', branchId).eq('expense_type', expenseType).eq('billing_month', billingMonth).maybeSingle();
}

export function updateBranchExpense(expenseId, patch) {
    return supabase.from('branch_expenses').update(patch).eq('id', expenseId);
}

export function insertBranchExpense(payload) {
    return supabase.from('branch_expenses').insert([payload]);
}

// ── TabExpenses.jsx (gráfica de tendencia — últimos pagos) ─────────────────

/**
 * Los pagos de los últimos `meses` meses (el actual incluido), por
 * `billing_month` ('AAAA-MM', texto: compara bien como cadena).
 *
 * Antes era `order asc + limit(100)` sin filtro de fecha: el tope se aplicaba
 * ANTES de quedarse con lo reciente, así que una sala con más de 100 pagos
 * graficaba los MÁS VIEJOS y la «tendencia de los últimos 6 meses» mostraba
 * otro año. Ahora el filtro va al servidor y no hay tope: 7 meses × 6
 * servicios son ~42 filas, lejos del techo de 1000.
 */
export function fetchBranchExpensesHistory(branchId, meses = 7) {
    const desde = correrMes(mesSV(), -(Math.max(1, meses) - 1));
    return supabase.from('branch_expenses')
        .select('billing_month, amount, expense_type')
        .eq('branch_id', branchId)
        .eq('status', 'PAGADO')
        .gte('billing_month', desde)
        .order('billing_month', { ascending: true });
}

/** Trae las ventas de una sucursal desde el sistema de origen. `{ data, error }`. */
export const sincronizarVentasDeSucursal = (payload) =>
    supabase.functions.invoke('sync-wfm-sales', { body: payload });
