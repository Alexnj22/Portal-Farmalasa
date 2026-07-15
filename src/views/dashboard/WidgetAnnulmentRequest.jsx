import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Loader2, AlertTriangle, CheckCircle2, X, Clock,
  Eye, ArrowLeft, AlertCircle, Ban, CreditCard, UserCog,
  ChevronRight, Info, ShieldAlert, User, CalendarDays, Contact,
} from 'lucide-react';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { smartFilter } from '../../utils/searchUtils';
import { notifyEmployees } from '../../utils/notify';
import { insertApprovalRequestSilent } from '../../data/requests';
import { fetchInvoiceItemsForInvoice, fetchBranchInvoicesForMonth } from '../../data/facturacion';
import { searchCustomersByTokens } from '../../data/customers';

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

/* Avatar sizes — explicit classes so JIT doesn't purge */
const AV = {
  5:  'w-5  h-5',
  6:  'w-6  h-6',
  7:  'w-7  h-7',
  8:  'w-8  h-8',
  10: 'w-10 h-10',
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

function VendorAvatar({ employee, size = 6 }) {
  const sz = AV[size] ?? AV[6];
  const base = `${sz} rounded-full overflow-hidden flex-shrink-0 border border-slate-200 flex items-center justify-center`;
  if (!employee)
    return <div className={`${base} bg-slate-100`}><User size={size <= 6 ? 11 : 14} className="text-slate-500" /></div>;
  if (employee.photo || employee.photo_url)
    return <div className={base}><img src={employee.photo || employee.photo_url} className="w-full h-full object-cover" alt="" onError={(ev) => { ev.currentTarget.style.display = 'none'; }} /></div>;
  return (
    <div className={`${base} bg-gradient-to-br from-slate-200 to-slate-300`}>
      <span className="text-slate-600 font-black text-[10px] leading-none">{employee.name?.charAt(0)}</span>
    </div>
  );
}

/* ── Compact invoice header shared across all sub-views ─────────────────────── */
function InvoiceHeader({ inv, onBack, vendor }) {
  return (
    <div className="flex flex-col gap-1 shrink-0 pb-2 border-b border-slate-100">
      <div className="flex items-center gap-2">
        <button onClick={onBack}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors shrink-0">
          <ArrowLeft size={12} strokeWidth={2.5} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-slate-800 truncate leading-tight">{inv.cliente || 'Sin nombre'}</p>
          <p className="text-[9px] text-slate-500 font-mono leading-tight">{inv.correlativo}</p>
        </div>
        <p className="text-[13px] font-black text-slate-800 shrink-0">{fmtCurrency(inv.total)}</p>
      </div>
      <div className="flex items-center gap-1.5 pl-8 flex-wrap">
        <span className="text-[9px] text-slate-500 font-mono">ID #{inv.id}</span>
        <span className="text-slate-200">·</span>
        <span className="text-[9px] font-semibold text-slate-500">{fmtDate(inv.fecha)}</span>
        {vendor && (
          <>
            <span className="text-slate-200">·</span>
            <span className="inline-flex items-center gap-1">
              <VendorAvatar employee={vendor} size={5} />
              <span className="text-[9px] text-slate-500 font-semibold">{vendor.name?.split(' ')[0]}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/* Sticky submit button at bottom of forms */
function StickySubmit({ label, onClick, disabled, loading: isLoading }) {
  return (
    <div className="shrink-0 pt-2">
      <button onClick={onClick} disabled={disabled || isLoading}
        className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
        {isLoading && <Loader2 size={14} className="animate-spin" />}
        {isLoading ? 'Enviando...' : label}
      </button>
    </div>
  );
}

const SALES_SUPERVISOR_ROLE_ID = 13; // Supervisor/a de Ventas

function findTargetEmployee(employees) {
  const candidates = employees.filter(e =>
    e.status === 'ACTIVO' &&
    (e.role_id === SALES_SUPERVISOR_ROLE_ID || e.roleId === SALES_SUPERVISOR_ROLE_ID)
  );
  const avail = candidates.find(e => {
    const ev = e.activeEventType ?? e.active_event_type;
    return !ev || !['VACATION', 'DISABILITY'].includes(ev);
  });
  if (avail) return avail;
  return employees.find(e => ['ADMIN', 'SUPERADMIN'].includes(String(e.system_role ?? '').toUpperCase()));
}

/* ─── Invoice detail ─────────────────────────────────────────────────────────── */
function InvoiceDetail({ inv, onBack, onModify, employees }) {
  const age           = daysAgo(inv.fecha);
  const graceDaysLeft = GRACE_DAYS - age;
  const withinGrace   = graceDaysLeft >= 0;
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const vendor = employees.find(e => String(e.code) === String(inv.cod_vendedor));

  useEffect(() => {
    let cancelled = false;
    fetchInvoiceItemsForInvoice(inv.id)
      .then(({ data }) => { if (!cancelled) { setItems(data || []); setLoading(false); } });
    return () => { cancelled = true; };
  }, [inv.id]);

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-200">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Info 2 columnas compacta */}
        <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shrink-0">
          <div className="grid grid-cols-2 divide-x divide-slate-50">
            <div>
              {[
                { label: 'Tipo Doc.',     value: inv.tipo_documento || '—' },
                { label: 'Forma de Pago', value: PAYMENT_LABELS[(inv.tipo_pago || '').toLowerCase()] || inv.tipo_pago || '—' },
                { label: 'ID Venta',      value: `#${inv.id}`, mono: true },
              ].map(({ label, value, mono }, i) => (
                <div key={i} className={`px-3 py-1.5 ${i > 0 ? 'border-t border-slate-50' : ''}`}>
                  <p className="text-[8px] font-black text-slate-600 uppercase tracking-wider">{label}</p>
                  <p className={`text-[11px] font-bold text-slate-700 ${mono ? 'font-mono' : ''}`}>{value}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="px-3 py-1.5 border-b border-slate-50">
                <p className="text-[8px] font-black text-slate-600 uppercase tracking-wider">Vendedor</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <VendorAvatar employee={vendor} size={5} />
                  <p className="text-[11px] font-bold text-slate-700 truncate">
                    {vendor ? vendor.name.split(' ').slice(0, 2).join(' ') : (inv.cod_vendedor ? `#${inv.cod_vendedor}` : '—')}
                  </p>
                </div>
              </div>
              <div className="px-3 py-1.5 border-b border-slate-50">
                <p className="text-[8px] font-black text-slate-600 uppercase tracking-wider">Fecha</p>
                <p className="text-[12px] font-black text-slate-800">{fmtDate(inv.fecha)}</p>
              </div>
              <div className="px-3 py-1.5">
                <p className="text-[8px] font-black text-slate-600 uppercase tracking-wider">Total</p>
                <p className="text-[13px] font-black text-slate-800">{fmtCurrency(inv.total)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Productos */}
        <div className="shrink-0">
          <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest px-1 mb-1">
            Productos ({items.length})
          </p>
          {loading ? (
            <div className="flex justify-center py-3"><Loader2 size={15} className="animate-spin text-slate-500" /></div>
          ) : items.length === 0 ? (
            <p className="text-[11px] text-slate-500 text-center py-2">Sin detalle</p>
          ) : (
            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
              {items.map((it, i) => (
                <div key={i} className={`flex items-start gap-2 px-3 py-1.5 ${i > 0 ? 'border-t border-slate-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-700 leading-tight truncate">{it.descripcion}</p>
                    {it.presentacion && <p className="text-[9px] text-slate-500">{it.presentacion}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-black text-slate-700">{fmtCurrency(it.total_linea)}</p>
                    <p className="text-[9px] text-slate-500">{it.cantidad} × {fmtCurrency(it.precio_unitario)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Período de gracia */}
        <div className={`rounded-2xl px-3 py-2 flex items-center gap-2 shrink-0 ${
          withinGrace ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
        }`}>
          <Clock size={12} className={withinGrace ? 'text-amber-500' : 'text-red-500'} strokeWidth={2.5} />
          <p className={`text-[11px] font-bold ${withinGrace ? 'text-amber-700' : 'text-red-600'}`}>
            {withinGrace
              ? `${graceDaysLeft} día${graceDaysLeft !== 1 ? 's' : ''} restante${graceDaysLeft !== 1 ? 's' : ''} para solicitar anulación`
              : `Anulación fuera de plazo — ${age} días desde la venta`}
          </p>
        </div>
      </div>

      <StickySubmit label="Solicitar Modificación" onClick={onModify} />
    </div>
  );
}

/* ─── Type selector ─────────────────────────────────────────────────────────── */
function TypeSelector({ inv, onSelect, onBack, employees }) {
  const isCCF = inv.tipo_documento === 'CCF';
  const vendor = employees.find(e => String(e.code) === String(inv.cod_vendedor));

  const types = [
    {
      key: 'annul',     icon: Ban,       label: 'Anulación de Factura',
      desc: isCCF ? 'CCF — requiere nota de crédito' : `Período de gracia: ${GRACE_DAYS} días`,
      color: 'text-rose-600',   bg: 'bg-rose-50 border-rose-200/70',   iconBg: 'bg-rose-100',
    },
    {
      key: 'pay_change', icon: CreditCard, label: 'Cambio de Forma de Pago',
      desc: `Actual: ${PAYMENT_LABELS[(inv.tipo_pago || '').toLowerCase()] || inv.tipo_pago || 'N/A'}`,
      color: 'text-sky-600',    bg: 'bg-sky-50 border-sky-200/70',     iconBg: 'bg-sky-100',
    },
    {
      key: 'vendor_change', icon: UserCog, label: 'Cambio de Vendedor',
      desc: vendor ? vendor.name.split(' ')[0] : `Vendedor: #${inv.cod_vendedor || 'N/A'}`,
      color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200/70', iconBg: 'bg-purple-100',
    },
    {
      key: 'client_change', icon: Contact, label: 'Cambio de Cliente',
      desc: `Actual: ${inv.cliente || 'Sin nombre'}`,
      color: 'text-teal-600', bg: 'bg-teal-50 border-teal-200/70', iconBg: 'bg-teal-100',
    },
  ];

  return (
    <div className="flex flex-col gap-3 h-full animate-in slide-in-from-right-3 duration-200">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />
      <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest px-1">Tipo de solicitud</p>
      <div className="flex flex-col gap-2 flex-1">
        {types.map(({ key, icon: Icon, label, desc, color, bg, iconBg }) => (
          <button key={key} onClick={() => onSelect(key)}
            className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left hover:-translate-y-0.5 transition-all ${bg}`}>
            <div className={`w-8 h-8 rounded-[0.65rem] flex items-center justify-center flex-shrink-0 ${iconBg}`}>
              <Icon size={15} strokeWidth={2} className={color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-[12px] font-black ${color}`}>{label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>
            </div>
            <ChevronRight size={13} strokeWidth={2.5} className="text-slate-300 shrink-0" />
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

  const age             = daysAgo(inv.fecha);
  const withinGrace     = age <= GRACE_DAYS;
  const isCCF           = inv.tipo_documento === 'CCF';
  const ccfNotSameDay   = isCCF && !isSameDay(inv.fecha);
  const ccfSameDay      = isCCF && isSameDay(inv.fecha);
  const isCreditPay     = (inv.tipo_pago || '').toLowerCase() === 'credito';
  const commentRequired = !withinGrace || ccfNotSameDay;
  const canSubmit       = reason && (!commentRequired || comment.trim()) && (!ccfNotSameDay || ccfAck);
  const vendor          = employees.find(e => String(e.code) === String(inv.cod_vendedor));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setSubmitError('');
    try {
      const target = findTargetEmployee(employees);
      const { error } = await insertApprovalRequestSilent({
        employee_id: user?.id, approver_id: target?.id ?? null,
        type: 'ANNULMENT_REQUEST', status: 'PENDING',
        note: comment.trim() || null,
        metadata: {
          invoice_id: inv.id, correlativo: inv.correlativo, fecha: inv.fecha,
          total: inv.total, tipo_documento: inv.tipo_documento, tipo_pago: inv.tipo_pago,
          branch_id: activeBranchId, branch_name: activeBranch?.name,
          reason, comment: comment.trim() || null,
          is_ccf: isCCF, is_credit_payment: isCreditPay,
          notified_employee_id: target?.id ?? null,
          notified_employee: target?.name ?? 'Sin supervisor asignado',
        },
      });
      if (error) throw error;
      await appendAuditLog('ANNULMENT_REQUEST_CREATED', String(inv.id), {
        correlativo: inv.correlativo, reason, total: inv.total, notified: target?.name,
      });
      if (target?.id) {
        await notifyEmployees([target.id], {
          type: 'REQUEST_PENDING',
          title: '⚠️ Solicitud de Anulación',
          body: `${user?.name || 'Un empleado'} solicita anular ${inv.correlativo} (${fmtCurrency(inv.total)}) — ${reason}`,
          link: '/requests',
          push: true,
        });
      }
      onSuccess('annul', target?.name);
    } catch (e) { setSubmitError(e.message || 'Error al enviar solicitud'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-200">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />

      <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {isCreditPay && (
          <div className="rounded-2xl px-3 py-2 flex items-start gap-2 bg-indigo-50 border border-indigo-200">
            <Info size={12} className="text-indigo-500 mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-[11px] font-bold text-indigo-700 leading-snug">
              Venta a <strong>crédito</strong> — la anulación tomará más tiempo y se confirmará al realizarse.
            </p>
          </div>
        )}
        {ccfSameDay && (
          <div className="rounded-2xl px-3 py-2 flex items-start gap-2 bg-amber-50 border border-amber-200">
            <ShieldAlert size={12} className="text-amber-500 mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-[11px] font-bold text-amber-700 leading-snug">
              <strong>CCF:</strong> Asegúrate de que se emitirá la nota de crédito correspondiente.
            </p>
          </div>
        )}
        {ccfNotSameDay && (
          <div className="rounded-2xl px-3 py-2 flex flex-col gap-2 bg-red-50 border border-red-300">
            <div className="flex items-start gap-2">
              <ShieldAlert size={13} className="text-red-600 mt-0.5 shrink-0" strokeWidth={2.5} />
              <p className="text-[11px] font-bold text-red-700 leading-snug">
                <strong>CCF de fecha anterior.</strong> Solo se anulan el mismo día y requieren nota de crédito.
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={ccfAck} onChange={e => setCcfAck(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-red-500 shrink-0" />
              <span className="text-[11px] font-black text-red-700">Entiendo y confirmo que tengo autorización para solicitarlo</span>
            </label>
          </div>
        )}
        {!withinGrace && !ccfNotSameDay && (
          <div className="rounded-2xl px-3 py-2 flex items-start gap-2 bg-red-50 border border-red-200">
            <AlertTriangle size={12} className="text-red-500 mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-[11px] font-bold text-red-700 leading-snug">
              Factura fuera del plazo ({age} días). Requiere motivo detallado y aprobación del supervisor.
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
                }`}>{r}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
            Comentarios {commentRequired && <span className="text-red-400">*</span>}
          </label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
            placeholder={commentRequired ? 'Descripción detallada requerida...' : 'Descripción adicional...'}
            className={`w-full px-3.5 py-2 rounded-2xl border bg-white text-[16px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:ring-2 transition-all resize-none ${
              commentRequired && !comment.trim() ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-slate-200 focus:border-[#0052CC] focus:ring-[#0052CC]/10'
            }`}
          />
        </div>
        {submitError && <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>}
      </div>

      <StickySubmit label="Enviar solicitud de anulación" onClick={handleSubmit} disabled={!canSubmit} loading={submitting} />
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
  const vendor     = employees.find(e => String(e.code) === String(inv.cod_vendedor));

  const handleSubmit = async () => {
    if (!newPayment) return;
    setSubmitting(true); setSubmitError('');
    try {
      const target = findTargetEmployee(employees);
      const { error } = await insertApprovalRequestSilent({
        employee_id: user?.id, approver_id: target?.id ?? null,
        type: 'PAYMENT_CHANGE_REQUEST', status: 'PENDING',
        note: comment.trim() || null,
        metadata: {
          invoice_id: inv.id, correlativo: inv.correlativo, fecha: inv.fecha,
          total: inv.total, tipo_documento: inv.tipo_documento,
          current_pago: inv.tipo_pago, new_pago: newPayment,
          branch_id: activeBranchId, branch_name: activeBranch?.name,
          notified_employee_id: target?.id ?? null,
          notified_employee: target?.name ?? 'Sin supervisor asignado',
        },
      });
      if (error) throw error;
      await appendAuditLog('PAYMENT_CHANGE_REQUEST_CREATED', String(inv.id), {
        correlativo: inv.correlativo, current_pago: inv.tipo_pago, new_pago: newPayment,
      });
      if (target?.id) {
        await notifyEmployees([target.id], {
          type: 'REQUEST_PENDING',
          title: '💳 Cambio de Forma de Pago',
          body: `${user?.name || 'Un empleado'} solicita cambiar pago de ${inv.correlativo}: ${inv.tipo_pago} → ${newPayment}`,
          link: '/requests',
          push: true,
        });
      }
      onSuccess('pay_change', target?.name);
    } catch (e) { setSubmitError(e.message || 'Error al enviar solicitud'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-200">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />

      <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="rounded-2xl px-3 py-2 flex items-center gap-2 bg-slate-50 border border-slate-200">
          <CreditCard size={13} className="text-slate-400 shrink-0" strokeWidth={2.5} />
          <div>
            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Forma de pago actual</p>
            <p className="text-[12px] font-black text-slate-700">{PAYMENT_LABELS[currentPay] || currentPay || '—'}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Cambiar a *</label>
          <div className="grid grid-cols-2 gap-1.5">
            {available.map(m => (
              <button key={m} onClick={() => setNewPayment(m)}
                className={`text-left px-3 py-2 rounded-2xl border text-[11px] font-bold transition-all ${
                  newPayment === m ? 'bg-[#0052CC] text-white border-[#0052CC]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#0052CC]/40'
                }`}>{PAYMENT_LABELS[m] || m}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Motivo</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder="Explica el motivo del cambio..."
            className="w-full px-3.5 py-2 rounded-2xl border border-slate-200 bg-white text-[16px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all resize-none"
          />
        </div>
        {submitError && <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>}
      </div>

      <StickySubmit label="Enviar solicitud de cambio" onClick={handleSubmit} disabled={!newPayment} loading={submitting} />
    </div>
  );
}

/* ─── Vendor change form ─────────────────────────────────────────────────────── */
function VendorChangeForm({ inv, onBack, onSuccess, user, activeBranch, activeBranchId, employees, appendAuditLog }) {
  const [newVendorId, setNewVendorId] = useState('');
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');

  const currentVendor  = employees.find(e => String(e.code) === String(inv.cod_vendedor));
  const vendorList     = employees.filter(e =>
    e.status === 'ACTIVO' &&
    String(e.branch_id ?? e.branchId) === String(activeBranchId) &&
    String(e.code) !== String(inv.cod_vendedor)
  );
  const selectedVendor = employees.find(e => String(e.id) === String(newVendorId));

  const handleSubmit = async () => {
    if (!newVendorId || !selectedVendor) return;
    setSubmitting(true); setSubmitError('');
    try {
      const target = findTargetEmployee(employees);
      const { error } = await insertApprovalRequestSilent({
        employee_id: user?.id, approver_id: target?.id ?? null,
        type: 'VENDOR_CHANGE_REQUEST', status: 'PENDING',
        note: comment.trim() || null,
        metadata: {
          invoice_id: inv.id, correlativo: inv.correlativo, fecha: inv.fecha,
          total: inv.total, tipo_documento: inv.tipo_documento,
          branch_id: activeBranchId, branch_name: activeBranch?.name,
          current_vendor_code: inv.cod_vendedor,
          current_vendor_name: currentVendor?.name ?? null,
          current_vendor_photo: currentVendor?.photo_url ?? null,
          new_vendor_id: selectedVendor.id,
          new_vendor_code: selectedVendor.code,
          new_vendor_name: selectedVendor.name,
          new_vendor_photo: selectedVendor.photo_url ?? null,
          notified_employee_id: target?.id ?? null,
          notified_employee: target?.name ?? 'Sin supervisor asignado',
        },
      });
      if (error) throw error;
      await appendAuditLog('VENDOR_CHANGE_REQUEST_CREATED', String(inv.id), {
        correlativo: inv.correlativo, from: inv.cod_vendedor, to: selectedVendor.code,
      });
      if (target?.id) {
        await notifyEmployees([target.id], {
          type: 'REQUEST_PENDING',
          title: '👤 Cambio de Vendedor',
          body: `${user?.name || 'Un empleado'} solicita reasignar ${inv.correlativo} a ${selectedVendor.name}`,
          link: '/requests',
          push: true,
        });
      }
      onSuccess('vendor_change', target?.name);
    } catch (e) { setSubmitError(e.message || 'Error al enviar solicitud'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-200">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={currentVendor} />

      <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Vendedor actual */}
        <div className="rounded-2xl px-3 py-2 bg-slate-50 border border-slate-200">
          <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5">Vendedor actual</p>
          <div className="flex items-center gap-2.5">
            <VendorAvatar employee={currentVendor} size={8} />
            <p className="text-[13px] font-black text-slate-700">
              {currentVendor?.name ?? `Vendedor #${inv.cod_vendedor || '—'}`}
            </p>
          </div>
        </div>

        {/* Lista — solo foto + nombre */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Asignar a *</label>
          {vendorList.length === 0 ? (
            <p className="text-[11px] text-slate-500 text-center py-3">No hay otros vendedores en esta sucursal</p>
          ) : (
            <div className="space-y-1">
              {vendorList.map(emp => {
                const isSelected = String(newVendorId) === String(emp.id);
                return (
                  <button key={emp.id} onClick={() => setNewVendorId(String(emp.id))}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl border text-left transition-all ${
                      isSelected ? 'bg-[#0052CC]/5 border-[#0052CC]/40' : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}>
                    <VendorAvatar employee={emp} size={8} />
                    <p className={`text-[12px] font-black flex-1 truncate ${isSelected ? 'text-[#0052CC]' : 'text-slate-700'}`}>{emp.name}</p>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-[#0052CC] flex items-center justify-center shrink-0">
                        <svg viewBox="0 0 10 8" className="w-2.5 h-2"><path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Motivo</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder="Explica por qué se debe reasignar esta venta..."
            className="w-full px-3.5 py-2 rounded-2xl border border-slate-200 bg-white text-[16px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all resize-none"
          />
        </div>
        {submitError && <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>}
      </div>

      <StickySubmit label="Enviar solicitud de cambio" onClick={handleSubmit} disabled={!newVendorId} loading={submitting} />
    </div>
  );
}

/* ─── Client change form ─────────────────────────────────────────────────────── */
function ClientChangeForm({ inv, onBack, onSuccess, user, activeBranch, activeBranchId, employees, appendAuditLog }) {
  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState([]);
  const [searching,   setSearching]   = useState(false);
  const [newClient,   setNewClient]   = useState(null);
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');
  const vendor = employees.find(e => String(e.code) === String(inv.cod_vendedor));

  /* Búsqueda server-side sobre el listado COMPLETO de clientes (23K+ filas,
     el cap de 1000 de PostgREST hace inviable traerlos al cliente):
     · cada palabra escrita debe coincidir (AND de tokens)
     · cada token busca en search_name (columna generada sin acentos/mayúsculas)
       + NIT, DUI, teléfono y código ERP — "jose" encuentra "JOSÉ" y viceversa
     · debounce 300ms · top 30 por nombre */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const tokens = q.split(/\s+/).filter(Boolean).slice(0, 5)
          .map(tok => tok.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[,%()]/g, ''))
          .filter(Boolean);
        const { data } = await searchCustomersByTokens(tokens);
        setResults(data || []);
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const handleSubmit = async () => {
    if (!newClient) return;
    setSubmitting(true); setSubmitError('');
    try {
      const target = findTargetEmployee(employees);
      const { error } = await insertApprovalRequestSilent({
        employee_id: user?.id, approver_id: target?.id ?? null,
        type: 'CLIENT_CHANGE_REQUEST', status: 'PENDING',
        note: comment.trim() || null,
        metadata: {
          invoice_id: inv.id, correlativo: inv.correlativo, fecha: inv.fecha,
          total: inv.total, tipo_documento: inv.tipo_documento,
          branch_id: activeBranchId, branch_name: activeBranch?.name,
          current_cliente: inv.cliente ?? null,
          new_client_id: newClient.id,
          new_client_name: newClient.name,
          new_client_nit: newClient.nit ?? null,
          new_client_dui: newClient.dui ?? null,
          notified_employee_id: target?.id ?? null,
          notified_employee: target?.name ?? 'Sin supervisor asignado',
        },
      });
      if (error) throw error;
      await appendAuditLog('CLIENT_CHANGE_REQUEST_CREATED', String(inv.id), {
        correlativo: inv.correlativo, from: inv.cliente, to: newClient.name,
      });
      if (target?.id) {
        await notifyEmployees([target.id], {
          type: 'REQUEST_PENDING',
          title: '🧾 Cambio de Cliente',
          body: `${user?.name || 'Un empleado'} solicita cambiar el cliente de ${inv.correlativo}: ${inv.cliente || 'Sin nombre'} → ${newClient.name}`,
          link: '/requests',
          push: true,
        });
      }
      onSuccess('client_change', target?.name);
    } catch (e) { setSubmitError(e.message || 'Error al enviar solicitud'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-200">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />

      <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Cliente actual */}
        <div className="rounded-2xl px-3 py-2 bg-slate-50 border border-slate-200">
          <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5">Cliente actual</p>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center shrink-0">
              <span className="text-slate-600 font-black text-[11px] leading-none">{(inv.cliente || '?').charAt(0)}</span>
            </div>
            <p className="text-[13px] font-black text-slate-700 truncate">{inv.cliente || 'Sin nombre'}</p>
          </div>
        </div>

        {/* Buscador de cliente nuevo */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Cliente nuevo *</label>
          <div className="relative">
            {searching
              ? <Loader2 size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
              : <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />}
            <input
              type="text" value={query}
              onChange={e => { setQuery(e.target.value); setNewClient(null); }}
              placeholder="Nombre, NIT, DUI o teléfono..."
              className="w-full pl-8 pr-7 py-2 rounded-2xl border border-slate-200 bg-white text-[16px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all"
              spellCheck={false}
            />
            {query && (
              <button onClick={() => { setQuery(''); setNewClient(null); setResults([]); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-600">
                <X size={10} strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Seleccionado */}
          {newClient && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-2xl border bg-[#0052CC]/5 border-[#0052CC]/40">
              <div className="w-7 h-7 rounded-full bg-[#0052CC]/10 flex items-center justify-center shrink-0">
                <span className="text-[#0052CC] font-black text-[10px] leading-none">{newClient.name?.charAt(0)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-black text-[#0052CC] truncate">{newClient.name}</p>
                {(newClient.nit || newClient.dui) && (
                  <p className="text-[9px] text-slate-500 font-mono truncate">{newClient.nit || newClient.dui}</p>
                )}
              </div>
              <div className="w-4 h-4 rounded-full bg-[#0052CC] flex items-center justify-center shrink-0">
                <svg viewBox="0 0 10 8" className="w-2.5 h-2"><path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            </div>
          )}

          {/* Resultados */}
          {!newClient && query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-[11px] text-slate-500 text-center py-2">Sin coincidencias en el listado de clientes</p>
          )}
          {!newClient && results.length > 0 && (
            <div className="space-y-1 max-h-[180px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {results.map(c => (
                <button key={c.id} onClick={() => setNewClient(c)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl border text-left transition-all bg-white border-slate-200 hover:border-[#0052CC]/40">
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    <span className="text-slate-500 font-black text-[10px] leading-none">{c.name?.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-slate-700 truncate leading-tight">{c.name}</p>
                    <p className="text-[9px] text-slate-500 font-mono truncate">
                      {[c.nit && `NIT ${c.nit}`, c.dui && `DUI ${c.dui}`, c.phone].filter(Boolean).join(' · ') || `#${c.erp_id || c.id}`}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Motivo</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder="Explica por qué se debe cambiar el cliente..."
            className="w-full px-3.5 py-2 rounded-2xl border border-slate-200 bg-white text-[16px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all resize-none"
          />
        </div>
        {submitError && <p className="text-[11px] text-red-500 font-medium px-1">{submitError}</p>}
      </div>

      <StickySubmit label="Enviar solicitud de cambio" onClick={handleSubmit} disabled={!newClient} loading={submitting} />
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

  const [view,        setView]        = useState('list');
  const [prevView,    setPrevView]    = useState('list');
  const [invoices,    setInvoices]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [dateFilter,  setDateFilter]  = useState('');
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

    const { data, error } = await fetchBranchInvoicesForMonth(activeBranchId, from, to);

    if (error) console.error('WidgetAnnulmentRequest:', error.message);
    setInvoices(data || []);
    setLoading(false);
  }, [activeBranchId]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial/recarga al cambiar de sucursal
  useEffect(() => { setView('list'); setFocused(null); setSearch(''); setDateFilter(''); }, [propBranchId]); // eslint-disable-line react-hooks/set-state-in-effect -- resetea el widget al cambiar de sucursal

  /* Search: by client, vendor name/code, invoice number, ID, payment type, amount */
  const buildCorpus = useCallback((inv) => {
    const vendor = employees.find(e => String(e.code) === String(inv.cod_vendedor));
    return [
      inv.correlativo,
      inv.cliente,
      inv.tipo_pago,
      String(inv.id),
      String(Number(inv.total || 0).toFixed(2)),
      vendor?.name ?? '',
      String(inv.cod_vendedor ?? ''),
    ];
  }, [employees]);

  const { results: afterSearch, isFuzzy } = !search.trim()
    ? { results: invoices, isFuzzy: false }
    : smartFilter(search, invoices, buildCorpus);

  const filtered = dateFilter ? afterSearch.filter(inv => inv.fecha === dateFilter) : afterSearch;

  const handleSuccess = (type, supervisor) => {
    setSuccessInfo({ type, supervisor });
    setView('success');
    setTimeout(() => { setView('list'); setFocused(null); loadInvoices(); }, 4000);
  };

  const sharedProps = { user, activeBranch, activeBranchId, employees, appendAuditLog };

  if (!activeBranchId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <AlertTriangle size={28} strokeWidth={1.5} className="text-slate-300" />
        <p className="text-[12px] font-semibold text-slate-500">Tu sucursal no está configurada</p>
      </div>
    );
  }

  /* ── Éxito ── */
  if (view === 'success') {
    const msgs = {
      annul:         { title: 'Anulación solicitada',       sub: 'Supervisión fue notificada y revisará la solicitud.' },
      pay_change:    { title: 'Cambio de pago solicitado',  sub: 'Supervisión fue notificada para su aprobación.' },
      vendor_change: { title: 'Cambio de vendedor enviado', sub: 'Supervisión fue notificada para su aprobación.' },
      client_change: { title: 'Cambio de cliente enviado',  sub: 'Supervisión fue notificada para su aprobación.' },
    };
    const lbl = msgs[successInfo.type] || msgs.annul;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CheckCircle2 size={40} className="text-emerald-500" strokeWidth={1.5} />
        <div className="text-center">
          <p className="text-[14px] font-black text-slate-800">{lbl.title}</p>
          <p className="text-[12px] text-slate-500 mt-1 max-w-[200px] leading-relaxed">{lbl.sub}</p>
          {successInfo.supervisor && <p className="text-[11px] text-[#0052CC] font-bold mt-1">Supervisor: {successInfo.supervisor}</p>}
        </div>
      </div>
    );
  }

  /* ── Sub-views ── */
  if (view === 'annul'        && focused) return <AnnulForm         inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;
  if (view === 'pay_change'   && focused) return <PaymentChangeForm inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;
  if (view === 'vendor_change'&& focused) return <VendorChangeForm  inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;
  if (view === 'client_change'&& focused) return <ClientChangeForm  inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;
  if (view === 'type_select'  && focused) return <TypeSelector inv={focused} onBack={() => setView(prevView)} onSelect={key => setView(key)} employees={employees} />;
  if (view === 'detail'       && focused) return (
    <InvoiceDetail inv={focused} onBack={() => { setView('list'); setFocused(null); }}
      onModify={() => { setPrevView('detail'); setView('type_select'); }} employees={employees} />
  );

  /* ── Lista ── */
  return (
    <div className="flex flex-col gap-2.5 h-full">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
          Ventas del mes — {activeBranch?.name || 'Tu sucursal'}
        </p>
        <span className="text-[10px] font-bold text-slate-500">
          {filtered.length !== invoices.length ? `${filtered.length} / ${invoices.length}` : `${invoices.length} facturas`}
        </span>
      </div>

      {/* Controls: search flexible + LiquidDatePicker fijo */}
      <div className="flex items-stretch gap-2 shrink-0">
        {/* Search */}
        <div className="flex-1 relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cliente, vendedor, factura..."
            className="w-full pl-8 pr-7 py-2 rounded-2xl border border-slate-200 bg-white text-[16px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all"
            spellCheck={false}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-600">
              <X size={10} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* LiquidDatePicker (estándar del proyecto — nunca input date nativo) */}
        <div className="w-[150px] shrink-0 rounded-2xl border border-slate-200 bg-white flex items-center focus-within:border-[#0052CC] focus-within:ring-2 focus-within:ring-[#0052CC]/10 transition-all">
          <LiquidDatePicker value={dateFilter} onChange={(d) => setDateFilter(d || '')} icon={CalendarDays} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-500" /></div>}

        {!loading && filtered.length === 0 && (
          <div className="py-8 text-center text-[12px] text-slate-500 font-medium">
            {search || dateFilter ? 'Sin resultados con estos filtros' : 'No hay facturas este mes'}
          </div>
        )}

        {!loading && isFuzzy && search && (
          <div className="mb-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[10px] text-amber-700 font-semibold">
            <Search size={10} strokeWidth={2.5} className="shrink-0" />
            Similares a &ldquo;{search}&rdquo;
          </div>
        )}

        {!loading && filtered.map(inv => {
          const age    = daysAgo(inv.fecha);
          const ok     = age <= GRACE_DAYS;
          const vendor = employees.find(e => String(e.code) === String(inv.cod_vendedor));
          return (
            <div key={inv.id}
              className="flex items-center gap-2 px-3 py-2 rounded-2xl border border-slate-100 bg-white hover:border-slate-200 transition-all">
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] font-black truncate leading-tight ${ok ? 'text-slate-800' : 'text-slate-500'}`}>
                  {inv.cliente || 'Sin nombre'}
                </p>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className="text-[9px] text-slate-500 font-mono">{inv.correlativo}</span>
                  <DocBadge tipo={inv.tipo_documento} />
                  {inv.tipo_pago && <PayBadge tipo={inv.tipo_pago} />}
                  {/* Vendedor avatar + nombre aquí, no al inicio de la fila */}
                  <span className="inline-flex items-center gap-1">
                    <VendorAvatar employee={vendor} size={5} />
                    <span className="text-[9px] text-slate-500 font-medium">
                      {vendor ? vendor.name.split(' ')[0] : (inv.cod_vendedor ? `#${inv.cod_vendedor}` : '')}
                    </span>
                  </span>
                </div>
              </div>

              <div className="text-right shrink-0">
                <p className={`text-[11px] font-black ${ok ? 'text-slate-700' : 'text-slate-500'}`}>
                  {fmtCurrency(inv.total)}
                </p>
                <p className="text-[8px] text-slate-500">{fmtDate(inv.fecha)}</p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setFocused(inv); setView('detail'); }}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-[#0052CC] hover:text-white text-slate-500 transition-all"
                  title="Ver detalle">
                  <Eye size={12} strokeWidth={2.5} />
                </button>
                <button onClick={() => { setFocused(inv); setPrevView('list'); setView('type_select'); }}
                  className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                    ok ? 'bg-amber-50 hover:bg-amber-500 hover:text-white text-amber-500'
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
