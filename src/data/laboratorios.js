// Bloque 6.A — capa de datos, entidad "laboratorios" (política de
// vencimiento/devolución por proveedor). Extraído de
// TabPoliticaVencimiento.jsx: 8 llamadas supabase.from().
import { supabase } from '../supabaseClient';
import { anotar, conBitacora } from './audit';

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

// Las escrituras anotan su propia entrada en la bitácora (D3, 2026-09-28):
// cualquier cliente que las llame la deja. `contexto` son los datos legibles
// que sólo la pantalla conoce; la acción es fija.
export async function insertProveedor(payload, contexto = {}) {
    const res = await supabase.from('proveedores').insert(payload).select().single();
    if (!res.error && res.data) {
        anotar('CREAR_PROVEEDOR', res.data.id, { proveedor: res.data.nombre, ...contexto });
    }
    return res;
}

export function updateProveedor(id, patch, contexto = {}) {
    return conBitacora(supabase.from('proveedores').update(patch).eq('id', id),
        'EDITAR_PROVEEDOR', id, { proveedor: patch?.nombre, ...contexto });
}

export function deleteProveedor(id, contexto = {}) {
    return conBitacora(supabase.from('proveedores').delete().eq('id', id),
        'ELIMINAR_PROVEEDOR', id, contexto);
}

export function fetchProductCountByLabDevolutivo(labId) {
    return supabase.from('products').select('id', { count: 'exact', head: true })
        .eq('laboratorio_id', labId).eq('devolutivo', true);
}

export async function updateProductsMarkND(labId, contexto = {}) {
    const res = await supabase.from('products')
        .update({ devolutivo: false })
        .eq('laboratorio_id', labId).eq('devolutivo', true)
        .select('id');
    if (!res.error) {
        anotar('LABORATORIO_MARCAR_ND', labId, { productos_afectados: res.data?.length ?? 0, ...contexto });
    }
    return res;
}

// ── TabLaboratorios.jsx (2 de sus 3 sitios; el tercero reutiliza
// fetchLaboratoriosBasic ya definida arriba) ─────────────────────────────────

const LAB_LOC_FIELDS = 'lab_id, branch_id, vitrina, estante, peldano, bodega_numero, bodega_peldano';

export function fetchLabLocations() {
    return supabase.from('lab_locations').select(LAB_LOC_FIELDS);
}

export function upsertLabLocation(payload, contexto = {}) {
    return conBitacora(supabase.from('lab_locations').upsert(payload, { onConflict: 'lab_id,branch_id' }),
        'UPDATE_LAB_LOCATION', payload?.lab_id, { branch_id: payload?.branch_id, ...contexto });
}
