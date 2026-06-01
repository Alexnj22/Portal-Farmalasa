import { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useToastStore } from '../store/toastStore';

// Subscribes to inventory_sync_log via Realtime.
// On a failed sync → shows toast error + OS notification (if permission granted).
// Mount once in AppLayout so it's active everywhere.
export function useSyncMonitor() {
  const showToast = useToastStore(s => s.showToast);

  useEffect(() => {
    const channel = supabase
      .channel('sync-monitor-global')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'inventory_sync_log', filter: 'success=eq.false' },
        ({ new: row }) => {
          const title = `Sync fallido · Suc. ${row.erp_sucursal_id}`;
          const body = row.error_msg || 'Error en sincronización de inventario';
          showToast(title, body, 'error');
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(`Farmalasa · ${title}`, { body, icon: '/favicon.ico' }); } catch {}
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [showToast]);
}
