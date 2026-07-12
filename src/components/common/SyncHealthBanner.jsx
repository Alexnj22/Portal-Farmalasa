import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';

const WARN_MINS  = 8;
const STALE_MINS = 15;

function dotColor(minsAgo, hasError) {
  if (hasError || minsAgo === null) return 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.6)]';
  if (minsAgo > STALE_MINS) return 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.6)]';
  if (minsAgo > WARN_MINS)  return 'bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.6)]';
  return 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.6)]';
}

// Inner content for the sync_health dashboard widget.
// Rendered inside a WidgetCard — no outer wrapper needed.
export default function SyncHealthBanner() {
  const [branches, setBranches]   = useState([]);
  const [notifPerm, setNotifPerm] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const fetchLatest = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('inventory_sync_log')
      .select('erp_sucursal_id, success, synced_at, error_msg, items_count')
      .gte('synced_at', since)
      .eq('is_vencidos', false)
      .order('synced_at', { ascending: false })
      .limit(60);
    if (error) console.error('SyncHealthBanner: fetch inventory_sync_log failed:', error.message);

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
    return () => clearInterval(timer);
  }, [fetchLatest]);

  const requestNotif = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  };

  const now = Date.now();
  const hasErrors = branches.some(b => !b.success);
  const anyStale  = branches.some(b => (now - new Date(b.synced_at).getTime()) / 60000 > STALE_MINS);
  const allGood   = branches.length > 0 && !hasErrors && !anyStale;

  const latestMs      = branches.length ? Math.max(...branches.map(b => new Date(b.synced_at).getTime())) : null;
  const minsAgoLatest = latestMs ? Math.round((now - latestMs) / 60000) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary strip */}
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-white/40 shrink-0 ${
        hasErrors || anyStale ? 'bg-red-50/60' : allGood ? 'bg-emerald-50/50' : ''
      }`}>
        {hasErrors || anyStale
          ? <AlertTriangle size={13} className="text-red-500 shrink-0" />
          : <CheckCircle2  size={13} className="text-emerald-500 shrink-0" />
        }
        <span className={`text-[11px] font-black flex-1 ${
          hasErrors || anyStale ? 'text-red-700' : allGood ? 'text-emerald-700' : 'text-slate-500'
        }`}>
          {hasErrors
            ? `${branches.filter(b => !b.success).length} suc. con error`
            : anyStale ? 'Sync retrasado'
            : allGood  ? 'Inventario al día'
            : 'Verificando...'}
        </span>
        {minsAgoLatest !== null && (
          <span className="text-[10px] text-slate-400 shrink-0">
            hace {minsAgoLatest === 0 ? '<1' : minsAgoLatest} min
          </span>
        )}
      </div>

      {/* Branch list */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] divide-y divide-white/40 p-1.5 space-y-0.5">
        {branches.length === 0
          ? [1,2,3,4,5,6,7].map(i => (
              <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl">
                <div className="w-2 h-2 rounded-full bg-slate-200 animate-pulse shrink-0" />
                <div className="flex-1 h-2 bg-slate-100 rounded animate-pulse" />
                <div className="w-10 h-2 bg-slate-100 rounded animate-pulse" />
              </div>
            ))
          : branches.map(b => {
              const m      = (now - new Date(b.synced_at).getTime()) / 60000;
              const mRound = Math.round(m);
              const isErr  = !b.success;
              return (
                <div key={b.erp_sucursal_id}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors ${
                    isErr ? 'bg-red-50/60' : mRound > STALE_MINS ? 'bg-amber-50/50' : ''
                  }`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor(m, isErr)}`} />
                  <span className="text-[11px] font-black text-slate-700 w-10 shrink-0">
                    Suc. {b.erp_sucursal_id}
                  </span>
                  {isErr
                    ? <span className="flex-1 text-[10px] text-red-500 font-medium truncate">{b.error_msg || 'Error'}</span>
                    : <span className="flex-1 text-[10px] text-slate-400">
                        {b.items_count?.toLocaleString('es')} items
                      </span>
                  }
                  <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                    {mRound === 0 ? '<1' : mRound}m
                  </span>
                </div>
              );
            })
        }
      </div>

      {/* Footer: notification permission */}
      {notifPerm !== 'granted' && notifPerm !== 'denied' && notifPerm !== 'unsupported' && (
        <button
          onClick={requestNotif}
          className="flex items-center justify-center gap-1.5 py-2 border-t border-white/40 text-[10px] font-bold text-slate-400 hover:text-[#0052CC] transition-colors shrink-0"
        >
          <Bell size={11} />
          Activar alertas de escritorio
        </button>
      )}
      {notifPerm === 'granted' && (
        <div className="flex items-center justify-center gap-1.5 py-1.5 border-t border-white/40 shrink-0">
          <Bell size={10} className="text-emerald-500" />
          <span className="text-[10px] text-emerald-600 font-semibold">Alertas activas</span>
        </div>
      )}
    </div>
  );
}
