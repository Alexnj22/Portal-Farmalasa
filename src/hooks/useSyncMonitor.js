import { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import { useStaffStore } from '../store/staffStore';
import { announcementAppliesToUser } from '../utils/announcementAudience';
import { mensajeAmigable } from '../utils/errorMessages';
import { ERP_NAMES } from '../constants/erp';

function fireBrowserNotif(title, body, tag, onClick) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/favicon.ico', tag });
    if (onClick) n.onclick = () => { window.focus(); onClick(); };
  } catch { /* best-effort: notificación del navegador puede fallar (permiso revocado, etc.) */ }
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
          // `error_msg` es el error CRUDO del cron: nombre de la función de
          // Postgres más lo que haya devuelto el ERP. El 2026-08-01 esto llegó
          // a un usuario como `sync_inventory_batch: <!DOCTYPE html>…`, por
          // toast y por notificación del sistema operativo a la vez. El texto
          // real queda en `inventory_sync_log` para quien depura; acá se
          // muestra qué pasó, no cómo se llama la función que falló.
          const sucursal = ERP_NAMES[row.erp_sucursal_id] ?? `Sucursal ${row.erp_sucursal_id}`;
          const title = `Inventario sin actualizar · ${sucursal}`;
          const body  = mensajeAmigable(
            row.error_msg,
            'No se pudo actualizar el inventario desde el ERP. El equipo de sistemas ya está notificado.',
          );
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
          // Realtime payload is raw snake_case from the DB
          if (a.is_archived) return;
          if (a.scheduled_for && new Date(a.scheduled_for) > new Date()) return;

          // Check if this announcement targets the current user
          const roles = useStaffStore.getState().roles || [];
          if (!announcementAppliesToUser(a, user, roles)) return;

          const isUrgent = a.priority === 'URGENT';
          const toastTitle = isUrgent ? 'Aviso urgente' : 'Nuevo aviso';
          const body       = a.title || 'Tienes un aviso nuevo';

          // `humano: true`: el aviso lo escribió una persona de RRHH. Un aviso
          // urgente sale como 'error' y sin este flag el guardia del store lo
          // trataría como texto de máquina (un link adentro alcanzaría).
          showToast(toastTitle, body, isUrgent ? 'error' : 'info', 3500, { humano: true });
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
