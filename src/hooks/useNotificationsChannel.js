import { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useStaffStore } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';

function fireBrowserNotif(title, body, tag, onClick) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const n = new Notification(title, { body, icon: '/favicon.ico', tag });
        if (onClick) n.onclick = () => { window.focus(); onClick(); };
    } catch { /* best-effort: notificación del navegador puede fallar (permiso revocado, etc.) */ }
}

// Montar UNA sola vez (AppLayout). Carga inicial + realtime de la tabla
// notifications filtrado al empleado actual; RLS respalda el filtro.
export function useNotificationsChannel() {
    const { user } = useAuth();
    const showToast = useToastStore(s => s.showToast);
    const fetchNotifications = useStaffStore(s => s.fetchNotifications);
    const _addNotification = useStaffStore(s => s._addNotification);

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
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [user?.id, fetchNotifications, _addNotification, showToast]);
}
