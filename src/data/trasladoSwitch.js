// Interruptor de pausa del traslado automático de pedidos.
//
// No es el candado de mantenimiento: aquel frena las policies de RLS, y el
// traslado corre con service_role y desde una tarea programada, así que pasaría
// igual. Este lo consulta la propia función antes de mover nada, y también
// alcanza a la continuación automática.
//
// Son DOS interruptores a propósito. Pausar el envío y la recepción a la vez
// deja varado lo que ya salió de bodega y todavía no llegó: fuera de una sala y
// sin poder entrar en la otra. Ante un problema se pausa el envío, y la
// recepción se deja abierta para poder cerrar lo que está en camino.
import { supabase } from '../supabaseClient';

export function fetchTrasladoSwitch() {
    return supabase
        .from('traslado_interruptor')
        .select('accion, pausado, motivo, cambiado_at, cambiado_por')
        .order('accion');
}

export function setTrasladoSwitch(accion, pausado, motivo) {
    return supabase.rpc('set_traslado_interruptor', {
        p_accion:  accion,
        p_pausado: pausado,
        p_motivo:  motivo || null,
    });
}
