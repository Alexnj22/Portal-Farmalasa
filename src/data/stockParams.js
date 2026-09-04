// Bloque 6.A — capa de datos, entidad "stockParams" (MIN·MAX). Extraído
// de TabMinMax.jsx: 23 llamadas supabase.from(). La inmensa mayoría son
// upserts/updates a product_stock_params con la misma clave compuesta
// (erp_product_id, erp_sucursal_id) — se consolidan en
// upsertStockParams/updateStockParams genéricos (el caller sigue
// armando el payload/patch exacto que ya armaba antes).
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

const ONCONFLICT = 'erp_product_id,erp_sucursal_id';

// Punto único de verdad para "MIN/MAX efectivo" (publicado + manual, modelo
// aditivo exclusivo de Bodega desde Fase 1 de la auditoría 2026-07-17). Antes
// de esa fase, cada consumidor traía su propia fórmula (algunas con COALESCE
// de reemplazo) — ese fue el bug C-1. Propaga null si no hay base (el caller
// decide su propio fallback: 0 para inputs editables, '—' para displays).
export function effectiveMinMax(base, manual) {
    return base == null ? null : base + (manual ?? 0);
}

// El par efectivo, con la MISMA escalera que aplican `publish_stock_params`,
// el trigger de Bodega y —desde 2026-08-05— `minmax_eff_min`/`minmax_eff_max`
// en la BD: si el MAX pasa de 1, el MIN sube a 1; si el MIN llegó a 1, el MAX
// sube a MIN+1.
//
// Hace falta porque en Bodega el manual es un DELTA sobre la Σ de sucursales, y
// la Σ se mueve sola cuando alguien publica: las restricciones vigilan la base
// (`chk_min_lt_max`) y nadie vigilaba el efectivo, así que un `0·1` de base con
// un delta de +1 quedaba en `0·2` — la combinación que la propia regla prohíbe.
// Medidas 3 así el 2026-08-05, dos nacidas en las publicaciones de ese día.
//
// La escalera NO se puede decidir columna por columna: necesita ver el par. Por
// eso esto y no un cambio dentro de `effectiveMinMax`, que sigue siendo la suma
// y sigue propagando el null de "no hay base" —el llamador elige su fallback,
// 0 para un input, '—' para un display—. Sin par no hay escalera que aplicar.
export function effectiveMinMaxPair(row) {
    const min = effectiveMinMax(row?.min_units, row?.manual_min);
    const max = effectiveMinMax(row?.max_units, row?.manual_max);
    if (min == null || max == null) return { min, max };
    const nMin = Math.max(min, max > 1 ? 1 : 0);
    return { min: nMin, max: nMin >= 1 ? Math.max(max, nMin + 1) : max };
}

// ── product_stock_params ─────────────────────────────────────────────────────

export function upsertStockParams(payload) {
    return supabase.from('product_stock_params').upsert(payload, { onConflict: ONCONFLICT });
}

// Igual que upsertStockParams pero devuelve la fila escrita. F2.6: el log de
// auditoría de Bodega necesita el delta que NO se editó (manual_min cuando se
// edita el MAX, y viceversa), y get_stock_analysis no devuelve esas columnas —
// registraba `null`. Se resuelve con la fila de vuelta del propio upsert, sin
// round-trip extra y sin agregarle columnas a un RPC de 1.5 s.
export function upsertStockParamsReturning(payload, columns = '*') {
    return supabase.from('product_stock_params').upsert(payload, { onConflict: ONCONFLICT })
        .select(columns).maybeSingle();
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

// Polling de bodega (reemplaza postgres_changes — ver comentario en el caller).
// Cursor keyset compuesto (updated_at, erp_product_id) — B-1: una publicación
// masiva escribe miles de filas con el MISMO timestamp (publish_stock_params usa
// un solo NOW() para todo el batch); un cursor gt(updated_at) simple avanza al
// último timestamp visto y se salta el resto de filas con ese mismo timestamp
// para siempre. El keyset + .limit() explícito hace que el próximo poll (5s)
// retome exactamente donde quedó, incluso bajo el cap de 1000 filas de PostgREST.
export function fetchStockParamsUpdates(erpSucursalId, sinceIso, sinceProductId = 0) {
    return supabase.from('product_stock_params')
        .select('erp_product_id, min_units, max_units, manual_min, manual_max, draft_status, draft_min, draft_max, updated_at')
        .eq('erp_sucursal_id', erpSucursalId)
        .or(`updated_at.gt.${sinceIso},and(updated_at.eq.${sinceIso},erp_product_id.gt.${sinceProductId})`)
        .order('updated_at', { ascending: true })
        .order('erp_product_id', { ascending: true })
        .limit(1000);
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

// Por RPC y no leyendo `audit_logs`: el mismo motivo que en `branches.js`. El
// filtro —incluido el OR con MINMAX_ZERO_ALL_BRANCHES, que es un evento global
// sin sucursal— vive ahora del lado del servidor, junto con el permiso.
export function fetchAuditLogsForProduct(actions, erpProductId, erpSucursalId) {
    return supabase.rpc('audit_log_de_producto', {
        p_actions: actions,
        p_target_id: String(erpProductId),
        p_sucursal_id: erpSucursalId == null ? null : String(erpSucursalId),
    });
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

/*
 * PAGINA porque su forma MULTIPLICA. Los dos `.in()` no van apareados: la base
 * devuelve el producto cartesiano —todos los productos × todas las sucursales
 * del pedido—, y de ahí el llamador usa sólo las combinaciones que existen. El
 * peor pedido real hoy pide 90 filas y usa 49 (medido 2026-08-17), pero con las
 * 7 salas bastan 150 productos para cruzar las 1000 y que PostgREST corte sin
 * avisar. El síntoma sería MIN y MAX en cero para los productos que quedaron
 * fuera, indistinguible de un producto sin parámetros.
 *
 * Desempate por `id`: `range()` corta por posición y sin orden total la base
 * puede repartir la misma fila en dos páginas.
 */
export async function fetchStockParamsForRevision(productIds, sucursalIds) {
    const data = await fetchAllRows(() => supabase.from('product_stock_params')
        .select('erp_product_id, erp_sucursal_id, units_sold_6m, daily_velocity, min_units, max_units, manual_min, manual_max, abc_class')
        .in('erp_product_id', productIds)
        .in('erp_sucursal_id', sucursalIds)
        .order('id', { ascending: true }));
    return { data };
}

/**
 * Los ajustes que puso una persona en una sucursal — quién, cuándo, por qué.
 *
 * Va en una consulta APARTE y no dentro de `get_stock_analysis` a propósito:
 * agregarle columnas a ese RPC obliga a recrearlo entero (cambia el tipo de
 * retorno), y es la consulta más pesada de la vista. Acá son pocas filas y las
 * cubre `idx_psp_manual_at`, el índice parcial que sólo indexa las ajustadas.
 *
 * `manual_at` y no `manual_motivo` es el filtro correcto: el motivo es opcional
 * —se pide sólo cuando alguien quiere que el cálculo lo respete— y un ajuste sin
 * motivo declarado sigue siendo un ajuste que no hay que pisar.
 */
export async function fetchAjustesManuales(erpSucursalId) {
    const data = await fetchAllRows(() => supabase.from('product_stock_params')
        .select('erp_product_id, manual_at, manual_por, manual_motivo, manual_nota, manual_cliente_unidades, manual_cliente_dias, ajuste_solicitud_id')
        .eq('erp_sucursal_id', erpSucursalId)
        .not('manual_at', 'is', null)
        .order('id', { ascending: true }));
    return { data };
}

// ── ExpandedPanel.jsx (2 sitios) ──────────────────────────────────────────────

export function fetchStockParamsHistory(erpProductId, erpSucursalId) {
    return supabase.from('product_stock_params_history')
        .select('captured_at, min_units, max_units, daily_velocity, velocity_30d, abc_class, demand_variability')
        .eq('erp_product_id', erpProductId)
        .eq('erp_sucursal_id', erpSucursalId)
        .order('captured_at', { ascending: false })
        // F2.2 — desempate obligatorio: hasta el 2026-07-29 el historial se
        // escribia por dos caminos (trigger con el valor viejo + INSERT de la
        // RPC con el nuevo) en la MISMA transaccion, asi que 13,198 pares
        // comparten captured_at al segundo. Sin `id DESC` el "antes" se podia
        // pintar como si fuera el estado posterior. Las filas nuevas ya vienen
        // de una sola fuente, pero las historicas siguen ahi.
        .order('id', { ascending: false })
        .limit(5);
}

export function fetchProductCostHistory(erpProductId) {
    return supabase.from('product_cost_history')
        .select('fecha, proveedor, precio_unitario, cantidad, lote, fecha_vencimiento')
        .eq('erp_product_id', erpProductId)
        .order('fecha', { ascending: false })
        .limit(6);
}
