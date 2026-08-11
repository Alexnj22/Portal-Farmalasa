import { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useStaffStore } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { fireBrowserNotif } from '../utils/browserNotif';

// Montar UNA sola vez (AppLayout). Carga inicial + realtime de la tabla
// notifications filtrado al empleado actual; RLS respalda el filtro.
export function useNotificationsChannel() {
    const { user } = useAuth();
    const showToast = useToastStore(s => s.showToast);
    const fetchNotifications = useStaffStore(s => s.fetchNotifications);
    const _addNotification = useStaffStore(s => s._addNotification);
    const _replaceNotification = useStaffStore(s => s._replaceNotification);

    useEffect(() => {
        if (!user?.id) return;

        fetchNotifications();

        const channel = supabase
            .channel('notifications-live')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` },
                ({ new: n }) => {
                    _addNotification(n);
                    showToast(n.title, n.body || '', 'info');
                    fireBrowserNotif(
                        `Farmalasa · ${n.title}`,
                        n.body || '',
                        `notif-${n.id}`,
                        n.link ? () => { window.location.href = n.link; } : undefined
                    );
                }
            )
            /* Un aviso también CAMBIA, no sólo llega.
             *
             * Cuando alguien decide una solicitud, un trigger le escribe a su
             * notificación en qué terminó (`metadata.resuelta`) — y eso es lo
             * que le quita los botones de «Aprobar / Rechazar». Escuchando sólo
             * INSERT, ese cambio no llegaba nunca: la campana pedía una decisión
             * ya tomada hasta que alguien recargara la página.
             *
             * Sin toast ni aviso del navegador: no es novedad, es la misma fila
             * puesta al día. */
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` },
                ({ new: n }) => _replaceNotification(n),
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [user?.id, fetchNotifications, _addNotification, _replaceNotification, showToast]);
}
