// Bloque 6.A — capa de datos, entidad "conteoInventario". El resto del módulo
// son RPCs (ya server-side y fuera de alcance de 6.A).
//
// C5 (2026-07-29): insertConteoItemManual y fetchProductCostoActivo salieron de
// aquí. El alta manual era el único write del módulo que no pasaba por RPC, con
// el cliente eligiendo sistema_cantidad y costo_unitario; ahora es
// agregar_item_conteo, que costea server-side con el mismo criterio que el
// snapshot.
import { supabase } from '../supabaseClient';
import { likePattern } from '../utils/searchUtils';

// Un conteo por sucursal cada vez que se audita: la tabla crece del orden de
// decenas al año, muy lejos del tope de 1000 de PostgREST. El límite va
// explícito para que el día que se acerque sea un cambio deliberado y no un
// truncado silencioso (CLAUDE.md, regla del cap de 1000).
export function fetchConteosInventario() {
    return supabase.from('conteos_inventario')
        .select('*, branches(name)')
        .order('created_at', { ascending: false })
        .limit(1000);
}

export function fetchConteoDetalle(conteoId) {
    return supabase.from('conteos_inventario').select('*, branches(name)').eq('id', conteoId).single();
}

// ── ConteoDetailView.jsx / AddManualItemForm ────────────────────────────────

export function searchActiveProductsForConteo(term) {
    return supabase.from('products')
        .select('id, nombre, laboratorios(nombre)')
        .eq('activo', true)
        .ilike('nombre_norm', likePattern(term))
        .order('nombre')
        .limit(30);
}

export function fetchProductPresentacionesForConteo(productId) {
    return supabase.from('product_precios')
        .select('id_presentacion, presentaciones(tipo)')
        .eq('product_id', productId)
        .eq('activo', true);
}

export function fetchErpSucursalIdsForBranch(branchId) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id').eq('branch_id', branchId);
}

// Qué sucursales pueden tener un conteo: las que están mapeadas al ERP. El
// criterio es el mapeo y no el `type` de la sucursal — es lo mismo que exige
// crear_conteo_inventario (SUCURSAL_SIN_MAPEO_ERP), así que filtrar por otra
// cosa dejaría opciones en la lista que revientan al elegirlas. Hoy la única
// sin mapeo es Administración, que no tiene inventario.
export function fetchBranchIdsConInventario() {
    return supabase.from('erp_sucursal_map').select('branch_id');
}

/*
 * ACOTADA POR EL DATO: el `.in('erp_sucursal_id', …)` va sobre una columna que
 * se repite —el detector `in-columna-repetida` la marca con razón— pero el
 * `.eq('erp_product_id', …)` la fija a UN producto, y la lista de sucursales
 * tiene 7 como máximo. El producto con más lotes de todo el inventario tiene 66
 * (medido 2026-08-17). No hay forma de acercar esto a las 1000 filas.
 */
export function fetchInventoryLotesForProduct(productId, erpSucursalIds) {
    return supabase.from('inventory')
        .select('lote, fecha_vencimiento')
        .eq('erp_product_id', productId)
        .in('erp_sucursal_id', erpSucursalIds)
        .not('lote', 'is', null);
}
