import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';

const WARN_MINS  = 8;   // yellow threshold
const STALE_MINS = 15;  // red threshold

function dotColor(minsAgo, hasError) {
  if (hasError || minsAgo === null) return 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.7)]';
  if (minsAgo > STALE_MINS) return 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.7)]';
  if (minsAgo > WARN_MINS)  return 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.7)]';
  return 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.7)]';
}

export default function SyncHealthBanner() {
  const [branches, setBranches]   = useState([]);
  const [notifPerm, setNotifPerm] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const fetchLatest = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('inventory_sync_log')
      .select('erp_sucursal_id, success, synced_at, error_msg, items_count')
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
      .channel('sync-health-banner')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inventory_sync_log' }, fetchLatest)
      .subscribe();
    return () => { clearInterval(timer); supabase.removeChannel(channel); };
  }, [fetchLatest]);

  const requestNotif = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  };

  const now = Date.now();

  const hasErrors = branches.some(b => !b.success);
  const anyStale  = branches.some(b => {
    const m = (now - new Date(b.synced_at).getTime()) / 60000;
    return m > STALE_MINS;
  });
  const allGood = branches.length > 0 && !hasErrors && !anyStale;

  const latestMs = branches.length
    ? Math.max(...branches.map(b => new Date(b.synced_at).getTime()))
    : null;
  const minsAgoLatest = latestMs ? Math.round((now - latestMs) / 60000) : null;

  return (
    <div className={`flex items-center gap-3 px-4 py-2 rounded-[1.25rem] border text-[11px] font-semibold transition-colors ${
      hasErrors || anyStale
        ? 'bg-red-50/80 border-red-200/60'
        : allGood
        ? 'bg-emerald-50/60 border-emerald-200/50'
        : 'bg-slate-50/80 border-slate-100'
    }`}>
      {/* Status icon */}
      {hasErrors || anyStale
        ? <AlertTriangle size={13} className="text-red-500 shrink-0" />
        : <CheckCircle2  size={13} className="text-emerald-500 shrink-0" />
      }

      {/* Branch dots */}
      <div className="flex items-center gap-1.5">
        {branches.length === 0
          ? [1,2,3,4,5,6,7].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-slate-200 animate-pulse" />
            ))
          : branches.map(b => {
              const m = (now - new Date(b.synced_at).getTime()) / 60000;
              return (
                <div key={b.erp_sucursal_id} className="relative group/dot">
                  <div className={`w-2 h-2 rounded-full ${dotColor(m, !b.success)}`} />
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-xl whitespace-nowrap opacity-0 group-hover/dot:opacity-100 transition-opacity pointer-events-none z-[200] shadow-lg">
                    <span className="text-slate-300">Suc. {b.erp_sucursal_id}</span> · {b.items_count?.toLocaleString()} items · {Math.round(m)}min
                    {!b.success && <><br /><span className="text-red-400">{b.error_msg}</span></>}
                  </div>
                </div>
              );
            })
        }
      </div>

      {/* Summary text */}
      <span className={`${hasErrors || anyStale ? 'text-red-700' : allGood ? 'text-emerald-700' : 'text-slate-500'}`}>
        {hasErrors
          ? `${branches.filter(b => !b.success).length} suc. con error`
          : anyStale
          ? `Sync retrasado`
          : allGood
          ? 'Inventario al día'
          : 'Cargando estado...'
        }
      </span>

      {/* Time ago */}
      {minsAgoLatest !== null && (
        <span className="text-slate-400 ml-auto shrink-0">
          hace {minsAgoLatest === 0 ? '<1' : minsAgoLatest} min
        </span>
      )}

      {/* Notification toggle */}
      {notifPerm === 'default' && (
        <button
          onClick={requestNotif}
          className="flex items-center gap-1 text-slate-400 hover:text-[#0052CC] transition-colors ml-1 shrink-0 group/bell"
          title="Activar alertas de escritorio"
        >
          <Bell size={12} className="group-hover/bell:animate-[bounce_0.4s_ease-in-out]" />
          <span className="text-[10px] hidden sm:inline">Activar alertas</span>
        </button>
      )}
      {notifPerm === 'granted' && (
        <Bell size={12} className="text-emerald-500 ml-1 shrink-0" title="Alertas de escritorio activas" />
      )}
    </div>
  );
}
