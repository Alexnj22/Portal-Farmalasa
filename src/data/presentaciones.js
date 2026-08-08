// Capa de datos del maestro de presentaciones (pestaña Presentaciones de
// Productos, 2026-08-08).
//
// Los dos RPC devuelven un ÚNICO objeto JSON, no un SETOF: el cap de 1000 filas
// de PostgREST no aplica (Patrón C de CLAUDE.md). No es una optimización
// prematura — «CAJA» agrupa 2,222 productos, así que el detalle cruzaría el cap
// y se truncaría en silencio si esto devolviera filas.
import { supabase } from '../supabaseClient';

export async function fetchPresentacionesMaestro() {
    const { data, error } = await supabase.rpc('get_presentaciones_maestro');
    return { data: data ?? [], error };
}

export async function fetchProductosPorPresentacion(tipo) {
    const { data, error } = await supabase.rpc('get_productos_por_presentacion', { p_tipo: tipo });
    return { data: data ?? [], error };
}
