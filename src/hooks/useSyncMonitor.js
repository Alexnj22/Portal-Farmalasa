import { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import { mensajeAmigable } from '../utils/errorMessages';
import { fireBrowserNotif } from '../utils/browserNotif';
import { ERP_NAMES } from '../constants/erp';

// Se monta UNA vez en AppLayout. Escucha `inventory_sync_log` (INSERT con
// success=false) y avisa que el ERP no entregó el inventario.
//
// Ya NO escucha `announcements` (2026-08-01). Había DOS suscripciones al mismo
// INSERT —ésta y el canal `announcements-live` que abre `fetchBoot`— y las dos
// hacían toast, con textos distintos, para el mismo aviso. Como el store de
// toasts tiene un solo espacio, el que veía el usuario dependía de cuál llegara
// última. Quedó la de `fetchBoot`, que además mantiene la lista de avisos: es
// la que tiene que existir sí o sí, y ahora también dispara la notificación del
// sistema operativo que antes salía de acá.
export function useSyncMonitor() {
  const showToast = useToastStore(s => s.showToast);
  const { hasPermission } = useAuth();

  // Un sync fallido es una ALERTA TÉCNICA, no una notificación de negocio: el
  // ERP no entregó datos y quien puede hacer algo es sistemas. Antes le caía a
  // los 59 empleados —`inventory_sync_log` tiene `SELECT USING (true)` y está
  // en la publicación de Realtime—, así que un dependiente de Salud 3 recibía,
  // en pantalla y en el celular, que había fallado el inventario de Salud 1.
  // El gate es el módulo `sync_health`, que ya existe y ya está asignado al rol
  // "Sistema — Alertas Técnicas".
  const puedeVerAlertas = hasPermission('sync_health', 'can_view');

  useEffect(() => {
    if (!puedeVerAlertas) return;

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
            'No se pudo traer el inventario de esta sucursal.',
          );
          showToast(title, body, 'error');
          fireBrowserNotif(`Farmalasa · ${title}`, body, `sync-fail-${row.id}`);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [showToast, puedeVerAlertas]);
}
