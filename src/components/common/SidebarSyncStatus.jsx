import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { fetchInventorySyncLogRecent } from '../../data/inventory';
import { usePushSubscription } from '../../hooks/usePushSubscription';
import { useNowTick } from '../../hooks/useNowTick';

const WARN_MINS  = 8;
const STALE_MINS = 15;

function dotClass(minsAgo, hasError) {
  if (hasError || minsAgo === null || minsAgo > STALE_MINS)
    return 'bg-danger shadow-[var(--shadow-glow-danger-sm)]';
  if (minsAgo > WARN_MINS)
    return 'bg-warning shadow-[var(--shadow-glow-warning-sm)]';
  return 'bg-success shadow-[var(--shadow-glow-success-sm)]';
}

export default function SidebarSyncStatus() {
  const [branches, setBranches] = useState([]);
  const { permission, subscribed, subscribe, isSupported } = usePushSubscription();

  const fetchLatest = useCallback(async () => {
    const { data, error } = await fetchInventorySyncLogRecent();
    if (error) console.error('SidebarSyncStatus: fetch inventory_sync_log failed:', error.message);

    if (!data) return;
    const byBranch = {};
    for (const row of data) {
      if (!byBranch[row.erp_sucursal_id]) byBranch[row.erp_sucursal_id] = row;
    }
    setBranches(Object.values(byBranch).sort((a, b) => a.erp_sucursal_id - b.erp_sucursal_id));
  }, []);

  useEffect(() => {
    fetchLatest(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
    const timer = setInterval(fetchLatest, 90_000);
    const channel = supabase
      .channel('sidebar-sync-status')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inventory_sync_log' }, fetchLatest)
      .subscribe();
    return () => { clearInterval(timer); supabase.removeChannel(channel); };
  }, [fetchLatest]);

  const now       = useNowTick();
  const hasErrors = branches.some(b => !b.success);
  const anyStale  = branches.some(b => (now - new Date(b.synced_at).getTime()) / 60000 > STALE_MINS);
  const allGood   = branches.length > 0 && !hasErrors && !anyStale;

  const latestMs      = branches.length ? Math.max(...branches.map(b => new Date(b.synced_at).getTime())) : null;
  const minsAgoLatest = latestMs ? Math.round((now - latestMs) / 60000) : null;

  const bellGranted = subscribed && permission === 'granted';
  const bellDenied  = permission === 'denied';

  // Vive sobre fondo siempre-oscuro (sidebar / SidebarSettingsMenu — ambos
  // bespoke, no reaccionan al tema a propósito, ver DESIGN.md §2 "Sidebar:
  // se mantiene oscura e invariante al tema").
  const cardCls    = 'bg-white/[0.06] border-white/[0.09]';
  const labelCls   = 'text-white/45';
  const dimIconCls = 'text-white/30';
  const dotIdleCls = 'bg-white/15';
  const timeAgoCls = 'text-white/25';

  return (
    <div className="grid grid-cols-2 gap-1.5">

      {/* ── Left: sync status ─────────────────────────────────────────────── */}
      <div className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2 border ${cardCls}`}>
        {/* Label row */}
        <div className="flex items-center gap-1 mb-0.5">
          {hasErrors || anyStale
            ? <AlertTriangle size={10} className="text-danger" />
            : <CheckCircle2  size={10} className={allGood ? 'text-success' : dimIconCls} />
          }
          <span className={`text-micro font-semibold uppercase tracking-wider ${labelCls}`}>Sync</span>
        </div>
        {/* Dots row */}
        <div className="flex items-center justify-center gap-[3px] flex-wrap">
          {branches.length === 0
            ? [1,2,3,4,5,6,7].map(i => (
                <div key={i} className={`w-[5px] h-[5px] rounded-full animate-pulse ${dotIdleCls}`} />
              ))
            : branches.map(b => {
                const m = (now - new Date(b.synced_at).getTime()) / 60000;
                return (
                  <div key={b.erp_sucursal_id} className="relative group/sdot">
                    <div className={`w-[5px] h-[5px] rounded-full ${dotClass(m, !b.success)}`} />
                    <div data-surface="tooltip" className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 text-caption font-bold px-2 py-1 whitespace-nowrap opacity-0 group-hover/sdot:opacity-100 focus-within:opacity-100 transition-opacity pointer-events-none z-flyout">
                      Suc. {b.erp_sucursal_id} · {Math.round(m)}min
                      {!b.success && <><br /><span className="text-danger font-medium">{b.error_msg}</span></>}
                    </div>
                  </div>
                );
              })
          }
        </div>
        {/* Time ago */}
        {minsAgoLatest !== null && (
          <span className={`text-micro tabular-nums mt-0.5 ${timeAgoCls}`}>
            {minsAgoLatest === 0 ? '<1' : minsAgoLatest}m
          </span>
        )}
      </div>

      {/* ── Right: notification bell ──────────────────────────────────────── */}
      {!isSupported ? (
        <div className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2 border opacity-30 ${cardCls}`}>
          <BellOff size={14} className={dimIconCls} />
          <span className={`text-micro uppercase tracking-wider font-semibold ${labelCls}`}>N/D</span>
        </div>
      ) : (
        <button
          onClick={bellGranted || bellDenied ? undefined : subscribe}
          disabled={bellDenied}
          title={bellDenied ? 'Actívalas en la configuración del navegador' : undefined}
          className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2 cursor-pointer outline-none transition border
            ${bellGranted
              ? 'bg-success/[0.10] border-success/[0.18] cursor-default'
              : bellDenied
              ? 'bg-white/[0.03] border-white/[0.05] cursor-not-allowed opacity-40'
              : `${cardCls} hover:bg-chart-3/[0.12] hover:border-chart-3/[0.18] hover:scale-[1.02] active:scale-[0.98]`
            }`}
        >
          <div className="flex items-center gap-1 mb-0.5">
            {bellGranted
              ? <CheckCircle2 size={10} className="text-success" />
              : <Bell size={10} className={bellDenied ? dimIconCls : labelCls} />
            }
            <span className={`text-micro font-semibold uppercase tracking-wider ${
              bellGranted ? 'text-success/70' : labelCls
            }`}>
              Alertas
            </span>
          </div>
          <span className={`text-micro font-black text-center leading-tight ${
            bellGranted ? 'text-success' : bellDenied ? timeAgoCls : 'text-white/55'
          }`}>
            {bellGranted ? 'Activas' : bellDenied ? 'Bloqueadas' : 'Activar'}
          </span>
        </button>
      )}

    </div>
  );
}
