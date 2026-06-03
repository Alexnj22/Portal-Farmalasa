import React, { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, AlertTriangle, CheckCircle2, ChevronRight, X, Receipt, Clock, Building2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import LiquidSelect from '../../components/common/LiquidSelect';

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

const ERP_SUCURSAL_MAP_INV = { 4: 1, 25: 2, 27: 3, 28: 4, 2: 5, 29: 7 };

export default function WidgetAnnulmentRequest() {
  const { user, getScope }  = useAuth();
  const employees            = useStaffStore(s => s.employees);
  const branches             = useStaffStore(s => s.branches);
  const appendAuditLog       = useStaffStore(s => s.appendAuditLog);

  const userBranchId  = user?.branchId ?? user?.branch_id;
  const isAllScope    = getScope('dash_annulment_req') === 'ALL';

  const [selectedBranchId, setSelectedBranchId] = useState(String(userBranchId ?? ''));
  const [invoices, setInvoices]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState(null);
  const [reason, setReason]           = useState('');
  const [comment, setComment]         = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [success, setSuccess]         = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Active branch: selectable when ALL scope, fixed to own branch otherwise
  const activeBranchId = isAllScope ? selectedBranchId : String(userBranchId ?? '');
  const activeBranch   = branches.find(b => String(b.id) === activeBranchId);
  const erpSucursalId  = ERP_SUCURSAL_MAP_INV[Number(activeBranchId)];

  // Branch options for LiquidSelect — only branches that have an ERP mapping
  const branchOptions = branches
    .filter(b => ERP_SUCURSAL_MAP_INV[Number(b.id)])
    .map(b => ({ value: String(b.id), label: b.name }));

  const loadInvoices = useCallback(async () => {
    const erpId = ERP_SUCURSAL_MAP_INV[Number(activeBranchId)];
    if (!erpId) { setLoading(false); setInvoices([]); return; }
    setLoading(true);
    const now   = svToday();
    const y     = now.getFullYear();
    const m     = String(now.getMonth() + 1).padStart(2, '0');
    const from  = `${y}-${m}-01`;
    const to    = `${y}-${m}-${String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    const { data } = await supabase
      .from('sales_invoices')
      .select('id, correlativo, fecha, total, tipo_dte, branch_id, sucursal_id')
      .eq('sucursal_id', erpId)
      .gte('fecha', from)
      .lte('fecha', to)
      .order('fecha', { ascending: false })
      .limit(200);

    setInvoices(data || []);
    setLoading(false);
  }, [activeBranchId]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const filtered = invoices.filter(inv => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return String(inv.correlativo || '').toLowerCase().includes(q) ||
           String(fmtCurrency(inv.total)).includes(q);
  });

  const graceDaysLeft = selected ? GRACE_DAYS - daysAgo(selected.fecha) : null;
  const withinGrace   = graceDaysLeft !== null && graceDaysLeft >= 0;

  // Find supervisor at the active branch (JEFE/SUBJEFE), fallback to ADMIN
  const findNotificationTarget = useCallback(() => {
    const branchEmps = employees.filter(e =>
      String(e.branchId ?? e.branch_id) === activeBranchId
    );
    const supervisors = branchEmps.filter(e =>
      ['JEFE', 'SUBJEFE'].includes(String(e.system_role ?? '').toUpperCase())
    );

    // Check if supervisor is on vacation today
    const availableSup = supervisors.find(sup => {
      const events = sup.activeEventType ?? sup.active_event_type;
      return !events || !['VACATION', 'DISABILITY'].includes(events);
    });
    if (availableSup) return availableSup;

    // Fallback: ADMIN
    return employees.find(e =>
      ['ADMIN', 'SUPERADMIN'].includes(String(e.system_role ?? '').toUpperCase())
    );
  }, [employees, activeBranchId]);

  const handleSubmit = async () => {
    if (!selected || !reason || !withinGrace) return;
    setSubmitting(true);
    setSubmitError('');

    try {
      const target = findNotificationTarget();
      const { error } = await supabase.from('approval_requests').insert({
        employee_id: user?.id,
        type: 'ANNULMENT_REQUEST',
        status: 'PENDING',
        note: comment.trim() || null,
        metadata: {
          invoice_id:   selected.id,
          correlativo:  selected.correlativo,
          fecha:        selected.fecha,
          total:        selected.total,
          tipo_dte:     selected.tipo_dte,
          branch_id:    activeBranchId,
          branch_name:  activeBranch?.name,
          reason,
          comment:      comment.trim() || null,
          notified_employee_id: target?.id ?? null,
          notified_employee:    target?.name ?? 'Sin supervisor asignado',
        },
      });

      if (error) throw error;

      await appendAuditLog('ANNULMENT_REQUEST_CREATED', String(selected.id), {
        correlativo: selected.correlativo,
        reason,
        total: selected.total,
        notified: target?.name,
      });

      // Push notification if target has subscriptions
      if (target?.id) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              employeeId: target.id,
              title: '⚠️ Solicitud de Anulación',
              body: `${user?.name || 'Un empleado'} solicita anular ${selected.correlativo} ($${Number(selected.total).toFixed(2)}) — ${reason}`,
            },
          });
        } catch { /* non-fatal */ }
      }

      setSuccess(true);
      setSelected(null); setReason(''); setComment('');
      setTimeout(() => { setSuccess(false); loadInvoices(); }, 3000);
    } catch (e) {
      setSubmitError(e.message || 'Error al enviar solicitud');
    } finally {
      setSubmitting(false);
    }
  };

  if (!erpSucursalId && !isAllScope) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-300">
        <AlertTriangle size={28} strokeWidth={1.5} />
        <p className="text-[12px] font-semibold text-slate-400">Tu sucursal no está configurada para este widget</p>
      </div>
    );
  }

  if (success) {
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

  /* ── STEP 2: Fill form for selected invoice ── */
  if (selected) {
    const age = daysAgo(selected.fecha);
    return (
      <div className="flex flex-col gap-3 h-full">
        {/* Header */}
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setSelected(null)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors">
            <ChevronRight size={13} className="rotate-180" strokeWidth={2.5} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-black text-slate-800 truncate">{selected.correlativo}</p>
            <p className="text-[10px] text-slate-400">{fmtDate(selected.fecha)} · {fmtCurrency(selected.total)}</p>
          </div>
        </div>

        {/* Grace period indicator */}
        <div className={`rounded-2xl px-3.5 py-2.5 flex items-center gap-2 shrink-0 ${
          withinGrace
            ? 'bg-amber-50 border border-amber-200'
            : 'bg-red-50 border border-red-200'
        }`}>
          <Clock size={13} className={withinGrace ? 'text-amber-500' : 'text-red-500'} strokeWidth={2.5} />
          <p className={`text-[11px] font-bold ${withinGrace ? 'text-amber-700' : 'text-red-600'}`}>
            {withinGrace
              ? `Dentro del período de gracia — ${graceDaysLeft} día${graceDaysLeft !== 1 ? 's' : ''} restante${graceDaysLeft !== 1 ? 's' : ''}`
              : `Fuera del período de gracia (${age} días desde la venta). No se puede solicitar anulación.`}
          </p>
        </div>

        {withinGrace && (
          <div className="flex flex-col gap-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {/* Reason */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Motivo *</label>
              <div className="grid grid-cols-2 gap-1.5">
                {REASONS.map(r => (
                  <button key={r} onClick={() => setReason(r)}
                    className={`text-left px-3 py-2 rounded-2xl border text-[11px] font-bold transition-all ${
                      reason === r
                        ? 'bg-[#0052CC] text-white border-[#0052CC]'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-[#0052CC]/40'
                    }`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Comment */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Comentarios</label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                placeholder="Descripción adicional del motivo..."
                className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all resize-none"
              />
            </div>

            {submitError && (
              <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!reason || submitting}
              className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {submitting ? 'Enviando...' : 'Enviar solicitud de anulación'}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── STEP 1: Select invoice ── */
  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Branch selector pill — only when ALL scope */}
      {isAllScope && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white/80 border border-slate-200/70 shadow-sm">
          <Building2 size={12} className="text-slate-400 shrink-0" strokeWidth={2} />
          <div className="flex-1 min-w-0">
            <LiquidSelect
              value={selectedBranchId}
              onChange={val => { setSelectedBranchId(val ?? String(userBranchId ?? '')); setSelected(null); setSearch(''); }}
              options={branchOptions}
              placeholder="Seleccionar sucursal..."
              bare
              compact
              clearable={false}
            />
          </div>
        </div>
      )}

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
          placeholder="Buscar por correlativo o monto..."
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

        {!loading && filtered.map(inv => {
          const age = daysAgo(inv.fecha);
          const ok  = age <= GRACE_DAYS;
          return (
            <button key={inv.id} onClick={() => setSelected(inv)}
              className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl border border-slate-100 bg-white hover:border-[#0052CC]/30 hover:bg-blue-50/30 transition-all text-left group"
            >
              <Receipt size={15} className={ok ? 'text-slate-400' : 'text-slate-200'} strokeWidth={2} />
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] font-black truncate ${ok ? 'text-slate-800' : 'text-slate-400'}`}>
                  {inv.correlativo}
                </p>
                <p className="text-[10px] text-slate-400">{fmtDate(inv.fecha)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[12px] font-black ${ok ? 'text-slate-700' : 'text-slate-300'}`}>{fmtCurrency(inv.total)}</p>
                {ok ? (
                  <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                    {GRACE_DAYS - age}d gracia
                  </span>
                ) : (
                  <span className="text-[9px] font-bold text-slate-300">Fuera de plazo</span>
                )}
              </div>
              <ChevronRight size={13} className="text-slate-300 group-hover:text-[#0052CC] transition-colors shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
