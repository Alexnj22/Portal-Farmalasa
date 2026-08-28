import React, { useState, useEffect, useMemo, useCallback } from 'react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { webpSignedUrl } from '../../utils/storageFiles';
import SegmentedControl from '../../components/common/SegmentedControl';
import Button from '../../components/common/Button';
import Checkbox from '../../components/common/Checkbox';
import Badge from '../../components/common/Badge';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import {
  Search, Loader2, AlertTriangle, CheckCircle2, Clock,
  Eye, ArrowLeft, AlertCircle, Ban, CreditCard, UserCog,
  ChevronRight, Info, ShieldAlert, User, CalendarDays, Contact, Receipt,
} from 'lucide-react';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import SearchInput from '../../components/common/SearchInput';
import { useStaffStore } from '../../store/staffStore';
import { HerramientasModal, PieModal } from './LanzadorSolicitud';
import { useAuth } from '../../context/AuthContext';
import { normSearch } from '../../utils/searchUtils';
import { clickable } from '../../utils/clickable';
import { formatMoney } from '../../utils/formatNumber';
import { insertApprovalRequestSilent } from '../../data/requests';
import {
  fetchInvoiceItemsForInvoice, fetchBranchInvoicesRecent,
  searchBranchInvoices, WIDGET_INVOICE_PAGE,
} from '../../data/facturacion';
import { searchCustomersByTokens } from '../../data/customers';
import { salaConCajaAbierta } from '../../data/cortes';
import PortalTextarea from '../../components/common/PortalTextarea';
import ListRow from '../../components/common/ListRow';
import { mensajeAmigable } from '../../utils/errorMessages';
import { shortEmployeeName, employeeInitials } from '../../utils/nameUtils';
import { rotuloCampo } from '../../utils/rotuloDeCampo';

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
  // `en-CA` da `YYYY-MM-DD`: es el idiom para LEER la fecha de una zona, no
  // formato para el usuario — el mismo que ya usa `useTimeClockEngine.js`.
  // Antes esto era `toLocaleString('en-US')` reparseado con `new Date()`, que
  // funcionaba de casualidad (con `es-SV` da Invalid Date). Solo se usan las
  // partes de fecha del resultado, nunca la hora.
  const [a, m, d] = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' })
    .split('-').map(Number);
  return new Date(a, m - 1, d);
}
function isSameDay(dateStr) {
  const today = svToday();
  const d = new Date(dateStr + 'T00:00:00');
  return today.getFullYear() === d.getFullYear() &&
    today.getMonth() === d.getMonth() &&
    today.getDate() === d.getDate();
}

/* ── Anular pide una CAJA abierta, no un día abierto ────────────────────────
   Pedido del usuario el 2026-08-24, y corregido por él mismo esa misma noche.

   Anular devuelve efectivo, y ese efectivo sale de la caja que esté abierta en
   ese momento. Si la sala ya sacó su cierre del día, no hay ninguna: no hay de
   dónde descontar, y la venta quedaría moviendo un número ya declarado.

   El freno es del MOMENTO, no de la venta. La fecha de la factura no
   interviene: una venta de hace tres días se anula sin problema mientras la
   sala tenga caja abierta. La primera versión de esta regla lo leía al revés
   —bloqueaba para siempre lo que ya tenía su cierre— y eso convertía «esperá a
   mañana» en una promesa falsa.

   Acá vivía además un «período de gracia de 3 días» que no frenaba nada: sólo
   pedía un comentario. Se fue entero.

   Lo decide la base con `sala_con_caja_abierta`, la MISMA función que aplican
   el trigger de la solicitud y la Edge Function que la ejecuta: una sola regla,
   escrita una sola vez. Es una pregunta por SALA y por momento, no por factura.

   `cajaAbierta` tiene cuatro valores a propósito. 'cargando' y `null` (no se
   pudo averiguar) NO son «hay caja»: ofrecer anular con esa duda es prometer
   algo que el servidor va a rechazar, y decir que ya cerró sería inventarlo.
   Los dos bloquean, y cada uno dice lo suyo. */
function estadoDeLaCaja(cajaAbierta) {
  if (cajaAbierta === true)  return 'abierta';
  if (cajaAbierta === false) return 'cerrada';
  return cajaAbierta === 'cargando' ? 'cargando' : 'desconocido';
}
const MOTIVO_SIN_ANULAR = {
  cerrada:     'La sala ya sacó su cierre del día — espera a mañana, o a que abra caja',
  cargando:    'Verificando si la sala tiene caja abierta…',
  desconocido: 'No se pudo verificar si la sala tiene caja abierta',
};

/* ── La ventana que el filtro de fecha admite ───────────────────────────────
   La lista trae las ventas del MES CORRIENTE, así que dejar elegir cualquier
   día de cualquier año ofrecía un resultado que no puede existir: el filtro
   devolvía vacío y parecía roto.

   Del 1 al 7 el mes recién arranca, y "no encuentro la factura de anteayer"
   es exactamente cuando se usa esto. Por eso el piso es el MENOR entre el
   primero del mes y hace 7 días: la ventana nunca baja de una semana.

   **Enero.** El 3 de enero el piso cae en el 27 de diciembre — la ventana
   cruza de año, y ahí `LiquidDatePicker` vuelve a mostrar el campo del año
   solo (`hideYear` se anula cuando `min` y `max` no comparten año). Es la
   única semana del año en que aparece, y aparece porque en esa semana el año
   sí distingue: "01/03" podría ser de dos años distintos. El resto del tiempo
   sobra, que es justamente lo que se pidió sacar.

   OJO: la ventana es del CONTROL, no de la consulta. La lista sigue siendo la
   del mes; elegir el 27 de diciembre desde acá no la va a traer. Se admite
   porque el mismo día 3 el usuario está mirando cierres del mes anterior y un
   calendario que apaga esos días se lee como que el portal los perdió. */
function ventanaDelFiltro() {
  const hoy = svToday();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const primeroDelMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const haceSiete = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 7);
  return { min: iso(primeroDelMes <= haceSiete ? primeroDelMes : haceSiete), max: iso(hoy) };
}
/* Una factura anulada ya no es un documento vivo: no se vuelve a anular, y
   tampoco se le cambia el cliente, el pago ni el vendedor. La regla la impone
   la BD (`factura_esta_anulada` + trigger `validar_solicitud_facturacion`); acá
   se muestra antes de que alguien llene un formulario que el servidor va a
   rechazar.

   Son DOS estados, no uno. Medido el 2026-08-06: 975 facturas en
   'DTE INVALIDADO EN MH' contra 14 en 'NULA'. 'NULA' es el paso intermedio
   —anulada en el ERP, todavía sin invalidar ante Hacienda—; el estado final es
   el otro. Mirar solo 'NULA' cubría el 1.4% de los casos. */
const ESTADOS_ANULADA = ['NULA', 'DTE INVALIDADO EN MH'];
function esAnulada(inv) {
  return ESTADOS_ANULADA.includes(String(inv?.estado ?? '').toUpperCase());
}

function fmtCurrency(n) { return formatMoney(n ?? 0); }
function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DocBadge({ tipo }) {
  if (!tipo) return null;
  const isCCF = tipo === 'CCF';
  return (
    <Badge variant={isCCF ? 'danger' : 'neutral'} size="sm" className="shrink-0">{tipo}</Badge>
  );
}
function PayBadge({ tipo }) {
  if (!tipo) return null;
  return (
    <Badge variant="success" size="sm" className="shrink-0"> {tipo}</Badge>
  );
}

function VendorAvatar({ employee, size = 6 }) {
  const sz = AV[size] ?? AV[6];
  const base = `${sz} rounded-full overflow-hidden flex-shrink-0 border border-divider flex items-center justify-center`;
  if (!employee)
    return <div className={`${base} bg-surface-card-hover`}><User size={size <= 6 ? 11 : 14} className="text-content-3" /></div>;
  if (employee.photo || employee.photo_url)
    // WEBP y no PNG. Medido el 2026-08-06 al abrir este widget: seis fotos,
    // **0,98 MB**, 167 kB de promedio, y la más lenta tardó 2,1 s — para
    // dibujarlas en un círculo de 20 píxeles. `webpSignedUrl` ya existía, con
    // su medición escrita (168 kB → 20 kB), y no lo usaba nadie.
    //
    // `loading="lazy"` además: la lista trae un mes de ventas y las de abajo no
    // hacen falta hasta que alguien baje.
    // `AvatarConEstado` conserva las dos optimizaciones medidas acá: envuelve a
    // `LiquidAvatar`, que ya pide la foto en WEBP y ya lleva `loading="lazy"`.
    // Lo que agrega es el aro — quien pidió la anulación puede no estar hoy.
    return <AvatarConEstado emp={employee} px={20} radio="rounded-full" marco="" />;
  return (
    <div className={`${base} bg-surface-card-hover`}>
      <span className="text-content-2 font-black text-caption leading-none">{employeeInitials(employee)}</span>
    </div>
  );
}

/* ── Compact invoice header shared across all sub-views ─────────────────────── */
function InvoiceHeader({ inv, onBack, vendor }) {
  return (
    <div className="flex flex-col gap-1 shrink-0 pb-2 border-b border-divider">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="xs" icon={ArrowLeft} iconOnly onClick={onBack} />
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-black text-content truncate leading-tight">{inv.cliente || 'Sin nombre'}</p>
          <p className="text-micro text-content-3 font-mono leading-tight">{inv.correlativo}</p>
        </div>
        <p className="text-body font-black text-content shrink-0">{fmtCurrency(inv.total)}</p>
      </div>
      <div className="flex items-center gap-1.5 pl-8 flex-wrap">
        <span className="text-micro text-content-3 font-mono">ID #{inv.id}</span>
        <span className="text-content-3">·</span>
        <span className="text-micro font-semibold text-content-3">{fmtDate(inv.fecha)}</span>
        {vendor && (
          <>
            <span className="text-content-3">·</span>
            <span className="inline-flex items-center gap-1">
              <VendorAvatar employee={vendor} size={5} />
              <span className="text-micro text-content-3 font-semibold">{vendor.name?.split(' ')[0]}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/* La acción principal de cada paso — va al PIE canónico del modal.
   Estaba al final del cuerpo que scrollea: en las facturas con muchas líneas
   había que llegar hasta abajo para encontrar el botón de enviar, y con el
   teclado abierto en el teléfono quedaba directamente fuera de la vista.
   `ml-auto` porque el pie reparte con `justify-between` y acá hay un solo
   botón: sin eso queda pegado a la izquierda. */
function StickySubmit({ label, onClick, disabled, loading: isLoading }) {
  return (
    <PieModal>
      <Button className="ml-auto" disabled={disabled || isLoading} onClick={onClick}>
        {isLoading && <Loader2 size={14} className="animate-spin" />}
        {isLoading ? 'Enviando...' : label}</Button>
    </PieModal>
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
  // El último recurso: alguien de dirección. Antes era `system_role IN
  // ('ADMIN','SUPERADMIN')`, que resolvía a UNA sola persona; el rango del cargo
  // da las tres, así que el aviso deja de depender de que esa una esté.
  return employees.find(e => Number(e.rango ?? 0) >= 4);
}

/* ─── Invoice detail ─────────────────────────────────────────────────────────── */
function InvoiceDetail({ inv, onBack, onModify, employees, cajaAbierta }) {
  const estadoCaja = estadoDeLaCaja(cajaAbierta);
  const seAnula    = estadoCaja === 'abierta';
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
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Info 2 columnas compacta */}
        <div data-surface="card" className="overflow-hidden shrink-0">
          <div className="grid grid-cols-2 divide-x divide-divider">
            <div>
              {[
                { label: 'Tipo Doc.',     value: inv.tipo_documento || '—' },
                { label: 'Forma de pago', value: PAYMENT_LABELS[(inv.tipo_pago || '').toLowerCase()] || inv.tipo_pago || '—' },
                { label: 'ID Venta',      value: `#${inv.id}`, mono: true },
              ].map(({ label, value, mono }, i) => (
                <div key={i} className={`px-3 py-1.5 ${i > 0 ? 'border-t border-divider' : ''}`}>
                  <p className="text-micro font-black text-content-2 uppercase tracking-wider">{label}</p>
                  <p className={`text-label font-bold text-content-2 ${mono ? 'font-mono' : ''}`}>{value}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="px-3 py-1.5 border-b border-divider">
                <p className="text-micro font-black text-content-2 uppercase tracking-wider">Vendedor</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <VendorAvatar employee={vendor} size={5} />
                  <p className="text-label font-bold text-content-2 truncate">
                    {vendor ? vendor.name.split(' ').slice(0, 2).join(' ') : (inv.cod_vendedor ? `#${inv.cod_vendedor}` : '—')}
                  </p>
                </div>
              </div>
              <div className="px-3 py-1.5 border-b border-divider">
                <p className="text-micro font-black text-content-2 uppercase tracking-wider">Fecha</p>
                <p className="text-body-sm font-black text-content">{fmtDate(inv.fecha)}</p>
              </div>
              <div className="px-3 py-1.5">
                <p className="text-micro font-black text-content-2 uppercase tracking-wider">Total</p>
                <p className="text-body font-black text-content">{fmtCurrency(inv.total)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Productos */}
        <div className="shrink-0">
          <p className="text-micro font-black text-content-2 uppercase tracking-widest px-1 mb-1">
            Productos ({items.length})
          </p>
          {loading ? (
            <div className="flex justify-center py-3"><SkeletonText lines={4} className="w-full max-w-md" /></div>
          ) : items.length === 0 ? (
            <p className="text-label text-content-3 text-center py-2">Sin detalle</p>
          ) : (
            <div data-surface="card" className="overflow-hidden">
              {items.map((it, i) => (
                <div key={i} className={`flex items-start gap-2 px-3 py-1.5 ${i > 0 ? 'border-t border-divider' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-label font-bold text-content-2 leading-tight truncate">{it.descripcion}</p>
                    {it.presentacion && <p className="text-micro text-content-3">{it.presentacion}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-label font-black text-content-2">{fmtCurrency(it.total_linea)}</p>
                    <p className="text-micro text-content-3">{it.cantidad} × {fmtCurrency(it.precio_unitario)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* La caja de la sala — de ahí sale el efectivo que se devuelve */}
        <div className={`rounded-2xl px-3 py-2 flex items-start gap-2 shrink-0 ${
          seAnula ? 'bg-warning/10 border border-warning/30' : 'bg-danger/10 border border-danger/30'
        }`}>
          <Clock size={12} className={`mt-0.5 shrink-0 ${seAnula ? 'text-warning' : 'text-danger'}`} strokeWidth={2.5} />
          <p className={`text-label font-bold leading-snug ${seAnula ? 'text-warning-text' : 'text-danger'}`}>
            {seAnula
              ? 'La sala tiene caja abierta: se puede anular hasta que salga el cierre del día.'
              : `${MOTIVO_SIN_ANULAR[estadoCaja]}: no hay caja de dónde descontar. Los cambios de cliente, vendedor y forma de pago sí se pueden pedir.`}
          </p>
        </div>
      </div>

      <StickySubmit
        label={esAnulada(inv) ? 'Factura anulada — sin cambios posibles' : 'Solicitar Modificación'}
        onClick={onModify}
        disabled={esAnulada(inv)}
      />
    </div>
  );
}

/* ─── Type selector ─────────────────────────────────────────────────────────── */
function TypeSelector({ inv, onSelect, onBack, employees, cajaAbierta }) {
  const isCCF = inv.tipo_documento === 'CCF';
  const vendor = employees.find(e => String(e.code) === String(inv.cod_vendedor));
  const estadoCaja = estadoDeLaCaja(cajaAbierta);
  const seAnula    = estadoCaja === 'abierta';

  const types = [
    {
      key: 'annul',     icon: Ban,       label: 'Anulación de factura',
      // Los otros tres cambios NO se apagan con el cierre: cambiar el cliente,
      // el vendedor o la forma de pago no mueve el efectivo de la caja.
      desc: !seAnula ? MOTIVO_SIN_ANULAR[estadoCaja]
          : isCCF   ? 'CCF — requiere nota de crédito'
          : 'Hasta que la sala saque su cierre del día',
      disabled: !seAnula,
      color: 'text-danger-text',   bg: 'bg-danger/10 border-danger/30',   iconBg: 'bg-danger/10',
    },
    {
      key: 'pay_change', icon: CreditCard, label: 'Cambio de forma de pago',
      desc: `Actual: ${PAYMENT_LABELS[(inv.tipo_pago || '').toLowerCase()] || inv.tipo_pago || 'N/A'}`,
      color: 'text-warning-text',    bg: 'bg-warning/10 border-warning/20',     iconBg: 'bg-warning/10',
    },
    {
      key: 'vendor_change', icon: UserCog, label: 'Cambio de vendedor',
      desc: vendor ? vendor.name.split(' ')[0] : `Vendedor: #${inv.cod_vendedor || 'N/A'}`,
      color: 'text-chart-3-text', bg: 'bg-chart-3/10 border-chart-3/30', iconBg: 'bg-chart-3/10',
    },
    {
      key: 'client_change', icon: Contact, label: 'Cambio de cliente',
      desc: `Actual: ${inv.cliente || 'Sin nombre'}`,
      color: 'text-chart-9-text', bg: 'bg-chart-9/10 border-chart-9/30', iconBg: 'bg-chart-9/10',
    },
  ];

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0 animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />
      <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">Tipo de solicitud</p>
      <div className="flex flex-col gap-2 flex-1">
        {types.map(({ key, icon: Icon, label, desc, color, bg, iconBg, disabled }) => (
          <button key={key} onClick={() => onSelect(key)} disabled={disabled} title={disabled ? desc : undefined}
            className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all min-h-[var(--tap-min)] ${bg} ${
              disabled ? 'opacity-50 cursor-not-allowed' : 'hover:translate-y-[var(--lift-hover)] active:scale-[0.97]'
            }`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
              <Icon size={15} strokeWidth={2} className={color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-body-sm font-black ${color}`}>{label}</p>
              <p className="text-caption text-content-3 mt-0.5">{desc}</p>
            </div>
            {!disabled && <ChevronRight size={13} strokeWidth={2.5} className="text-content-3 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Annulment form ─────────────────────────────────────────────────────────── */
function AnnulForm({ inv, onBack, onSuccess, user, activeBranch, activeBranchId, employees, appendAuditLog, cajaAbierta }) {
  const [reason,      setReason]      = useState('');
  const [comment,     setComment]     = useState('');
  const [ccfAck,      setCcfAck]      = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');

  const estadoCaja      = estadoDeLaCaja(cajaAbierta);
  const seAnula         = estadoCaja === 'abierta';
  const isCCF           = inv.tipo_documento === 'CCF';
  const ccfNotSameDay   = isCCF && !isSameDay(inv.fecha);
  const ccfSameDay      = isCCF && isSameDay(inv.fecha);
  const isCreditPay     = (inv.tipo_pago || '').toLowerCase() === 'credito';
  // El otro motivo para exigir comentario —estar fuera del período de gracia—
  // se fue con el período. La antigüedad de la venta ya no dice nada: lo que
  // manda es si la sala tiene caja abierta ahora.
  const commentRequired = ccfNotSameDay;
  // El freno de la caja va PRIMERO: si la sala cerró mientras el formulario
  // estaba abierto, no hay nada que llenar que lo destrabe.
  const canSubmit       = seAnula && reason && (!commentRequired || comment.trim()) && (!ccfNotSameDay || ccfAck);
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
          invoice_id: inv.id,
          // El id con el que se ubica la venta fuera del portal. El de arriba
          // es el interno y no sirve para buscarla: son dos numeraciones.
          erp_invoice_id: inv.erp_invoice_id ?? null,
          correlativo: inv.correlativo, fecha: inv.fecha,
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
      // El aviso al aprobador ya NO se manda desde acá: lo crea el trigger
      // `notificar_solicitud_creada` en la misma transacción que la solicitud.
      // Mandarlo también desde el navegador duplicaría la notificación, y era
      // el camino que podía no ejecutarse (pestaña cerrada, red caída).
      onSuccess('annul', target?.name);
    } catch (e) { setSubmitError(mensajeAmigable(e, 'Error al enviar solicitud')); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />

      <div className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* La sala no tiene caja abierta. Se puede llegar acá de dos maneras:
            entrando con el cierre ya emitido (el selector lo apaga, pero la
            vista se puede abrir por otro camino) o teniendo el formulario
            abierto en el momento en que la sala corta. En las dos, decirlo acá
            evita llenar algo que la base va a rechazar — y decir CUÁNDO volver,
            porque esto no es definitivo: mañana la sala abre y entra. */}
        {!seAnula && (
          <div className="rounded-2xl px-3 py-2 flex items-start gap-2 bg-danger/10 border border-danger/40">
            <ShieldAlert size={13} className="text-danger mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-label font-bold text-danger-text leading-snug">
              {MOTIVO_SIN_ANULAR[estadoCaja]}: no hay caja de dónde descontar el efectivo.
              Vuelve mañana, o cuando la sucursal tenga una caja abierta.
            </p>
          </div>
        )}
        {isCreditPay && (
          <div className="rounded-2xl px-3 py-2 flex items-start gap-2 bg-chart-3/10 border border-chart-3/30">
            <Info size={12} className="text-chart-3-text mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-label font-bold text-chart-3-text leading-snug">
              Venta a <strong>crédito</strong> — la anulación tomará más tiempo y se confirmará al realizarse.
            </p>
          </div>
        )}
        {ccfSameDay && (
          <div className="rounded-2xl px-3 py-2 flex items-start gap-2 bg-warning/10 border border-warning/30">
            <ShieldAlert size={12} className="text-warning mt-0.5 shrink-0" strokeWidth={2.5} />
            <p className="text-label font-bold text-warning-text leading-snug">
              <strong>CCF:</strong> Asegúrate de que se emitirá la nota de crédito correspondiente.
            </p>
          </div>
        )}
        {ccfNotSameDay && (
          <div className="rounded-2xl px-3 py-2 flex flex-col gap-2 bg-danger/10 border border-danger/40">
            <div className="flex items-start gap-2">
              <ShieldAlert size={13} className="text-danger mt-0.5 shrink-0" strokeWidth={2.5} />
              <p className="text-label font-bold text-danger-text leading-snug">
                <strong>CCF de fecha anterior.</strong> Solo se anulan el mismo día y requieren nota de crédito.
              </p>
            </div>
            <Checkbox
              checked={ccfAck}
              onChange={setCcfAck}
              label={<span className="text-label font-black text-danger-text">Entiendo y confirmo que tengo autorización para solicitarlo</span>}
            />
          </div>
        )}
        {/* Acá iba «Factura fuera del plazo (N días)». Era el aviso del período
            de gracia: informaba que la venta estaba vencida y dejaba pedirla
            igual con un motivo detallado. La antigüedad dejó de decir nada —lo
            que manda es si la sala tiene caja abierta—, así que el aviso hablaba
            de una regla que ya no existe. Lo reemplaza el bloque de arriba. */}

        <div className="flex flex-col gap-1.5">
          <label className={rotuloCampo('text-content-3')}>Motivo *</label>
          {/* `layout="block"`, como el selector de forma de pago. Sin él, el
              canónico dibuja su RIEL compacto —una sola píldora con las
              opciones adentro— y meterlo en una grilla con `flex-wrap` lo
              deformaba: seis motivos apretados dentro de una cápsula, que es
              lo que se veía y no se parecía a ningún otro selector del widget. */}
          <SegmentedControl
              layout="block" columns={2}
              size="sm"
              label="Motivo"
              value={reason}
              onChange={setReason}
              options={REASONS.map(r => ({ value: r, label: r }))}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={rotuloCampo('text-content-3')}>
            Comentarios {commentRequired && <span className="text-danger-text">*</span>}
          </label>
          <PortalTextarea
              value={comment} onChange={e => setComment(e.target.value)} rows={3}
              placeholder={commentRequired ? 'Descripción detallada requerida...' : 'Descripción adicional...'}
          />
        </div>
        {submitError && <p className="text-label text-danger-text font-medium px-1">{submitError}</p>}
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
  // El crédito no está entre los destinos: una venta ya emitida no se pasa a
  // crédito, se anula y se vuelve a facturar. Quien lo impone es el servidor
  // (`validar_solicitud_facturacion`); acá se saca de la lista para que nadie
  // elija algo que va a rebotar. Salir DE crédito sí se puede.
  const available  = PAYMENT_METHODS.filter(m => m !== currentPay && m !== 'credito');
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
          invoice_id: inv.id,
          // El id con el que se ubica la venta fuera del portal. El de arriba
          // es el interno y no sirve para buscarla: son dos numeraciones.
          erp_invoice_id: inv.erp_invoice_id ?? null,
          correlativo: inv.correlativo, fecha: inv.fecha,
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
      // El aviso al aprobador ya NO se manda desde acá: lo crea el trigger
      // `notificar_solicitud_creada` en la misma transacción que la solicitud.
      // Mandarlo también desde el navegador duplicaría la notificación, y era
      // el camino que podía no ejecutarse (pestaña cerrada, red caída).
      onSuccess('pay_change', target?.name);
    } catch (e) { setSubmitError(mensajeAmigable(e, 'Error al enviar solicitud')); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />

      <div className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div data-surface="card" className="px-3 py-2 flex items-center gap-2">
          <CreditCard size={13} className="text-content-3 shrink-0" strokeWidth={2.5} />
          <div>
            <p className="text-micro font-black text-content-2 uppercase tracking-widest">Forma de pago actual</p>
            <p className="text-body-sm font-black text-content-2">{PAYMENT_LABELS[currentPay] || currentPay || '—'}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={rotuloCampo('text-content-3')}>Cambiar a *</label>
          {/* Sin envoltorio de grilla: el canónico ya dispone las opciones, y
              meterlo dentro de otro `grid-cols-2` lo forzaba a dos por fila —
              cinco formas de pago terminaban en tres renglones dejando media
              tarjeta vacía. Tres columnas las acomoda en dos. */}
          <SegmentedControl
              layout="block" columns={3}
              options={available.map(m => ({ value: m, label: PAYMENT_LABELS[m] || m }))}
              value={newPayment} onChange={setNewPayment} label="Cambiar a" />
          <p className="text-caption text-content-3 px-1">
            El crédito no aparece a propósito: una venta ya emitida no se pasa a crédito. Para eso hay que anularla y volver a facturarla.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className={rotuloCampo('text-content-3')}>Motivo</label>
          <PortalTextarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              placeholder="Explica el motivo del cambio..."
          />
        </div>
        {submitError && <p className="text-label text-danger-text font-medium px-1">{submitError}</p>}
      </div>

      <StickySubmit label="Enviar solicitud de cambio" onClick={handleSubmit} disabled={!newPayment} loading={submitting} />
    </div>
  );
}

/* ─── Vendor change form ─────────────────────────────────────────────────────── */
function VendorChangeForm({ inv, onBack, onSuccess, user, activeBranch, activeBranchId, employees, appendAuditLog, codigosVistos }) {
  const [newVendorId, setNewVendorId] = useState('');
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');

  const currentVendor  = employees.find(e => String(e.code) === String(inv.cod_vendedor));
  // Asignados a la sucursal **o** con ventas efectivas en ella. Solo lo primero
  // dejaba fuera a quien factura donde no está asignado, y a esa persona no se
  // le podía reasignar una venta que ella misma hizo.
  const vendorList     = employees.filter(e =>
    e.status === 'ACTIVO' &&
    String(e.code) !== String(inv.cod_vendedor) &&
    (String(e.branch_id ?? e.branchId) === String(activeBranchId) ||
     codigosVistos?.has(String(e.code)))
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
          invoice_id: inv.id,
          // El id con el que se ubica la venta fuera del portal. El de arriba
          // es el interno y no sirve para buscarla: son dos numeraciones.
          erp_invoice_id: inv.erp_invoice_id ?? null,
          correlativo: inv.correlativo, fecha: inv.fecha,
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
      // El aviso al aprobador ya NO se manda desde acá: lo crea el trigger
      // `notificar_solicitud_creada` en la misma transacción que la solicitud.
      // Mandarlo también desde el navegador duplicaría la notificación, y era
      // el camino que podía no ejecutarse (pestaña cerrada, red caída).
      onSuccess('vendor_change', target?.name);
    } catch (e) { setSubmitError(mensajeAmigable(e, 'Error al enviar solicitud')); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={currentVendor} />

      <div className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Vendedor actual */}
        <div data-surface="card" className="px-3 py-2">
          <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1.5">Vendedor actual</p>
          <div className="flex items-center gap-2.5">
            <VendorAvatar employee={currentVendor} size={8} />
            <p className="text-body font-black text-content-2">
              {currentVendor?.name ?? `Vendedor #${inv.cod_vendedor || '—'}`}
            </p>
          </div>
        </div>

        {/* Lista — solo foto + nombre */}
        <div className="flex flex-col gap-1.5">
          <label className={rotuloCampo('text-content-3')}>Asignar a *</label>
          {vendorList.length === 0 ? (
            <p className="text-label text-content-3 text-center py-3">No hay otros vendedores en esta sucursal</p>
          ) : (
            /* Dos columnas: una fila entera por vendedor gastaba todo el
               ancho para una foto y un nombre, y con ocho vendedores empujaba
               el botón de enviar fuera de la vista. En una columna en pantalla
               angosta, en dos donde hay lugar. */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {vendorList.map(emp => {
                const isSelected = String(newVendorId) === String(emp.id);
                return (
                  <button key={emp.id} aria-pressed={isSelected} onClick={() => setNewVendorId(String(emp.id))}
                    data-surface="card" data-tono={isSelected ? 'brand' : undefined}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all">
                    <VendorAvatar employee={emp} size={8} />
                    <p className={`text-body-sm font-black flex-1 truncate ${isSelected ? 'text-brand-text' : 'text-content-2'}`} title={emp.name}>{shortEmployeeName(emp)}</p>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-brand flex items-center justify-center shrink-0">
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
          <label className={rotuloCampo('text-content-3')}>Motivo</label>
          <PortalTextarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              placeholder="Explica por qué se debe reasignar esta venta..."
          />
        </div>
        {submitError && <p className="text-label text-danger-text font-medium px-1">{submitError}</p>}
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
          invoice_id: inv.id,
          // El id con el que se ubica la venta fuera del portal. El de arriba
          // es el interno y no sirve para buscarla: son dos numeraciones.
          erp_invoice_id: inv.erp_invoice_id ?? null,
          correlativo: inv.correlativo, fecha: inv.fecha,
          total: inv.total, tipo_documento: inv.tipo_documento,
          branch_id: activeBranchId, branch_name: activeBranch?.name,
          current_cliente: inv.cliente ?? null,
          new_client_id: newClient.id,
          // El id que entiende el ERP es OTRO que el del portal. Sin este
          // campo la solicitud no se puede aplicar — y mandar el del portal
          // apuntaría a un cliente distinto sin dar ningún error.
          new_client_erp_id: newClient.erp_id ?? null,
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
      // El aviso al aprobador ya NO se manda desde acá: lo crea el trigger
      // `notificar_solicitud_creada` en la misma transacción que la solicitud.
      // Mandarlo también desde el navegador duplicaría la notificación, y era
      // el camino que podía no ejecutarse (pestaña cerrada, red caída).
      onSuccess('client_change', target?.name);
    } catch (e) { setSubmitError(mensajeAmigable(e, 'Error al enviar solicitud')); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2 h-full animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
      <InvoiceHeader inv={inv} onBack={onBack} vendor={vendor} />

      <div className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Cliente actual */}
        <div data-surface="card" className="px-3 py-2">
          <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1.5">Cliente actual</p>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-surface-card-hover flex items-center justify-center shrink-0">
              <span className="text-content-2 font-black text-label leading-none">{(inv.cliente || '?').charAt(0)}</span>
            </div>
            <p className="text-body font-black text-content-2 truncate">{inv.cliente || 'Sin nombre'}</p>
          </div>
        </div>

        {/* Buscador de cliente nuevo */}
        <div className="flex flex-col gap-1.5">
          <label className={rotuloCampo('text-content-3')}>Cliente nuevo *</label>
          <SearchInput
            size="sm"
            value={query}
            onChange={v => { setQuery(v); setNewClient(null); }}
            placeholder="Nombre, NIT, DUI o teléfono..."
            loading={searching}
          />

          {/* Seleccionado */}
          {newClient && (
            <div data-surface="card" data-tono="brand" className="flex items-center gap-2.5 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                <span className="text-brand-text font-black text-caption leading-none">{newClient.name?.charAt(0)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body-sm font-black text-brand-text truncate">{newClient.name}</p>
                {(newClient.nit || newClient.dui) && (
                  <p className="text-micro text-content-3 font-mono truncate">{newClient.nit || newClient.dui}</p>
                )}
              </div>
              <div className="w-4 h-4 rounded-full bg-brand flex items-center justify-center shrink-0">
                <svg viewBox="0 0 10 8" className="w-2.5 h-2"><path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            </div>
          )}

          {/* Resultados */}
          {!newClient && query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-label text-content-3 text-center py-2">Sin coincidencias en el listado de clientes</p>
          )}
          {!newClient && results.length > 0 && (
            <div className="space-y-1 max-h-[180px] overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {results.map(c => (
                <ListRow
                    key={c.id}
                    onClick={() => setNewClient(c)}
                    leading={<span className="font-black text-caption leading-none">{c.name?.charAt(0)}</span>}
                    title={c.name}
                    subtitle={[c.nit && `NIT ${c.nit}`, c.dui && `DUI ${c.dui}`, c.phone].filter(Boolean).join(' · ') || `#${c.erp_id || c.id}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className={rotuloCampo('text-content-3')}>Motivo</label>
          <PortalTextarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              placeholder="Explica por qué se debe cambiar el cliente..."
          />
        </div>
        {submitError && <p className="text-label text-danger-text font-medium px-1">{submitError}</p>}
      </div>

      <StickySubmit label="Enviar solicitud de cambio" onClick={handleSubmit} disabled={!newClient} loading={submitting} />
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────────── */
export function FormularioFacturacion({ selectedBranchId: propBranchId = null }) {
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
  // Se calcula una vez por montaje: el modal no vive de un día para el otro.
  const ventanaFiltro = useMemo(ventanaDelFiltro, []);
  const [focused,     setFocused]     = useState(null);
  const [reloadKey,   setReloadKey]   = useState(0);
  const [successInfo, setSuccessInfo] = useState({ type: 'annul', supervisor: '' });
  /* ¿La sala tiene una caja abierta ahora? Una sola pregunta por sala y no una
     por factura: la respuesta no depende de qué venta se mire, sino del momento
     (ver `estadoDeLaCaja`). Arranca en 'cargando' y no en `true` a propósito —
     `true` significa «hay caja», y afirmarlo antes de preguntar ofrecería
     anular durante el primer parpadeo. */
  const [cajaAbierta, setCajaAbierta] = useState('cargando');

  /* Ámbito de la consulta: el mes en curso, o el día elegido en el filtro. Se
     resuelve en el servidor — antes el filtro de fecha se aplicaba en el
     navegador sobre una lista ya truncada, así que elegir un día del principio
     del mes no mostraba nada. */
  const ambito = useMemo(() => {
    if (dateFilter) return { fecha: dateFilter };
    const now  = svToday();
    const y    = now.getFullYear();
    const m    = String(now.getMonth() + 1).padStart(2, '0');
    const last = String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${last}` };
  }, [dateFilter]);

  /* Índice nombre→código de los vendedores. `sales_invoices` guarda el código,
     no el nombre, así que buscar "marta" tiene que traducirse a códigos ANTES
     de ir al servidor. Los empleados ya están en el store: no cuesta un viaje. */
  const vendorIndex = useMemo(
    () => (employees || [])
      .filter(e => e.code)
      .map(e => ({ code: String(e.code), norm: normSearch(e.name || '') })),
    [employees],
  );

  /* ── Las fotos: el problema es la RÁFAGA, no el peso ─────────────────────
     Reportado: «las fotos tardan en cargar». Medido el 2026-08-07 al abrir
     este modal: el modal aparece a los 33 ms, las filas a los 702 ms, y las
     fotos **a los 4.191 ms** — tres segundos y medio con la lista ya en
     pantalla y los círculos vacíos.

     Lo primero que descarté fue el peso. Las URLs ya son las correctas
     (`/render/image/sign/`, WebP), y contra las mismas fotos reales, cuatro
     pasadas cada una: `/object/sign/` (el PNG guardado) 181 kB en 565–3005 ms
     contra `/render/image/sign/` 21 kB en 111–210 ms. El WebP ya estaba bien.

     Lo que pasa es la forma en que salen. Un mes de ventas tiene ~25
     vendedores distintos, y cuando las filas se pintan el navegador dispara
     las 25 de golpe: las tres primeras vuelven en ~350 ms y las otras 22 se
     encolan en el transformador de imágenes y vuelven todas juntas a los
     ~2.900 ms. O sea que no es una foto lenta — son 25 pidiéndose a la vez, y
     el transcodificado se hace en cada sesión porque el token firmado cambia
     y la CDN nunca puede reusar el de ayer.

     Entonces se precalientan las de ARRIBA, que son las que se ven, y de a
     TRES. Sin el tope de concurrencia esto sería la misma ráfaga un instante
     antes; con él, los avatares visibles llegan con las filas y el resto va
     llenándose mientras se scrollea, que es lo que `loading="lazy"` hace bien.

     El orden sale de `invoices` y no de `employees`: el que importa es el
     vendedor de la primera fila, no el primer empleado del padrón. */
  useEffect(() => {
    if (!invoices.length || !employees?.length) return undefined;
    const porCodigo = new Map(employees.filter(e => e.code).map(e => [String(e.code), e]));
    const urls = [];
    const vistas = new Set();
    for (const inv of invoices) {
      const e = porCodigo.get(String(inv.cod_vendedor));
      const u = webpSignedUrl(e?.photo || e?.photo_url);
      if (!u || vistas.has(u)) continue;
      vistas.add(u); urls.push(u);
      if (urls.length >= 8) break;   // las que caben en pantalla; el resto, lazy
    }

    let vivo = true;
    let siguiente = 0;
    const traer = () => {
      if (!vivo || siguiente >= urls.length) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = img.onerror = traer;   // libera el turno, no se apila
      img.src = urls[siguiente++];
    };
    for (let i = 0; i < 3; i++) traer();
    return () => { vivo = false; };
  }, [invoices, employees]);

  const buildTokens = useCallback((q) => (
    q.split(/\s+/).filter(Boolean).slice(0, 5)
      .map((bruto) => {
        // Se saca lo que rompería la sintaxis de `or=` de PostgREST (la coma
        // separa ramas, los paréntesis agrupan). El guion bajo se CONSERVA:
        // los correlativos lo llevan ("0000080360_COF").
        const texto = bruto.normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[,()"']/g, '').trim();
        if (!texto) return null;
        const norm = normSearch(texto);
        const codigos = norm
          ? vendorIndex.filter(v => v.norm.includes(norm)).map(v => v.code).slice(0, 25)
          : [];
        return { texto, codigos };
      })
      .filter(Boolean)
  ), [vendorIndex]);

  /* El conteo del ámbito se quitó junto con la leyenda «últimas 150 de 787»:
     era una consulta por cada apertura del widget para alimentar un número que
     hablaba de la tubería —cuántas filas se trajeron— y no de las facturas. */

  /* Lista: las últimas N del ámbito, o los resultados de la búsqueda. Siempre
     server-side. El debounce solo aplica cuando se está escribiendo. */
  useEffect(() => {
    if (!activeBranchId) { setInvoices([]); setLoading(false); return; }   // limpieza al quedarse sin sucursal
    const q = search.trim();
    const buscando = q.length >= 2;
    setLoading(true);
    let cancelado = false;
    const t = setTimeout(async () => {
      const { data, error } = buscando
        ? await searchBranchInvoices(activeBranchId, ambito, buildTokens(q))
        : await fetchBranchInvoicesRecent(activeBranchId, ambito);
      if (cancelado) return;
      if (error) console.error('WidgetAnnulmentRequest:', error.message);
      setInvoices(data || []);
      setLoading(false);
    }, buscando ? 300 : 0);
    return () => { cancelado = true; clearTimeout(t); };
  }, [activeBranchId, ambito, search, buildTokens, reloadKey]);

  /* La caja de ESTA sala. Se vuelve a preguntar al cambiar de sala y en cada
     recarga del widget (`reloadKey`), que es lo que corre después de enviar una
     solicitud: si la sala cerró mientras el modal estaba abierto, la próxima
     vuelta ya lo sabe. No se sondea cada minuto — el modal es efímero, y la
     base rechaza igual si se cuela una. */
  useEffect(() => {
    if (!activeBranchId) { setCajaAbierta('cargando'); return undefined; }
    let cancelado = false;
    setCajaAbierta('cargando');
    salaConCajaAbierta(activeBranchId)
      .then((r) => { if (!cancelado) setCajaAbierta(r); });
    return () => { cancelado = true; };
  }, [activeBranchId, reloadKey]);

  // Resetea el widget al cambiar de sucursal.
  useEffect(() => { setView('list'); setFocused(null); setSearch(''); setDateFilter(''); }, [propBranchId]);

  const buscando  = search.trim().length >= 2;
  // `parcial` y su leyenda «últimas 150 de 787» se quitaron a pedido del
  // usuario: el número contaba de la tubería —cuántas filas se trajeron— y no
  // de las facturas, que es lo único que importa mirando la lista.
  const enTope    = invoices.length >= WIDGET_INVOICE_PAGE;

  const handleSuccess = (type, supervisor) => {
    setSuccessInfo({ type, supervisor });
    setView('success');
    setTimeout(() => { setView('list'); setFocused(null); setReloadKey(k => k + 1); }, 4000);
  };

  /* Vendedores que REALMENTE facturan en esta sucursal, además de los que la
     tienen asignada: hay códigos que venden donde no están asignados (123, 142,
     107, 157 el 2026-08-05), y sin esto no se les puede reasignar una venta. */
  const codigosVistos = useMemo(
    () => new Set(invoices.map(i => String(i.cod_vendedor)).filter(Boolean)),
    [invoices],
  );

  const sharedProps = { user, activeBranch, activeBranchId, employees, appendAuditLog, cajaAbierta };

  if (!activeBranchId) {
    return (
      <EmptyState linea icon={AlertTriangle} title="Tu sucursal no está configurada" />
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
        <CheckCircle2 size={40} className="text-success" strokeWidth={1.5} />
        <div className="text-center">
          <p className="text-body-lg font-black text-content">{lbl.title}</p>
          <p className="text-body-sm text-content-3 mt-1 max-w-[200px] leading-relaxed">{lbl.sub}</p>
          {successInfo.supervisor && <p className="text-label text-brand-text font-bold mt-1">Supervisor: {successInfo.supervisor}</p>}
        </div>
      </div>
    );
  }

  /* ── Sub-views ── */
  if (view === 'annul'        && focused) return <AnnulForm         inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;
  if (view === 'pay_change'   && focused) return <PaymentChangeForm inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;
  if (view === 'vendor_change'&& focused) return <VendorChangeForm  inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} codigosVistos={codigosVistos} {...sharedProps} />;
  if (view === 'client_change'&& focused) return <ClientChangeForm  inv={focused} onBack={() => setView('type_select')} onSuccess={handleSuccess} {...sharedProps} />;
  if (view === 'type_select'  && focused) return <TypeSelector inv={focused} onBack={() => setView(prevView)} onSelect={key => setView(key)} employees={employees} cajaAbierta={cajaAbierta} />;
  if (view === 'detail'       && focused) return (
    <InvoiceDetail inv={focused} onBack={() => { setView('list'); setFocused(null); }}
      onModify={() => { setPrevView('detail'); setView('type_select'); }} employees={employees} cajaAbierta={cajaAbierta} />
  );

  /* ── Lista ── */
  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      {/* Los filtros van EN el encabezado del modal —la ranura canónica— y en
          un solo renglón. Antes ocupaban una franja propia debajo del título
          hecho a mano: dos alturas para dos controles, y el título repetido.
          El buscador no es expandible: plegado se leía como un botón sin nombre
          y había que descubrirlo. */}
      <HerramientasModal>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SearchInput
              accentColor="var(--success)"
              value={search}
              onChange={setSearch}
              placeholder="Cliente, vendedor, factura..."
            />
          </div>
          {/* LiquidDatePicker (estándar del proyecto — nunca input date nativo).
              Acotado a `ventanaFiltro`: la lista sólo trae el mes corriente, así
              que un calendario abierto a 1900–2100 ofrecía un resultado que no
              puede existir. Y con la ventana adentro de un año el campo del año
              desaparece — reaparece solo la primera semana de enero, que es la
              única en que la ventana cruza (ver `ventanaFiltro`). */}
          <LiquidDatePicker value={dateFilter} onChange={(d) => setDateFilter(d || '')}
              icon={CalendarDays} compact hideYear
              min={ventanaFiltro.min} max={ventanaFiltro.max} />
        </div>
      </HerramientasModal>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {loading && <div className="flex justify-center py-8"><SkeletonText lines={4} className="w-full max-w-md" /></div>}

        {!loading && invoices.length === 0 && (
          <div className="py-8 text-center text-body-sm text-content-3 font-medium">
            {buscando || dateFilter ? 'Sin resultados con estos filtros' : 'No hay facturas este mes'}
          </div>
        )}

        {/* Un tope alcanzado se avisa. Callarlo es lo que hacía el `.limit(500)`:
            una lista recortada se lee como "esto es todo lo que hay". */}
        {!loading && buscando && enTope && (
          <div className="mb-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-warning/10 border border-warning/30 text-caption text-warning-text font-semibold">
            <Search size={10} strokeWidth={2.5} className="shrink-0" />
            Hay más coincidencias — agrega una palabra para acotar
          </div>
        )}

        {/* La fila ya no se atenúa por antigüedad. Ese gris decía «fuera del
            período de gracia», y ese período se fue: con la regla del cierre,
            todo lo que no sea de hoy quedaría gris —o sea, casi la lista
            entera—, y un gris que cubre todo no distingue nada. Además la lista
            sirve para los CUATRO tipos de solicitud, y los otros tres no los
            estorba el cierre. Dónde no se puede anular se dice donde se decide:
            en el detalle y en el selector de tipo. */}
        {!loading && invoices.map(inv => {
          const anulada = esAnulada(inv);
          const vendor = employees.find(e => String(e.code) === String(inv.cod_vendedor));
          return (
            <div key={inv.id}
              {...clickable(() => { setFocused(inv); setView('detail'); })}
              data-surface="card"
              className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-all">
              <div className="flex-1 min-w-0">
                <p className={"text-body-sm font-black truncate leading-tight text-content"}>
                  {inv.cliente || 'Sin nombre'}
                </p>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className="text-micro text-content-3 font-mono">{inv.correlativo}</span>
                  <DocBadge tipo={inv.tipo_documento} />
                  {anulada && <Badge variant="danger" size="sm" className="shrink-0">Anulada</Badge>}
                  {inv.tipo_pago && <PayBadge tipo={inv.tipo_pago} />}
                  {/* Vendedor avatar + nombre aquí, no al inicio de la fila */}
                  <span className="inline-flex items-center gap-1">
                    <VendorAvatar employee={vendor} size={5} />
                    <span className="text-micro text-content-3 font-medium">
                      {vendor ? vendor.name.split(' ')[0] : (inv.cod_vendedor ? `#${inv.cod_vendedor}` : '')}
                    </span>
                  </span>
                </div>
              </div>

              <div className="text-right shrink-0">
                <p className={"text-label font-black text-content-2"}>
                  {fmtCurrency(inv.total)}
                </p>
                <p className="text-micro text-content-3">{fmtDate(inv.fecha)}</p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button size="xs" icon={Eye} title="Ver detalle" iconOnly
                    onClick={(e) => { e.stopPropagation(); setFocused(inv); setView('detail'); }} />
                <Button
                    icon={AlertCircle}
                    iconOnly
                    size="xs"
                    variant="destructive"
                    disabled={anulada}
                    onClick={(e) => { e.stopPropagation(); setFocused(inv); setPrevView('list'); setView('type_select'); }}
                    title={anulada ? 'Factura anulada — ya no admite cambios' : 'Solicitar modificación'}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* La BALDOSA se mudó a `baldosas/BaldosaFacturacion.jsx` el 2026-08-15, por el
 * mismo motivo que la de Min/Max: mientras vivía acá, importarla arrastraba
 * este archivo entero —formulario incluido— a lo que el Inicio descarga al
 * entrar. Ahora se lo trae con `lazy()` al abrirse.
 *
 * Lo que queda acá es `FormularioFacturacion`, que abren la baldosa y «Nueva
 * solicitud» de Solicitudes — las dos por `import()`.
 */
