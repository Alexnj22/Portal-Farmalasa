// Libros de IVA de ventas — capa de datos.
//
// Los tres RPC son SECURITY DEFINER con el gate de permiso adentro (migración
// 20260731211927): la policy de `sales_invoices` pide `ventas.can_view`, así que
// un contador con permiso de Libros IVA y nada más leería cero filas por el
// camino normal. El scope de sucursal lo aplica el servidor, no esta capa.
//
// Sin paginar a propósito, y no por descuido: los tres devuelven volúmenes
// chicos por construcción. El de consumidor agrupa POR DÍA (≤31 filas por
// sucursal-mes), y contribuyentes y anulados son documentos raros — junio 2026:
// 49 CCF y 80 anulados en las 7 sucursales. Un mes entero de las 7 no llega a
// 400 filas contra el cap de 1000 de PostgREST. Si algún día se pidiera un año
// completo, esto necesita `fetchAllRows`.
import { supabase } from '../supabaseClient';

const params = (desde, hasta, branchId) => ({
    p_desde: desde,
    p_hasta: hasta,
    p_branch_id: branchId ? Number(branchId) : null,
});

// Art. 83 RCT — una fila por día, con el rango de correlativos del→al.
export function fetchLibroConsumidor(desde, hasta, branchId) {
    return supabase.rpc('get_libro_ventas_consumidor', params(desde, hasta, branchId));
}

// Art. 85 RCT — una fila por documento. `nrc` viene NULL mientras el sync no
// capture el receptor del DTE; la vista lo muestra como faltante.
export function fetchLibroContribuyente(desde, hasta, branchId) {
    return supabase.rpc('get_libro_ventas_contribuyente', params(desde, hasta, branchId));
}

// Anexo de anulados. `NULA` no entra: nunca llegó a Hacienda.
export function fetchLibroAnulados(desde, hasta, branchId) {
    return supabase.rpc('get_libro_anulados', params(desde, hasta, branchId));
}
