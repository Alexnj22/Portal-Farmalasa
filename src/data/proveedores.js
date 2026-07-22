// Maestro de Proveedores — capa de datos. Lectura vía RPC Patrón C (json_agg).
import { supabase } from '../supabaseClient';

export async function fetchProveedoresMaestro() {
    const { data, error } = await supabase.rpc('get_proveedores_maestro');
    if (error) throw error;
    return data || [];
}

// Tabla chica (16 filas seed) — select directo, sin RPC, mismo patrón que
// fetchSuppliersBasic.
export function fetchProveedorCategorias() {
    return supabase.from('proveedores_categorias').select('id, clase, nombre').order('clase').order('nombre');
}

export async function setProveedorCategoria(id, categoriaId) {
    const { error } = await supabase.rpc('set_proveedor_categoria', { p_id: id, p_categoria_id: categoriaId });
    if (error) throw error;
}

export async function setProveedorSupplier(id, supplierId) {
    const { error } = await supabase.rpc('set_proveedor_supplier', { p_id: id, p_supplier_id: supplierId });
    if (error) throw error;
}

export async function updateProveedorManual(id, fields) {
    const { error } = await supabase.rpc('update_proveedor_manual', {
        p_id: id,
        p_contacto_nombre: fields.contacto_nombre || null,
        p_telefono2: fields.telefono2 || null,
        p_nombre_cheques: fields.nombre_cheques || null,
        p_notas: fields.notas || null,
        p_activo: fields.activo !== false,
        p_percibe_1: !!fields.percibe_1,
        p_alias: fields.alias || null,
    });
    if (error) throw error;
}
