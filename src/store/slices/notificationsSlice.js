import { supabase } from '../../supabaseClient';

// ============================================================================
// 🔔 NOTIFICACIONES — mensajes automáticos 1-a-1 (sistema → empleado)
// AVISO = humano→muchos (announcements) · NOTIFICACIÓN = sistema→ti (esta tabla)
// La escritura SIEMPRE pasa por los RPC notify_employees / notify_branch
// (SECURITY DEFINER) — ver src/utils/notify.js. RLS: solo el destinatario lee.
// ============================================================================

export const createNotificationsSlice = (set, get) => ({
    notifications: [],
    isLoadingNotifications: false,

    fetchNotifications: async () => {
        set({ isLoadingNotifications: true });
        try {
            // RLS filtra por destinatario; 100 más recientes bastan para la campana
            const { data, error } = await supabase
                .from('notifications')
                .select('id, type, title, body, link, metadata, branch_id, created_at, read_at')
                .order('created_at', { ascending: false })
                .limit(100);
            if (error) throw error;
            set({ notifications: data || [], isLoadingNotifications: false });
            return data || [];
        } catch (err) {
            console.error('Error cargando notificaciones:', err);
            set({ isLoadingNotifications: false });
            return [];
        }
    },

    // Realtime INSERT → prepend (evita duplicados si fetch y evento se cruzan)
    _addNotification: (notif) => {
        set(state => {
            if (state.notifications.some(n => n.id === notif.id)) return state;
            return { notifications: [notif, ...state.notifications].slice(0, 100) };
        });
    },

    markNotificationRead: async (id) => {
        const readAt = new Date().toISOString();
        set(state => ({
            notifications: state.notifications.map(n => n.id === id && !n.read_at ? { ...n, read_at: readAt } : n),
        }));
        try {
            await supabase.from('notifications').update({ read_at: readAt }).eq('id', id).is('read_at', null);
        } catch (err) {
            console.error('Error marcando notificación leída:', err);
        }
    },

    markAllNotificationsRead: async () => {
        const readAt = new Date().toISOString();
        const unreadIds = get().notifications.filter(n => !n.read_at).map(n => n.id);
        if (!unreadIds.length) return;
        set(state => ({
            notifications: state.notifications.map(n => n.read_at ? n : { ...n, read_at: readAt }),
        }));
        try {
            await supabase.from('notifications').update({ read_at: readAt }).in('id', unreadIds).is('read_at', null);
        } catch (err) {
            console.error('Error marcando notificaciones leídas:', err);
        }
    },
});
