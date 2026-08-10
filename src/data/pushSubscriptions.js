// Bloque 6.A — capa de datos, entidad "pushSubscriptions".
//
// Las dos operaciones pasan por RPC y no por `.from()` a propósito: la
// suscripción es del EQUIPO y su dueño cambia con el turno, así que ligarla o
// soltarla cruza de un empleado a otro — justo lo que la RLS de la tabla impide
// (`push_subscriptions_update` valida la fila EXISTENTE, así que el upsert por
// `endpoint` de otra persona muere con «new row violates row-level security
// policy»; verificado contra prod el 2026-08-10). Ver
// `supabase/migrations/20260810160711_push_del_equipo_reclamar_y_soltar.sql`.
//
// El empleado NO viaja como parámetro: lo resuelve el servidor con
// `auth_employee_id()` desde el token de quien llama.
import { supabase } from '../supabaseClient';

export function reclamarPushSubscription({ endpoint, p256dh, auth }) {
    return supabase.rpc('reclamar_push_del_equipo', {
        p_endpoint: endpoint,
        p_p256dh: p256dh,
        p_auth: auth,
    });
}

export function soltarPushSubscription(endpoint) {
    return supabase.rpc('soltar_push_del_equipo', { p_endpoint: endpoint });
}
