import React, { useState, useEffect, memo, useMemo } from 'react';
import CuerpoDialogo from '../components/common/CuerpoDialogo';
import Notice from '../components/common/Notice';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import FilterBar from '../components/common/FilterBar';
import ViewTabBar from '../components/common/ViewTabBar';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Inbox, Check, X, ChevronRight, ChevronDown,
    User, Calendar, Loader2, ClipboardList,
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Coffee,
    CheckCircle2, XCircle, Stethoscope, FileImage, AlertTriangle,
    Search, ArrowLeftRight, CalendarDays, Banknote, FileCheck2,
    Ban, CreditCard, Receipt, Plus,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import { smartFilter } from '../utils/searchUtils';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import RangeDatePicker from '../components/common/RangeDatePicker';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import { REQUEST_TYPES, REQUEST_STATUS } from '../store/slices/requestsSlice';
import { ICONO_POR_TIPO } from '../constants/tipoIconos';
import PortalTextarea from '../components/common/PortalTextarea';
import ModalShell from '../components/common/ModalShell';
import { formatMoney } from '../utils/formatNumber';

const CREATABLE_TYPES = [
    { key: 'VACATION',     icon: Palmtree },
    { key: 'PERMIT',       icon: FileText },
    { key: 'SHIFT_CHANGE', icon: RefreshCw },
    { key: 'OVERTIME',     icon: Coffee },
    { key: 'ADVANCE',      icon: DollarSign },
    { key: 'CERTIFICATE',  icon: FileCheck },
];

// El mapa vivía acá y se mudó a `constants/tipoIconos` (2026-08-01): la campana
// de notificaciones necesita los mismos íconos para los mismos tipos, y tener
// dos listas era garantía de que se desincronizaran.
const TYPE_ICONS = ICONO_POR_TIPO;

// Acá vivía `TYPE_COLORS` (tokenizado en T7, AUDITORIA-TEMA-2026-07.md): un color de relleno por cada tipo de solicitud —
// chart-1, chart-3, chart-4, chart-6, chart-8, chart-9, success, warning,
// danger— aplicado al círculo, al borde de la tarjeta, al resplandor del hover,
// al encabezado de sección y a cada bloque de detalle.
//
// Se fue por dos motivos, y el segundo es el que manda:
//
//  1. §6 dice que un `chart-N` solo se usa cuando el color distingue una
//     CATEGORÍA que el usuario reconoce, y que `chart-8` es de los cuatro que
//     "no se usan para nada nuevo". Acá el color no distinguía nada: el tipo ya
//     está escrito con todas sus letras y tiene su ícono.
//  2. Con nueve tintes compitiendo, **el color dejaba de significar estado**.
//     Una tarjeta rechazada y una de vacaciones se distinguían por matiz, y el
//     dato que de verdad importa —pendiente, aprobada, rechazada— quedaba
//     escondido en un punto de 8px.
//
// El canon queda: superficie neutra (`data-surface="card"`), el tipo se lee por
// ícono + nombre, y **el color se reserva para el estado**, en su insignia.

// El ID con el que se ubica la venta. Sale de la solicitud (`erp_invoice_id`,
// que el widget guarda desde v2.414.0) o de lo que quedó registrado al
// aplicarla. NUNCA cae al id interno del portal: son dos numeraciones distintas
// y mostrarlas bajo la misma etiqueta manda a buscar la venta equivocada.
const idDeVenta = (meta) =>
    meta?.erp_invoice_id ?? meta?.erp_aplicado?.erp_invoice_id ?? null;

const IdVenta = ({ meta }) => {
    const id = idDeVenta(meta);
    if (!id) return null;
    return <p className="text-caption text-content-3 font-mono mt-0.5">ID de venta {id}</p>;
};


const fmtDate = (iso) => !iso ? '—' : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
const fmtDateFull = (iso) => !iso ? '—' : new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });

// One-line summary shown in collapsed state
const CompactSummary = ({ req }) => {
    const meta = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    if (req.type === 'VACATION' && meta.startDate)
        return <span className="text-caption text-content-3">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}</span>;
    if (req.type === 'SHIFT_CHANGE' && meta.targetEmployeeName)
        return <span className="text-caption text-content-3">↔ {meta.targetEmployeeName.split(' ')[0]}{meta.date ? ` · ${fmtDate(meta.date)}` : ''}</span>;
    if (req.type === 'DISABILITY' && meta.startDate) {
        const days = meta.days || (meta.endDate ? Math.max(1, Math.round((new Date(meta.endDate+'T00:00:00') - new Date(meta.startDate+'T00:00:00')) / 86400000) + 1) : null);
        return <span className="text-caption text-content-3">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}{days ? ` · ${days}d` : ''}</span>;
    }
    if (req.type === 'PERMIT') {
        const dates = meta.permissionDates || [];
        if (dates.length) return <span className="text-caption text-content-3">{dates.length === 1 ? fmtDate(dates[0]) : `${dates.length} días`}</span>;
    }
    if (req.type === 'ADVANCE' && meta.amount)
        return <span className="text-caption text-content-3">${Number(meta.amount).toLocaleString('es-SV')}</span>;
    if (req.type === 'CERTIFICATE' && meta.certificateType) {
        const labels = { LABORAL: 'Laboral', SALARIO: 'Salario', BANCARIA: 'Bancaria' };
        return <span className="text-caption text-content-3">{labels[meta.certificateType] || meta.certificateType}</span>;
    }
    if (req.type === 'ANNULMENT_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo}{meta.reason ? ` · ${meta.reason}` : ''}</span>;
    if (req.type === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · {meta.current_pago} → {meta.new_pago}</span>;
    if (req.type === 'VENDOR_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · vendedor #{meta.current_vendor_code} → #{meta.new_vendor_code}</span>;
    if (req.type === 'CLIENT_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · {(meta.current_cliente || 'Sin nombre').split(' ')[0]} → {(meta.new_client_name || '').split(' ')[0]}</span>;
    if (req.note) return <span className="text-caption text-content-3 italic truncate max-w-[160px]">"{req.note}"</span>;
    return null;
};

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
const RequestCard = memo(({ req, onApprove, onReject, canApprove = false, employeesById }) => {
    const [expanded, setExpanded] = useState(false);

    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-surface-card-hover text-content-3', border: 'border-divider', dot: 'bg-content-3' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const meta      = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    const isRejected = req.status === 'REJECTED';
    const isUrgent   = req.type === 'DISABILITY' && req.status === 'PENDING';

    const getApproverLabel = (ap) => {
        const emp = ap.approverId ? employeesById.get(String(ap.approverId)) : null;
        return emp ? `${emp.name}${emp.role ? ` · ${emp.role}` : ''}` : `Nivel ${ap.level}`;
    };

    // Superficie canónica. El borde solo se colorea por ESTADO —una incapacidad
    // pendiente es urgente, una rechazada quedó cerrada—, nunca por tipo: eso
    // era lo que hacía competir nueve matices por decir algo que el nombre ya
    // dice.
    return (
        <div data-surface="card" className={`transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] overflow-hidden transform-gpu
            ${isUrgent ? '!border-danger' : isRejected ? '!border-danger/30' : ''}`}>

            {/* Compact header — click to expand */}
            {/* Encabezado plegable. Le faltaba `aria-expanded`: el estado
                abierto/cerrado vivía solo en el giro del chevron. */}
            <button onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                // La fila de la solicitud es el control que la despliega, y en
                // el teléfono sólo respondía al puntero: 33 de los 46 mudos que
                // dejaron ver las pestañas internas salían de acá.
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-card-hover/40 active:scale-[0.99] transition-[background-color,transform] duration-[var(--dur-base)]">

                {/* El ícono dice el tipo; el color, el estado. Antes el círculo
                    iba relleno del color del tipo y era lo más brillante de la
                    tarjeta — el ojo iba ahí y no al estado. */}
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-card-hover border border-divider">
                    <TypeIcon size={15} strokeWidth={2} className="text-content-2" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        {req.employee && (
                            <span className="text-body font-semibold text-content truncate leading-tight max-w-[160px]">
                                {req.employee.name}
                            </span>
                        )}
                        <span className={`flex items-center gap-1 text-caption font-bold shrink-0 ${statConf.color.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {statConf.label}
                        </span>
                        {isUrgent && <span className="text-micro font-black text-danger animate-pulse shrink-0">URGENTE</span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <CompactSummary req={req} />
                        <span className="text-micro text-content-3 shrink-0">{fmtDateFull(req.created_at)}</span>
                        {req.current_level && req.status === 'PENDING' && req.type !== 'DISABILITY' && (
                            <span className="text-micro text-content-3 shrink-0">· Niv. {req.current_level}/{req.type === 'SHIFT_CHANGE' ? 2 : 3}</span>
                        )}
                    </div>
                </div>

                <ChevronDown size={14} strokeWidth={2.5}
                    className={`text-content-3 flex-shrink-0 transition-transform duration-[var(--dur-slow)] ${expanded ? 'rotate-180' : ''}`} />
            </button>

            {/* Expandable body */}
            <div inert={!(expanded) ? true : undefined} className={`overflow-hidden transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] ${expanded ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-4 pb-4 pt-3 border-t border-border-card space-y-2.5">

                    {/* SHIFT_CHANGE */}
                    {req.type === 'SHIFT_CHANGE' && (
                        <div className="space-y-2">
                            {(meta.targetEmployeeName || meta.date) && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-chart-3/10 border border-chart-3/30">
                                    <ArrowLeftRight size={12} className="text-chart-3-text flex-shrink-0" strokeWidth={2} />
                                    <div className="flex flex-wrap items-center gap-2">
                                        {meta.targetEmployeeName && <span className="text-body-sm font-bold text-chart-3-text">↔ {meta.targetEmployeeName}</span>}
                                        {meta.date && <span className="text-label text-chart-3-text">{new Date(meta.date+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'long', day: '2-digit', month: 'long' })}</span>}
                                    </div>
                                </div>
                            )}
                            {(meta.myShift || meta.targetShift) && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                        <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">{req.employee?.name?.split(' ')[0]}</p>
                                        <p className="text-label font-black text-content-2">{meta.myShift || '—'}</p>
                                    </div>
                                    <div className="bg-chart-3/10 border border-chart-3/30 rounded-2xl p-2.5">
                                        <p className="text-micro font-black text-chart-3-text uppercase tracking-widest mb-0.5">{meta.targetEmployeeName?.split(' ')[0]}</p>
                                        <p className="text-label font-black text-content-2">{meta.targetShift || '—'}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* DISABILITY */}
                    {req.type === 'DISABILITY' && (
                        <div className="space-y-2">
                            {meta.startDate && (
                                <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30">
                                    <Stethoscope size={13} className="text-danger flex-shrink-0" strokeWidth={2} />
                                    <div>
                                        <p className="text-caption font-black uppercase tracking-widest text-danger mb-0.5">Período</p>
                                        <p className="text-body font-bold text-danger-text">
                                            {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                                            {meta.days && <span className="text-danger font-medium ml-1.5">· {meta.days}d</span>}
                                        </p>
                                        {Number(meta.days) > 3 && <p className="text-caption text-content-2 font-black mt-0.5">Requiere boleta ISSS</p>}
                                    </div>
                                </div>
                            )}
                            {meta.docUrl ? (
                                <a href={meta.docUrl} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card border border-border-card text-label font-bold text-content-2 hover:text-brand-text transition-all">
                                    <FileImage size={12} strokeWidth={2} />{meta.docName || 'Ver certificado adjunto'}
                                </a>
                            ) : (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card-hover border border-divider">
                                    <AlertTriangle size={11} className="text-warning flex-shrink-0" strokeWidth={2} />
                                    <p className="text-caption text-content-2 font-medium">Sin certificado adjunto.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* VACATION */}
                    {req.type === 'VACATION' && meta.startDate && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-success/10 border border-success/30">
                            <CalendarDays size={13} className="text-success flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-success mb-0.5">Período</p>
                                <p className="text-body-sm font-bold text-success-text">
                                    {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* PERMIT */}
                    {req.type === 'PERMIT' && (meta.permissionDates || []).length > 0 && (
                        <div className="px-3 py-2.5 rounded-2xl bg-success/10 border border-success/30">
                            <p className="text-caption font-black uppercase tracking-widest text-success-text mb-2">Días de Permiso</p>
                            <div className="flex flex-wrap gap-1.5">
                                {meta.permissionDates.map(d => (
                                    <Badge key={d} variant="success" uppercase={false}>{new Date(d+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' })}</Badge>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ADVANCE */}
                    {req.type === 'ADVANCE' && meta.amount && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card-hover border border-divider">
                            <Banknote size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-0.5">Monto solicitado</p>
                                <p className="text-body font-black text-content-2">${Number(meta.amount).toLocaleString('es-SV')}</p>
                            </div>
                        </div>
                    )}

                    {/* CERTIFICATE */}
                    {req.type === 'CERTIFICATE' && meta.certificateType && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card-hover border border-divider">
                            <FileCheck2 size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-0.5">Tipo</p>
                                <p className="text-body-sm font-bold text-content-2">
                                    {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ANNULMENT_REQUEST */}
                    {req.type === 'ANNULMENT_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-surface-card-hover border border-divider">
                                <Ban size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-0.5">Factura a anular</p>
                                    <p className="text-body-sm font-bold text-content-2">{meta.correlativo} · {formatMoney(meta.total || 0)}</p>
                                    {meta.fecha && <p className="text-caption text-content-2">{new Date(meta.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}</p>}
                                    <IdVenta meta={meta} />
                                </div>
                                {meta.tipo_documento && (
                                    <Badge variant={meta.tipo_documento === 'CCF' ? 'danger' : 'neutral'} size="sm" className="shrink-0">{meta.tipo_documento}</Badge>
                                )}
                            </div>
                            {meta.reason && (
                                <div className="px-3 py-2 rounded-2xl bg-surface-card border border-border-card">
                                    <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-0.5">Motivo de anulación</p>
                                    <p className="text-label font-bold text-content-2">{meta.reason}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* PAYMENT_CHANGE_REQUEST */}
                    {req.type === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-surface-card-hover border border-divider">
                                <CreditCard size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-0.5">Factura</p>
                                    <p className="text-body-sm font-bold text-content-2">{meta.correlativo} · {formatMoney(meta.total || 0)}</p>
                                    <IdVenta meta={meta} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">Actual</p>
                                    <p className="text-body-sm font-black text-content-2 capitalize">{meta.current_pago || '—'}</p>
                                </div>
                                <div className="bg-surface-card-hover border border-divider rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">Cambiar a</p>
                                    <p className="text-body-sm font-black text-content-2 capitalize">{meta.new_pago || '—'}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* VENDOR_CHANGE_REQUEST */}
                    {req.type === 'VENDOR_CHANGE_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-surface-card-hover border border-divider">
                                <Receipt size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-0.5">Factura</p>
                                    <p className="text-body-sm font-bold text-content-2">{meta.correlativo} · {formatMoney(meta.total || 0)}</p>
                                    <IdVenta meta={meta} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">Vendedor actual</p>
                                    {meta.current_vendor_photo && (
                                        <img src={meta.current_vendor_photo} className="w-6 h-6 rounded-full object-cover mb-1" alt="" />
                                    )}
                                    <p className="text-label font-black text-content-2">{meta.current_vendor_name || `#${meta.current_vendor_code}`}</p>
                                    {meta.current_vendor_code && <p className="text-micro text-content-3 font-mono">#{meta.current_vendor_code}</p>}
                                </div>
                                <div className="bg-surface-card-hover border border-divider rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">Asignar a</p>
                                    {meta.new_vendor_photo && (
                                        <img src={meta.new_vendor_photo} className="w-6 h-6 rounded-full object-cover mb-1" alt="" />
                                    )}
                                    <p className="text-label font-black text-content-2">{meta.new_vendor_name || `#${meta.new_vendor_code}`}</p>
                                    {meta.new_vendor_code && <p className="text-micro text-content-3 font-mono">#{meta.new_vendor_code}</p>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* CLIENT_CHANGE_REQUEST */}
                    {req.type === 'CLIENT_CHANGE_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-surface-card-hover border border-divider">
                                <Receipt size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-0.5">Factura</p>
                                    <p className="text-body-sm font-bold text-content-2">{meta.correlativo} · {formatMoney(meta.total || 0)}</p>
                                    <IdVenta meta={meta} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">Cliente actual</p>
                                    <div className="w-6 h-6 rounded-full bg-surface-card-hover flex items-center justify-center mb-1">
                                        <span className="text-content-3 font-black text-caption leading-none">{(meta.current_cliente || '?').charAt(0)}</span>
                                    </div>
                                    <p className="text-label font-black text-content-2 leading-tight">{meta.current_cliente || 'Sin nombre'}</p>
                                </div>
                                <div className="bg-surface-card-hover border border-divider rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">Cambiar a</p>
                                    <div className="w-6 h-6 rounded-full bg-surface-card border border-divider flex items-center justify-center mb-1">
                                        <span className="text-content-2 font-black text-caption leading-none">{(meta.new_client_name || '?').charAt(0)}</span>
                                    </div>
                                    <p className="text-label font-black text-content-2 leading-tight">{meta.new_client_name}</p>
                                    {(meta.new_client_nit || meta.new_client_dui) && (
                                        <p className="text-micro text-content-3 font-mono mt-0.5">{meta.new_client_nit ? `NIT ${meta.new_client_nit}` : `DUI ${meta.new_client_dui}`}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Constancia de lo aplicado. Sin esto, aprobar y que el
                        cambio ocurra fuera del portal se ve igual que aprobar
                        y que no ocurra nada — que es como estaba antes. */}
                    {meta.erp_aplicado && (
                        <div className="px-3 py-2.5 rounded-2xl bg-surface-card-hover border border-divider space-y-1">
                            <p className="text-micro font-black uppercase tracking-widest text-content-2">Aplicado</p>
                            <p className="text-label font-bold text-content">
                                {meta.erp_aplicado.campo === 'anulacion'
                                    ? 'Factura anulada'
                                    : `${meta.erp_aplicado.de || '—'} → ${meta.erp_aplicado.a || '—'}`}
                                {meta.erp_aplicado.by_name && ` · por ${meta.erp_aplicado.by_name}`}
                            </p>
                            {meta.erp_aplicado.hacienda?.sello && (
                                <p className="text-micro text-content-3 font-mono break-all">
                                    Sello de Hacienda: {meta.erp_aplicado.hacienda.sello}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Note */}
                    {req.note && (
                        <div>
                            <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1.5">Motivo del empleado</p>
                            <p className="text-body-sm text-content-2 bg-surface-card rounded-2xl p-3 border border-border-card leading-relaxed">{req.note}</p>
                        </div>
                    )}

                    {/* Rejection reason */}
                    {isRejected && req.approver_note && (
                        <div className="px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30">
                            <p className="text-micro font-black uppercase tracking-widest text-danger mb-1">Motivo de rechazo</p>
                            <p className="text-body-sm text-danger-text font-medium leading-relaxed">{req.approver_note}</p>
                        </div>
                    )}

                    {/* Approval note */}
                    {!isRejected && req.approver_note && (
                        <div className="px-3 py-2.5 rounded-2xl bg-success/10 border border-success/30">
                            <p className="text-micro font-black uppercase tracking-widest text-success mb-1">Nota del aprobador</p>
                            <p className="text-body-sm text-success-text font-medium leading-relaxed">{req.approver_note}</p>
                        </div>
                    )}

                    {/* Approval history */}
                    {req.approvals && req.approvals.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-micro font-black uppercase tracking-widest text-content-2">Historial</p>
                            {req.approvals.map((ap, i) => (
                                <div key={i} className="flex items-start gap-2 bg-success/10 border border-success/30 rounded-2xl p-2.5">
                                    <CheckCircle2 size={12} className="text-success mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                                    <div className="min-w-0">
                                        <p className="text-label font-black text-success-text">{getApproverLabel(ap)}</p>
                                        <p className="text-micro text-content-3 mt-0.5">{new Date(ap.approvedAt).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                                        {ap.approverNote && <p className="text-caption text-content-2 mt-0.5 italic">"{ap.approverNote}"</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {req.employee?.code && (
                        <p className="text-caption text-content-3">Código: <span className="font-mono font-bold text-content-2">{req.employee.code}</span></p>
                    )}

                    {req.status === 'PENDING' && (
                        <div className="flex items-center gap-2 pt-1">
                            <Button tone="success" icon={Check} disabled={!canApprove} onClick={() => onApprove(req)}>Aprobar</Button>
                            <Button variant="destructive" icon={X} disabled={!canApprove} onClick={() => onReject(req)}>Rechazar</Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

// ─── Vista principal ───────────────────────────────────────────────────────────
const RequestsView = () => {
    const { user, hasPermission, getScope } = useAuth();
    const canApprove = hasPermission('requests', 'can_approve');
    const canCreate  = hasPermission('requests', 'can_edit');

    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const requests       = useStaff(s => s.requests);
    const employees      = useStaff(s => s.employees);
    const holidays       = useStaff(s => s.holidays);
    const isLoadingReqs  = useStaff(s => s.isLoadingRequests);
    const fetchRequests  = useStaff(s => s.fetchRequests);
    const approveRequest = useStaff(s => s.approveRequest);
    const rejectRequest  = useStaff(s => s.rejectRequest);
    const createRequest  = useStaff(s => s.createRequest);

    const employeesById = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);

    const employeeOptions = useMemo(() =>
        (employees || [])
            .filter(e => e.status !== 'INACTIVO')
            .map(e => ({ value: String(e.id), label: e.name }))
    , [employees]);

    const [statusFilter,      setStatusFilter]      = useState('PENDING');
    const [rawSearch,         setRawSearch]         = useState('');
    const [collapsedSections, setCollapsedSections] = useState(new Set());
    const [actionModal,       setActionModal]       = useState(null);
    const [actionNote,        setActionNote]        = useState('');
    const [isActioning,       setIsActioning]       = useState(false);

    // ── Crear solicitud a nombre de un empleado (RRHH) ──────────────────────
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [createEmployeeId, setCreateEmployeeId] = useState('');
    const [createType,      setCreateType]      = useState('VACATION');
    const [createPayload,   setCreatePayload]   = useState({});
    const [createNote,      setCreateNote]      = useState('');
    const [isCreatingReq,   setIsCreatingReq]   = useState(false);

    const openCreateModal = (employeeId = '') => {
        setCreateEmployeeId(employeeId ? String(employeeId) : '');
        setCreateType('VACATION');
        setCreatePayload({});
        setCreateNote('');
        setCreateModalOpen(true);
    };

    // Deep-link desde EmployeeDetailView ("+ Nueva Solicitud" de un empleado puntual)
    useEffect(() => {
        if (location.state?.prefillEmployeeId) {
            openCreateModal(location.state.prefillEmployeeId); // eslint-disable-line react-hooks/set-state-in-effect -- abre el modal por deep-link al montar
            navigate(location.pathname, { replace: true });
        }
    }, [location.state?.prefillEmployeeId, location.pathname, navigate]);

    /* Deep-link desde la notificación: `?solicitud=<id>` abre esa solicitud, y
       `&accion=aprobar|rechazar` abre además su diálogo de decisión.
       Es lo que convierte el aviso en «acá está» en vez de «andá a buscarla»,
       y es el camino que usa iPhone, donde iOS no dibuja los botones de acción
       de una notificación web.

       Se espera a que `requests` tenga la solicitud: la campana es global y la
       lista puede llegar después. Los parámetros se limpian recién cuando se
       encontró, para que un render temprano no los descarte. */
    useEffect(() => {
        const id = searchParams.get('solicitud');
        if (!id) return;
        const req = (requests || []).find(r => String(r.id) === String(id));
        if (!req) return;

        const accion = searchParams.get('accion');
        if (accion === 'aprobar' || accion === 'rechazar') {
            setActionModal({ req, mode: accion === 'aprobar' ? 'approve' : 'reject' }); // eslint-disable-line react-hooks/set-state-in-effect -- abre el diálogo por deep-link
            setActionNote('');
        }
        // Sin esto la solicitud podría quedar escondida tras el filtro activo.
        if (req.status !== statusFilter) setStatusFilter(req.status);

        const limpio = new URLSearchParams(searchParams);
        limpio.delete('solicitud');
        limpio.delete('accion');
        setSearchParams(limpio, { replace: true });
    }, [searchParams, setSearchParams, requests, statusFilter]);

    const handleCreateRequest = async () => {
        if (!createEmployeeId || !createNote.trim()) return;
        setIsCreatingReq(true);
        const result = await createRequest(createEmployeeId, createType, createPayload, createNote.trim());
        setIsCreatingReq(false);
        if (result) {
            useToastStore.getState().showToast('Enviada', `Solicitud de ${REQUEST_TYPES[createType]?.label} registrada.`, 'success');
            setCreateModalOpen(false);
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo crear la solicitud.', 'error');
        }
    };

    useEffect(() => {
        const apId = canApprove ? user?.id : null;
        const brId = getScope('requests') === 'BRANCH' ? user?.branchId : null;
        fetchRequests(null, brId, apId);
    }, [canApprove, user?.id, user?.branchId, getScope, fetchRequests]);

    useEffect(() => {
        const handler = () => {
            const apId = canApprove ? user?.id : null;
            const brId = getScope('requests') === 'BRANCH' ? user?.branchId : null;
            fetchRequests(null, brId, apId);
        };
        window.addEventListener('requests-updated', handler);
        return () => window.removeEventListener('requests-updated', handler);
    }, [canApprove, user?.id, user?.branchId, getScope, fetchRequests]);


    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    const pendingCount = requests.filter(r => {
        const myId = String(user?.id);
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && String(r.approver_id) !== myId) return false;
        return r.status === 'PENDING' && (!r.approver || String(r.approver?.id) === myId);
    }).length;

    const statusFiltered = requests.filter(r => {
        const myId = String(user?.id);
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && String(r.approver_id) !== myId) return false;
        const assignedToMe  = !r.approver || String(r.approver?.id) === myId;
        const processedByMe = String(r.approver?.id) === myId;
        if (statusFilter === 'PENDING'  && !(r.status === 'PENDING'  && assignedToMe))  return false;
        if (statusFilter === 'APPROVED' && !(r.status === 'APPROVED' && processedByMe)) return false;
        if (statusFilter === 'REJECTED' && !(r.status === 'REJECTED' && processedByMe)) return false;
        return true;
    });

    const { results: baseFiltered, isFuzzy: isReqSearchFuzzy } = !rawSearch.trim()
        ? { results: statusFiltered, isFuzzy: false }
        : smartFilter(rawSearch, statusFiltered, r => [r.employee?.name]);

    const groupedByType = Object.entries(
        baseFiltered.reduce((acc, r) => {
            const t = r.type || 'OTHER';
            if (!acc[t]) acc[t] = [];
            acc[t].push(r);
            return acc;
        }, {})
    );

    const toggleSection = (type) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            next.has(type) ? next.delete(type) : next.add(type);
            return next;
        });
    };

    const handleConfirmAction = async () => {
        if (!actionModal) return;
        if (actionModal.mode === 'reject' && !actionNote.trim()) return;
        setIsActioning(true);
        const ok = actionModal.mode === 'approve'
            ? await approveRequest(actionModal.req.id, user.id, actionNote.trim())
            : await rejectRequest(actionModal.req.id, user.id, actionNote.trim());
        setIsActioning(false);
        if (ok) {
            useToastStore.getState().showToast('Listo', `Solicitud ${actionModal.mode === 'approve' ? 'aprobada' : 'rechazada'}.`, 'success');
            setActionModal(null);
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo procesar la acción.', 'error');
        }
    };

    const STATUS_TABS = [
        { key: 'PENDING',  label: 'Pendientes' },
        { key: 'APPROVED', label: 'Aprobadas'  },
        { key: 'REJECTED', label: 'Rechazadas' },
        { key: 'ALL',      label: 'Todas'       },
    ];

    // D3.9 (2026-07-27): barra reescrita a mano → canónico. El botón de crear
    // pasa a TabBarAction (variante primaria) y pierde el gradiente + halo que
    // tenía escritos a mano; el contador de pendientes viaja en el label del tab.
    const filtersContent = (
        <ViewTabBar
            tabs={STATUS_TABS.map(t => ({
                key: t.key,
                label: t.key === 'PENDING' && pendingCount > 0 ? `${t.label} · ${pendingCount}` : t.label,
            }))}
            activeTab={statusFilter}
            onTabChange={setStatusFilter}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder="Buscar empleado..."
        />
    );

    // §17: la acción vive en la píldora del CUERPO, no en el header. Esta vista
    // no tenía `FilterBar` —sus estados son pestañas, no filtros— así que la
    // píldora existe justo para esto: es el lugar donde el usuario busca lo que
    // puede hacer, y en el teléfono es lo único que no se va con el scroll.
    const filtrosCuerpo = canCreate ? (
        <FilterBar acciones={[{
            key: 'nueva', icon: Plus, label: 'Nueva Solicitud', variant: 'primary',
            onClick: () => openCreateModal(),
        }]} />
    ) : null;

    return (
        <GlassViewLayout icon={Inbox} title="Bandeja de Aprobaciones" filtersContent={filtersContent} transparentBody={true}>
            <div className="pt-4 px-2 md:px-0 pb-8 space-y-6">
                {filtrosCuerpo && <div className="flex justify-end">{filtrosCuerpo}</div>}

                {isLoadingReqs ? (
                    <div className="space-y-6">
                        {Array.from({ length: 2 }).map((_, si) => (
                            <section key={si}>
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-6 h-6 skeleton rounded-lg" />
                                    <div className="h-3 w-24 skeleton rounded-full" />
                                    <div className="flex-1 h-px bg-divider mx-1" />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} data-surface="card" className="p-4 flex items-center gap-3">
                                            <div className="w-9 h-9 skeleton rounded-full shrink-0" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-3 w-28 skeleton rounded-full" />
                                                <div className="h-2.5 w-20 skeleton rounded-full" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : baseFiltered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-[var(--dur-lento)] ease-[var(--ease-spring)]">
                        <div className="relative group flex flex-col items-center text-center">
                            <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${statusFilter === 'PENDING' ? 'bg-brand' : statusFilter === 'APPROVED' ? 'bg-success' : statusFilter === 'REJECTED' ? 'bg-danger' : 'bg-content-3'}`} />
                            <div className={`relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card border border-border-card shadow-[var(--shadow-elevation-md)] transition-all duration-[var(--dur-lento)] group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] ${statusFilter === 'PENDING' ? 'text-brand-text' : statusFilter === 'APPROVED' ? 'text-success' : statusFilter === 'REJECTED' ? 'text-danger' : 'text-content-3'}`}>
                                {statusFilter === 'PENDING' ? <CheckCircle2 size={40} strokeWidth={2} /> : <ClipboardList size={40} strokeWidth={2} />}
                            </div>
                            <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">
                                {statusFilter === 'PENDING' ? 'Todo al día' : 'Sin resultados'}
                            </h3>
                            <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">
                                {statusFilter === 'PENDING' ? 'No hay solicitudes pendientes de revisión.' : 'Sin solicitudes en esta categoría.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                    {isReqSearchFuzzy && rawSearch.trim() && (
                        <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{rawSearch.trim()}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
                    )}
                    {groupedByType.map(([type, cards]) => {
                        const TypeIcon  = TYPE_ICONS[type] || FileText;
                        const typeConf  = REQUEST_TYPES[type] || { label: type };
                        const isCollapsed = collapsedSections.has(type);

                        return (
                            <section key={type}>
                                <button onClick={() => toggleSection(type)} aria-expanded={!isCollapsed}
                                    // El encabezado ES el control que pliega el
                                    // grupo y medía 24px de alto. Mismo caso —y
                                    // misma salida— que el de Laboratorios: acá
                                    // el tamaño no es el diseño, era un descuido.
                                    // `--tap-min` vale 0 en escritorio, así que
                                    // ahí no cambia nada.
                                    className="w-full flex items-center gap-2 mb-3 min-h-[var(--tap-min)] transition-transform duration-[var(--dur-fast)] active:scale-[0.99]">
                                    <div className="w-6 h-6 rounded-lg flex items-center justify-center border border-divider bg-surface-card-hover text-content-2">
                                        <TypeIcon size={12} strokeWidth={2} />
                                    </div>
                                    <h3 className="text-label font-black uppercase tracking-widest text-content-2">{typeConf.label}</h3>
                                    <span className="text-caption font-bold text-content-3">{cards.length}</span>
                                    <div className="flex-1 h-px bg-divider mx-1" />
                                    <ChevronDown size={13} strokeWidth={2.5}
                                        className={`text-content-3 transition-transform duration-[var(--dur-slow)] flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} />
                                </button>

                                <div inert={isCollapsed ? true : undefined} className={`transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] ${isCollapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-[9999px] opacity-100 overflow-visible'}`}>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 pb-2">
                                        {cards.map(req => (
                                            <RequestCard key={req.id} req={req}
                                                onApprove={(r) => { setActionModal({ mode: 'approve', req: r }); setActionNote(''); }}
                                                onReject={(r)  => { setActionModal({ mode: 'reject',  req: r }); setActionNote(''); }}
                                                canApprove={canApprove}
                                                employeesById={employeesById}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        );
                    })}
                    </>
                )}
            </div>

            {/* ModalShell: escrito a mano no atrapaba el foco, no cerraba con
                Escape y no se anunciaba como diálogo (auditoría 2026-07-29). */}
            {/* El `actionModal &&` NO es defensivo de más: sin él la vista CRASHEA.
                Los hijos de un elemento JSX se evalúan al CREARLO, no cuando el
                padre decide pintarlos — así que `actionModal.mode` de aquí abajo
                corre en cada render, incluido el primero, cuando `actionModal` es
                `null`. "TypeError: null is not an object (evaluating 'c.mode')" y
                la vista entera al ErrorBoundary.
                El modal a mano que había antes sí tenía la guarda; se perdió al
                pasarlo a `ModalShell` en v2.183.0, porque `open={!!actionModal}`
                LEE como si condicionara los hijos y no los condiciona. */}
            {actionModal && (
            <ModalShell open={!!actionModal} onClose={() => !isActioning && setActionModal(null)} maxWidthClass="max-w-md" zClass="z-toast" closeOnEsc={!isActioning} surface={null} ariaLabel={actionModal?.mode === 'approve' ? 'Aprobar la solicitud' : 'Rechazar la solicitud'}>
                    <CuerpoDialogo
                        titulo={actionModal.mode === 'approve' ? 'Aprobar solicitud' : 'Rechazar solicitud'}
                        subtitulo={`${REQUEST_TYPES[actionModal.req.type]?.label} · ${actionModal.req.employee?.name}`}
                        icono={actionModal.mode === 'approve' ? CheckCircle2 : XCircle}
                        tono={actionModal.mode === 'approve' ? 'success' : 'danger'}
                        anchoEscritorio="max-w-md"
                        pie={<>
                            <Button
                                onClick={handleConfirmAction}
                                loading={isActioning}
                                disabled={!canApprove || (actionModal.mode === 'reject' && !actionNote.trim())}
                                tone={actionModal.mode === 'approve' ? 'success' : 'danger'}
                                icon={actionModal.mode === 'approve' ? Check : X}
                            >
                                {actionModal.mode === 'approve' ? 'Aprobar' : 'Rechazar'}
                            </Button>
                            <Button variant="secondary" disabled={isActioning}
                                onClick={() => !isActioning && setActionModal(null)}>Cancelar</Button>
                        </>}
                    >
                        <div className="text-left">
                        <label className="text-label font-black uppercase tracking-widest text-content-2 mb-1.5 block">
                            {actionModal.mode === 'reject' ? 'Motivo de rechazo' : 'Nota para el empleado'}
                            {actionModal.mode === 'reject' && <span className="text-danger ml-1">*</span>}
                        </label>
                        <PortalTextarea
                            value={actionNote}
                            onChange={e => setActionNote(e.target.value)}
                            rows={3}
                            placeholder={actionModal.mode === 'approve' ? 'Opcional...' : 'Explica el motivo del rechazo...'}
                            readOnly={isActioning}
                            textareaClassName="disabled:opacity-50"
                        />
                        </div>
                    </CuerpoDialogo>
            </ModalShell>
            )}

            <ModalShell open={createModalOpen} onClose={() => !isCreatingReq && setCreateModalOpen(false)} maxWidthClass="max-w-lg" zClass="z-toast" closeOnEsc={!isCreatingReq} surface={null} ariaLabel="Nueva solicitud">
                    <CuerpoDialogo
                        titulo="Nueva solicitud"
                        subtitulo="A nombre de un empleado"
                        icono={ClipboardList}
                        anchoEscritorio="max-w-lg"
                        pie={<>
                            <Button disabled={!canCreate || isCreatingReq || !createEmployeeId || !createNote.trim()}
                                loading={isCreatingReq} icon={Check}
                                onClick={handleCreateRequest}>Enviar</Button>
                            <Button variant="secondary" disabled={isCreatingReq}
                                onClick={() => !isCreatingReq && setCreateModalOpen(false)}>Cancelar</Button>
                        </>}
                    >
                        <div className="space-y-4 text-left">

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">Empleado <span className="text-danger">*</span></p>
                            <LiquidSelect
                                value={createEmployeeId}
                                onChange={setCreateEmployeeId}
                                options={employeeOptions}
                                placeholder="Seleccionar empleado..."
                                icon={User}
                                compact
                                clearable={false}
                            />
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-2">Tipo</p>
                            <div className="flex flex-wrap gap-2">
                                {CREATABLE_TYPES.map(({ key, icon: Icon }) => {
                                    const conf = REQUEST_TYPES[key];
                                    return (
                                        <Button
                                            variant="secondary"
                                            icon={Icon}
                                            key={key}
                                            type="button"
                                            onClick={() => { setCreateType(key); setCreatePayload({}); }}
                                        >{conf.label}</Button>
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">
                                {createType === 'VACATION' ? 'Período de Vacaciones' :
                                 createType === 'PERMIT'   ? 'Días de Permiso' :
                                 'Fecha'}
                            </p>
                            {createType === 'VACATION' ? (
                                <RangeDatePicker
                                    startDate={createPayload.startDate || ''}
                                    endDate={createPayload.endDate || ''}
                                    onRangeChange={(s, e) => setCreatePayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                                    holidays={holidays}
                                    defaultDays={15}
                                    label="vacaciones"
                                />
                            ) : (
                                <LiquidDatePicker
                                    value={createPayload.date || ''}
                                    onChange={(v) => setCreatePayload(prev => ({ ...prev, date: v }))}
                                    placeholder="Seleccionar fecha"
                                    holidays={holidays}
                                />
                            )}
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">Motivo / Descripción <span className="text-danger">*</span></p>
                            <PortalTextarea
                                value={createNote}
                                onChange={e => setCreateNote(e.target.value)}
                                rows={3}
                                placeholder="Describe la solicitud..."
                                readOnly={isCreatingReq}
                                textareaClassName="disabled:opacity-50"
                            />
                        </div>

                        </div>
                    </CuerpoDialogo>
            </ModalShell>
        </GlassViewLayout>
    );
};

export default RequestsView;
