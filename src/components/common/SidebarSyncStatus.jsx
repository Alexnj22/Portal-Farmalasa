import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { usePushSubscription } from '../../hooks/usePushSubscription';
import { useNowTick } from '../../hooks/useNowTick';

const WARN_MINS  = 8;
const STALE_MINS = 15;

function dotClass(minsAgo, hasError) {
  if (hasError || minsAgo === null || minsAgo > STALE_MINS)
    return 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.8)]';
  if (minsAgo > WARN_MINS)
    return 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]';
  return 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.8)]';
}

export default function SidebarSyncStatus() {
  const [branches, setBranches] = useState([]);
  const { permission, subscribed, subscribe, isSupported } = usePushSubscription();

  const fetchLatest = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('inventory_sync_log')
      .select('erp_sucursal_id, success, synced_at, error_msg')
      .gte('synced_at', since)
      .eq('is_vencidos', false)
      .order('synced_at', { ascending: false })
      .limit(60);
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

  return (
    <div className="grid grid-cols-2 gap-1.5">

      {/* ── Left: sync status ─────────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2 border bg-white/[0.06] border-white/[0.09]">
        {/* Label row */}
        <div className="flex items-center gap-1 mb-0.5">
          {hasErrors || anyStale
            ? <AlertTriangle size={10} className="text-red-400" />
            : <CheckCircle2  size={10} className={allGood ? 'text-emerald-400' : 'text-white/30'} />
          }
          <span className="text-[9px] font-semibold text-white/45 uppercase tracking-wider">Sync</span>
        </div>
        {/* Dots row */}
        <div className="flex items-center justify-center gap-[3px] flex-wrap">
          {branches.length === 0
            ? [1,2,3,4,5,6,7].map(i => (
                <div key={i} className="w-[5px] h-[5px] rounded-full bg-white/15 animate-pulse" />
              ))
            : branches.map(b => {
                const m = (now - new Date(b.synced_at).getTime()) / 60000;
                return (
                  <div key={b.erp_sucursal_id} className="relative group/sdot">
                    <div className={`w-[5px] h-[5px] rounded-full ${dotClass(m, !b.success)}`} />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-slate-900 border border-white/10 text-white text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover/sdot:opacity-100 transition-opacity pointer-events-none z-[300] shadow-xl">
                      Suc. {b.erp_sucursal_id} · {Math.round(m)}min
                      {!b.success && <><br /><span className="text-red-400 font-medium">{b.error_msg}</span></>}
                    </div>
                  </div>
                );
              })
          }
        </div>
        {/* Time ago */}
        {minsAgoLatest !== null && (
          <span className="text-[9px] text-white/25 tabular-nums mt-0.5">
            {minsAgoLatest === 0 ? '<1' : minsAgoLatest}m
          </span>
        )}
      </div>

      {/* ── Right: notification bell ──────────────────────────────────────── */}
      {!isSupported ? (
        <div className="flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2 border bg-white/[0.06] border-white/[0.09] opacity-30">
          <BellOff size={14} className="text-white/40" />
          <span className="text-[9px] text-white/35 uppercase tracking-wider font-semibold">N/D</span>
        </div>
      ) : (
        <button
          onClick={bellGranted || bellDenied ? undefined : subscribe}
          disabled={bellDenied}
          title={bellDenied ? 'Actívalas en la configuración del navegador' : undefined}
          className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2 cursor-pointer outline-none transition-all border
            ${bellGranted
              ? 'bg-emerald-500/[0.10] border-emerald-400/[0.18] cursor-default'
              : bellDenied
              ? 'bg-white/[0.03] border-white/[0.05] cursor-not-allowed opacity-40'
              : 'bg-white/[0.06] border-white/[0.09] hover:bg-violet-500/[0.12] hover:border-violet-400/[0.18] hover:scale-[1.02] active:scale-[0.98]'
            }`}
        >
          <div className="flex items-center gap-1 mb-0.5">
            {bellGranted
              ? <CheckCircle2 size={10} className="text-emerald-400" />
              : <Bell size={10} className={bellDenied ? 'text-white/30' : 'text-white/40'} />
            }
            <span className={`text-[9px] font-semibold uppercase tracking-wider ${
              bellGranted ? 'text-emerald-400/70' : 'text-white/45'
            }`}>
              Alertas
            </span>
          </div>
          <span className={`text-[9px] font-black text-center leading-tight ${
            bellGranted ? 'text-emerald-400' : bellDenied ? 'text-white/25' : 'text-white/55'
          }`}>
            {bellGranted ? 'Activas' : bellDenied ? 'Bloqueadas' : 'Activar'}
          </span>
        </button>
      )}

    </div>
  );
}
