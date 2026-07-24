import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Check, X, Clock, Package, ArrowRight, Inbox, CheckCheck, TrendingUp, Building2 } from 'lucide-react';
import { tokenMatch } from '../../utils/searchUtils';
import { supabase } from '../../supabaseClient';
import { fetchAllMinMaxChangeRequests } from '../../data/minmaxRequests';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { notifyEmployees } from '../../utils/notify';
import LiquidSelect from '../../components/common/LiquidSelect';
import ConfirmModal from '../../components/common/ConfirmModal';
import { ERP_NAMES, ERP_ORDER } from './tabminmax/constants';

const STATUS_CFG = {
  pending:  { label: 'Pendiente', cls: 'bg-warning/80 text-amber-700 border-warning/30' },
  approved: { label: 'Aprobada',  cls: 'bg-success/80 text-emerald-700 border-success/30' },
  rejected: { label: 'Rechazada', cls: 'bg-danger/80 text-danger border-danger/30' },
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

function Avatar({ emp, name }) {
  const photo = emp?.photo || emp?.photo_url || null;
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (photo) return <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover border border-border-card shadow-sm shrink-0" />;
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-content-2 flex items-center justify-center text-[13px] font-black shrink-0 border border-border-card">
      {initial}
    </div>
  );
}

// ─── Card de solicitud ─────────────────────────────────────────────────────────
function RequestCard({ r, emp, busy, onApprove, onReject }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote]           = useState('');
  const st        = STATUS_CFG[r.status] ?? STATUS_CFG.pending;
  const isPending = r.status === 'pending';
  const name      = r.requested_by_name || emp?.name || r.requested_by;

  return (
    <div className="rounded-2xl border border-border-card bg-surface-card backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_4px_20px_rgba(0,0,0,0.05)] p-4 flex flex-col gap-3 transition-shadow hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_28px_rgba(0,0,0,0.09)]">

      {/* Header: solicitante + estado */}
      <div className="flex items-center gap-2.5">
        <Avatar emp={emp} name={name} />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-content truncate">{name}</p>
          <p className="text-[10px] text-content-3">{relTime(r.requested_at)}</p>
        </div>
        <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
      </div>

      {/* Producto + sucursal */}
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-content leading-tight truncate">{r.product_name || `Producto ${r.erp_product_id}`}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-content-3 bg-surface-card-hover/70 px-2 py-0.5 rounded-full">
            <Building2 size={10} /> {ERP_NAMES[r.erp_sucursal_id] || r.erp_sucursal_id}
          </span>
          {r.current_sales_6m != null && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-success bg-success/70 px-2 py-0.5 rounded-full">
              <TrendingUp size={10} /> {Number(r.current_sales_6m).toLocaleString()} und · 6m
            </span>
          )}
        </div>
      </div>

      {/* Valores: actual → propuesto */}
      <div className="flex items-center justify-center gap-3 rounded-xl bg-surface-card-hover/70 border border-slate-100 py-2">
        <div className="text-right text-[12px] font-bold tabular-nums text-content-3">
          <div>MIN {r.current_min ?? '—'}</div>
          <div>MAX {r.current_max ?? '—'}</div>
        </div>
        <ArrowRight size={15} className="text-content-3" />
        <div className="text-left text-[12px] font-black tabular-nums">
          <div className="text-orange-600">MIN {r.requested_min}</div>
          <div className="text-blue-600">MAX {r.requested_max}</div>
        </div>
      </div>

      {/* Motivo del solicitante */}
      {r.reason && <p className="text-[11px] text-content-3 italic leading-snug">“{r.reason}”</p>}

      {/* Nota de decisión (historial) */}
      {!isPending && r.decision_note && (
        <p className="text-[10px] text-content-3">Nota: {r.decision_note}</p>
      )}
      {!isPending && (
        <p className="text-[10px] text-content-3 flex items-center gap-1">
          <Clock size={10} /> {r.decided_by || '—'} · {relTime(r.decided_at)}
        </p>
      )}

      {/* Acciones */}
      {isPending && !rejecting && (
        <div className="flex items-center gap-2 mt-auto">
          <button onClick={() => onApprove(r)} disabled={busy}
            className="flex-1 h-9 rounded-xl text-[12px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />} Aprobar
          </button>
          <button onClick={() => setRejecting(true)} disabled={busy}
            className="h-9 px-3 rounded-xl text-[12px] font-bold text-danger bg-danger/10 hover:bg-red-500 hover:text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors">
            <X size={14} /> Rechazar
          </button>
        </div>
      )}

      {/* Rechazo con razón */}
      {isPending && rejecting && (
        <div className="flex flex-col gap-2 mt-auto">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} autoFocus
            placeholder="Motivo del rechazo (opcional)…"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-surface-card text-[16px] text-content-2 placeholder-slate-400 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100 resize-none" />
          <div className="flex items-center gap-2">
            <button onClick={() => onReject(r, note.trim() || null)} disabled={busy}
              className="flex-1 h-8 rounded-xl text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={13} />} Confirmar rechazo
            </button>
            <button onClick={() => { setRejecting(false); setNote(''); }} disabled={busy}
              className="h-8 px-3 rounded-xl text-[11px] font-bold text-content-3 hover:bg-surface-card-hover transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab principal ───────────────────────────────────────────────────────────
export default function TabMinMaxRequests({ searchTerm = '' }) {
  const { user }       = useAuth();
  const appendAuditLog = useStaff(s => s.appendAuditLog);
  const employees      = useStaff(s => s.employees);
  const empMap = useMemo(() => {
    const m = new Map();
    for (const e of (employees || [])) m.set(String(e.id), e);
    return m;
  }, [employees]);

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('pending');
  const [sucFilter, setSucFilter] = useState('all');
  const [busyId, setBusyId]   = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchAllMinMaxChangeRequests();
    if (error) setError(error.message);
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const notifyRequester = useCallback(async (r, approved, note) => {
    if (!r.requested_by_id) return;
    const title   = approved ? '✅ Ajuste Min/Max aprobado' : '❌ Ajuste Min/Max rechazado';
    const message = approved
      ? `Tu propuesta para ${r.product_name} (${ERP_NAMES[r.erp_sucursal_id] || r.erp_sucursal_id}) fue aplicada: MIN ${r.requested_min} · MAX ${r.requested_max}.`
      : `Tu propuesta para ${r.product_name} fue rechazada.${note ? ' Motivo: ' + note : ''}`;
    await notifyEmployees([String(r.requested_by_id)], {
      type: 'MINMAX_DECIDED',
      title,
      body: message,
      link: '/minmax',
      push: true,
      metadata: {
        status: approved ? 'APPROVED' : 'REJECTED',
        product_name: r.product_name,
        erp_sucursal_id: r.erp_sucursal_id,
        requested_min: r.requested_min,
        requested_max: r.requested_max,
        note: note || null,
      },
    });
  }, []);

  // Lógica de decisión sin gestión de UI (reutilizable por individual y masivo)
  const runDecision = useCallback(async (r, approve, note) => {
    const fn = approve ? 'approve_minmax_request' : 'reject_minmax_request';
    const { error } = await supabase.rpc(fn, { p_request_id: r.id, p_decided_by: user?.email ?? null, p_note: note });
    if (error) throw error;
    // target_id = producto (no la solicitud) — es lo que el historial MIN/MAX de
    // Productos usa para buscar cambios de un producto puntual (M-5). request_id
    // queda en details para seguir pudiendo rastrear la solicitud original.
    await appendAuditLog(approve ? 'MINMAX_REQUEST_APPROVED' : 'MINMAX_REQUEST_REJECTED', String(r.erp_product_id), {
      request_id: r.id, product: r.product_name, sucursal_id: r.erp_sucursal_id,
      requested_min: r.requested_min, requested_max: r.requested_max, note,
    });
    await notifyRequester(r, approve, note);
  }, [user, appendAuditLog, notifyRequester]);

  const decide = useCallback(async (r, approve, note = null) => {
    setBusyId(r.id); setError(null);
    try { await runDecision(r, approve, note); await load(); }
    catch (e) {
      setError(e.message?.includes('NO_PERMISSION') || e.message?.includes('row-level')
        ? 'No tenés permiso para aprobar (can_approve en Min/Max).'
        : (e.message || 'Error al procesar'));
    } finally { setBusyId(null); }
  }, [runDecision, load]);

  // ── Filtros / agrupación ──
  const tabRows = useMemo(
    () => rows.filter(r => tab === 'pending' ? r.status === 'pending' : r.status !== 'pending'),
    [rows, tab]
  );
  const sucCounts = useMemo(() => {
    const m = {};
    for (const r of tabRows) m[r.erp_sucursal_id] = (m[r.erp_sucursal_id] || 0) + 1;
    return m;
  }, [tabRows]);

  const filtered = useMemo(() => {
    return tabRows.filter(r => {
      if (sucFilter !== 'all' && String(r.erp_sucursal_id) !== String(sucFilter)) return false;
      if (searchTerm.trim() && !tokenMatch(searchTerm, r.product_name, r.requested_by_name)) return false;
      return true;
    });
  }, [tabRows, sucFilter, searchTerm]);

  const pendingCount = useMemo(() => rows.filter(r => r.status === 'pending').length, [rows]);
  const sucOptions = useMemo(
    () => ERP_ORDER.filter(id => sucCounts[id]).map(id => ({ value: String(id), label: `${ERP_NAMES[id]} (${sucCounts[id]})` })),
    [sucCounts]
  );

  // Mejora M7: abre el ConfirmModal estándar en vez de window.confirm (B-6)
  const approveAll = useCallback(() => {
    const pend = filtered.filter(r => r.status === 'pending');
    if (!pend.length) return;
    setConfirmBulkOpen(true);
  }, [filtered]);

  // Mejora M7: 1 sola transacción atómica (approve_minmax_requests_bulk) en vez
  // de N llamadas seriadas a approve_minmax_request — si fallaba a mitad del loop
  // viejo quedaba en estado parcial (algunas aprobadas, otras no). Audit logs y
  // notificaciones en lotes de BATCH_SIZE (en paralelo dentro de cada lote, pero
  // los lotes en serie) — evita un burst de decenas/cientos de escrituras
  // simultáneas a audit_logs/notifications en un solo tick (regla del proyecto:
  // la tabla quedó marcada sensible a bursts de escritura tras el outage
  // 2026-07-08). Notificaciones agrupadas por empleado (1 por requester en vez
  // de 1 por solicitud).
  const BATCH_SIZE = 20;
  const runInBatches = async (items, fn) => {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      await Promise.all(items.slice(i, i + BATCH_SIZE).map(fn));
    }
  };

  const runBulkApprove = useCallback(async () => {
    const pend = filtered.filter(r => r.status === 'pending');
    if (!pend.length) { setConfirmBulkOpen(false); return; }
    setBulkBusy(true); setError(null);
    try {
      const { data, error } = await supabase.rpc('approve_minmax_requests_bulk', {
        p_request_ids: pend.map(r => r.id), p_decided_by: user?.email ?? null,
      });
      if (error) throw error;

      const approved = data?.approved ?? [];
      const skippedBodega = data?.skipped_bodega ?? [];
      const skippedHidden = data?.skipped_hidden ?? [];
      const skippedNotFound = data?.skipped_not_found ?? [];

      await runInBatches(approved, r => appendAuditLog('MINMAX_REQUEST_APPROVED', String(r.erp_product_id), {
        request_id: r.id, product: r.product_name, sucursal_id: r.erp_sucursal_id,
        requested_min: r.requested_min, requested_max: r.requested_max, note: 'Aprobación masiva',
      }));

      const byRequester = new Map();
      for (const r of approved) {
        if (!r.requested_by_id) continue;
        if (!byRequester.has(r.requested_by_id)) byRequester.set(r.requested_by_id, []);
        byRequester.get(r.requested_by_id).push(r);
      }
      await runInBatches([...byRequester.entries()], ([empId, items]) => {
        const body = items.length === 1
          ? `Tu propuesta para ${items[0].product_name} (${ERP_NAMES[items[0].erp_sucursal_id] || items[0].erp_sucursal_id}) fue aplicada: MIN ${items[0].requested_min} · MAX ${items[0].requested_max}.`
          : `${items.length} propuestas tuyas fueron aprobadas y aplicadas: ${items.map(i => i.product_name).join(', ')}.`;
        return notifyEmployees([String(empId)], {
          type: 'MINMAX_DECIDED',
          title: '✅ Ajuste Min/Max aprobado',
          body,
          link: '/minmax',
          push: true,
          metadata: { status: 'APPROVED', count: items.length },
        });
      });

      // Superficia los 3 tipos de omisión — antes solo Bodega se mostraba,
      // "ya decidida por otra persona" y "producto oculto" quedaban en
      // silencio (hallazgo de /code-review post-auditoría).
      const skipMsgs = [];
      if (skippedBodega.length)   skipMsgs.push(`${skippedBodega.length} de Bodega (no admite solicitudes directas)`);
      if (skippedHidden.length)   skipMsgs.push(`${skippedHidden.length} de producto(s) oculto(s) en Min/Max`);
      if (skippedNotFound.length) skipMsgs.push(`${skippedNotFound.length} ya decidida(s) por otra persona`);
      if (skipMsgs.length) {
        setError(`Se omitieron ${skipMsgs.join(', ')}.`);
      }

      await load();
    } catch (e) {
      setError(e.message || 'Error al aprobar en lote');
    } finally { setBulkBusy(false); setConfirmBulkOpen(false); }
  }, [filtered, user, appendAuditLog, load]);

  const pendingInView = filtered.filter(r => r.status === 'pending').length;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Barra superior: estado (izq) + filter pill (der) ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Segmented estado */}
        <div className="flex items-center gap-1.5">
          {[['pending', `Pendientes${pendingCount ? ` · ${pendingCount}` : ''}`], ['history', 'Historial']].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setSucFilter('all'); }}
              className={`px-4 py-2 rounded-full text-[12px] font-bold transition-colors ${
                tab === k ? 'bg-brand text-white shadow-sm' : 'bg-surface-card text-content-3 border border-slate-200/70 hover:border-brand/40'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Filter pill estándar */}
        <div className="flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-surface-card backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] shrink-0">
          <div className="px-2 py-1.5" style={{ minWidth: 150 }}>
            <LiquidSelect value={sucFilter === 'all' ? '' : sucFilter}
              onChange={v => setSucFilter(v || 'all')}
              options={sucOptions} placeholder="Todas las sucursales" icon={Building2} compact bare />
          </div>
          {sucFilter !== 'all' && (
            <button onClick={() => setSucFilter('all')} title="Quitar sucursal"
              className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-danger/10 hover:bg-red-500 text-danger hover:text-white transition-colors shrink-0">
              <X size={9} strokeWidth={3} />
            </button>
          )}
          {tab === 'pending' && pendingInView > 0 && (
            <>
              <div className="h-5 w-px bg-surface-card-hover shrink-0" />
              <button onClick={approveAll} disabled={bulkBusy}
                className="mx-1.5 inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[11px] font-black text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors shrink-0">
                {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={13} />}
                Aprobar {sucFilter !== 'all' ? `${ERP_NAMES[Number(sucFilter)]}` : 'todas'} ({pendingInView})
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 px-3.5 py-2 text-[12px] font-semibold text-danger flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)}><X size={13} /></button>
        </div>
      )}

      {/* ── Grid de cards ── */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-content-3" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-content-3">
          <Inbox size={34} strokeWidth={1.5} />
          <p className="text-[13px] font-semibold text-content-3">
            {tab === 'pending' ? 'No hay solicitudes pendientes' : 'Sin historial de solicitudes'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(r => (
            <RequestCard
              key={r.id}
              r={r}
              emp={r.requested_by_id ? empMap.get(String(r.requested_by_id)) : null}
              busy={busyId === r.id || bulkBusy}
              onApprove={() => decide(r, true)}
              onReject={(req, note) => decide(req, false, note)}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmBulkOpen}
        onClose={() => !bulkBusy && setConfirmBulkOpen(false)}
        onConfirm={runBulkApprove}
        isProcessing={bulkBusy}
        isDestructive={false}
        title="¿Aprobar solicitudes?"
        message={`Se aprobarán ${pendingInView} solicitud(es)${sucFilter !== 'all' ? ` de ${ERP_NAMES[Number(sucFilter)]}` : ''} y se aplicarán en vivo.`}
        confirmText="Aprobar todo"
        cancelText="Cancelar"
      />
    </div>
  );
}
