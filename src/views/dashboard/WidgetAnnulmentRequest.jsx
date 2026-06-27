import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Loader2, AlertTriangle, CheckCircle2, X, Receipt, Clock,
  Eye, ArrowLeft, AlertCircle, Ban, CreditCard, UserCog,
  ChevronRight, Info, ShieldAlert, User,
} from 'lucide-react';
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

const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'credito', 'transferencia', 'cheque', 'bitcoin'];
const PAYMENT_LABELS  = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', credito: 'Crédito',
  transferencia: 'Transferencia', cheque: 'Cheque', bitcoin: 'Bitcoin',
};

function svToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/El_Salvador' }));
}

function daysAgo(dateStr) {
  const invoiceDate = new Date(dateStr + 'T00:00:00');
  const today = svToday();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - invoiceDate) / 86400000);
}

function isSameDay(dateStr) {
  const today = svToday();
  const d = new Date(dateStr + 'T00:00:00');
  return today.getFullYear() === d.getFullYear() &&
    today.getMonth() === d.getMonth() &&
    today.getDate() === d.getDate();
}

function fmtCurrency(n) { return `$${Number(n ?? 0).toFixed(2)}`; }

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

/* ─── findTarget: busca supervisor disponible ──────────────────────────────── */
function findTargetEmployee(employees, activeBranchId) {
  const branchEmps = employees.filter(e => String(e.branchId ?? e.branch_id) === String(activeBranchId));
  const supervisors = branchEmps.filter(e => ['JEFE', 'SUBJEFE'].includes(String(e.system_role ?? '').toUpperCase()));
  const avail = supervisors.find(s => {
    const ev = s.activeEventType ?? s.active_event_type;
    return !ev || !['VACATION', 'DISABILITY'].includes(ev);
  });
  if (avail) return avail;
  return employees.find(e => ['ADMIN', 'SUPERADMIN'].includes(String(e.system_role ?? '').toUpperCase()));
}

/* ─── Invoice detail ────────────────────────────────────────────────────────── */
function InvoiceDetail({ inv, onBack, onModify }) {
  const age           = daysAgo(inv.fecha);
  const graceDaysLeft = GRACE_DAYS - age;
  const withinGrace   = graceDaysLeft >= 0;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('sales_invoice_items')
      .select('descripcion, presentacion, cantidad, precio_unitario, total_linea')
      .eq('invoice_id', inv.id)
      .order('total_linea', { ascending: false })
      .then(({ data }) => { if (!cancelled) { setItems(data || []); setLoading(false); } });
    return () => { cancelled = true; };
  }, [inv.id]);

  return (
    <div className="flex flex-col gap-3 h-full animate-in slide-in-from-right-3 duration-200">
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
        <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shrink-0">
          {[
            { label: 'Tipo',     value: inv.tipo_documento || '—' },
            { label: 'Pago',     value: inv.tipo_pago      || '—' },
            { label: 'Vendedor', value: inv.cod_vendedor   ? `#${inv.cod_vendedor}` : '—' },
            { label: 'Fecha',    value: fmtDate(inv.fecha)        },
            { label: 'Total',    value: fmtCurrency(inv.total)    },
          ].map(({ label, value }, i) => (
            <div key={i} className={`flex items-center justify-between px-3.5 py-2 ${i > 0 ? 'border-t border-slate-50' : ''}`}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</span>
              <span className="text-[11px] font-bold text-slate-700">{value}</span>
            </div>
          ))}
        </div>

        <div className="shrink-0">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1.5">
            Productos ({items.length})
          </p>
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-slate-300" /></div>
          ) : items.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-3">Sin detalle de productos</p>
          ) : (
            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
              {items.map((it, i) => (
                <div key={i} className={`flex items-start gap-2 px-3 py-2 ${i > 0 ? 'border-t border-slate-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-700 leading-tight truncate">{it.descripcion}</p>
                    {it.presentacion && <p className="text-[9px] text-slate-400">{it.presentacion}</p>}
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
          onClick={onModify}
          className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] transition-all shrink-0">
          Solicitar Modificación
        </button>
      </div>
    </div>
  );
}

/* ─── Type selector ─────────────────────────────────────────────────────────── */
function TypeSelector({ inv, onSelect, onBack }) {
  const isCCF = inv.tipo_documento === 'CCF';

  const types = [
    {
      key: 'annul',
      icon: Ban,
      label: 'Anulación de Factura',
      desc: isCCF ? 'CCF — requiere nota de crédito' : `Período de gracia: ${GRACE_DAYS} días`,
      color: 'text-rose-600',
      bg: 'bg-rose-50 border-rose-200/70',
      iconBg: 'bg-rose-100',
    },
    {
      key: 'pay_change',
      icon: CreditCard,
      label: 'Cambio de Forma de Pago',
      desc: `Actual: ${inv.tipo_pago || 'N/A'}`,
      color: 'text-sky-600',
      bg: 'bg-sky-50 border-sky-200/70',
      iconBg: 'bg-sky-100',
    },
    {
      key: 'vendor_change',
      icon: UserCog,
      label: 'Cambio de Código Vendedor',
      desc: `Vendedor actual: #${inv.cod_vendedor || 'N/A'}`,
      color: 'text-purple-600',
      bg: 'bg-purple-50 border-purple-200/70',
      iconBg: 'bg-purple-100',
    },
  ];

  return (
    <div className="flex flex-col gap-3 h-full animate-in slide-in-from-right-3 duration-200">
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors shrink-0">
          <ArrowLeft size={13} strokeWidth={2.5} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-slate-800">Solicitar Modificación</p>
          <p className="text-[10px] text-slate-400">{inv.correlativo} · {fmtCurrency(inv.total)}</p>
        </div>
      </div>

      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tipo de solicitud</p>

      <div className="flex flex-col gap-2 flex-1">
        {types.map(({ key, icon: Icon, label, desc, color, bg, iconBg }) => (
          <button key={key} onClick={() => onSelect(key)}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left hover:-translate-y-0.5 transition-all ${bg}`}>
            <div className={`w-9 h-9 rounded-[0.75rem] flex items-center justify-center flex-shrink-0 ${iconBg}`}>
              <Icon size={16} strokeWidth={2} className={color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-[12px] font-black ${color}`}>{label}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{desc}</p>
            </div>
            <ChevronRight size={14} strokeWidth={2.5} className="text-slate-300 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Annulment form ─────────────────────────────────────────────────────────── */
function AnnulForm({ inv, onBack, onSuccess, user, activeBranch, activeBranchId, employees, appendAuditLog }) {
  const [reason,      setReason]      = useState('');
  const [comment,     setComment]     = useState('');
  const [ccfAck,      setCcfAck]      = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');

  const age          = daysAgo(inv.fecha);
  const withinGrace  = age <= GRACE_DAYS;
  const isCCF        = inv.tipo_documento === 'CCF';
  const ccfSameDay   = isCCF && isSameDay(inv.fecha);
  const ccfNotSameDay = isCCF && !isSameDay(inv.fecha);
  const isCreditPay  = (inv.tipo_pago || '').toLowerCase() === 'credito';
  const commentRequired = !withinGrace || ccfNotSameDay;

  const canSubmit = reason && (!commentRequired || comment.trim()) && (!ccfNotSameDay || ccfAck);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const target = findTargetEmployee(employees, activeBranchId);
      const { error } = await supabase.from('approval_requests').insert({
        employee_id:  user?.id,
        approver_id:  target?.id ?? null,
        type:         'ANNULMENT_REQUEST',
        status:       'PENDING',
        note:         comment.trim() || null,
        metadata: {
          invoice_id:           inv.id,
          correlativo:          inv.correlativo,
          fecha:                inv.fecha,
          total:                inv.total,
          tipo_documento:       inv.tipo_documento,
          tipo_pago:            inv.tipo_pago,
          branch_id:            activeBranchId,
          branch_name:          activeBranch?.name,
          reason,
          comment:              comment.trim() || null,
          is_ccf:               isCCF,
          is_credit_payment:    isCreditPay,
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
              body: `${user?.name || 'Un empleado'} solicita anular ${inv.correlativo} (${fmtCurrency(inv.total)}) — ${reason}`,
            },
          });
        } catch { /* non-fatal */ }
      }
      onSuccess('annul', target?.name);
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
          <p className="text-[12px] font-black text-slate-800 truncate">Anulación — {inv.correlativo}</p>
          <p className="text-[10px] text-slate-400">{fmtDate(inv.fecha)} · {fmtCurrency(inv.total)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

        {/* Crédito → aviso de demora */}
        {isCreditPay && (
          <div className="rounded-2xl px-3.5 py-2.5 flex items-start gap-2 bg-indigo-50 border border-indigo-200 shrink-0">
            <Info size={13} className="text-indigo-500 mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-[11px] font-bold text-indigo-700 leading-snug">
              Esta venta es a <strong>crédito</strong>. La anulación tomará más tiempo de lo habitual y se confirmará al realizarse.
            </p>
          </div>
        )}

        {/* CCF mismo día — aviso informativo */}
        {ccfSameDay && (
          <div className="rounded-2xl px-3.5 py-2.5 flex items-start gap-2 bg-amber-50 border border-amber-200 shrink-0">
            <ShieldAlert size={13} className="text-amber-500 mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-[11px] font-bold text-amber-700 leading-snug">
              <strong>CCF:</strong> Los comprobantes fiscales son más delicados. Asegúrate de que se emitirá la nota de crédito correspondiente.
            </p>
          </div>
        )}

        {/* CCF de otro día — bloqueo severo */}
        {ccfNotSameDay && (
          <div className="rounded-2xl px-3.5 py-2.5 flex flex-col gap-2.5 bg-red-50 border border-red-300 shrink-0">
            <div className="flex items-start gap-2">
              <ShieldAlert size={14} className="text-red-600 mt-0.5 shrink-0" strokeWidth={2.5} />
              <p className="text-[11px] font-bold text-red-700 leading-snug">
                <strong>CCF de fecha anterior.</strong> Los CCF solo pueden anularse el mismo día de la emisión y requieren nota de crédito. Esta solicitud será marcada como urgente y requiere motivo obligatorio.
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={ccfAck} onChange={e => setCcfAck(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-red-500 shrink-0" />
              <span className="text-[11px] font-black text-red-700">Entiendo la implicación y confirmo que tengo autorización para solicitarlo</span>
            </label>
          </div>
        )}

        {/* Fuera de gracia */}
        {!withinGrace && !ccfNotSameDay && (
          <div className="rounded-2xl px-3.5 py-2.5 flex items-start gap-2 bg-red-50 border border-red-200 shrink-0">
            <AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-[11px] font-bold text-red-700 leading-snug">
              Esta factura está fuera del período de gracia ({age} días). La solicitud requerirá aprobación del supervisor y motivo detallado.
            </p>
          </div>
        )}

        {/* Selector de motivo */}
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

        {/* Comentario */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
            Comentarios {commentRequired ? <span className="text-red-400">*</span> : ''}
          </label>
          <textarea
            value={comment} onChange={e => setComment(e.target.value)} rows={3}
            placeholder={commentRequired ? 'Descripción detallada requerida...' : 'Descripción adicional del motivo...'}
            className={`w-full px-3.5 py-2.5 rounded-2xl border bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:ring-2 transition-all resize-none ${
              commentRequired && !comment.trim() ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-slate-200 focus:border-[#0052CC] focus:ring-[#0052CC]/10'
            }`}
          />
        </div>

        {submitError && <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>}

        <button onClick={handleSubmit} disabled={!canSubmit || submitting}
          className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Enviando...' : 'Enviar solicitud de anulación'}
        </button>
      </div>
    </div>
  );
}

/* ─── Payment change form ────────────────────────────────────────────────────── */
function PaymentChangeForm({ inv, onBack, onSuccess, user, activeBranch, activeBranchId, employees, appendAuditLog }) {
  const [newPayment,  setNewPayment]  = useState('');
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');

  const currentPay = (inv.tipo_pago || '').toLowerCase();
  const available  = PAYMENT_METHODS.filter(m => m !== currentPay);

  const handleSubmit = async () => {
    if (!newPayment) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const target = findTargetEmployee(employees, activeBranchId);
      const { error } = await supabase.from('approval_requests').insert({
        employee_id:  user?.id,
        approver_id:  target?.id ?? null,
        type:         'PAYMENT_CHANGE_REQUEST',
        status:       'PENDING',
        note:         comment.trim() || null,
        metadata: {
          invoice_id:           inv.id,
          correlativo:          inv.correlativo,
          fecha:                inv.fecha,
          total:                inv.total,
          tipo_documento:       inv.tipo_documento,
          current_pago:         inv.tipo_pago,
          new_pago:             newPayment,
          branch_id:            activeBranchId,
          branch_name:          activeBranch?.name,
          notified_employee_id: target?.id ?? null,
          notified_employee:    target?.name ?? 'Sin supervisor asignado',
        },
      });
      if (error) throw error;

      await appendAuditLog('PAYMENT_CHANGE_REQUEST_CREATED', String(inv.id), {
        correlativo: inv.correlativo, current_pago: inv.tipo_pago, new_pago: newPayment,
      });

      if (target?.id) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              employeeId: target.id,
              title: '💳 Cambio de Forma de Pago',
              body: `${user?.name || 'Un empleado'} solicita cambiar pago de ${inv.correlativo}: ${inv.tipo_pago} → ${newPayment}`,
            },
          });
        } catch { /* non-fatal */ }
      }
      onSuccess('pay_change', target?.name);
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
          <p className="text-[12px] font-black text-slate-800 truncate">Cambio de Pago — {inv.correlativo}</p>
          <p className="text-[10px] text-slate-400">{fmtDate(inv.fecha)} · {fmtCurrency(inv.total)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

        {/* Pago actual */}
        <div className="rounded-2xl px-3.5 py-2.5 flex items-center gap-2 bg-slate-50 border border-slate-200 shrink-0">
          <CreditCard size={13} className="text-slate-400 shrink-0" strokeWidth={2.5} />
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de pago actual</p>
            <p className="text-[13px] font-black text-slate-700 capitalize">{PAYMENT_LABELS[currentPay] || currentPay || '—'}</p>
          </div>
        </div>

        {/* Selector nuevo pago */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Cambiar a *</label>
          <div className="grid grid-cols-2 gap-1.5">
            {available.map(m => (
              <button key={m} onClick={() => setNewPayment(m)}
                className={`text-left px-3 py-2.5 rounded-2xl border text-[11px] font-bold transition-all ${
                  newPayment === m ? 'bg-[#0052CC] text-white border-[#0052CC]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#0052CC]/40'
                }`}>
                {PAYMENT_LABELS[m] || m}
              </button>
            ))}
          </div>
        </div>

        {/* Comentario */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Motivo del cambio</label>
          <textarea
            value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder="Explica el motivo del cambio..."
            className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all resize-none"
          />
        </div>

        {submitError && <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>}

        <button onClick={handleSubmit} disabled={!newPayment || submitting}
          className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Enviando...' : 'Enviar solicitud de cambio'}
        </button>
      </div>
    </div>
  );
}

/* ─── Vendor change form ─────────────────────────────────────────────────────── */
function VendorChangeForm({ inv, onBack, onSuccess, user, activeBranch, activeBranchId, employees, appendAuditLog }) {
  const [newVendorId, setNewVendorId] = useState('');
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');

  const currentVendor = employees.find(e => String(e.code) === String(inv.cod_vendedor));
  const vendorList    = employees.filter(e =>
    e.status === 'ACTIVO' &&
    String(e.branch_id ?? e.branchId) === String(activeBranchId) &&
    String(e.code) !== String(inv.cod_vendedor)
  );

  const selectedVendor = employees.find(e => String(e.id) === String(newVendorId));

  const handleSubmit = async () => {
    if (!newVendorId || !selectedVendor) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const target = findTargetEmployee(employees, activeBranchId);
      const { error } = await supabase.from('approval_requests').insert({
        employee_id:  user?.id,
        approver_id:  target?.id ?? null,
        type:         'VENDOR_CHANGE_REQUEST',
        status:       'PENDING',
        note:         comment.trim() || null,
        metadata: {
          invoice_id:           inv.id,
          correlativo:          inv.correlativo,
          fecha:                inv.fecha,
          total:                inv.total,
          tipo_documento:       inv.tipo_documento,
          branch_id:            activeBranchId,
          branch_name:          activeBranch?.name,
          current_vendor_code:  inv.cod_vendedor,
          current_vendor_name:  currentVendor?.name ?? null,
          current_vendor_photo: currentVendor?.photo ?? currentVendor?.photo_url ?? null,
          new_vendor_id:        selectedVendor.id,
          new_vendor_code:      selectedVendor.code,
          new_vendor_name:      selectedVendor.name,
          new_vendor_photo:     selectedVendor.photo ?? selectedVendor.photo_url ?? null,
          notified_employee_id: target?.id ?? null,
          notified_employee:    target?.name ?? 'Sin supervisor asignado',
        },
      });
      if (error) throw error;

      await appendAuditLog('VENDOR_CHANGE_REQUEST_CREATED', String(inv.id), {
        correlativo: inv.correlativo, from: inv.cod_vendedor, to: selectedVendor.code,
      });

      if (target?.id) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              employeeId: target.id,
              title: '👤 Cambio de Vendedor',
              body: `${user?.name || 'Un empleado'} solicita reasignar ${inv.correlativo} de #${inv.cod_vendedor} a ${selectedVendor.name}`,
            },
          });
        } catch { /* non-fatal */ }
      }
      onSuccess('vendor_change', target?.name);
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
          <p className="text-[12px] font-black text-slate-800 truncate">Cambio de Vendedor — {inv.correlativo}</p>
          <p className="text-[10px] text-slate-400">{fmtDate(inv.fecha)} · {fmtCurrency(inv.total)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

        {/* Vendedor actual */}
        <div className="rounded-2xl px-3.5 py-2.5 bg-slate-50 border border-slate-200 shrink-0">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Vendedor actual</p>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-slate-200 border border-slate-300 flex-shrink-0 flex items-center justify-center">
              {currentVendor?.photo || currentVendor?.photo_url
                ? <img src={currentVendor.photo || currentVendor.photo_url} className="w-full h-full object-cover" alt="" />
                : <User size={14} className="text-slate-400" />}
            </div>
            <div>
              <p className="text-[12px] font-black text-slate-700">{currentVendor?.name ?? 'Vendedor desconocido'}</p>
              <p className="text-[10px] text-slate-400 font-mono">Código #{inv.cod_vendedor || '—'}</p>
            </div>
          </div>
        </div>

        {/* Lista de vendedores */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Asignar a *</label>
          {vendorList.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-3">No hay otros vendedores en esta sucursal</p>
          ) : (
            <div className="space-y-1">
              {vendorList.map(emp => {
                const isSelected = String(newVendorId) === String(emp.id);
                return (
                  <button key={emp.id} onClick={() => setNewVendorId(String(emp.id))}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl border text-left transition-all ${
                      isSelected ? 'bg-[#0052CC]/5 border-[#0052CC]/40 shadow-[0_0_0_1px_rgba(0,82,204,0.15)]' : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}>
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0 flex items-center justify-center">
                      {emp.photo || emp.photo_url
                        ? <img src={emp.photo || emp.photo_url} className="w-full h-full object-cover" alt="" />
                        : <User size={14} className="text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] font-black truncate ${isSelected ? 'text-[#0052CC]' : 'text-slate-700'}`}>{emp.name}</p>
                      <p className="text-[9px] text-slate-400 font-mono">Código #{emp.code || '—'}</p>
                    </div>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-[#0052CC] flex items-center justify-center shrink-0">
                        <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-white"><path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Comentario */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Motivo del cambio</label>
          <textarea
            value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder="Explica por qué se debe reasignar esta venta..."
            className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all resize-none"
          />
        </div>

        {submitError && <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>}

        <button onClick={handleSubmit} disabled={!newVendorId || submitting}
          className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Enviando...' : 'Enviar solicitud de cambio'}
        </button>
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────────── */
export default function WidgetAnnulmentRequest({ selectedBranchId: propBranchId = null }) {
  const { user }       = useAuth();
  const employees      = useStaffStore(s => s.employees);
  const branches       = useStaffStore(s => s.branches);
  const appendAuditLog = useStaffStore(s => s.appendAuditLog);

  const userBranchId   = user?.branchId ?? user?.branch_id;
  const activeBranchId = propBranchId ?? String(userBranchId ?? '');
  const activeBranch   = branches.find(b => String(b.id) === activeBranchId);

  // view: 'list' | 'detail' | 'type_select' | 'annul' | 'pay_change' | 'vendor_change' | 'success'
  const [view,        setView]        = useState('list');
  const [prevView,    setPrevView]    = useState('list');
  const [invoices,    setInvoices]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [focused,     setFocused]     = useState(null);
  const [successInfo, setSuccessInfo] = useState({ type: 'annul', supervisor: '' });

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
      .select('id, correlativo, fecha, total, tipo_documento, cliente, tipo_pago, branch_id, cod_vendedor')
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
  useEffect(() => { setView('list'); setFocused(null); setSearch(''); }, [propBranchId]);

  const { results: filtered, isFuzzy } = !search.trim()
    ? { results: invoices, isFuzzy: false }
    : smartFilter(search, invoices, inv => [inv.correlativo, inv.cliente, fmtDate(inv.fecha), inv.fecha, String(Number(inv.total || 0).toFixed(2))]);

  const handleSuccess = (type, supervisor) => {
    setSuccessInfo({ type, supervisor });
    setView('success');
    setTimeout(() => { setView('list'); setFocused(null); loadInvoices(); }, 4000);
  };

  const sharedProps = { user, activeBranch, activeBranchId, employees, appendAuditLog };

  if (!activeBranchId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-300">
        <AlertTriangle size={28} strokeWidth={1.5} />
        <p className="text-[12px] font-semibold text-slate-400">Tu sucursal no está configurada para este widget</p>
      </div>
    );
  }

  /* ── Success screen ── */
  if (view === 'success') {
    const successLabels = {
      annul:         { title: 'Anulación solicitada',       sub: 'La supervisión fue notificada y revisará la solicitud.' },
      pay_change:    { title: 'Cambio de pago solicitado',  sub: 'La supervisión fue notificada para su aprobación.' },
      vendor_change: { title: 'Cambio de vendedor enviado', sub: 'La supervisión fue notificada para su aprobación.' },
    };
    const lbl = successLabels[successInfo.type] || successLabels.annul;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CheckCircle2 size={40} className="text-emerald-500" strokeWidth={1.5} />
        <div className="text-center">
          <p className="text-[14px] font-black text-slate-800">{lbl.title}</p>
          <p className="text-[12px] text-slate-500 mt-1 max-w-[200px] leading-relaxed">{lbl.sub}</p>
          {successInfo.supervisor && (
            <p className="text-[11px] text-[#0052CC] font-bold mt-1">Supervisor: {successInfo.supervisor}</p>
          )}
        </div>
      </div>
    );
  }

  /* ── Sub-views ── */
  if (view === 'annul' && focused)
    return <AnnulForm inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;

  if (view === 'pay_change' && focused)
    return <PaymentChangeForm inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;

  if (view === 'vendor_change' && focused)
    return <VendorChangeForm inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;

  if (view === 'type_select' && focused)
    return (
      <TypeSelector
        inv={focused}
        onBack={() => setView(prevView)}
        onSelect={key => setView(key)}
      />
    );

  if (view === 'detail' && focused)
    return (
      <InvoiceDetail
        inv={focused}
        onBack={() => { setView('list'); setFocused(null); }}
        onModify={() => { setPrevView('detail'); setView('type_select'); }}
      />
    );

  /* ── LISTA ── */
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

        {!loading && isFuzzy && search && (
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
              className="flex items-center gap-2 px-3 py-2.5 rounded-2xl border border-slate-100 bg-white hover:border-slate-200 transition-all">
              <Receipt size={13} className={ok ? 'text-slate-400 shrink-0' : 'text-slate-200 shrink-0'} strokeWidth={2} />

              <div className="flex-1 min-w-0">
                <p className={`text-[12px] font-black truncate leading-tight ${ok ? 'text-slate-800' : 'text-slate-400'}`}>
                  {inv.cliente || 'Sin nombre'}
                </p>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className="text-[9px] text-slate-400 font-mono">{inv.correlativo}</span>
                  <DocBadge tipo={inv.tipo_documento} />
                  {inv.tipo_pago && <PayBadge tipo={inv.tipo_pago} />}
                </div>
              </div>

              <div className="text-right shrink-0">
                <p className={`text-[11px] font-black ${ok ? 'text-slate-700' : 'text-slate-300'}`}>
                  {fmtCurrency(inv.total)}
                </p>
                <p className="text-[8px] text-slate-300">{fmtDate(inv.fecha)}</p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { setFocused(inv); setView('detail'); }}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-[#0052CC] hover:text-white text-slate-400 transition-all"
                  title="Ver detalle">
                  <Eye size={12} strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => { setFocused(inv); setPrevView('list'); setView('type_select'); }}
                  className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                    ok
                      ? 'bg-amber-50 hover:bg-amber-500 hover:text-white text-amber-500'
                      : 'bg-red-50 hover:bg-red-500 hover:text-white text-red-400'
                  }`}
                  title="Solicitar modificación">
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
