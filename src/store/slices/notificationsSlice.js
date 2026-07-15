import {
    fetchNotifications as fetchNotificationsData, markNotificationRead as markNotificationReadData,
    markNotificationsReadBulk, deleteNotificationsByIds as deleteNotificationsByIdsData,
    deleteNotificationsBefore,
} from '../../data/notifications';

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
            const { data, error } = await fetchNotificationsData();
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
            await markNotificationReadData(id, readAt);
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
            await markNotificationsReadBulk(unreadIds, readAt);
        } catch (err) {
            console.error('Error marcando notificaciones leídas:', err);
        }
    },

    // RLS solo permite borrar las propias (policy notifications_delete).
    // El commit llega DESPUÉS de la ventana de "Deshacer" (3s) de la campana,
    // por eso recibe IDs explícitos: lo que llegue durante la ventana no se toca.
    deleteNotificationsByIds: async (ids) => {
        const idSet = new Set(ids || []);
        if (!idSet.size) return;
        set(state => ({ notifications: state.notifications.filter(n => !idSet.has(n.id)) }));
        try {
            await deleteNotificationsByIdsData([...idSet]);
        } catch (err) {
            console.error('Error borrando notificaciones:', err);
        }
    },

    // "Borrar todas" real: fetchNotifications solo carga las 100 más recientes,
    // así que borrar por IDs cargados dejaba reaparecer las más viejas en el
    // siguiente fetch. Este borra TODO lo del destinatario server-side (RLS ya
    // limita a sus propias filas) hasta `cutoff` — el mismo corte de tiempo
    // capturado al click, ANTES de la ventana de deshacer de 3s, para no
    // borrar algo que llegó por realtime durante esa ventana (mismo contrato
    // que deleteNotificationsByIds).
    deleteAllNotifications: async (cutoff) => {
        const cutoffIso = cutoff || new Date().toISOString();
        set(state => ({ notifications: state.notifications.filter(n => n.created_at > cutoffIso) }));
        try {
            await deleteNotificationsBefore(cutoffIso);
        } catch (err) {
            console.error('Error borrando todas las notificaciones:', err);
        }
    },
});
