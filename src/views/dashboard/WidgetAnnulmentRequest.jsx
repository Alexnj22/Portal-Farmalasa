import React, { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, AlertTriangle, CheckCircle2, X, Receipt, Clock, Eye, ArrowLeft, AlertCircle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { smartFilter } from '../../utils/searchUtils';

const GRACE_DAYS = 3;


const REASONS = [
  'Devolución del cliente',
  'Error en venta',
  'Duplicado / venta repetida',
  'Cobro incorrecto',
  'Producto no entregado',
  'Otro',
];

function svToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/El_Salvador' }));
}

function daysAgo(dateStr) {
  const invoiceDate = new Date(dateStr + 'T00:00:00');
  const today = svToday();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - invoiceDate) / 86400000);
}

function fmtCurrency(n) {
  return `$${Number(n ?? 0).toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DocBadge({ tipo }) {
  if (!tipo) return null;
  const isCCF = tipo === 'CCF';
  return (
    <span className={`shrink-0 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md ${
      isCCF ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
    }`}>{tipo}</span>
  );
}

function PayBadge({ tipo }) {
  if (!tipo) return null;
  return (
    <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 uppercase">
      {tipo}
    </span>
  );
}

/* ─── Invoice detail + products ────────────────────────────────────────── */
function InvoiceDetail({ inv, onBack, onAnnul }) {
  const age           = daysAgo(inv.fecha);
  const graceDaysLeft = GRACE_DAYS - age;
  const withinGrace   = graceDaysLeft >= 0;

  const [items,        setItems]        = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('sales_invoice_items')
      .select('descripcion, presentacion, cantidad, precio_unitario, total_linea')
      .eq('invoice_id', inv.id)
      .order('total_linea', { ascending: false })
      .then(({ data }) => { if (!cancelled) { setItems(data || []); setItemsLoading(false); } });
    return () => { cancelled = true; };
  }, [inv.id]);

  return (
    <div className="flex flex-col gap-3 h-full animate-in slide-in-from-right-3 duration-200">
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors shrink-0">
          <ArrowLeft size={13} strokeWidth={2.5} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-slate-800 truncate">{inv.cliente || inv.correlativo}</p>
          <p className="text-[10px] text-slate-400">{inv.correlativo} · {fmtDate(inv.fecha)}</p>
        </div>
        <span className="text-[13px] font-black text-slate-700">{fmtCurrency(inv.total)}</span>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Invoice summary */}
        <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shrink-0">
          {[
            { label: 'Tipo',  value: inv.tipo_documento || '—' },
            { label: 'Pago',  value: inv.tipo_pago      || '—' },
            { label: 'Fecha', value: fmtDate(inv.fecha)        },
            { label: 'Total', value: fmtCurrency(inv.total)    },
          ].map(({ label, value }, i) => (
            <div key={i} className={`flex items-center justify-between px-3.5 py-2 ${i > 0 ? 'border-t border-slate-50' : ''}`}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</span>
              <span className="text-[11px] font-bold text-slate-700">{value}</span>
            </div>
          ))}
        </div>

        {/* Products */}
        <div className="shrink-0">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1.5">
            Productos ({items.length})
          </p>
          {itemsLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 size={16} className="animate-spin text-slate-300" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-3">Sin detalle de productos</p>
          ) : (
            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
              {items.map((it, i) => (
                <div key={i} className={`flex items-start gap-2 px-3 py-2 ${i > 0 ? 'border-t border-slate-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-700 leading-tight truncate">{it.descripcion}</p>
                    {it.presentacion && (
                      <p className="text-[9px] text-slate-400">{it.presentacion}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-black text-slate-700">{fmtCurrency(it.total_linea)}</p>
                    <p className="text-[9px] text-slate-400">{it.cantidad} × {fmtCurrency(it.precio_unitario)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Grace status */}
        <div className={`rounded-2xl px-3.5 py-2.5 flex items-center gap-2 shrink-0 ${
          withinGrace ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
        }`}>
          <Clock size={13} className={withinGrace ? 'text-amber-500' : 'text-red-500'} strokeWidth={2.5} />
          <p className={`text-[11px] font-bold ${withinGrace ? 'text-amber-700' : 'text-red-600'}`}>
            {withinGrace
              ? `${graceDaysLeft} día${graceDaysLeft !== 1 ? 's' : ''} restante${graceDaysLeft !== 1 ? 's' : ''} de gracia`
              : `Fuera del período de gracia — ${age} días desde la venta`}
          </p>
        </div>

        <button
          onClick={onAnnul}
          className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] transition-all shrink-0"
        >
          Solicitar anulación
        </button>
      </div>
    </div>
  );
}

/* ─── Annulment form ────────────────────────────────────────────────────── */
function AnnulForm({ inv, onBack, onSuccess, user, activeBranch, activeBranchId, employees, appendAuditLog, backLabel = 'Atrás' }) {
  const [reason,      setReason]      = useState('');
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');

  const age         = daysAgo(inv.fecha);
  const withinGrace = age <= GRACE_DAYS;

  const findTarget = useCallback(() => {
    const branchEmps = employees.filter(e => String(e.branchId ?? e.branch_id) === String(activeBranchId));
    const supervisors = branchEmps.filter(e => ['JEFE', 'SUBJEFE'].includes(String(e.system_role ?? '').toUpperCase()));
    const avail = supervisors.find(s => {
      const ev = s.activeEventType ?? s.active_event_type;
      return !ev || !['VACATION', 'DISABILITY'].includes(ev);
    });
    if (avail) return avail;
    return employees.find(e => ['ADMIN', 'SUPERADMIN'].includes(String(e.system_role ?? '').toUpperCase()));
  }, [employees, activeBranchId]);

  const handleSubmit = async () => {
    if (!reason) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const target = findTarget();
      const { error } = await supabase.from('approval_requests').insert({
        employee_id: user?.id,
        type: 'ANNULMENT_REQUEST',
        status: 'PENDING',
        note: comment.trim() || null,
        metadata: {
          invoice_id:   inv.id,
          correlativo:  inv.correlativo,
          fecha:        inv.fecha,
          total:        inv.total,
          tipo_documento: inv.tipo_documento,
          branch_id:    activeBranchId,
          branch_name:  activeBranch?.name,
          reason,
          comment:      comment.trim() || null,
          notified_employee_id: target?.id ?? null,
          notified_employee:    target?.name ?? 'Sin supervisor asignado',
        },
      });
      if (error) throw error;

      await appendAuditLog('ANNULMENT_REQUEST_CREATED', String(inv.id), {
        correlativo: inv.correlativo, reason, total: inv.total, notified: target?.name,
      });

      if (target?.id) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              employeeId: target.id,
              title: '⚠️ Solicitud de Anulación',
              body: `${user?.name || 'Un empleado'} solicita anular ${inv.correlativo} ($${Number(inv.total).toFixed(2)}) — ${reason}`,
            },
          });
        } catch { /* non-fatal */ }
      }
      onSuccess();
    } catch (e) {
      setSubmitError(e.message || 'Error al enviar solicitud');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full animate-in slide-in-from-right-3 duration-200">
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors">
          <ArrowLeft size={13} strokeWidth={2.5} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-slate-800 truncate">{inv.correlativo}</p>
          <p className="text-[10px] text-slate-400">{fmtDate(inv.fecha)} · {fmtCurrency(inv.total)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Out-of-grace warning */}
        {!withinGrace && (
          <div className="rounded-2xl px-3.5 py-2.5 flex items-start gap-2 bg-red-50 border border-red-200 shrink-0">
            <AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-[11px] font-bold text-red-700 leading-snug">
              Esta factura está fuera del período de gracia ({age} días). La solicitud quedará pendiente de aprobación del supervisor.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Motivo *</label>
          <div className="grid grid-cols-2 gap-1.5">
            {REASONS.map(r => (
              <button key={r} onClick={() => setReason(r)}
                className={`text-left px-3 py-2 rounded-2xl border text-[11px] font-bold transition-all ${
                  reason === r ? 'bg-[#0052CC] text-white border-[#0052CC]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#0052CC]/40'
                }`}>
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Comentarios</label>
          <textarea
            value={comment} onChange={e => setComment(e.target.value)} rows={3}
            placeholder="Descripción adicional del motivo..."
            className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all resize-none"
          />
        </div>

        {submitError && <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>}

        <button onClick={handleSubmit} disabled={!reason || submitting}
          className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Enviando...' : 'Enviar solicitud de anulación'}
        </button>
      </div>
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────────────── */
export default function WidgetAnnulmentRequest({ selectedBranchId: propBranchId = null }) {
  const { user }       = useAuth();
  const employees      = useStaffStore(s => s.employees);
  const branches       = useStaffStore(s => s.branches);
  const appendAuditLog = useStaffStore(s => s.appendAuditLog);

  const userBranchId   = user?.branchId ?? user?.branch_id;
  const activeBranchId = propBranchId ?? String(userBranchId ?? '');
  const activeBranch   = branches.find(b => String(b.id) === activeBranchId);

  // view: 'list' | 'detail' | 'annul' | 'success'
  const [view,          setView]          = useState('list');
  const [prevAnnulView, setPrevAnnulView] = useState('list');
  const [invoices,      setInvoices]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [focused,       setFocused]       = useState(null);

  const loadInvoices = useCallback(async () => {
    if (!activeBranchId) { setLoading(false); setInvoices([]); return; }
    setLoading(true);
    const now  = svToday();
    const y    = now.getFullYear();
    const m    = String(now.getMonth() + 1).padStart(2, '0');
    const from = `${y}-${m}-01`;
    const to   = `${y}-${m}-${String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('sales_invoices')
      .select('id, correlativo, fecha, total, tipo_documento, cliente, tipo_pago, branch_id')
      .eq('branch_id', Number(activeBranchId))
      .gte('fecha', from)
      .lte('fecha', to)
      .order('fecha', { ascending: false })
      .order('correlativo', { ascending: false })
      .limit(500);

    if (error) console.error('WidgetAnnulmentRequest:', error.message);
    setInvoices(data || []);
    setLoading(false);
  }, [activeBranchId]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  // Reset to list when branch changes from parent
  useEffect(() => { setView('list'); setFocused(null); setSearch(''); }, [propBranchId]);

  const { results: filtered, isFuzzy: isWidgetSearchFuzzy } = !search.trim()
    ? { results: invoices, isFuzzy: false }
    : smartFilter(search, invoices, inv => [inv.correlativo, inv.cliente, fmtDate(inv.fecha), inv.fecha, String(Number(inv.total || 0).toFixed(2))]);

  if (!activeBranchId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-300">
        <AlertTriangle size={28} strokeWidth={1.5} />
        <p className="text-[12px] font-semibold text-slate-400">Tu sucursal no está configurada para este widget</p>
      </div>
    );
  }

  if (view === 'success') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CheckCircle2 size={40} className="text-emerald-500" strokeWidth={1.5} />
        <div className="text-center">
          <p className="text-[14px] font-black text-slate-800">Solicitud enviada</p>
          <p className="text-[12px] text-slate-500 mt-1">El supervisor fue notificado para su aprobación.</p>
        </div>
      </div>
    );
  }

  if (view === 'annul' && focused) {
    return (
      <AnnulForm
        inv={focused}
        onBack={() => setView(prevAnnulView)}
        onSuccess={() => { setView('success'); setTimeout(() => { setView('list'); setFocused(null); loadInvoices(); }, 3000); }}
        user={user}
        activeBranch={activeBranch}
        activeBranchId={activeBranchId}
        employees={employees}
        appendAuditLog={appendAuditLog}
      />
    );
  }

  if (view === 'detail' && focused) {
    return (
      <InvoiceDetail
        inv={focused}
        onBack={() => { setView('list'); setFocused(null); }}
        onAnnul={() => { setPrevAnnulView('detail'); setView('annul'); }}
      />
    );
  }

  /* ── STEP 1: Invoice list ── */
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Ventas del mes — {activeBranch?.name || 'Tu sucursal'}
        </p>
        <span className="text-[10px] font-bold text-slate-400">{invoices.length} facturas</span>
      </div>

      <div className="relative shrink-0">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por cliente, fecha o monto..."
          className="w-full pl-9 pr-8 py-2 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all"
          spellCheck={false}
        />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-slate-300" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-8 text-center text-[12px] text-slate-400 font-medium">
            {search ? `Sin resultados para "${search}"` : 'No hay facturas este mes'}
          </div>
        )}

        {!loading && isWidgetSearchFuzzy && search && (
          <div className="mb-2 mx-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[10px] text-amber-700 font-semibold">
            <Search size={11} strokeWidth={2.5} className="shrink-0" />
            Similares a &ldquo;{search}&rdquo;
          </div>
        )}

        {!loading && filtered.map(inv => {
          const age = daysAgo(inv.fecha);
          const ok  = age <= GRACE_DAYS;
          return (
            <div key={inv.id}
              className="flex items-center gap-2 px-3 py-2.5 rounded-2xl border border-slate-100 bg-white hover:border-slate-200 transition-all"
            >
              <Receipt size={13} className={ok ? 'text-slate-400 shrink-0' : 'text-slate-200 shrink-0'} strokeWidth={2} />

              {/* Main info — cliente primary */}
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] font-black truncate leading-tight ${ok ? 'text-slate-800' : 'text-slate-400'}`}>
                  {inv.cliente || 'Sin nombre'}
                </p>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className="text-[9px] text-slate-400 font-mono">{inv.correlativo}</span>
                  <span className="text-[8px] text-slate-300">·</span>
                  <span className="text-[9px] text-slate-300 font-mono">#{inv.id}</span>
                  <DocBadge tipo={inv.tipo_documento} />
                  {inv.tipo_pago && <PayBadge tipo={inv.tipo_pago} />}
                </div>
              </div>

              {/* Amount + grace */}
              <div className="text-right shrink-0">
                <p className={`text-[11px] font-black ${ok ? 'text-slate-700' : 'text-slate-300'}`}>
                  {fmtCurrency(inv.total)}
                </p>
                <p className="text-[8px] text-slate-300">{fmtDate(inv.fecha)}</p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { setFocused(inv); setView('detail'); }}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-[#0052CC] hover:text-white text-slate-400 transition-all"
                  title="Ver detalle"
                >
                  <Eye size={12} strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => { setFocused(inv); setPrevAnnulView('list'); setView('annul'); }}
                  className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                    ok
                      ? 'bg-amber-50 hover:bg-amber-500 hover:text-white text-amber-500'
                      : 'bg-red-50 hover:bg-red-500 hover:text-white text-red-400'
                  }`}
                  title={ok ? 'Solicitar anulación' : 'Solicitar anulación (fuera de gracia)'}
                >
                  <AlertCircle size={12} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
