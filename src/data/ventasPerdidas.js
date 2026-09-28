// Bloque 6.A — capa de datos, entidad "ventasPerdidas". Extraído de
// VentasPperdidasView.jsx: 4 llamadas supabase.from().
import { supabase } from '../supabaseClient';
import { conBitacora } from './audit';

export function fetchBranchesForVentasPerdidas() {
    return supabase.from('branches').select('id, name');
}

export function fetchEmployeesSafeBasic() {
    return supabase.from('employees_safe').select('id, name, photo_url');
}

export function fetchVentasPerdidas(status) {
    return supabase.from('ventas_perdidas')
        .select('id, producto_buscado, descripcion, principio_activo, laboratorio, cantidad, branch_id, reportado_por, status, created_at')
        .eq('status', status)
        .order('created_at', { ascending: false });
}

export function updateVentaPerdidaStatus(id, status) {
    return supabase.from('ventas_perdidas').update({ status }).eq('id', id);
}

// ── AppLayout.jsx (badge de pendientes en el menú) ──────────────────────────

export function fetchVentasPerdidasPendingCount() {
    return supabase.from('ventas_perdidas').select('*', { count: 'exact', head: true }).eq('status', 'pendiente');
}

// ── WidgetInventorySearch.jsx (reportar producto sin stock desde SRS) ──────

// Anota REPORTAR_VENTA_PERDIDA (D3, 2026-09-28): la fila guarda `reportado_por`,
// pero su estado se edita después y la bitácora es lo único que conserva el
// momento en que alguien dijo «esto me lo pidieron y no lo tenía». Antes lo
// anotaba la pantalla, y aunque el insert fallara.
export function insertVentaPerdida(payload, contexto = {}) {
    return conBitacora(supabase.from('ventas_perdidas').insert(payload), 'REPORTAR_VENTA_PERDIDA', null, {
        producto: payload.descripcion || payload.producto_buscado, cantidad: payload.cantidad,
        sucursal_id: payload.branch_id ?? null, ...contexto,
    });
}
