import {
    fetchNotifications as fetchNotificationsData, markNotificationRead as markNotificationReadData,
    markNotificationsReadBulk, deleteNotificationsByIds as deleteNotificationsByIdsData,
    deleteNotificationsBefore, restoreNotificationsByIds as restoreNotificationsByIdsData,
} from '../../data/notifications';

// ============================================================================
// 🔔 NOTIFICACIONES — mensajes automáticos 1-a-1 (sistema → empleado)
// AVISO = humano→muchos (announcements) · NOTIFICACIÓN = sistema→ti (esta tabla)
// La escritura SIEMPRE pasa por los RPC avisar_a_empleados / avisar_a_sucursal
// (SECURITY DEFINER) — ver src/utils/notify.js. Los `notify_*` que delegan están
// cerrados a `authenticated`: sólo los llaman crons, edge functions con
// service_role y disparadores. RLS: solo el destinatario lee.
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

    /* Realtime UPDATE → reemplazar la fila.
     *
     * Faltaba, y por eso una solicitud ya decidida seguía ofreciendo
     * «Aprobar / Rechazar» en la campana: el trigger
     * `marcar_notificacion_solicitud_resuelta` escribe `metadata.resuelta` en el
     * momento de la decisión, pero el canal sólo escuchaba INSERT. O sea que el
     * dato que apaga los botones llegaba a la base y no al navegador — y la
     * campana sólo se refresca al montar, así que había que recargar la página
     * entera para que la notificación dejara de pedir una decisión ya tomada.
     *
     * Si la fila no está en la lista se ignora: puede ser una vieja que quedó
     * fuera de las 100 que carga la campana, y meterla acá la haría aparecer de
     * la nada por un cambio que nadie pidió ver. */
    _replaceNotification: (notif) => {
        set(state => {
            if (!state.notifications.some(n => n.id === notif.id)) return state;
            /* Quitarla de la campana llega por este camino —es un UPDATE de
               `deleted_at`— y fusionarlo dejaría la fila a la vista con la fecha
               adentro. Quien la quitó no lo nota porque su propia pestaña ya la
               sacó; lo nota la SEGUNDA pestaña de la misma persona.

               `read_at` NO saca la fila acá, y es a propósito: por este mismo
               camino llega el sello del trigger que dice en qué terminó una
               solicitud, y ese UPDATE trae la fila ya leída. Sacarla borraría
               justo el «APROBADA / RECHAZADA» que se quiere ver. Quien la leyó
               ya la vio irse por `markNotificationRead`. */
            if (notif.deleted_at) {
                return { notifications: state.notifications.filter(n => n.id !== notif.id) };
            }
            return { notifications: state.notifications.map(n => n.id === notif.id ? { ...n, ...notif } : n) };
        });
    },

    /**
     * El sello de en qué terminó una solicitud, en el acto.
     *
     * Es lo mismo que hace el trigger en la base, reflejado en memoria para
     * quien acaba de decidir: el realtime puede tardar o no llegar, y en esa
     * ventana la campana de la MISMA persona que aprobó le seguiría ofreciendo
     * aprobar. La marca lleva el ESTADO —no un booleano— porque la tarjeta
     * escribe con él la etiqueta de en qué terminó.
     *
     * La fila se QUEDA, aunque leer una la saque de la campana (2026-09-04).
     * Es la excepción y tiene motivo: el sello es la respuesta a algo que la
     * persona acaba de hacer, y sacarla sería contestarle con una tarjeta que
     * desaparece. No vuelve — la próxima carga ya no trae lo leído—, así que se
     * ve mientras el panel está abierto y no después. Pedido del usuario:
     * «ese sí me gustaba, que saliera ahí si fue aceptado o rechazado».
     */
    marcarAvisoDeSolicitudResuelto: (requestId, estado) => {
        if (!requestId) return;
        const clave = String(requestId);
        set(state => ({
            notifications: state.notifications.map(n =>
                (n.type === 'REQUEST_PENDING' || n.type === 'MINMAX_PENDING')
                && String(n.metadata?.request_id ?? '') === clave
                    ? { ...n,
                        metadata: { ...(n.metadata ?? {}), resuelta: estado },
                        read_at: n.read_at ?? new Date().toISOString() }
                    : n),
        }));
    },

    markNotificationRead: async (id, { quitar = true } = {}) => {
        const readAt = new Date().toISOString();
        set(state => (quitar
            ? { notifications: state.notifications.filter(n => n.id !== id) }
            /* `quitar: false` lo usan los caminos que DECIDEN desde la campana.
               Marcan leído al empezar, y si eso sacara la tarjeta se llevaría el
               sello «APROBADA / RECHAZADA» que aparece al terminar — que es
               justamente lo que se quiere ver. La fila igual no vuelve: la
               próxima carga de la campana ya no trae lo leído. */
            : { notifications: state.notifications.map(n => n.id === id && !n.read_at ? { ...n, read_at: readAt } : n) }
        ));
        try {
            await markNotificationReadData(id, readAt);
        } catch (err) {
            console.error('Error marcando notificación leída:', err);
        }
    },

    // «Marcar todas como leídas» vacía la campana, por lo mismo. El listado las
    // conserva enteras.
    markAllNotificationsRead: async () => {
        const readAt = new Date().toISOString();
        const unreadIds = get().notifications.filter(n => !n.read_at).map(n => n.id);
        if (!unreadIds.length) return;
        set(state => ({
            notifications: state.notifications.filter(n => !unreadIds.includes(n.id)),
        }));
        try {
            await markNotificationsReadBulk(unreadIds, readAt);
        } catch (err) {
            console.error('Error marcando notificaciones leídas:', err);
        }
    },

    /* Borrar es OCULTAR: se escribe `deleted_at` y la fila queda en la base
       hasta que la purgue el cron de los 90 días. Lo que sale de la campana se
       puede ver y devolver desde `/notificaciones`, que lo muestra igual. La
       policy de DELETE se quitó en la migración `20260904141450`, así que esto
       ya no es una convención de este archivo: no hay forma de destruirla desde
       el navegador.

       El RLS sigue acotando a las propias (`notifications_update`). El commit
       llega DESPUÉS de la ventana de "Deshacer" (3s) de la campana, por eso
       recibe IDs explícitos: lo que llegue durante la ventana no se toca. */
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

    /* Devolverla a la campana desde la papelera.
       Recarga después de escribir en vez de insertarla en memoria: la fila
       restaurada puede ser vieja y no entrar en las 100 de la campana, y
       meterla a mano ahí la mostraría en un orden que el próximo fetch
       desharía. */
    restoreNotificationsByIds: async (ids) => {
        const idSet = new Set(ids || []);
        if (!idSet.size) return;
        try {
            const { error } = await restoreNotificationsByIdsData([...idSet]);
            if (error) throw error;
            await get().fetchNotifications();
        } catch (err) {
            console.error('Error restaurando notificaciones:', err);
            throw err;
        }
    },

    // "Borrar todas" real: fetchNotifications solo carga las 100 más recientes,
    // así que borrar por IDs cargados dejaba reaparecer las más viejas en el
    // siguiente fetch. Este OCULTA todo lo del destinatario server-side (RLS ya
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
