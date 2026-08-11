// Bloque 6.A — capa de datos, entidad "notifications". Extraído de
// notificationsSlice.js: 5 llamadas supabase.from(). La escritura de
// nuevas notificaciones SIEMPRE pasa por los RPC notify_employees/
// notify_branch (ver src/utils/notify.js) — este módulo solo cubre
// lectura/marcado-como-leído/borrado del lado del destinatario.
import { supabase } from '../supabaseClient';

// `created_by` es QUIÉN la originó — lo escribe `notificar_solicitud_creada` con
// el `employee_id` de la solicitud. Estaba en la tabla y no se leía, así que la
// campana no podía poner la cara de quien pide: había que abrir la solicitud
// para saber de quién era. Verificado contra prod (2026-08-11): resuelve a un
// empleado en las 16 REQUEST_PENDING y las 10 REQUEST_RESOLVED; los avisos del
// sistema lo traen nulo y ahí la fila se dibuja como antes.
export function fetchNotifications() {
    return supabase.from('notifications')
        .select('id, type, title, body, link, metadata, branch_id, created_by, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(100);
}

export function markNotificationRead(id, readAt) {
    return supabase.from('notifications').update({ read_at: readAt }).eq('id', id).is('read_at', null);
}

export function markNotificationsReadBulk(ids, readAt) {
    return supabase.from('notifications').update({ read_at: readAt }).in('id', ids).is('read_at', null);
}

export function deleteNotificationsByIds(ids) {
    return supabase.from('notifications').delete().in('id', ids);
}

export function deleteNotificationsBefore(cutoffIso) {
    return supabase.from('notifications').delete().lte('created_at', cutoffIso);
}
