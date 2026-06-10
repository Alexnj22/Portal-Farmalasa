import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Check, X, Clock, Package, ArrowRight, Inbox } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';

const ERP_NAMES = { 1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5' };

const STATUS_CFG = {
  pending:  { label: 'Pendiente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'Aprobada',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Rechazada', cls: 'bg-red-50 text-red-600 border-red-200' },
};

function relTime(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 2) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return new Date(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
}

export default function TabMinMaxRequests({ searchTerm = '' }) {
  const { user } = useAuth();
  const appendAuditLog = useStaff(s => s.appendAuditLog);

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('pending'); // pending | history
  const [busyId, setBusyId]   = useState(null);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('minmax_change_requests')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const notifyRequester = useCallback(async (req, approved, note) => {
    if (!req.requested_by_id) return;
    try {
      await supabase.functions.invoke('send-push-notification', {
        body: {
          title: approved ? '✅ Ajuste Min/Max aprobado' : '❌ Ajuste Min/Max rechazado',
          message: approved
            ? `Tu propuesta para ${req.product_name} (${ERP_NAMES[req.erp_sucursal_id] || req.erp_sucursal_id}) fue aplicada: MIN ${req.requested_min} · MAX ${req.requested_max}.`
            : `Tu propuesta para ${req.product_name} fue rechazada.${note ? ' Motivo: ' + note : ''}`,
          url: '/minmax',
          target_type: 'EMPLOYEE',
          target_value: [req.requested_by_id],
        },
      });
    } catch { /* no-fatal */ }
  }, []);

  const decide = useCallback(async (req, approve) => {
    setBusyId(req.id);
    setError(null);
    try {
      let note = null;
      if (!approve) {
        note = window.prompt('Motivo del rechazo (opcional):') ?? null;
      }
      const fn = approve ? 'approve_minmax_request' : 'reject_minmax_request';
      const { error } = await supabase.rpc(fn, {
        p_request_id: req.id,
        p_decided_by: user?.email ?? null,
        p_note: note,
      });
      if (error) throw error;

      await appendAuditLog(approve ? 'MINMAX_REQUEST_APPROVED' : 'MINMAX_REQUEST_REJECTED', String(req.id), {
        product: req.product_name, sucursal_id: req.erp_sucursal_id,
        requested_min: req.requested_min, requested_max: req.requested_max, note,
      });
      await notifyRequester(req, approve, note);
      await load();
    } catch (e) {
      setError(e.message?.includes('NO_PERMISSION') || e.message?.includes('row-level')
        ? 'No tenés permiso para aprobar (can_approve en Min/Max).'
        : (e.message || 'Error al procesar'));
    } finally {
      setBusyId(null);
    }
  }, [user, appendAuditLog, notifyRequester, load]);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return rows.filter(r => {
      if (tab === 'pending' && r.status !== 'pending') return false;
      if (tab === 'history' && r.status === 'pending') return false;
      if (q && !r.product_name?.toLowerCase().includes(q) && !r.requested_by_name?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tab, searchTerm]);

  const pendingCount = useMemo(() => rows.filter(r => r.status === 'pending').length, [rows]);

  return (
    <div className="flex flex-col gap-3">
      {/* Sub-tabs */}
      <div className="flex items-center gap-2">
        {[['pending', `Pendientes${pendingCount ? ` (${pendingCount})` : ''}`], ['history', 'Historial']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-colors ${
              tab === k ? 'bg-[#0052CC] text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-[#0052CC]/40'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2 text-[12px] font-semibold text-red-600 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)}><X size={13} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-slate-300" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-300">
          <Inbox size={32} strokeWidth={1.5} />
          <p className="text-[13px] font-semibold text-slate-400">
            {tab === 'pending' ? 'No hay solicitudes pendientes' : 'Sin historial de solicitudes'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const st = STATUS_CFG[r.status] ?? STATUS_CFG.pending;
            const isPending = r.status === 'pending';
            const busy = busyId === r.id;
            return (
              <div key={r.id} className="rounded-2xl border border-slate-150 bg-white px-4 py-3 flex items-center gap-4">
                <Package size={16} className="text-slate-300 shrink-0" strokeWidth={2} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-bold text-slate-800 truncate">{r.product_name || `Producto ${r.erp_product_id}`}</span>
                    <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {ERP_NAMES[r.erp_sucursal_id] || r.erp_sucursal_id} · {r.requested_by_name || r.requested_by} · {relTime(r.requested_at)}
                  </div>
                  {r.reason && <div className="text-[11px] text-slate-500 mt-1 italic truncate">“{r.reason}”</div>}
                  {!isPending && r.decision_note && (
                    <div className="text-[10px] text-slate-400 mt-0.5">Nota: {r.decision_note}</div>
                  )}
                </div>

                {/* Valores: actual → propuesto */}
                <div className="shrink-0 flex items-center gap-2 text-[12px] font-bold tabular-nums">
                  <div className="text-right text-slate-400">
                    <div>MIN {r.current_min ?? '—'}</div>
                    <div>MAX {r.current_max ?? '—'}</div>
                  </div>
                  <ArrowRight size={13} className="text-slate-300" />
                  <div className="text-right">
                    <div className="text-orange-600">MIN {r.requested_min}</div>
                    <div className="text-blue-600">MAX {r.requested_max}</div>
                  </div>
                </div>

                {/* Acciones */}
                {isPending ? (
                  <div className="shrink-0 flex items-center gap-1.5">
                    <button onClick={() => decide(r, true)} disabled={busy}
                      className="h-8 px-3 rounded-lg text-[11px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1 transition-colors">
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />} Aprobar
                    </button>
                    <button onClick={() => decide(r, false)} disabled={busy}
                      className="h-8 w-8 flex items-center justify-center rounded-lg text-red-400 hover:text-white hover:bg-red-500 disabled:opacity-50 transition-colors" title="Rechazar">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="shrink-0 text-[9px] text-slate-400 flex items-center gap-1">
                    <Clock size={10} /> {relTime(r.decided_at)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
