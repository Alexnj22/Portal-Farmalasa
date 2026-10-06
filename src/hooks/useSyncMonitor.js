import { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import { mensajeAmigable } from '../utils/errorMessages';
import { fireBrowserNotif } from '@plataforma/browserNotif';
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
// Corridas seguidas sin entrar antes de avisar. El cron es de 1 minuto: son
// ~3 minutos con el inventario de la sucursal congelado.
const FALLAS_PARA_AVISAR = 3;

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
        async ({ new: row }) => {
          // Un tropiezo suelto NO es una alerta. El cron corre cada minuto y el
          // ERP a veces tarda más que el límite de la petición: medido el
          // 2026-10-05, 1 falla en 480 corridas de la última hora, y la
          // siguiente —13 s después— salió bien. Esa falla llegó como
          // notificación del sistema operativo diciendo «Revisa tu conexión»,
          // sobre un problema que ni era de la conexión de quien la leía ni
          // seguía existiendo cuando la leyó.
          //
          // Se avisa cuando la sucursal lleva FALLAS_PARA_AVISAR corridas
          // seguidas sin entrar, y UNA vez por caída: sólo si la corrida de
          // antes de esa racha salió bien (o no existe). Con `>=` en vez de
          // `===` avisaría cada minuto mientras dure la caída.
          const { data: ultimas, error } = await supabase
            .from('inventory_sync_log')
            .select('success')
            .eq('erp_sucursal_id', row.erp_sucursal_id)
            .eq('is_vencidos', row.is_vencidos)
            .lte('synced_at', row.synced_at)
            .order('synced_at', { ascending: false })
            .limit(FALLAS_PARA_AVISAR + 1);
          if (error) { console.warn('[useSyncMonitor]', error.message); return; }
          const racha = ultimas.findIndex(r => r.success);
          const seguidas = racha === -1 ? ultimas.length : racha;
          if (seguidas !== FALLAS_PARA_AVISAR) return;

          // `error_msg` es el error CRUDO del cron: nombre de la función de
          // Postgres más lo que haya devuelto el ERP. El 2026-08-01 esto llegó
          // a un usuario como `sync_inventory_batch: <!DOCTYPE html>…`, por
          // toast y por notificación del sistema operativo a la vez. El texto
          // real queda en `inventory_sync_log` para quien depura; acá se
          // muestra qué pasó, no cómo se llama la función que falló.
          //
          // El timeout se traduce ACÁ y no con `mensajeAmigable`: su texto
          // genérico manda a revisar la conexión propia, y aquí quien no
          // respondió fue la sucursal.
          const sucursal = ERP_NAMES[row.erp_sucursal_id] ?? `Sucursal ${row.erp_sucursal_id}`;
          const title = `Inventario sin actualizar · ${sucursal}`;
          const causa = /timed out|timeout|aborted/i.test(row.error_msg ?? '')
            ? 'La sucursal no está respondiendo a tiempo.'
            : mensajeAmigable(row.error_msg, 'No se pudo traer el inventario de esta sucursal.');
          const body = `${causa} Van ${FALLAS_PARA_AVISAR} intentos seguidos sin actualizarse; se sigue reintentando cada minuto.`;
          showToast(title, body, 'error');
          fireBrowserNotif(`Farmalasa · ${title}`, body, `sync-fail-${row.id}`);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [showToast, puedeVerAlertas]);
}
