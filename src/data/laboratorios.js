// Bloque 6.A — capa de datos, entidad "laboratorios" (política de
// vencimiento/devolución por proveedor). Extraído de
// TabPoliticaVencimiento.jsx: 8 llamadas supabase.from().
import { supabase } from '../supabaseClient';

export function fetchLaboratoriosBasic() {
    return supabase.from('laboratorios').select('id, nombre').order('nombre');
}

export function fetchProveedores() {
    return supabase.from('proveedores')
        .select('id, laboratorio_id, nombre, devolutivo, meses_devolucion, notas, vineta')
        .order('nombre');
}

export function fetchSuppliersNames() {
    return supabase.from('suppliers').select('nombre').order('nombre');
}

export function insertProveedor(payload) {
    return supabase.from('proveedores').insert(payload).select().single();
}

export function updateProveedor(id, patch) {
    return supabase.from('proveedores').update(patch).eq('id', id);
}

export function deleteProveedor(id) {
    return supabase.from('proveedores').delete().eq('id', id);
}

export function fetchProductCountByLabDevolutivo(labId) {
    return supabase.from('products').select('id', { count: 'exact', head: true })
        .eq('laboratorio_id', labId).eq('devolutivo', true);
}

export function updateProductsMarkND(labId) {
    return supabase.from('products')
        .update({ devolutivo: false })
        .eq('laboratorio_id', labId).eq('devolutivo', true)
        .select('id');
}

// ── TabLaboratorios.jsx (2 de sus 3 sitios; el tercero reutiliza
// fetchLaboratoriosBasic ya definida arriba) ─────────────────────────────────

const LAB_LOC_FIELDS = 'lab_id, branch_id, vitrina, estante, peldano, bodega_numero, bodega_peldano';

export function fetchLabLocations() {
    return supabase.from('lab_locations').select(LAB_LOC_FIELDS);
}

export function upsertLabLocation(payload) {
    return supabase.from('lab_locations').upsert(payload, { onConflict: 'lab_id,branch_id' });
}
