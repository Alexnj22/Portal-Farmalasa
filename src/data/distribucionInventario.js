// El inventario de la distribuidora: existencia por lote y vencimiento.
//
// La existencia SÓLO cambia por funciones de la base (entrada, ajuste, y la
// asignación al facturar que hace distribucion-dte): así cada unidad que entra
// o sale deja su movimiento con motivo. Desde acá se lee y se llama a esas
// funciones; nunca se escribe una tabla. Ver borradores/distribucion/0006.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export async function fetchLotes() {
    const rows = await fetchAllRows(() => supabase
        .from('dist_lotes')
        .select('id, emisor_id, product_id, lote, vence, existencia, updated_at, products(nombre)')
        .order('product_id').order('vence', { ascending: true, nullsFirst: false }));
    if (rows === null) throw new Error('No se pudo cargar el inventario.');
    return rows.map(r => ({ ...r, nombre: r.products?.nombre ?? `Producto ${r.product_id}` }));
}

export async function fetchMovimientosDeLote(loteId) {
    const { data, error } = await supabase
        .from('dist_lote_movimientos')
        .select('id, tipo, cantidad, existencia_despues, nota, pedido_id, dte_id, created_at, employees:creado_por(name)')
        .eq('lote_id', loteId)
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return data ?? [];
}

export async function entradaDeLote({ emisorId, productId, lote, vence, unidades, nota }) {
    const { data, error } = await supabase.rpc('dist_lote_entrada', {
        p_emisor: emisorId, p_producto: productId, p_lote: lote, p_vence: vence || null,
        p_unidades: unidades, p_nota: nota || null,
    });
    if (error) throw error;
    return data;
}

export async function ajustarLote({ loteId, existencia, vence, nota }) {
    const { data, error } = await supabase.rpc('dist_lote_ajustar', {
        p_lote: loteId, p_existencia: existencia, p_vence: vence || null, p_nota: nota,
    });
    if (error) throw error;
    return data;
}
