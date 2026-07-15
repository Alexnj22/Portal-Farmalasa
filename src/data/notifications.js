// Bloque 6.A — capa de datos, entidad "notifications". Extraído de
// notificationsSlice.js: 5 llamadas supabase.from(). La escritura de
// nuevas notificaciones SIEMPRE pasa por los RPC notify_employees/
// notify_branch (ver src/utils/notify.js) — este módulo solo cubre
// lectura/marcado-como-leído/borrado del lado del destinatario.
import { supabase } from '../supabaseClient';

export function fetchNotifications() {
    return supabase.from('notifications')
        .select('id, type, title, body, link, metadata, branch_id, created_at, read_at')
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
