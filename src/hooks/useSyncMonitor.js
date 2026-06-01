import { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';

function fireBrowserNotif(title, body, tag, onClick) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/favicon.ico', tag });
    if (onClick) n.onclick = () => { window.focus(); onClick(); };
  } catch {}
}

// Mounted once in AppLayout.
// Subscribes via Supabase Realtime to:
//   - inventory_sync_log (INSERT where success=false) → toast + OS notification
//   - announcements (INSERT)  → toast + OS notification → click opens /my-announcements
export function useSyncMonitor() {
  const showToast = useToastStore(s => s.showToast);
  const { user } = useAuth();

  // ── Inventory sync failures ─────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('sync-monitor-global')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'inventory_sync_log', filter: 'success=eq.false' },
        ({ new: row }) => {
          const title = `Sync fallido · Suc. ${row.erp_sucursal_id}`;
          const body  = row.error_msg || 'Error en sincronización de inventario';
          showToast(title, body, 'error');
          fireBrowserNotif(`Farmalasa · ${title}`, body, `sync-fail-${row.id}`);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [showToast]);

  // ── Announcement notifications ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('announcements-monitor')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'announcements' },
        ({ new: a }) => {
          // Skip archived or future-scheduled
          if (a.isArchived) return;
          if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return;

          // Check if this announcement targets the current user
          const applies =
            a.targetType === 'GLOBAL' ||
            (a.targetType === 'BRANCH'   && (a.targetValue || []).includes(String(user.branchId))) ||
            (a.targetType === 'EMPLOYEE' && (a.targetValue || []).includes(String(user.id)));
          if (!applies) return;

          const isUrgent = a.priority === 'URGENT';
          const toastTitle = isUrgent ? 'Aviso urgente' : 'Nuevo aviso';
          const body       = a.title || 'Tienes un aviso nuevo';

          showToast(toastTitle, body, isUrgent ? 'error' : 'info');
          fireBrowserNotif(
            `Farmalasa · ${toastTitle}`,
            body,
            `announcement-${a.id}`,
            () => { window.location.href = '/my-announcements'; }
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, showToast]);
}
