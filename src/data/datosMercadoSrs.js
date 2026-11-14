// Datos de mercado de la SRS (2026-11-14): la pareja de cada producto del
// portal con su producto en el catálogo de la Superintendencia (`crp`). La
// base decide el permiso — ver
// supabase/migrations/20261114051005_srs_datos_de_mercado_pareja_de_productos.sql
// y la función `srs-datos-mercado`, que busca en el catálogo con la cuenta de
// la empresa.
import { supabase } from '../supabaseClient';
import { mensajeAmigable } from '../utils/errorMessages';

export const mensajeDeDatosMercado = (e) => e?.hint || mensajeAmigable(e);

/** Todos los productos con existencia y su pareja (un solo JSON). */
export async function fetchParejasSrs() {
    const { data, error } = await supabase.rpc('srs_mercado_lista');
    return { filas: error ? [] : (data ?? []), error };
}

/**
 * Lo que decide una persona: `estado` 'confirmado' (con el producto de la SRS
 * elegido, o el que ya tenía), 'no_aplica' (no es medicamento) o 'propuesto'
 * (deshacer). Devuelve `{ fila, error }`.
 */
export async function revisarParejaSrs(productId, estado, producto = null) {
    const { data, error } = await supabase.rpc('srs_mercado_revisar', {
        p_product_id: Number(productId),
        p_estado: estado,
        p_crp: producto?.crp ?? null,
        p_n_registro: producto?.n_registro ?? null,
        p_nombre_srs: producto?.nombre_comercial ?? producto?.nombre_srs ?? null,
        p_presentacion_srs: producto?.presentacion ?? producto?.presentacion_srs ?? null,
        p_laboratorio_srs: producto?.laboratorio ?? producto?.laboratorio_srs ?? null,
    });
    return { fila: data ?? null, error };
}

/** Busca en el catálogo de la SRS. Devuelve `{ productos, error }`. */
export async function buscarEnCatalogoSrs(q) {
    const { data, error } = await supabase.functions.invoke('srs-datos-mercado', { body: { accion: 'buscar', q } });
    if (error) return { productos: [], error };
    if (!data?.ok) return { productos: [], error: { message: data?.error || 'No se pudo buscar.' } };
    return { productos: data.productos ?? [], error: null };
}
