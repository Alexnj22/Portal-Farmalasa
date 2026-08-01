// Libros de IVA — capa de datos.
//
// Los siete RPC son SECURITY DEFINER con el gate de permiso adentro (migraciones
// 20260731211927 para ventas, 20260801154204 para compras): las policies de
// `sales_invoices` y `purchase_receipts` piden `ventas.can_view` y
// `compras.can_view`, así que un contador con permiso de Libros IVA y nada más
// leería cero filas por el camino normal. El scope de sucursal lo aplica el
// servidor, no esta capa.
//
// Sin paginar a propósito, y no por descuido: todos devuelven volúmenes chicos
// por construcción. El de consumidor agrupa POR DÍA (≤31 filas por sucursal-mes),
// y los demás son documentos contados — junio 2026, las 7 sucursales: 49 CCF, 80
// anulados, 389 compras y 226 filas de percepción. El mes más cargado no llega a
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

// Art. 86 RCT — libro de compras, una fila por documento. Las anuladas vienen
// marcadas, no filtradas: el libro del ERP las incluye (verificado en Bodega el
// 2026-07-20, 28 documentos y $16,321.43 de los dos lados).
export function fetchLibroCompras(desde, hasta, branchId) {
    return supabase.rpc('get_libro_compras', params(desde, hasta, branchId));
}

// Anexo de percepción (Art. 163 CT) — el subconjunto de compras con percepción.
export function fetchLibroPercepcion(desde, hasta, branchId) {
    return supabase.rpc('get_libro_percepcion', params(desde, hasta, branchId));
}

// Anexo de retención (Art. 162 CT). Sale vacío y así debe ser: el ERP tampoco
// tiene una sola fila entre 2025-01 y 2026-07 en las 7 sucursales.
export function fetchLibroRetencion(desde, hasta, branchId) {
    return supabase.rpc('get_libro_retencion', params(desde, hasta, branchId));
}

// Reporte de sujeto excluido (Art. 119 CT). El filtro es la clase de documento,
// no "proveedor sin NRC" — son cosas distintas.
export function fetchLibroSujetoExcluido(desde, hasta, branchId) {
    return supabase.rpc('get_libro_sujeto_excluido', params(desde, hasta, branchId));
}

// Notas de crédito (05) y débito (06) de compras. NO es un libro: es la sección
// que hace visible lo que el libro no lleva.
//
// Sin `branchId` a propósito, y no por descuido: estos documentos llegan por
// correo y el origen no trae sucursal. Repartirlos por el documento que
// corrigen daría ~30% de cobertura, y un dato fiscal mal repartido es peor que
// uno sin repartir. La vista lo dice en pantalla.
export function fetchNotasCreditoCompras(desde, hasta) {
    return supabase.rpc('get_notas_credito_compras', { p_desde: desde, p_hasta: hasta });
}
