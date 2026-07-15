// Bloque 6.A — capa de datos, entidad "pedidos". Extraído de
// TabPedidos.jsx: 45 llamadas supabase.from() distintas, consolidadas
// en funciones nombradas por forma de query real (varias eran
// duplicados literales — ej. 5 lookups idénticos de la sucursal de
// bodega — y quedan en una sola función acá). Extracción mecánica:
// mismo query/filtro exacto que tenía cada sitio, sin cambiar
// comportamiento. Los dos fetch que hacían paginación manual con un
// while-loop (pedido_items, pedido_item_eventos) ahora usan
// fetchAllRows (utils/supabaseUtils.js), el helper que ya existe en el
// proyecto para esto.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// ── Sucursal / ERP lookups ──────────────────────────────────────────────────

export function fetchEmployeeBranchId(userId) {
    return supabase.from('employees').select('branch_id').eq('id', userId).maybeSingle();
}

export function fetchSucursalIdForBranch(branchId) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id').eq('branch_id', branchId).eq('es_bodega', false).maybeSingle();
}

export function fetchBodegaBranchId() {
    return supabase.from('erp_sucursal_map').select('branch_id').eq('es_bodega', true).maybeSingle();
}

export function fetchBranchIdForSucursal(sucId) {
    return supabase.from('erp_sucursal_map').select('branch_id').eq('erp_sucursal_id', sucId).maybeSingle();
}

export function fetchBranchInfoForSucursal(sucId) {
    return supabase.from('erp_sucursal_map').select('branch_id, nombre').eq('erp_sucursal_id', sucId).maybeSingle();
}

export function fetchBranchNamesForSucursales(sucIds) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id, branch:branches!inner(name)').in('erp_sucursal_id', sucIds);
}

// ── Apoyo (personal de refuerzo) ────────────────────────────────────────────

export function fetchApoyoForPedidos(pedidoIds, sucId) {
    let q = supabase.from('pedido_apoyo')
        .select('pedido_id, erp_sucursal_id, employee_id, tipo, employees(name, photo_url)')
        .in('pedido_id', pedidoIds);
    if (sucId) q = q.eq('erp_sucursal_id', sucId);
    return q;
}

export function fetchApoyoForPedido(pedidoId, sucId) {
    let q = supabase.from('pedido_apoyo')
        .select('id, employee_id, tipo, employees(name, photo_url)')
        .eq('pedido_id', pedidoId);
    if (sucId) q = q.eq('erp_sucursal_id', sucId);
    return q;
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export function fetchActiveRutas(todayStartIso) {
    return supabase.from('rutas')
        .select(`id, numero, conductor_id, conductor_nombre, status, salida_at, vuelta_base_at,
                 ruta_pedidos(id, pedido_id, erp_sucursal_id, orden_entrega, entregado_at, entregado_por)`)
        .or(`status.in.(pendiente,en_ruta),and(status.eq.completada,created_at.gte.${todayStartIso})`)
        .order('created_at', { ascending: false });
}

export function fetchRutaLocations(rutaIds) {
    return supabase.from('ruta_locations').select('ruta_id, updated_at').in('ruta_id', rutaIds);
}

export function upsertRutaLocation(rutaId, lat, lng) {
    return supabase.from('ruta_locations')
        .upsert({ ruta_id: rutaId, lat, lng, updated_at: new Date().toISOString() }, { onConflict: 'ruta_id' });
}

export function updateRutaStatus(rutaId, patch) {
    return supabase.from('rutas').update(patch).eq('id', rutaId);
}

export function updateRutaPedidoEntregado(stopId, userId) {
    return supabase.from('ruta_pedidos')
        .update({ entregado_at: new Date().toISOString(), entregado_por: userId })
        .eq('id', stopId);
}

// ── pedido_items ─────────────────────────────────────────────────────────────

const ITEMS_SELECT = `
    id, erp_sucursal_id, erp_product_id, cantidad_asignada, cantidad_recibida,
    status, nota_diferencia, error_tipo, received_at, received_by, lotes_asignados, agotamiento,
    sin_stock, revision_minmax, falta_caja, caja_especial,
    factor, dispatch_tipo, dispatch_factor, dispatch_multiplo,
    max_qty_snapshot, stock_packs_snapshot,
    resolucion_status, resolucion_tipo, resolucion_nota,
    resuelto_por, resuelto_at, confirmado_suc_por, confirmado_suc_at,
    rechazado_por, rechazado_at, nota_rechazo,
    products ( nombre, es_antibiotico, laboratorios ( nombre ), product_precios ( factor, activo, presentaciones!id_presentacion ( tipo ) ), dispatch_rules ( dispatch_label ) ),
    presentaciones!erp_presentacion_id ( tipo )
`;

// Pedidos con >1000 items existen en producción — paginado con fetchAllRows
// (antes era un while-loop manual duplicado con el de pedido_item_eventos).
export function fetchPedidoItemsAll(pedidoId, sucFilter) {
    return fetchAllRows(() => {
        let q = supabase.from('pedido_items').select(ITEMS_SELECT).eq('pedido_id', pedidoId);
        if (sucFilter) q = q.eq('erp_sucursal_id', sucFilter);
        return q;
    });
}

export function fetchPedidoItemEventosAll(pedidoId, sucFilter) {
    return fetchAllRows(() => {
        let q = supabase.from('pedido_item_eventos')
            .select('id, pedido_item_id, tipo, resolucion_tipo, nota, hecho_por, created_at')
            .eq('pedido_id', pedidoId).order('created_at', { ascending: true });
        if (sucFilter) q = q.eq('erp_sucursal_id', sucFilter);
        return q;
    });
}

export function fetchPedidoItemsPendientesIds(pedidoId, sucId) {
    return supabase.from('pedido_items').select('id')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).eq('status', 'pendiente');
}

export function fetchPedidoItemsFaltaElectrolit(pedidoId, sucId) {
    return supabase.from('pedido_items')
        .select('id, products(nombre)')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId)
        .eq('falta_caja', true).eq('status', 'pendiente');
}

export function fetchPedidoItemsFaltaEspeciales(pedidoId, sucId) {
    return supabase.from('pedido_items')
        .select('id')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId)
        .eq('falta_caja', true).eq('status', 'pendiente').eq('caja_especial', true);
}

export function updatePedidoItemsFaltaCaja(ids, value) {
    return supabase.from('pedido_items').update({ falta_caja: value }).in('id', ids);
}

// ── pedido_sucursal_status ──────────────────────────────────────────────────
// Getter/setter genéricos — mismo par (pedido_id, erp_sucursal_id) en TODOS
// los sitios que los usan, solo cambian las columnas seleccionadas o el
// payload del update. El caller sigue armando el patch/columns exactos que
// ya armaba antes; acá solo se centraliza el query builder.

export function fetchPedidoSucursalStatus(pedidoId, sucId, columns) {
    return supabase.from('pedido_sucursal_status').select(columns)
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).maybeSingle();
}

export function updatePedidoSucursalStatus(pedidoId, sucId, patch) {
    return supabase.from('pedido_sucursal_status').update(patch)
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);
}

// ── Pausas / asistencia ──────────────────────────────────────────────────────

export function fetchPausaHistorial(pedidoId, sucId) {
    return supabase.from('pedido_pausa_historial').select('razon').eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);
}

export function fetchAttendancePunches(employeeId, sinceIso) {
    return supabase.from('attendance').select('type, timestamp')
        .eq('employee_id', employeeId).in('type', ['OUT_LUNCH', 'IN_LUNCH'])
        .gte('timestamp', sinceIso).order('timestamp', { ascending: false }).limit(10);
}
