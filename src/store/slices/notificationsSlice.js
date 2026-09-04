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
            /* Quitarla de la campana y leerla llegan los dos por este camino
               —son UPDATE de `deleted_at` y de `read_at`— y fusionarlos dejaría
               la fila a la vista con la marca adentro. Quien la tocó no lo nota
               porque su propia pestaña ya la sacó; lo nota la SEGUNDA pestaña de
               la misma persona, que la seguiría mostrando hasta recargar. */
            if (notif.deleted_at || notif.read_at) {
                return { notifications: state.notifications.filter(n => n.id !== notif.id) };
            }
            return { notifications: state.notifications.map(n => n.id === notif.id ? { ...n, ...notif } : n) };
        });
    },

    /**
     * Sacar de la campana el aviso de una solicitud recién decidida.
     *
     * Es lo mismo que hace el trigger en la base, reflejado en memoria para
     * quien acaba de decidir: el realtime puede tardar o no llegar, y en esa
     * ventana la campana de la MISMA persona que aprobó le seguiría ofreciendo
     * aprobar.
     *
     * Ya no recibe el ESTADO. Lo escribía en `metadata.resuelta` para pintar el
     * sello «APROBADA» sobre una fila que se quedaba, y desde que leer una la
     * quita de la campana (2026-09-04) esa fila no se queda. Los cuatro
     * llamadores siguen pasándolo y no hace daño —un argumento de más en
     * JavaScript se ignora—: se saca de la firma para que nadie lo lea como si
     * hiciera algo. El estado final vive donde importa: en la fila que escribe
     * el trigger, que es la que muestra `/notificaciones`.
     */
    marcarAvisoDeSolicitudResuelto: (requestId) => {
        if (!requestId) return;
        const clave = String(requestId);
        /* Y la saca de la campana: decidirla es atenderla. Antes le escribía
           `read_at` y la dejaba a la vista con el sello «APROBADA», pero desde
           que leer una la quita (2026-09-04) eso sería la única fila leída que
           se queda — o sea la excepción que hace que la regla no se entienda.
           El aviso de que salió bien lo da el toast de `useDecidirSolicitud`, y
           la solicitud con su estado final vive en `/notificaciones` y en la
           bandeja de Solicitudes. */
        set(state => ({
            notifications: state.notifications.filter(n =>
                !((n.type === 'REQUEST_PENDING' || n.type === 'MINMAX_PENDING')
                  && String(n.metadata?.request_id ?? '') === clave)),
        }));
    },

    /* Leer una la SACA de la campana (2026-09-04: «al leer las notificaciones
       en la campana, que se quiten de ahí»). No se pierde: sigue en
       `/notificaciones`, que es el registro completo — y `fetchNotifications`
       ya no las trae, así que la próxima apertura coincide con esto. */
    markNotificationRead: async (id) => {
        const readAt = new Date().toISOString();
        set(state => ({
            notifications: state.notifications.filter(n => n.id !== id),
        }));
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
