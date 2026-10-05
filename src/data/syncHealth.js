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

/** Cómo se llama cada dominio en pantalla. */
export const ROTULO_DE_DOMINIO = { products: 'Productos', minmax: 'Min / Max', purchases: 'Compras', backup: 'Respaldo' };

/** A qué alcanza una corrida: una sucursal del origen, una del portal, o todo. */
export function alcanceDeCorrida(row, nombreDeSala = {}, nombreDeOrigen = {}) {
    if (row.erp_sucursal_id != null) return nombreDeOrigen[row.erp_sucursal_id] || `Sucursal ${row.erp_sucursal_id}`;
    if (row.branch_id != null) return nombreDeSala[row.branch_id] || `Sucursal ${row.branch_id}`;
    return 'Global';
}

/**
 * El estado de cada dominio: su última corrida y, si falló, desde cuándo no
 * tiene una buena. Las filas llegan de la más reciente a la más vieja.
 */
export function estadoPorDominio(rows) {
    const m = {};
    for (const d of SYNC_HEALTH_DOMAINS) m[d] = { dominio: d, ultima: null, ultimaBuena: null, fallas: 0 };
    for (const r of rows || []) {
        const e = m[r.domain];
        if (!e) continue;
        if (!e.ultima) e.ultima = r;
        if (r.success && !e.ultimaBuena) e.ultimaBuena = r;
        if (!r.success) e.fallas += 1;
    }
    return SYNC_HEALTH_DOMAINS.map((d) => m[d]);
}
