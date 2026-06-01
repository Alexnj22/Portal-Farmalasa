import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabaseClient';

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
  const [branches, setBranches]   = useState([]);
  const [notifPerm, setNotifPerm] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const fetchLatest = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('inventory_sync_log')
      .select('erp_sucursal_id, success, synced_at, error_msg')
      .gte('synced_at', since)
      .eq('is_vencidos', false)
      .order('synced_at', { ascending: false })
      .limit(60);

    if (!data) return;
    const byBranch = {};
    for (const row of data) {
      if (!byBranch[row.erp_sucursal_id]) byBranch[row.erp_sucursal_id] = row;
    }
    setBranches(Object.values(byBranch).sort((a, b) => a.erp_sucursal_id - b.erp_sucursal_id));
  }, []);

  useEffect(() => {
    fetchLatest();
    const timer = setInterval(fetchLatest, 90_000);
    const channel = supabase
      .channel('sidebar-sync-status')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inventory_sync_log' }, fetchLatest)
      .subscribe();
    return () => { clearInterval(timer); supabase.removeChannel(channel); };
  }, [fetchLatest]);

  const requestNotif = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  };

  const now       = Date.now();
  const hasErrors = branches.some(b => !b.success);
  const anyStale  = branches.some(b => (now - new Date(b.synced_at).getTime()) / 60000 > STALE_MINS);
  const allGood   = branches.length > 0 && !hasErrors && !anyStale;

  const latestMs      = branches.length ? Math.max(...branches.map(b => new Date(b.synced_at).getTime())) : null;
  const minsAgoLatest = latestMs ? Math.round((now - latestMs) / 60000) : null;

  return (
    <div className="rounded-xl border bg-white/[0.05] border-white/[0.08] overflow-hidden">
      {/* Status header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {hasErrors || anyStale
          ? <AlertTriangle size={10} className="text-red-400 shrink-0" />
          : <CheckCircle2  size={10} className={allGood ? 'text-emerald-400 shrink-0' : 'text-white/30 shrink-0'} />
        }
        <span className={`text-[10px] font-bold flex-1 truncate ${
          hasErrors || anyStale ? 'text-red-400' : allGood ? 'text-emerald-400' : 'text-white/35'
        }`}>
          {hasErrors ? 'Error en sync' : anyStale ? 'Sync retrasado' : allGood ? 'Inventario al día' : 'Verificando…'}
        </span>
        {minsAgoLatest !== null && (
          <span className="text-[9px] text-white/30 shrink-0 tabular-nums">
            {minsAgoLatest === 0 ? '<1' : minsAgoLatest}m
          </span>
        )}
      </div>

      {/* Branch dots */}
      <div className="flex items-center gap-1 px-2.5 pb-2">
        {branches.length === 0
          ? [1,2,3,4,5,6,7].map(i => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-white/15 animate-pulse" />
            ))
          : branches.map(b => {
              const m = (now - new Date(b.synced_at).getTime()) / 60000;
              return (
                <div key={b.erp_sucursal_id} className="relative group/sdot">
                  <div className={`w-1.5 h-1.5 rounded-full ${dotClass(m, !b.success)}`} />
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-slate-900 border border-white/10 text-white text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover/sdot:opacity-100 transition-opacity pointer-events-none z-[300] shadow-xl">
                    Suc. {b.erp_sucursal_id} · {Math.round(m)}min
                    {!b.success && <><br /><span className="text-red-400 font-medium">{b.error_msg}</span></>}
                  </div>
                </div>
              );
            })
        }
      </div>

      {/* Notification row — always visible */}
      <div className="border-t border-white/[0.07]">
        {notifPerm === 'granted' ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
            <Bell size={10} className="text-emerald-400 shrink-0" />
            <span className="text-[10px] text-emerald-400 font-semibold">Alertas activas</span>
          </div>
        ) : notifPerm === 'denied' ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5" title="Activa las notificaciones desde la configuración de tu navegador">
            <BellOff size={10} className="text-white/25 shrink-0" />
            <span className="text-[10px] text-white/25">Bloqueadas en navegador</span>
          </div>
        ) : notifPerm === 'unsupported' ? null : (
          <button
            onClick={requestNotif}
            className="flex items-center gap-1.5 px-2.5 py-1.5 w-full text-left group/bell hover:bg-white/[0.05] transition-colors"
          >
            <Bell size={10} className="text-white/35 group-hover/bell:text-[#818CF8] shrink-0 transition-colors" />
            <span className="text-[10px] text-white/35 group-hover/bell:text-white/60 transition-colors font-medium">
              Activar alertas
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
