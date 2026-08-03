// Corte Z (Gran Z) — capa de datos.
//
// El RPC es SECURITY DEFINER con el gate de permiso adentro, y devuelve el Z del
// origen JUNTO al número derivado del libro del portal, con la diferencia ya
// calculada. Los dos lados en la misma fila y no en dos consultas: el cotejo ES
// lo que se quiere mirar, y armarlo en el frontend es donde se cuela comparar
// contra la columna equivocada.
//
// Sin paginar a propósito: son ≤6 sucursales por mes por construcción.
import { supabase } from '../supabaseClient';

export async function fetchCortesZ(desde, hasta, branchId) {
    const { data, error } = await supabase.rpc('get_cortes_z', {
        p_desde: desde,
        p_hasta: hasta,
        p_branch_id: branchId ? Number(branchId) : null,
    });
    if (error) throw error;
    return data ?? [];
}
