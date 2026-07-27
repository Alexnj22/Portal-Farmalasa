import React, { useState, useEffect, memo, useMemo } from 'react';
import TabBarAction from '../components/common/TabBarAction';
import ViewTabBar from '../components/common/ViewTabBar';
import ReactDOM from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Inbox, Check, X, ChevronRight, ChevronDown,
    User, Calendar, Loader2, ClipboardList,
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Coffee,
    CheckCircle2, XCircle, Stethoscope, FileImage, AlertTriangle,
    Search, ArrowLeftRight, CalendarDays, Banknote, FileCheck2,
    Ban, CreditCard, UserCog, Receipt, Contact, Plus,
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

const CREATABLE_TYPES = [
    { key: 'VACATION',     icon: Palmtree },
    { key: 'PERMIT',       icon: FileText },
    { key: 'SHIFT_CHANGE', icon: RefreshCw },
    { key: 'OVERTIME',     icon: Coffee },
    { key: 'ADVANCE',      icon: DollarSign },
    { key: 'CERTIFICATE',  icon: FileCheck },
];

const TYPE_ICONS = {
    VACATION:               Palmtree,
    PERMIT:                 FileText,
    SHIFT_CHANGE:           RefreshCw,
    OVERTIME:               Coffee,
    ADVANCE:                DollarSign,
    CERTIFICATE:            FileCheck,
    DISABILITY:             Stethoscope,
    ANNULMENT_REQUEST:      Ban,
    PAYMENT_CHANGE_REQUEST: CreditCard,
    VENDOR_CHANGE_REQUEST:  UserCog,
    CLIENT_CHANGE_REQUEST:  Contact,
};

// circle = card colored avatar; section = section label color.
// Tokenizado T7 (AUDITORIA-TEMA-2026-07.md, propuesta de estandarización de
// color aprobada por el usuario 2026-07-24): 11 tipos → 9 son categóricos
// genuinos (paleta cerrada cat-1..9, sin significado de severidad) + 2 SÍ
// son severidad real, no solo "otra categoría más" — DISABILITY (ausencia
// médica) y ANNULMENT_REQUEST (pide deshacer algo ya enviado, necesita
// revisión) pasan a los tokens semánticos danger/warning en vez de un
// color categórico arbitrario.
const TYPE_COLORS = {
    VACATION:     { circle: 'bg-chart-1',  ring: 'ring-chart-1/30', section: 'text-chart-1-text', border: 'border-chart-1/30', hover: 'hover:shadow-[var(--shadow-glow-chart-1)]',  sectionIcon: 'text-chart-1-text bg-chart-1/10 border-chart-1/30'  },
    PERMIT:       { circle: 'bg-chart-2',  ring: 'ring-chart-2/30', section: 'text-chart-2-text', border: 'border-chart-2/30', hover: 'hover:shadow-[var(--shadow-glow-success)]',  sectionIcon: 'text-chart-2-text bg-chart-2/10 border-chart-2/30'  },
    SHIFT_CHANGE: { circle: 'bg-chart-3',  ring: 'ring-chart-3/30', section: 'text-chart-3-text', border: 'border-chart-3/30', hover: 'hover:shadow-[var(--shadow-glow-chart-3)]',  sectionIcon: 'text-chart-3-text bg-chart-3/10 border-chart-3/30'  },
    OVERTIME:     { circle: 'bg-chart-4',  ring: 'ring-chart-4/30', section: 'text-chart-4-text', border: 'border-chart-4/30', hover: 'hover:shadow-[var(--shadow-glow-chart-4)]',  sectionIcon: 'text-chart-4-text bg-chart-4/10 border-chart-4/30'  },
    ADVANCE:      { circle: 'bg-chart-5',  ring: 'ring-chart-5/30', section: 'text-chart-5-text', border: 'border-chart-5/30', hover: 'hover:shadow-[var(--shadow-glow-chart-5-lg)]',   sectionIcon: 'text-chart-5-text bg-chart-5/10 border-chart-5/30'  },
    CERTIFICATE:  { circle: 'bg-chart-6',  ring: 'ring-chart-6/30', section: 'text-chart-6-text', border: 'border-chart-6/30', hover: 'hover:shadow-[var(--shadow-glow-chart-6-lg)]',  sectionIcon: 'text-chart-6-text bg-chart-6/10 border-chart-6/30'  },
    DISABILITY:             { circle: 'bg-danger',  ring: 'ring-danger/30',  section: 'text-danger-text',  border: 'border-danger/30',  hover: 'hover:shadow-[var(--shadow-glow-danger)]',   sectionIcon: 'text-danger-text bg-danger/10 border-danger/30'   },
    ANNULMENT_REQUEST:      { circle: 'bg-warning', ring: 'ring-warning/30', section: 'text-warning-text', border: 'border-warning/30', hover: 'hover:shadow-[var(--shadow-glow-warning-lg)]',   sectionIcon: 'text-warning-text bg-warning/10 border-warning/30' },
    PAYMENT_CHANGE_REQUEST: { circle: 'bg-chart-7',  ring: 'ring-chart-7/30', section: 'text-chart-7-text', border: 'border-chart-7/30', hover: 'hover:shadow-[var(--shadow-glow-chart-7)]',   sectionIcon: 'text-chart-7-text bg-chart-7/10 border-chart-7/30'  },
    VENDOR_CHANGE_REQUEST:  { circle: 'bg-chart-8',  ring: 'ring-chart-8/30', section: 'text-chart-8-text', border: 'border-chart-8/30', hover: 'hover:shadow-[var(--shadow-glow-chart-8)]', sectionIcon: 'text-chart-8-text bg-chart-8/10 border-chart-8/30'  },
    CLIENT_CHANGE_REQUEST:  { circle: 'bg-chart-9',  ring: 'ring-chart-9/30', section: 'text-chart-9-text', border: 'border-chart-9/30', hover: 'hover:shadow-[var(--shadow-glow-chart-9-lg)]',  sectionIcon: 'text-chart-9-text bg-chart-9/10 border-chart-9/30'  },
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
    const tc        = TYPE_COLORS[req.type] || { circle: 'bg-content-3', ring: 'ring-divider', border: 'border-border-card', hover: '', sectionIcon: '' };
    const meta      = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    const isRejected = req.status === 'REJECTED';
    const isUrgent   = req.type === 'DISABILITY' && req.status === 'PENDING';

    const getApproverLabel = (ap) => {
        const emp = ap.approverId ? employeesById.get(String(ap.approverId)) : null;
        return emp ? `${emp.name}${emp.role ? ` · ${emp.role}` : ''}` : `Nivel ${ap.level}`;
    };

    return (
        <div className={`rounded-modal border bg-surface-card backdrop-blur-2xl shadow-[var(--shadow-elevation-sm)] hover:-translate-y-1 ${tc.hover} transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden transform-gpu
            ${isUrgent ? 'border-danger' : isRejected ? 'border-danger/30' : `${tc.border}`}`}>

            {/* Compact header — click to expand */}
            <button onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-card-hover/40 transition-colors duration-200">

                {/* Colored circle avatar */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ${tc.circle} ${tc.ring} shadow-sm`}>
                    <TypeIcon size={15} strokeWidth={2} className="text-white" />
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
                    className={`text-content-3 flex-shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
            </button>

            {/* Expandable body */}
            <div inert={!(expanded) ? true : undefined} className={`overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] ${expanded ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0'}`}>
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
                                        {Number(meta.days) > 3 && <p className="text-caption text-warning font-black mt-0.5">Requiere boleta ISSS</p>}
                                    </div>
                                </div>
                            )}
                            {meta.docUrl ? (
                                <a href={meta.docUrl} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card border border-border-card text-label font-bold text-content-2 hover:text-brand-text transition-all">
                                    <FileImage size={12} strokeWidth={2} />{meta.docName || 'Ver certificado adjunto'}
                                </a>
                            ) : (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-warning/10 border border-warning/30">
                                    <AlertTriangle size={11} className="text-warning flex-shrink-0" strokeWidth={2} />
                                    <p className="text-caption text-warning-text font-medium">Sin certificado adjunto.</p>
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
                        <div className="px-3 py-2.5 rounded-2xl bg-chart-2/10 border border-chart-2/30">
                            <p className="text-caption font-black uppercase tracking-widest text-chart-2-text mb-2">Días de Permiso</p>
                            <div className="flex flex-wrap gap-1.5">
                                {meta.permissionDates.map(d => (
                                    <span key={d} className="text-caption font-bold text-chart-2-text bg-chart-2/10 border border-chart-2/30 px-2 py-0.5 rounded-full">
                                        {new Date(d+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' })}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ADVANCE */}
                    {req.type === 'ADVANCE' && meta.amount && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-chart-5/10 border border-chart-5/30">
                            <Banknote size={13} className="text-chart-5-text flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-chart-5-text mb-0.5">Monto solicitado</p>
                                <p className="text-body font-black text-chart-5-text">${Number(meta.amount).toLocaleString('es-SV')}</p>
                            </div>
                        </div>
                    )}

                    {/* CERTIFICATE */}
                    {req.type === 'CERTIFICATE' && meta.certificateType && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-chart-6/10 border border-chart-6/30">
                            <FileCheck2 size={13} className="text-chart-6-text flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-chart-6-text mb-0.5">Tipo</p>
                                <p className="text-body-sm font-bold text-chart-6-text">
                                    {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ANNULMENT_REQUEST */}
                    {req.type === 'ANNULMENT_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-warning/10 border border-warning/30">
                                <Ban size={13} className="text-warning-text flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-caption font-black uppercase tracking-widest text-warning-text mb-0.5">Factura a anular</p>
                                    <p className="text-body-sm font-bold text-warning-text">{meta.correlativo} · ${Number(meta.total || 0).toFixed(2)}</p>
                                    {meta.fecha && <p className="text-caption text-warning-text">{new Date(meta.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}</p>}
                                </div>
                                {meta.tipo_documento && (
                                    <span className={`shrink-0 text-micro font-black uppercase px-2 py-1 rounded-lg ${meta.tipo_documento === 'CCF' ? 'bg-danger/10 text-danger-text border border-danger/30' : 'bg-surface-card-hover text-content-2 border border-border-card'}`}>{meta.tipo_documento}</span>
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
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-chart-7/10 border border-chart-7/30">
                                <CreditCard size={13} className="text-chart-7-text flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-caption font-black uppercase tracking-widest text-chart-7-text mb-0.5">Factura</p>
                                    <p className="text-body-sm font-bold text-chart-7-text">{meta.correlativo} · ${Number(meta.total || 0).toFixed(2)}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">Actual</p>
                                    <p className="text-body-sm font-black text-content-2 capitalize">{meta.current_pago || '—'}</p>
                                </div>
                                <div className="bg-chart-7/10 border border-chart-7/30 rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-chart-7-text uppercase tracking-widest mb-0.5">Cambiar a</p>
                                    <p className="text-body-sm font-black text-content-2 capitalize">{meta.new_pago || '—'}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* VENDOR_CHANGE_REQUEST */}
                    {req.type === 'VENDOR_CHANGE_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-chart-8/10 border border-chart-8/30">
                                <Receipt size={13} className="text-chart-8-text flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-caption font-black uppercase tracking-widest text-chart-8-text mb-0.5">Factura</p>
                                    <p className="text-body-sm font-bold text-chart-8-text">{meta.correlativo} · ${Number(meta.total || 0).toFixed(2)}</p>
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
                                <div className="bg-chart-8/10 border border-chart-8/30 rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-chart-8-text uppercase tracking-widest mb-0.5">Asignar a</p>
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
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-chart-9/10 border border-chart-9/30">
                                <Receipt size={13} className="text-chart-9-text flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-caption font-black uppercase tracking-widest text-chart-9-text mb-0.5">Factura</p>
                                    <p className="text-body-sm font-bold text-chart-9-text">{meta.correlativo} · ${Number(meta.total || 0).toFixed(2)}</p>
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
                                <div className="bg-chart-9/10 border border-chart-9/30 rounded-2xl p-2.5">
                                    <p className="text-micro font-black text-chart-9-text uppercase tracking-widest mb-1">Cambiar a</p>
                                    <div className="w-6 h-6 rounded-full bg-chart-9/10 flex items-center justify-center mb-1">
                                        <span className="text-chart-9-text font-black text-caption leading-none">{(meta.new_client_name || '?').charAt(0)}</span>
                                    </div>
                                    <p className="text-label font-black text-content-2 leading-tight">{meta.new_client_name}</p>
                                    {(meta.new_client_nit || meta.new_client_dui) && (
                                        <p className="text-micro text-content-3 font-mono mt-0.5">{meta.new_client_nit ? `NIT ${meta.new_client_nit}` : `DUI ${meta.new_client_dui}`}</p>
                                    )}
                                </div>
                            </div>
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
                            <button onClick={() => onApprove(req)} disabled={!canApprove}
                                className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-success-solid hover:bg-success-hover text-white text-body-sm font-bold transition-all active:scale-[0.97] shadow-sm hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-success)] disabled:opacity-50 disabled:cursor-not-allowed">
                                <Check size={13} strokeWidth={2.5} /> Aprobar
                            </button>
                            <button onClick={() => onReject(req)} disabled={!canApprove}
                                className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-danger-solid hover:bg-danger-hover text-white text-body-sm font-bold transition-all active:scale-[0.97] shadow-sm hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-danger)] disabled:opacity-50 disabled:cursor-not-allowed">
                                <X size={13} strokeWidth={2.5} /> Rechazar
                            </button>
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
            trailingActions={canCreate && (
                <TabBarAction icon={Plus} variant="primary" onClick={() => openCreateModal()}>
                    Nueva Solicitud
                </TabBarAction>
            )}
        />
    );

    return (
        <GlassViewLayout icon={Inbox} title="Bandeja de Aprobaciones" filtersContent={filtersContent} transparentBody={true}>
            <div className="pt-4 px-2 md:px-0 pb-8 space-y-6">

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
                                        <div key={i} className="rounded-modal border border-divider bg-surface-card p-4 flex items-center gap-3">
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
                    <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                        <div className="relative group flex flex-col items-center text-center">
                            <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${statusFilter === 'PENDING' ? 'bg-brand' : statusFilter === 'APPROVED' ? 'bg-success' : statusFilter === 'REJECTED' ? 'bg-danger' : 'bg-content-3'}`} />
                            <div className={`relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card backdrop-blur-xl border border-border-card shadow-[var(--shadow-elevation-md)] transition-all duration-700 group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] ${statusFilter === 'PENDING' ? 'text-brand-text' : statusFilter === 'APPROVED' ? 'text-success' : statusFilter === 'REJECTED' ? 'text-danger' : 'text-content-3'}`}>
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
                        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-label text-warning-text font-semibold">
                            <Search size={12} strokeWidth={2.5} className="shrink-0" />
                            Resultados similares para &ldquo;{rawSearch.trim()}&rdquo; — no se encontraron coincidencias exactas
                        </div>
                    )}
                    {groupedByType.map(([type, cards]) => {
                        const TypeIcon  = TYPE_ICONS[type] || FileText;
                        const typeConf  = REQUEST_TYPES[type] || { label: type };
                        const tc        = TYPE_COLORS[type] || { sectionIcon: 'text-content-2 bg-surface-card-hover border-divider', section: 'text-content-2' };
                        const isCollapsed = collapsedSections.has(type);

                        return (
                            <section key={type}>
                                <button onClick={() => toggleSection(type)} className="w-full flex items-center gap-2 mb-3">
                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border ${tc.sectionIcon}`}>
                                        <TypeIcon size={12} strokeWidth={2} />
                                    </div>
                                    <h3 className={`text-label font-black uppercase tracking-widest ${tc.section}`}>{typeConf.label}</h3>
                                    <span className="text-caption font-bold text-content-3">{cards.length}</span>
                                    <div className="flex-1 h-px bg-divider mx-1" />
                                    <ChevronDown size={13} strokeWidth={2.5}
                                        className={`text-content-3 transition-transform duration-300 flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} />
                                </button>

                                <div inert={isCollapsed ? true : undefined} className={`transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] ${isCollapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-[9999px] opacity-100 overflow-visible'}`}>
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

            {actionModal && ReactDOM.createPortal(
                <div className="fixed inset-0 z-toast flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-scrim backdrop-blur-md" onClick={() => !isActioning && setActionModal(null)} />
                    <div className="relative bg-surface-card backdrop-blur-2xl border border-border-card rounded-header shadow-[var(--shadow-elevation-lg)] w-full max-w-md p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className={`w-14 h-14 rounded-card flex items-center justify-center mx-auto mb-4 border ${actionModal.mode === 'approve' ? 'bg-success/10 border-success/30 shadow-[var(--shadow-glow-success)]' : 'bg-danger/10 border-danger/30 shadow-[var(--shadow-glow-danger)]'}`}>
                            {actionModal.mode === 'approve' ? <CheckCircle2 size={26} className="text-success" strokeWidth={2} /> : <XCircle size={26} className="text-danger" strokeWidth={2} />}
                        </div>
                        <h3 className="text-title-sm font-bold text-content text-center mb-1">
                            {actionModal.mode === 'approve' ? 'Aprobar Solicitud' : 'Rechazar Solicitud'}
                        </h3>
                        <p className="text-body-sm text-content-3 text-center mb-5">
                            {REQUEST_TYPES[actionModal.req.type]?.label} · {actionModal.req.employee?.name}
                        </p>
                        <label className="text-label font-black uppercase tracking-widest text-content-2 mb-1.5 block">
                            {actionModal.mode === 'reject' ? 'Motivo de rechazo' : 'Nota para el empleado'}
                            {actionModal.mode === 'reject' && <span className="text-danger ml-1">*</span>}
                        </label>
                        <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={3}
                            placeholder={actionModal.mode === 'approve' ? 'Opcional...' : 'Explica el motivo del rechazo...'}
                            disabled={isActioning}
 className="w-full px-4 py-3 rounded-3xl border border-border-card bg-surface-card backdrop-blur-md text-body-xl text-content-2 placeholder-content-3 focus:border-brand/40 resize-none transition-all disabled:opacity-50" />
                        <div className="flex items-center gap-2 mt-4">
                            <button onClick={() => !isActioning && setActionModal(null)} disabled={isActioning}
                                className="flex-1 py-3 rounded-2xl border border-border-card bg-surface-card text-content-3 text-body font-medium hover:bg-surface-card transition-all disabled:opacity-50">
                                Cancelar
                            </button>
                            <button onClick={handleConfirmAction}
                                disabled={!canApprove || isActioning || (actionModal.mode === 'reject' && !actionNote.trim())}
                                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-body font-bold transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 ${
                                    actionModal.mode === 'approve'
                                        ? 'bg-success hover:bg-success-hover shadow-[var(--shadow-glow-success)]'
                                        : 'bg-danger hover:bg-danger-hover shadow-[var(--shadow-glow-danger)]'
                                }`}>
                                {isActioning ? <Loader2 size={14} className="animate-spin" />
                                    : actionModal.mode === 'approve' ? <><Check size={14} strokeWidth={2.5} /> Aprobar</> : <><X size={14} strokeWidth={2.5} /> Rechazar</>}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {createModalOpen && ReactDOM.createPortal(
                <div className="fixed inset-0 z-toast flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-scrim backdrop-blur-md" onClick={() => !isCreatingReq && setCreateModalOpen(false)} />
                    <div className="relative bg-surface-card backdrop-blur-2xl border border-border-card rounded-header shadow-[var(--shadow-elevation-lg)] w-full max-w-lg p-6 space-y-4 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="w-11 h-11 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                                <ClipboardList size={20} className="text-brand-text" strokeWidth={2} />
                            </div>
                            <div>
                                <h3 className="text-body-xl font-bold text-content">Nueva Solicitud</h3>
                                <p className="text-label text-content-3">A nombre de un empleado</p>
                            </div>
                        </div>

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
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => { setCreateType(key); setCreatePayload({}); }}
                                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-label font-bold transition-all ${
                                                createType === key
                                                    ? `${conf.color} ${conf.border} shadow-sm`
                                                    : 'border-divider text-content-3 hover:border-divider bg-surface-card'
                                            }`}
                                        >
                                            <Icon size={13} strokeWidth={2} />
                                            {conf.label}
                                        </button>
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
                            <textarea
                                value={createNote}
                                onChange={e => setCreateNote(e.target.value)}
                                rows={3}
                                placeholder="Describe la solicitud..."
                                disabled={isCreatingReq}
 className="w-full px-4 py-3 rounded-3xl border border-border-card bg-surface-card backdrop-blur-md text-body-xl text-content-2 placeholder-content-3 focus:border-brand/40 resize-none transition-all disabled:opacity-50"
                            />
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                            <button onClick={() => !isCreatingReq && setCreateModalOpen(false)} disabled={isCreatingReq}
                                className="flex-1 py-3 rounded-2xl border border-border-card bg-surface-card text-content-3 text-body font-medium hover:bg-surface-card transition-all disabled:opacity-50">
                                Cancelar
                            </button>
                            <button onClick={handleCreateRequest}
                                disabled={!canCreate || isCreatingReq || !createEmployeeId || !createNote.trim()}
                                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-body font-bold transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 bg-brand hover:bg-brand-hover shadow-[var(--shadow-glow-brand)]">
                                {isCreatingReq ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} strokeWidth={2.5} /> Enviar</>}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </GlassViewLayout>
    );
};

export default RequestsView;
