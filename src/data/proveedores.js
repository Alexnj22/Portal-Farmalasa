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

// H5 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): asignación masiva. Las dos
// devuelven cuántas filas cambiaron DE VERDAD (no cuántas se seleccionaron),
// así el aviso no miente cuando algunas ya tenían esa categoría.
//
// La diferencia entre ambas es real y por eso son dos RPC: `bulk` le pone a
// todos LA MISMA categoría; `sugerida` le pone a cada uno LA SUYA, calculada
// desde su propio giro fiscal, e ignora a los que no tienen sugerencia.
export async function setProveedoresCategoriaBulk(ids, categoriaId) {
    const { data, error } = await supabase.rpc('set_proveedores_categoria_bulk', {
        p_ids: ids, p_categoria_id: categoriaId ?? null,
    });
    if (error) throw error;
    return data ?? 0;
}

export async function applyProveedoresCategoriaSugerida(ids) {
    const { data, error } = await supabase.rpc('apply_proveedores_categoria_sugerida', { p_ids: ids });
    if (error) throw error;
    return data ?? 0;
}

export async function setProveedorSupplier(id, supplierId) {
    const { error } = await supabase.rpc('set_proveedor_supplier', { p_id: id, p_supplier_id: supplierId });
    if (error) throw error;
}

// H2 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): `percibe_1` ya NO se manda —
// el RPC lo deriva. Lo que viaja es el override tri-estado:
//   null  = automático (lo deciden los DTE del proveedor, Art. 163 CT)
//   true  = manual, sí percibe
//   false = manual, no percibe
// Antes se mandaba un booleano plano y el RPC lo copiaba al override en cada
// guardado, congelando el campo aunque el usuario solo hubiera tocado el
// teléfono.
export async function updateProveedorManual(id, fields) {
    const { error } = await supabase.rpc('update_proveedor_manual', {
        p_id: id,
        p_contacto_nombre: fields.contacto_nombre || null,
        p_telefono2: fields.telefono2 || null,
        p_nombre_cheques: fields.nombre_cheques || null,
        p_notas: fields.notas || null,
        p_activo: fields.activo !== false,
        p_alias: fields.alias || null,
        p_percibe_1_override: fields.percibe_1_override ?? null,
        // `retiene_renta` va por ACA y no por un setter propio: la ficha tiene un
        // solo camino de escritura, y dos formas de escribir el mismo registro se
        // separan el día que una gane un chequeo y la otra no.
        p_retiene_renta: fields.retiene_renta ?? null,
    });
    if (error) throw error;
}
