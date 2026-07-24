import React, { useState, useEffect, memo, useRef, useMemo } from 'react';
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

// circle = card colored avatar; section = section label color
const TYPE_COLORS = {
    VACATION:     { circle: 'bg-emerald-500',  ring: 'ring-emerald-200', section: 'text-emerald-700', border: 'border-success/60', hover: 'hover:shadow-[0_8px_28px_rgba(16,185,129,0.12)]',  sectionIcon: 'text-success bg-success/10 border-success/50'  },
    PERMIT:       { circle: 'bg-blue-500',     ring: 'ring-blue-200',    section: 'text-blue-700',    border: 'border-blue-200/50',    hover: 'hover:shadow-[0_8px_28px_rgba(59,130,246,0.12)]',   sectionIcon: 'text-blue-600 bg-blue-50 border-blue-200/50'           },
    SHIFT_CHANGE: { circle: 'bg-cyan-500',     ring: 'ring-cyan-200',    section: 'text-cyan-700',    border: 'border-cyan-200/50',    hover: 'hover:shadow-[0_8px_28px_rgba(6,182,212,0.12)]',    sectionIcon: 'text-cyan-600 bg-cyan-50 border-cyan-200/50'           },
    OVERTIME:     { circle: 'bg-amber-500',    ring: 'ring-amber-200',   section: 'text-amber-700',   border: 'border-warning/50',   hover: 'hover:shadow-[0_8px_28px_rgba(245,158,11,0.12)]',   sectionIcon: 'text-warning bg-warning/10 border-warning/50'        },
    ADVANCE:      { circle: 'bg-violet-500',   ring: 'ring-violet-200',  section: 'text-violet-700',  border: 'border-violet-200/50',  hover: 'hover:shadow-[0_8px_28px_rgba(139,92,246,0.12)]',   sectionIcon: 'text-violet-600 bg-violet-50 border-violet-200/50'     },
    CERTIFICATE:  { circle: 'bg-indigo-500',   ring: 'ring-indigo-200',  section: 'text-indigo-700',  border: 'border-indigo-200/50',  hover: 'hover:shadow-[0_8px_28px_rgba(99,102,241,0.12)]',   sectionIcon: 'text-indigo-600 bg-indigo-50 border-indigo-200/50'     },
    DISABILITY:             { circle: 'bg-red-500',      ring: 'ring-red-200',      section: 'text-red-700',      border: 'border-danger/60',      hover: 'hover:shadow-[0_8px_28px_rgba(239,68,68,0.14)]',     sectionIcon: 'text-danger bg-danger/10 border-danger/50'              },
    ANNULMENT_REQUEST:      { circle: 'bg-rose-500',     ring: 'ring-rose-200',     section: 'text-rose-700',     border: 'border-rose-200/60',     hover: 'hover:shadow-[0_8px_28px_rgba(244,63,94,0.14)]',     sectionIcon: 'text-rose-600 bg-rose-50 border-rose-200/50'           },
    PAYMENT_CHANGE_REQUEST: { circle: 'bg-sky-500',      ring: 'ring-sky-200',      section: 'text-sky-700',      border: 'border-sky-200/50',      hover: 'hover:shadow-[0_8px_28px_rgba(14,165,233,0.12)]',    sectionIcon: 'text-sky-600 bg-sky-50 border-sky-200/50'              },
    VENDOR_CHANGE_REQUEST:  { circle: 'bg-purple-500',   ring: 'ring-purple-200',   section: 'text-purple-700',   border: 'border-purple-200/50',   hover: 'hover:shadow-[0_8px_28px_rgba(168,85,247,0.12)]',    sectionIcon: 'text-purple-600 bg-purple-50 border-purple-200/50'     },
    CLIENT_CHANGE_REQUEST:  { circle: 'bg-teal-500',     ring: 'ring-teal-200',     section: 'text-teal-700',     border: 'border-teal-200/50',     hover: 'hover:shadow-[0_8px_28px_rgba(20,184,166,0.12)]',    sectionIcon: 'text-teal-600 bg-teal-50 border-teal-200/50'           },
};

const fmtDate = (iso) => !iso ? '—' : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
const fmtDateFull = (iso) => !iso ? '—' : new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });

// One-line summary shown in collapsed state
const CompactSummary = ({ req }) => {
    const meta = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    if (req.type === 'VACATION' && meta.startDate)
        return <span className="text-[10px] text-content-3">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}</span>;
    if (req.type === 'SHIFT_CHANGE' && meta.targetEmployeeName)
        return <span className="text-[10px] text-content-3">↔ {meta.targetEmployeeName.split(' ')[0]}{meta.date ? ` · ${fmtDate(meta.date)}` : ''}</span>;
    if (req.type === 'DISABILITY' && meta.startDate) {
        const days = meta.days || (meta.endDate ? Math.max(1, Math.round((new Date(meta.endDate+'T00:00:00') - new Date(meta.startDate+'T00:00:00')) / 86400000) + 1) : null);
        return <span className="text-[10px] text-content-3">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}{days ? ` · ${days}d` : ''}</span>;
    }
    if (req.type === 'PERMIT') {
        const dates = meta.permissionDates || [];
        if (dates.length) return <span className="text-[10px] text-content-3">{dates.length === 1 ? fmtDate(dates[0]) : `${dates.length} días`}</span>;
    }
    if (req.type === 'ADVANCE' && meta.amount)
        return <span className="text-[10px] text-content-3">${Number(meta.amount).toLocaleString('es-SV')}</span>;
    if (req.type === 'CERTIFICATE' && meta.certificateType) {
        const labels = { LABORAL: 'Laboral', SALARIO: 'Salario', BANCARIA: 'Bancaria' };
        return <span className="text-[10px] text-content-3">{labels[meta.certificateType] || meta.certificateType}</span>;
    }
    if (req.type === 'ANNULMENT_REQUEST' && meta.correlativo)
        return <span className="text-[10px] text-content-3">{meta.correlativo}{meta.reason ? ` · ${meta.reason}` : ''}</span>;
    if (req.type === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-[10px] text-content-3">{meta.correlativo} · {meta.current_pago} → {meta.new_pago}</span>;
    if (req.type === 'VENDOR_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-[10px] text-content-3">{meta.correlativo} · vendedor #{meta.current_vendor_code} → #{meta.new_vendor_code}</span>;
    if (req.type === 'CLIENT_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-[10px] text-content-3">{meta.correlativo} · {(meta.current_cliente || 'Sin nombre').split(' ')[0]} → {(meta.new_client_name || '').split(' ')[0]}</span>;
    if (req.note) return <span className="text-[10px] text-content-3 italic truncate max-w-[160px]">"{req.note}"</span>;
    return null;
};

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
const RequestCard = memo(({ req, onApprove, onReject, canApprove = false, employeesById }) => {
    const [expanded, setExpanded] = useState(false);

    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-surface-card-hover text-content-3', border: 'border-slate-200', dot: 'bg-content-3' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const tc        = TYPE_COLORS[req.type] || { circle: 'bg-content-3', ring: 'ring-slate-200', border: 'border-border-card', hover: '', sectionIcon: '' };
    const meta      = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    const isRejected = req.status === 'REJECTED';
    const isUrgent   = req.type === 'DISABILITY' && req.status === 'PENDING';

    const getApproverLabel = (ap) => {
        const emp = ap.approverId ? employeesById.get(String(ap.approverId)) : null;
        return emp ? `${emp.name}${emp.role ? ` · ${emp.role}` : ''}` : `Nivel ${ap.level}`;
    };

    return (
        <div className={`rounded-[2rem] border bg-surface-card backdrop-blur-2xl shadow-[0_2px_12px_rgba(0,0,0,0.05)] hover:-translate-y-1 ${tc.hover} transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden transform-gpu
            ${isUrgent ? 'border-red-300' : isRejected ? 'border-danger/60' : `${tc.border}`}`}>

            {/* Compact header — click to expand */}
            <button onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-black/[0.02] transition-colors duration-200">

                {/* Colored circle avatar */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ${tc.circle} ${tc.ring} shadow-sm`}>
                    <TypeIcon size={15} strokeWidth={2} className="text-white" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        {req.employee && (
                            <span className="text-[13px] font-semibold text-content truncate leading-tight max-w-[160px]">
                                {req.employee.name}
                            </span>
                        )}
                        <span className={`flex items-center gap-1 text-[10px] font-bold shrink-0 ${statConf.color.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {statConf.label}
                        </span>
                        {isUrgent && <span className="text-[9px] font-black text-danger animate-pulse shrink-0">URGENTE</span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <CompactSummary req={req} />
                        <span className="text-[9px] text-content-3 shrink-0">{fmtDateFull(req.created_at)}</span>
                        {req.current_level && req.status === 'PENDING' && req.type !== 'DISABILITY' && (
                            <span className="text-[9px] text-content-3 shrink-0">· Niv. {req.current_level}/{req.type === 'SHIFT_CHANGE' ? 2 : 3}</span>
                        )}
                    </div>
                </div>

                <ChevronDown size={14} strokeWidth={2.5}
                    className={`text-content-3 flex-shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
            </button>

            {/* Expandable body */}
            <div className={`overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] ${expanded ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-4 pb-4 pt-3 border-t border-border-card space-y-2.5">

                    {/* SHIFT_CHANGE */}
                    {req.type === 'SHIFT_CHANGE' && (
                        <div className="space-y-2">
                            {(meta.targetEmployeeName || meta.date) && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-cyan-50/60 border border-cyan-200/50">
                                    <ArrowLeftRight size={12} className="text-cyan-500 flex-shrink-0" strokeWidth={2} />
                                    <div className="flex flex-wrap items-center gap-2">
                                        {meta.targetEmployeeName && <span className="text-[12px] font-bold text-cyan-700">↔ {meta.targetEmployeeName}</span>}
                                        {meta.date && <span className="text-[11px] text-cyan-600">{new Date(meta.date+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'long', day: '2-digit', month: 'long' })}</span>}
                                    </div>
                                </div>
                            )}
                            {(meta.myShift || meta.targetShift) && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                        <p className="text-[8px] font-black text-content-2 uppercase tracking-widest mb-0.5">{req.employee?.name?.split(' ')[0]}</p>
                                        <p className="text-[11px] font-black text-content-2">{meta.myShift || '—'}</p>
                                    </div>
                                    <div className="bg-cyan-50/80 border border-cyan-100 rounded-2xl p-2.5">
                                        <p className="text-[8px] font-black text-cyan-600 uppercase tracking-widest mb-0.5">{meta.targetEmployeeName?.split(' ')[0]}</p>
                                        <p className="text-[11px] font-black text-content-2">{meta.targetShift || '—'}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* DISABILITY */}
                    {req.type === 'DISABILITY' && (
                        <div className="space-y-2">
                            {meta.startDate && (
                                <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-danger/80 border border-danger/70">
                                    <Stethoscope size={13} className="text-danger flex-shrink-0" strokeWidth={2} />
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-danger mb-0.5">Período</p>
                                        <p className="text-[13px] font-bold text-red-700">
                                            {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                                            {meta.days && <span className="text-danger font-medium ml-1.5">· {meta.days}d</span>}
                                        </p>
                                        {Number(meta.days) > 3 && <p className="text-[10px] text-warning font-black mt-0.5">Requiere boleta ISSS</p>}
                                    </div>
                                </div>
                            )}
                            {meta.docUrl ? (
                                <a href={meta.docUrl} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card border border-border-card text-[11px] font-bold text-content-2 hover:text-brand transition-all">
                                    <FileImage size={12} strokeWidth={2} />{meta.docName || 'Ver certificado adjunto'}
                                </a>
                            ) : (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-warning/70 border border-warning/60">
                                    <AlertTriangle size={11} className="text-warning flex-shrink-0" strokeWidth={2} />
                                    <p className="text-[10px] text-amber-700 font-medium">Sin certificado adjunto.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* VACATION */}
                    {req.type === 'VACATION' && meta.startDate && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-success/60 border border-success/50">
                            <CalendarDays size={13} className="text-success flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-success mb-0.5">Período</p>
                                <p className="text-[12px] font-bold text-emerald-700">
                                    {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* PERMIT */}
                    {req.type === 'PERMIT' && (meta.permissionDates || []).length > 0 && (
                        <div className="px-3 py-2.5 rounded-2xl bg-blue-50/60 border border-blue-200/50">
                            <p className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-2">Días de Permiso</p>
                            <div className="flex flex-wrap gap-1.5">
                                {meta.permissionDates.map(d => (
                                    <span key={d} className="text-[10px] font-bold text-blue-700 bg-blue-100/80 border border-blue-200/60 px-2 py-0.5 rounded-full">
                                        {new Date(d+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' })}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ADVANCE */}
                    {req.type === 'ADVANCE' && meta.amount && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-violet-50/60 border border-violet-200/50">
                            <Banknote size={13} className="text-violet-500 flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-violet-500 mb-0.5">Monto solicitado</p>
                                <p className="text-[13px] font-black text-violet-700">${Number(meta.amount).toLocaleString('es-SV')}</p>
                            </div>
                        </div>
                    )}

                    {/* CERTIFICATE */}
                    {req.type === 'CERTIFICATE' && meta.certificateType && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-indigo-50/60 border border-indigo-200/50">
                            <FileCheck2 size={13} className="text-indigo-500 flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-0.5">Tipo</p>
                                <p className="text-[12px] font-bold text-indigo-700">
                                    {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ANNULMENT_REQUEST */}
                    {req.type === 'ANNULMENT_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-rose-50/80 border border-rose-200/70">
                                <Ban size={13} className="text-rose-500 flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-0.5">Factura a anular</p>
                                    <p className="text-[12px] font-bold text-rose-700">{meta.correlativo} · ${Number(meta.total || 0).toFixed(2)}</p>
                                    {meta.fecha && <p className="text-[10px] text-rose-500">{new Date(meta.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}</p>}
                                </div>
                                {meta.tipo_documento && (
                                    <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-1 rounded-lg ${meta.tipo_documento === 'CCF' ? 'bg-danger/10 text-red-700 border border-danger/30' : 'bg-surface-card-hover text-content-2 border border-slate-200'}`}>{meta.tipo_documento}</span>
                                )}
                            </div>
                            {meta.reason && (
                                <div className="px-3 py-2 rounded-2xl bg-surface-card border border-border-card">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-content-2 mb-0.5">Motivo de anulación</p>
                                    <p className="text-[11px] font-bold text-content-2">{meta.reason}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* PAYMENT_CHANGE_REQUEST */}
                    {req.type === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-sky-50/80 border border-sky-200/60">
                                <CreditCard size={13} className="text-sky-500 flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-sky-400 mb-0.5">Factura</p>
                                    <p className="text-[12px] font-bold text-sky-700">{meta.correlativo} · ${Number(meta.total || 0).toFixed(2)}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                    <p className="text-[8px] font-black text-content-2 uppercase tracking-widest mb-0.5">Actual</p>
                                    <p className="text-[12px] font-black text-content-2 capitalize">{meta.current_pago || '—'}</p>
                                </div>
                                <div className="bg-sky-50/80 border border-sky-100 rounded-2xl p-2.5">
                                    <p className="text-[8px] font-black text-sky-500 uppercase tracking-widest mb-0.5">Cambiar a</p>
                                    <p className="text-[12px] font-black text-content-2 capitalize">{meta.new_pago || '—'}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* VENDOR_CHANGE_REQUEST */}
                    {req.type === 'VENDOR_CHANGE_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-purple-50/80 border border-purple-200/60">
                                <Receipt size={13} className="text-purple-500 flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-purple-400 mb-0.5">Factura</p>
                                    <p className="text-[12px] font-bold text-purple-700">{meta.correlativo} · ${Number(meta.total || 0).toFixed(2)}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                    <p className="text-[8px] font-black text-content-2 uppercase tracking-widest mb-0.5">Vendedor actual</p>
                                    {meta.current_vendor_photo && (
                                        <img src={meta.current_vendor_photo} className="w-6 h-6 rounded-full object-cover mb-1" alt="" />
                                    )}
                                    <p className="text-[11px] font-black text-content-2">{meta.current_vendor_name || `#${meta.current_vendor_code}`}</p>
                                    {meta.current_vendor_code && <p className="text-[9px] text-content-3 font-mono">#{meta.current_vendor_code}</p>}
                                </div>
                                <div className="bg-purple-50/80 border border-purple-100 rounded-2xl p-2.5">
                                    <p className="text-[8px] font-black text-purple-500 uppercase tracking-widest mb-0.5">Asignar a</p>
                                    {meta.new_vendor_photo && (
                                        <img src={meta.new_vendor_photo} className="w-6 h-6 rounded-full object-cover mb-1" alt="" />
                                    )}
                                    <p className="text-[11px] font-black text-content-2">{meta.new_vendor_name || `#${meta.new_vendor_code}`}</p>
                                    {meta.new_vendor_code && <p className="text-[9px] text-content-3 font-mono">#{meta.new_vendor_code}</p>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* CLIENT_CHANGE_REQUEST */}
                    {req.type === 'CLIENT_CHANGE_REQUEST' && meta.correlativo && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-teal-50/80 border border-teal-200/60">
                                <Receipt size={13} className="text-teal-500 flex-shrink-0" strokeWidth={2} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-teal-400 mb-0.5">Factura</p>
                                    <p className="text-[12px] font-bold text-teal-700">{meta.correlativo} · ${Number(meta.total || 0).toFixed(2)}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-surface-card border border-border-card rounded-2xl p-2.5">
                                    <p className="text-[8px] font-black text-content-2 uppercase tracking-widest mb-1">Cliente actual</p>
                                    <div className="w-6 h-6 rounded-full bg-surface-card-hover flex items-center justify-center mb-1">
                                        <span className="text-content-3 font-black text-[10px] leading-none">{(meta.current_cliente || '?').charAt(0)}</span>
                                    </div>
                                    <p className="text-[11px] font-black text-content-2 leading-tight">{meta.current_cliente || 'Sin nombre'}</p>
                                </div>
                                <div className="bg-teal-50/80 border border-teal-100 rounded-2xl p-2.5">
                                    <p className="text-[8px] font-black text-teal-500 uppercase tracking-widest mb-1">Cambiar a</p>
                                    <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center mb-1">
                                        <span className="text-teal-600 font-black text-[10px] leading-none">{(meta.new_client_name || '?').charAt(0)}</span>
                                    </div>
                                    <p className="text-[11px] font-black text-content-2 leading-tight">{meta.new_client_name}</p>
                                    {(meta.new_client_nit || meta.new_client_dui) && (
                                        <p className="text-[9px] text-content-3 font-mono mt-0.5">{meta.new_client_nit ? `NIT ${meta.new_client_nit}` : `DUI ${meta.new_client_dui}`}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Note */}
                    {req.note && (
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-content-2 mb-1.5">Motivo del empleado</p>
                            <p className="text-[12px] text-content-2 bg-surface-card rounded-2xl p-3 border border-border-card leading-relaxed">{req.note}</p>
                        </div>
                    )}

                    {/* Rejection reason */}
                    {isRejected && req.approver_note && (
                        <div className="px-3 py-2.5 rounded-2xl bg-danger/80 border border-danger/70">
                            <p className="text-[9px] font-black uppercase tracking-widest text-danger mb-1">Motivo de rechazo</p>
                            <p className="text-[12px] text-red-800 font-medium leading-relaxed">{req.approver_note}</p>
                        </div>
                    )}

                    {/* Approval note */}
                    {!isRejected && req.approver_note && (
                        <div className="px-3 py-2.5 rounded-2xl bg-success/80 border border-success/60">
                            <p className="text-[9px] font-black uppercase tracking-widest text-success mb-1">Nota del aprobador</p>
                            <p className="text-[12px] text-emerald-800 font-medium leading-relaxed">{req.approver_note}</p>
                        </div>
                    )}

                    {/* Approval history */}
                    {req.approvals && req.approvals.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-[9px] font-black uppercase tracking-widest text-content-2">Historial</p>
                            {req.approvals.map((ap, i) => (
                                <div key={i} className="flex items-start gap-2 bg-success/70 border border-success/50 rounded-2xl p-2.5">
                                    <CheckCircle2 size={12} className="text-success mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-black text-emerald-700">{getApproverLabel(ap)}</p>
                                        <p className="text-[9px] text-content-3 mt-0.5">{new Date(ap.approvedAt).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                                        {ap.approverNote && <p className="text-[10px] text-content-2 mt-0.5 italic">"{ap.approverNote}"</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {req.employee?.code && (
                        <p className="text-[10px] text-content-3">Código: <span className="font-mono font-bold text-content-2">{req.employee.code}</span></p>
                    )}

                    {req.status === 'PENDING' && (
                        <div className="flex items-center gap-2 pt-1">
                            <button onClick={() => onApprove(req)} disabled={!canApprove}
                                className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-bold transition-all active:scale-[0.97] shadow-sm hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
                                <Check size={13} strokeWidth={2.5} /> Aprobar
                            </button>
                            <button onClick={() => onReject(req)} disabled={!canApprove}
                                className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-[12px] font-bold transition-all active:scale-[0.97] shadow-sm hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(239,68,68,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
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
    const [isSearchMode,      setIsSearchMode]      = useState(false);
    const [rawSearch,         setRawSearch]         = useState('');
    const [collapsedSections, setCollapsedSections] = useState(new Set());
    const [actionModal,       setActionModal]       = useState(null);
    const [actionNote,        setActionNote]        = useState('');
    const [isActioning,       setIsActioning]       = useState(false);
    const searchInputRef = useRef(null);

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

    useEffect(() => {
        if (isSearchMode && searchInputRef.current)
            setTimeout(() => searchInputRef.current?.focus(), 100);
    }, [isSearchMode]);

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

    const filtersContent = (
        <div className="flex items-center gap-2 md:gap-3">
            {canCreate && (
                <button onClick={() => openCreateModal()}
                    className="group relative overflow-hidden flex items-center gap-2 h-10 md:h-11 px-4 md:px-5 bg-gradient-to-b from-brand/72 to-brand-hover/78 backdrop-blur-xl border border-border-card hover:border-border-card text-white rounded-full font-black text-[10px] uppercase tracking-widest shadow-[0_6px_22px_rgba(0,82,204,0.28),inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_12px_36px_rgba(0,82,204,0.44),inset_0_1px_0_rgba(255,255,255,0.24)] transition-all duration-200 active:scale-[0.97] shrink-0">
                    <span className="absolute inset-0 overflow-hidden rounded-full pointer-events-none">
                        <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.16] to-transparent -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
                    </span>
                    <Plus size={14} strokeWidth={3}/> <span className="hidden sm:inline">Nueva Solicitud</span>
                </button>
            )}
        <div className="relative flex items-center bg-surface-card backdrop-blur-2xl backdrop-saturate-[180%] border border-border-card shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">

            {/* Pending dot — outside the overflow-hidden area via outline trick */}
            {pendingCount > 0 && !isSearchMode && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 z-50 pointer-events-none">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 border-2 border-white items-center justify-center">
                        <span className="text-[8px] font-black text-white leading-none">{pendingCount > 9 ? '9+' : pendingCount}</span>
                    </span>
                </span>
            )}

            {/* Search mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left
                ${isSearchMode ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                <Search size={18} className="text-brand shrink-0" strokeWidth={2.5} />
                <input ref={searchInputRef} type="text" placeholder="Buscar empleado..."
                    className="flex-1 bg-transparent border-none outline-none text-[16px] md:text-[16px] font-bold text-content-2 w-[180px] sm:w-[280px] md:w-[400px] placeholder:text-content-3 focus:ring-0"
                    value={rawSearch} onChange={e => setRawSearch(e.target.value)} />
                {rawSearch && <button onClick={() => setRawSearch('')} className="p-1 text-content-3 hover:text-danger transition-all shrink-0"><X size={16} strokeWidth={2.5} /></button>}
                <button onClick={() => { setIsSearchMode(false); setRawSearch(''); }}
                    className="w-11 h-11 rounded-full hover:bg-white text-content-3 flex items-center justify-center shrink-0 transition-all hover:shadow-md hover:text-brand hover:-translate-y-0.5 ml-2">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {/* Normal mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right
                ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[800px] opacity-100 pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5'}`}>
                {STATUS_TABS.map(tab => (
                    <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                        className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${
                            statusFilter === tab.key
                                ? 'bg-white text-content border-white shadow-md scale-[1.02]'
                                : 'bg-transparent text-content-3 border-transparent hover:bg-white hover:text-content hover:-translate-y-0.5 hover:shadow-md hover:border-border-card'
                        }`}>
                        {tab.label}
                        {tab.key === 'PENDING' && pendingCount > 0 && (
                            <span className={`ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${statusFilter === 'PENDING' ? 'bg-surface-card-hover text-content-2' : 'bg-danger/10 text-danger'}`}>
                                {pendingCount}
                            </span>
                        )}
                    </button>
                ))}
                <div className="h-6 w-px bg-surface-card mx-1 shrink-0" />
                <button onClick={() => setIsSearchMode(true)}
                    className="w-11 h-11 bg-brand text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,82,204,0.4)] transition-all duration-300 hover:bg-brand-hover hover:-translate-y-0.5 active:scale-[0.97] transform-gpu relative">
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {rawSearch && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
        </div>
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
                                    <div className="flex-1 h-px bg-surface-card-hover/50 mx-1" />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className="rounded-[2rem] border border-black/[0.06] bg-surface-card p-4 flex items-center gap-3">
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
                            <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${statusFilter === 'PENDING' ? 'bg-brand' : statusFilter === 'APPROVED' ? 'bg-emerald-500' : statusFilter === 'REJECTED' ? 'bg-red-500' : 'bg-content-3'}`} />
                            <div className={`relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-surface-card backdrop-blur-xl border border-border-card shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-700 group-hover:-translate-y-2 group-hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] ${statusFilter === 'PENDING' ? 'text-brand' : statusFilter === 'APPROVED' ? 'text-success' : statusFilter === 'REJECTED' ? 'text-danger' : 'text-content-3'}`}>
                                {statusFilter === 'PENDING' ? <CheckCircle2 size={40} strokeWidth={2} /> : <ClipboardList size={40} strokeWidth={2} />}
                            </div>
                            <h3 className="font-bold text-[22px] text-content tracking-tight mb-2">
                                {statusFilter === 'PENDING' ? 'Todo al día' : 'Sin resultados'}
                            </h3>
                            <p className="font-medium text-[14px] text-content-3 max-w-[280px] leading-relaxed">
                                {statusFilter === 'PENDING' ? 'No hay solicitudes pendientes de revisión.' : 'Sin solicitudes en esta categoría.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                    {isReqSearchFuzzy && rawSearch.trim() && (
                        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-[11px] text-amber-700 font-semibold">
                            <Search size={12} strokeWidth={2.5} className="shrink-0" />
                            Resultados similares para &ldquo;{rawSearch.trim()}&rdquo; — no se encontraron coincidencias exactas
                        </div>
                    )}
                    {groupedByType.map(([type, cards]) => {
                        const TypeIcon  = TYPE_ICONS[type] || FileText;
                        const typeConf  = REQUEST_TYPES[type] || { label: type };
                        const tc        = TYPE_COLORS[type] || { sectionIcon: 'text-content-2 bg-surface-card-hover border-slate-200', section: 'text-content-2' };
                        const isCollapsed = collapsedSections.has(type);

                        return (
                            <section key={type}>
                                <button onClick={() => toggleSection(type)} className="w-full flex items-center gap-2 mb-3">
                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border ${tc.sectionIcon}`}>
                                        <TypeIcon size={12} strokeWidth={2} />
                                    </div>
                                    <h3 className={`text-[11px] font-black uppercase tracking-widest ${tc.section}`}>{typeConf.label}</h3>
                                    <span className="text-[10px] font-bold text-content-3">{cards.length}</span>
                                    <div className="flex-1 h-px bg-surface-card-hover/50 mx-1" />
                                    <ChevronDown size={13} strokeWidth={2.5}
                                        className={`text-content-3 transition-transform duration-300 flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} />
                                </button>

                                <div className={`transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] ${isCollapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-[9999px] opacity-100 overflow-visible'}`}>
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
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={() => !isActioning && setActionModal(null)} />
                    <div className="relative bg-surface-card backdrop-blur-2xl border border-border-card rounded-[2.5rem] shadow-[0_32px_80px_rgba(0,0,0,0.15)] w-full max-w-md p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className={`w-14 h-14 rounded-[1.75rem] flex items-center justify-center mx-auto mb-4 border ${actionModal.mode === 'approve' ? 'bg-success/10 border-success/60 shadow-[0_6px_20px_rgba(16,185,129,0.15)]' : 'bg-danger/10 border-danger/60 shadow-[0_6px_20px_rgba(239,68,68,0.15)]'}`}>
                            {actionModal.mode === 'approve' ? <CheckCircle2 size={26} className="text-success" strokeWidth={2} /> : <XCircle size={26} className="text-danger" strokeWidth={2} />}
                        </div>
                        <h3 className="text-[18px] font-bold text-content text-center mb-1">
                            {actionModal.mode === 'approve' ? 'Aprobar Solicitud' : 'Rechazar Solicitud'}
                        </h3>
                        <p className="text-[12px] text-content-3 text-center mb-5">
                            {REQUEST_TYPES[actionModal.req.type]?.label} · {actionModal.req.employee?.name}
                        </p>
                        <label className="text-[11px] font-black uppercase tracking-widest text-content-2 mb-1.5 block">
                            {actionModal.mode === 'reject' ? 'Motivo de rechazo' : 'Nota para el empleado'}
                            {actionModal.mode === 'reject' && <span className="text-danger ml-1">*</span>}
                        </label>
                        <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={3}
                            placeholder={actionModal.mode === 'approve' ? 'Opcional...' : 'Explica el motivo del rechazo...'}
                            disabled={isActioning}
                            className="w-full px-4 py-3 rounded-[1.5rem] border border-border-card bg-surface-card backdrop-blur-md text-[16px] text-content-2 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand/40 resize-none transition-all disabled:opacity-50" />
                        <div className="flex items-center gap-2 mt-4">
                            <button onClick={() => !isActioning && setActionModal(null)} disabled={isActioning}
                                className="flex-1 py-3 rounded-2xl border border-border-card bg-surface-card text-content-3 text-[13px] font-medium hover:bg-surface-card transition-all disabled:opacity-50">
                                Cancelar
                            </button>
                            <button onClick={handleConfirmAction}
                                disabled={!canApprove || isActioning || (actionModal.mode === 'reject' && !actionNote.trim())}
                                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-[13px] font-bold transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 ${
                                    actionModal.mode === 'approve'
                                        ? 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_4px_16px_rgba(16,185,129,0.3)]'
                                        : 'bg-red-500 hover:bg-red-600 shadow-[0_4px_16px_rgba(239,68,68,0.3)]'
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
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={() => !isCreatingReq && setCreateModalOpen(false)} />
                    <div className="relative bg-surface-card backdrop-blur-2xl border border-border-card rounded-[2.5rem] shadow-[0_32px_80px_rgba(0,0,0,0.15)] w-full max-w-lg p-6 space-y-4 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="w-11 h-11 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                                <ClipboardList size={20} className="text-brand" strokeWidth={2} />
                            </div>
                            <div>
                                <h3 className="text-[16px] font-bold text-content">Nueva Solicitud</h3>
                                <p className="text-[11px] text-content-3">A nombre de un empleado</p>
                            </div>
                        </div>

                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-content-2 mb-1.5">Empleado <span className="text-danger">*</span></p>
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
                            <p className="text-[10px] font-black uppercase tracking-widest text-content-2 mb-2">Tipo</p>
                            <div className="flex flex-wrap gap-2">
                                {CREATABLE_TYPES.map(({ key, icon: Icon }) => {
                                    const conf = REQUEST_TYPES[key];
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => { setCreateType(key); setCreatePayload({}); }}
                                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-bold transition-all ${
                                                createType === key
                                                    ? `${conf.color} ${conf.border} shadow-sm`
                                                    : 'border-slate-200 text-content-3 hover:border-slate-300 bg-white'
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
                            <p className="text-[10px] font-black uppercase tracking-widest text-content-2 mb-1.5">
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
                            <p className="text-[10px] font-black uppercase tracking-widest text-content-2 mb-1.5">Motivo / Descripción <span className="text-danger">*</span></p>
                            <textarea
                                value={createNote}
                                onChange={e => setCreateNote(e.target.value)}
                                rows={3}
                                placeholder="Describe la solicitud..."
                                disabled={isCreatingReq}
                                className="w-full px-4 py-3 rounded-[1.5rem] border border-border-card bg-surface-card backdrop-blur-md text-[16px] text-content-2 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand/40 resize-none transition-all disabled:opacity-50"
                            />
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                            <button onClick={() => !isCreatingReq && setCreateModalOpen(false)} disabled={isCreatingReq}
                                className="flex-1 py-3 rounded-2xl border border-border-card bg-surface-card text-content-3 text-[13px] font-medium hover:bg-surface-card transition-all disabled:opacity-50">
                                Cancelar
                            </button>
                            <button onClick={handleCreateRequest}
                                disabled={!canCreate || isCreatingReq || !createEmployeeId || !createNote.trim()}
                                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-[13px] font-bold transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 bg-brand hover:bg-brand-hover shadow-[0_4px_16px_rgba(0,82,204,0.3)]">
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
