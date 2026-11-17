import { supabase } from '../supabaseClient';

/**
 * Avisa que entró producto con vencimiento corto (`public.notificar_vence_corto`).
 * Compra → la gente de Bodega; pedido → la sucursal que recibe. La base vuelve
 * a filtrar por fecha y no repite el aviso de una misma carga (`referencia`).
 *
 * Nunca lanza: el aviso acompaña a la carga, no la frena. Devuelve el error
 * para que quien llama decida si lo dice.
 *
 * @param {{ origen: 'compra'|'pedido', referencia: string, detalle?: string,
 *           sucursalId?: number|null, productos: {nombre: string, vence: string, cantidad?: number}[] }} p
 */
export async function notificarVenceCorto({ origen, referencia, detalle = null, sucursalId = null, productos }) {
    if (!productos?.length) return { avisados: 0, error: null };
    try {
        const { data, error } = await supabase.rpc('notificar_vence_corto', {
            p_origen: origen,
            p_referencia: String(referencia),
            p_detalle: detalle,
            p_sucursal_id: sucursalId,
            p_productos: productos,
        });
        if (error) return { avisados: 0, error: error.message };
        return { avisados: data ?? 0, error: null };
    } catch (e) {
        return { avisados: 0, error: e?.message ?? 'No se pudo avisar.' };
    }
}
