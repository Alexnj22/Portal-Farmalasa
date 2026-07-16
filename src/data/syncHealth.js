import { supabase } from '../supabaseClient';

// SyncHealthView.jsx (bloque 7B.3) — historial reciente de v_sync_health
// (Fase 0), limitado a los 4 dominios sin monitoreo operativo propio hoy
// (dte tiene check-sales-alerts, inventory tiene SyncHealthBanner/useSyncMonitor).
export const SYNC_HEALTH_DOMAINS = ['products', 'minmax', 'purchases', 'backup'];

export function fetchSyncHealthRecent(limit = 200) {
    return supabase.from('v_sync_health')
        .select('domain, source, branch_id, erp_sucursal_id, checked_at, success, error_msg')
        .in('domain', SYNC_HEALTH_DOMAINS)
        .order('checked_at', { ascending: false })
        .limit(limit);
}
