import React, { useState, useEffect, memo, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import {
    Inbox, Check, X, ChevronRight, ChevronDown,
    User, Calendar, Loader2, ClipboardList,
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Coffee,
    CheckCircle2, XCircle, Stethoscope, FileImage, AlertTriangle,
    Search, ArrowLeftRight, CalendarDays, Banknote, FileCheck2,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import GlassViewLayout from '../components/GlassViewLayout';
import { REQUEST_TYPES, REQUEST_STATUS } from '../store/slices/requestsSlice';

const TYPE_ICONS = {
    VACATION:     Palmtree,
    PERMIT:       FileText,
    SHIFT_CHANGE: RefreshCw,
    OVERTIME:     Coffee,
    ADVANCE:      DollarSign,
    CERTIFICATE:  FileCheck,
    DISABILITY:   Stethoscope,
};

// circle = card colored avatar; section = section label color
const TYPE_COLORS = {
    VACATION:     { circle: 'bg-emerald-500',  ring: 'ring-emerald-200', section: 'text-emerald-700', border: 'border-emerald-200/60', hover: 'hover:shadow-[0_8px_28px_rgba(16,185,129,0.12)]',  sectionIcon: 'text-emerald-600 bg-emerald-50 border-emerald-200/50'  },
    PERMIT:       { circle: 'bg-blue-500',     ring: 'ring-blue-200',    section: 'text-blue-700',    border: 'border-blue-200/50',    hover: 'hover:shadow-[0_8px_28px_rgba(59,130,246,0.12)]',   sectionIcon: 'text-blue-600 bg-blue-50 border-blue-200/50'           },
    SHIFT_CHANGE: { circle: 'bg-cyan-500',     ring: 'ring-cyan-200',    section: 'text-cyan-700',    border: 'border-cyan-200/50',    hover: 'hover:shadow-[0_8px_28px_rgba(6,182,212,0.12)]',    sectionIcon: 'text-cyan-600 bg-cyan-50 border-cyan-200/50'           },
    OVERTIME:     { circle: 'bg-amber-500',    ring: 'ring-amber-200',   section: 'text-amber-700',   border: 'border-amber-200/50',   hover: 'hover:shadow-[0_8px_28px_rgba(245,158,11,0.12)]',   sectionIcon: 'text-amber-600 bg-amber-50 border-amber-200/50'        },
    ADVANCE:      { circle: 'bg-violet-500',   ring: 'ring-violet-200',  section: 'text-violet-700',  border: 'border-violet-200/50',  hover: 'hover:shadow-[0_8px_28px_rgba(139,92,246,0.12)]',   sectionIcon: 'text-violet-600 bg-violet-50 border-violet-200/50'     },
    CERTIFICATE:  { circle: 'bg-indigo-500',   ring: 'ring-indigo-200',  section: 'text-indigo-700',  border: 'border-indigo-200/50',  hover: 'hover:shadow-[0_8px_28px_rgba(99,102,241,0.12)]',   sectionIcon: 'text-indigo-600 bg-indigo-50 border-indigo-200/50'     },
    DISABILITY:   { circle: 'bg-red-500',      ring: 'ring-red-200',     section: 'text-red-700',     border: 'border-red-200/60',     hover: 'hover:shadow-[0_8px_28px_rgba(239,68,68,0.14)]',    sectionIcon: 'text-red-600 bg-red-50 border-red-200/50'              },
};

const fmtDate = (iso) => !iso ? '—' : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
const fmtDateFull = (iso) => !iso ? '—' : new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });

// One-line summary shown in collapsed state
const CompactSummary = ({ req }) => {
    const meta = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    if (req.type === 'VACATION' && meta.startDate)
        return <span className="text-[10px] text-slate-500">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}</span>;
    if (req.type === 'SHIFT_CHANGE' && meta.targetEmployeeName)
        return <span className="text-[10px] text-slate-500">↔ {meta.targetEmployeeName.split(' ')[0]}{meta.date ? ` · ${fmtDate(meta.date)}` : ''}</span>;
    if (req.type === 'DISABILITY' && meta.startDate) {
        const days = meta.days || (meta.endDate ? Math.max(1, Math.round((new Date(meta.endDate+'T00:00:00') - new Date(meta.startDate+'T00:00:00')) / 86400000) + 1) : null);
        return <span className="text-[10px] text-slate-500">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}{days ? ` · ${days}d` : ''}</span>;
    }
    if (req.type === 'PERMIT') {
        const dates = meta.permissionDates || [];
        if (dates.length) return <span className="text-[10px] text-slate-500">{dates.length === 1 ? fmtDate(dates[0]) : `${dates.length} días`}</span>;
    }
    if (req.type === 'ADVANCE' && meta.amount)
        return <span className="text-[10px] text-slate-500">${Number(meta.amount).toLocaleString('es-SV')}</span>;
    if (req.type === 'CERTIFICATE' && meta.certificateType) {
        const labels = { LABORAL: 'Laboral', SALARIO: 'Salario', BANCARIA: 'Bancaria' };
        return <span className="text-[10px] text-slate-500">{labels[meta.certificateType] || meta.certificateType}</span>;
    }
    if (req.note) return <span className="text-[10px] text-slate-400 italic truncate max-w-[160px]">"{req.note}"</span>;
    return null;
};

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
const RequestCard = memo(({ req, onApprove, onReject, canApprove = false, employeesById }) => {
    const [expanded, setExpanded] = useState(false);

    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const tc        = TYPE_COLORS[req.type] || { circle: 'bg-slate-400', ring: 'ring-slate-200', border: 'border-white/80', hover: '', sectionIcon: '' };
    const meta      = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    const isRejected = req.status === 'REJECTED';
    const isUrgent   = req.type === 'DISABILITY' && req.status === 'PENDING';

    const getApproverLabel = (ap) => {
        const emp = ap.approverId ? employeesById.get(String(ap.approverId)) : null;
        return emp ? `${emp.name}${emp.role ? ` · ${emp.role}` : ''}` : `Nivel ${ap.level}`;
    };

    return (
        <div className={`rounded-[2rem] border bg-white/60 backdrop-blur-2xl shadow-[0_2px_12px_rgba(0,0,0,0.05)] hover:-translate-y-1 ${tc.hover} transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden transform-gpu
            ${isUrgent ? 'border-red-300' : isRejected ? 'border-red-200/60' : `${tc.border}`}`}>

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
                            <span className="text-[13px] font-semibold text-slate-800 truncate leading-tight max-w-[160px]">
                                {req.employee.name}
                            </span>
                        )}
                        <span className={`flex items-center gap-1 text-[10px] font-bold shrink-0 ${statConf.color.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {statConf.label}
                        </span>
                        {isUrgent && <span className="text-[9px] font-black text-red-500 animate-pulse shrink-0">URGENTE</span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <CompactSummary req={req} />
                        <span className="text-[9px] text-slate-400 shrink-0">{fmtDateFull(req.created_at)}</span>
                        {req.current_level && req.status === 'PENDING' && req.type !== 'DISABILITY' && (
                            <span className="text-[9px] text-slate-400 shrink-0">· Niv. {req.current_level}/{req.type === 'SHIFT_CHANGE' ? 2 : 3}</span>
                        )}
                    </div>
                </div>

                <ChevronDown size={14} strokeWidth={2.5}
                    className={`text-slate-400 flex-shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
            </button>

            {/* Expandable body */}
            <div className={`overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] ${expanded ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-4 pb-4 pt-3 border-t border-white/60 space-y-2.5">

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
                                    <div className="bg-white/70 border border-white/80 rounded-2xl p-2.5">
                                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{req.employee?.name?.split(' ')[0]}</p>
                                        <p className="text-[11px] font-black text-slate-700">{meta.myShift || '—'}</p>
                                    </div>
                                    <div className="bg-cyan-50/80 border border-cyan-100 rounded-2xl p-2.5">
                                        <p className="text-[8px] font-black text-cyan-600 uppercase tracking-widest mb-0.5">{meta.targetEmployeeName?.split(' ')[0]}</p>
                                        <p className="text-[11px] font-black text-slate-700">{meta.targetShift || '—'}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* DISABILITY */}
                    {req.type === 'DISABILITY' && (
                        <div className="space-y-2">
                            {meta.startDate && (
                                <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-red-50/80 border border-red-200/70">
                                    <Stethoscope size={13} className="text-red-500 flex-shrink-0" strokeWidth={2} />
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mb-0.5">Período</p>
                                        <p className="text-[13px] font-bold text-red-700">
                                            {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                                            {meta.days && <span className="text-red-400 font-medium ml-1.5">· {meta.days}d</span>}
                                        </p>
                                        {Number(meta.days) > 3 && <p className="text-[10px] text-amber-600 font-black mt-0.5">Requiere boleta ISSS</p>}
                                    </div>
                                </div>
                            )}
                            {meta.docUrl ? (
                                <a href={meta.docUrl} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/70 border border-white/80 text-[11px] font-bold text-slate-600 hover:text-[#007AFF] transition-all">
                                    <FileImage size={12} strokeWidth={2} />{meta.docName || 'Ver certificado adjunto'}
                                </a>
                            ) : (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-amber-50/70 border border-amber-200/60">
                                    <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" strokeWidth={2} />
                                    <p className="text-[10px] text-amber-700 font-medium">Sin certificado adjunto.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* VACATION */}
                    {req.type === 'VACATION' && meta.startDate && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-emerald-50/60 border border-emerald-200/50">
                            <CalendarDays size={13} className="text-emerald-500 flex-shrink-0" strokeWidth={2} />
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-0.5">Período</p>
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

                    {/* Note */}
                    {req.note && (
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Motivo del empleado</p>
                            <p className="text-[12px] text-slate-700 bg-white/70 rounded-2xl p-3 border border-white/80 leading-relaxed">{req.note}</p>
                        </div>
                    )}

                    {/* Rejection reason */}
                    {isRejected && req.approver_note && (
                        <div className="px-3 py-2.5 rounded-2xl bg-red-50/80 border border-red-200/70">
                            <p className="text-[9px] font-black uppercase tracking-widest text-red-400 mb-1">Motivo de rechazo</p>
                            <p className="text-[12px] text-red-800 font-medium leading-relaxed">{req.approver_note}</p>
                        </div>
                    )}

                    {/* Approval note */}
                    {!isRejected && req.approver_note && (
                        <div className="px-3 py-2.5 rounded-2xl bg-emerald-50/80 border border-emerald-200/60">
                            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500 mb-1">Nota del aprobador</p>
                            <p className="text-[12px] text-emerald-800 font-medium leading-relaxed">{req.approver_note}</p>
                        </div>
                    )}

                    {/* Approval history */}
                    {req.approvals && req.approvals.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Historial</p>
                            {req.approvals.map((ap, i) => (
                                <div key={i} className="flex items-start gap-2 bg-emerald-50/70 border border-emerald-200/50 rounded-2xl p-2.5">
                                    <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-black text-emerald-700">{getApproverLabel(ap)}</p>
                                        <p className="text-[9px] text-slate-400 mt-0.5">{new Date(ap.approvedAt).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                                        {ap.approverNote && <p className="text-[10px] text-slate-600 mt-0.5 italic">"{ap.approverNote}"</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {req.employee?.code && (
                        <p className="text-[10px] text-slate-400">Código: <span className="font-mono font-bold text-slate-600">{req.employee.code}</span></p>
                    )}

                    {req.status === 'PENDING' && (
                        <div className="flex items-center gap-2 pt-1">
                            <button onClick={() => onApprove(req)} disabled={!canApprove}
                                className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-bold transition-all active:scale-95 shadow-sm hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
                                <Check size={13} strokeWidth={2.5} /> Aprobar
                            </button>
                            <button onClick={() => onReject(req)} disabled={!canApprove}
                                className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-[12px] font-bold transition-all active:scale-95 shadow-sm hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(239,68,68,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
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
    const { user, isJefe, isSupervisor, rolePerms } = useAuth();
    const canApprove = rolePerms === 'ALL' || !!rolePerms?.['requests']?.can_approve;

    const requests       = useStaff(s => s.requests);
    const employees      = useStaff(s => s.employees);
    const isLoadingReqs  = useStaff(s => s.isLoadingRequests);
    const fetchRequests  = useStaff(s => s.fetchRequests);
    const approveRequest = useStaff(s => s.approveRequest);
    const rejectRequest  = useStaff(s => s.rejectRequest);

    const employeesById = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);

    const [statusFilter,      setStatusFilter]      = useState('PENDING');
    const [isSearchMode,      setIsSearchMode]      = useState(false);
    const [rawSearch,         setRawSearch]         = useState('');
    const [collapsedSections, setCollapsedSections] = useState(new Set());
    const [actionModal,       setActionModal]       = useState(null);
    const [actionNote,        setActionNote]        = useState('');
    const [isActioning,       setIsActioning]       = useState(false);
    const searchInputRef = useRef(null);

    useEffect(() => {
        const apId = (isJefe || isSupervisor) ? user?.id : null;
        const brId = isJefe ? user?.branchId : null;
        fetchRequests(null, brId, apId);
    }, []);

    useEffect(() => {
        const handler = () => {
            const apId = (isJefe || isSupervisor) ? user?.id : null;
            const brId = isJefe ? user?.branchId : null;
            fetchRequests(null, brId, apId);
        };
        window.addEventListener('requests-updated', handler);
        return () => window.removeEventListener('requests-updated', handler);
    }, []);

    useEffect(() => {
        if (isSearchMode && searchInputRef.current)
            setTimeout(() => searchInputRef.current?.focus(), 100);
    }, [isSearchMode]);

    const pendingCount = requests.filter(r => {
        const myId = String(user?.id);
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && String(r.approver_id) !== myId) return false;
        return r.status === 'PENDING' && (!r.approver || String(r.approver?.id) === myId);
    }).length;

    const baseFiltered = requests.filter(r => {
        const myId = String(user?.id);
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && String(r.approver_id) !== myId) return false;
        const assignedToMe  = !r.approver || String(r.approver?.id) === myId;
        const processedByMe = String(r.approver?.id) === myId;
        if (statusFilter === 'PENDING'  && !(r.status === 'PENDING'  && assignedToMe))  return false;
        if (statusFilter === 'APPROVED' && !(r.status === 'APPROVED' && processedByMe)) return false;
        if (statusFilter === 'REJECTED' && !(r.status === 'REJECTED' && processedByMe)) return false;
        if (rawSearch.trim() && !(r.employee?.name || '').toLowerCase().includes(rawSearch.trim().toLowerCase())) return false;
        return true;
    });

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
        <div className="relative flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">

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
                <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input ref={searchInputRef} type="text" placeholder="Buscar empleado..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[180px] sm:w-[280px] md:w-[400px] placeholder:text-slate-400 focus:ring-0"
                    value={rawSearch} onChange={e => setRawSearch(e.target.value)} />
                {rawSearch && <button onClick={() => setRawSearch('')} className="p-1 text-slate-400 hover:text-red-500 transition-all shrink-0"><X size={16} strokeWidth={2.5} /></button>}
                <button onClick={() => { setIsSearchMode(false); setRawSearch(''); }}
                    className="w-10 h-10 md:w-11 md:h-11 rounded-full hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {/* Normal mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right
                ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[800px] opacity-100 pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5'}`}>
                {STATUS_TABS.map(tab => (
                    <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                        className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${
                            statusFilter === tab.key
                                ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                        }`}>
                        {tab.label}
                        {tab.key === 'PENDING' && pendingCount > 0 && (
                            <span className={`ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${statusFilter === 'PENDING' ? 'bg-slate-200 text-slate-700' : 'bg-red-100 text-red-600'}`}>
                                {pendingCount}
                            </span>
                        )}
                    </button>
                ))}
                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                <button onClick={() => setIsSearchMode(true)}
                    className="w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-300 hover:bg-[#0066CC] hover:-translate-y-0.5 active:scale-95 transform-gpu relative">
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {rawSearch && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={Inbox} title="Bandeja de Aprobaciones" filtersContent={filtersContent} transparentBody={true}>
            <div className="pt-4 px-2 md:px-0 pb-8 space-y-6">

                {isLoadingReqs ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
                        <Loader2 size={28} className="animate-spin text-[#007AFF]/60" strokeWidth={1.5} />
                        <span className="text-[13px] font-medium">Cargando solicitudes…</span>
                    </div>
                ) : baseFiltered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                        <div className="relative group flex flex-col items-center text-center">
                            <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${statusFilter === 'PENDING' ? 'bg-[#007AFF]' : statusFilter === 'APPROVED' ? 'bg-emerald-500' : statusFilter === 'REJECTED' ? 'bg-red-500' : 'bg-slate-400'}`} />
                            <div className={`relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-700 group-hover:-translate-y-2 group-hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] ${statusFilter === 'PENDING' ? 'text-[#007AFF]' : statusFilter === 'APPROVED' ? 'text-emerald-500' : statusFilter === 'REJECTED' ? 'text-red-500' : 'text-slate-400'}`}>
                                {statusFilter === 'PENDING' ? <CheckCircle2 size={40} strokeWidth={2} /> : <ClipboardList size={40} strokeWidth={2} />}
                            </div>
                            <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">
                                {statusFilter === 'PENDING' ? 'Todo al día' : 'Sin resultados'}
                            </h3>
                            <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">
                                {statusFilter === 'PENDING' ? 'No hay solicitudes pendientes de revisión.' : 'Sin solicitudes en esta categoría.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    groupedByType.map(([type, cards]) => {
                        const TypeIcon  = TYPE_ICONS[type] || FileText;
                        const typeConf  = REQUEST_TYPES[type] || { label: type };
                        const tc        = TYPE_COLORS[type] || { sectionIcon: 'text-slate-600 bg-slate-50 border-slate-200', section: 'text-slate-700' };
                        const isCollapsed = collapsedSections.has(type);

                        return (
                            <section key={type}>
                                <button onClick={() => toggleSection(type)} className="w-full flex items-center gap-2 mb-3">
                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border ${tc.sectionIcon}`}>
                                        <TypeIcon size={12} strokeWidth={2} />
                                    </div>
                                    <h3 className={`text-[11px] font-black uppercase tracking-widest ${tc.section}`}>{typeConf.label}</h3>
                                    <span className="text-[10px] font-bold text-slate-400">{cards.length}</span>
                                    <div className="flex-1 h-px bg-slate-200/50 mx-1" />
                                    <ChevronDown size={13} strokeWidth={2.5}
                                        className={`text-slate-400 transition-transform duration-300 flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} />
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
                    })
                )}
            </div>

            {actionModal && ReactDOM.createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={() => !isActioning && setActionModal(null)} />
                    <div className="relative bg-white/80 backdrop-blur-2xl border border-white/80 rounded-[2.5rem] shadow-[0_32px_80px_rgba(0,0,0,0.15)] w-full max-w-md p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className={`w-14 h-14 rounded-[1.75rem] flex items-center justify-center mx-auto mb-4 border ${actionModal.mode === 'approve' ? 'bg-emerald-50 border-emerald-200/60 shadow-[0_6px_20px_rgba(16,185,129,0.15)]' : 'bg-red-50 border-red-200/60 shadow-[0_6px_20px_rgba(239,68,68,0.15)]'}`}>
                            {actionModal.mode === 'approve' ? <CheckCircle2 size={26} className="text-emerald-600" strokeWidth={2} /> : <XCircle size={26} className="text-red-600" strokeWidth={2} />}
                        </div>
                        <h3 className="text-[18px] font-bold text-slate-800 text-center mb-1">
                            {actionModal.mode === 'approve' ? 'Aprobar Solicitud' : 'Rechazar Solicitud'}
                        </h3>
                        <p className="text-[12px] text-slate-400 text-center mb-5">
                            {REQUEST_TYPES[actionModal.req.type]?.label} · {actionModal.req.employee?.name}
                        </p>
                        <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                            {actionModal.mode === 'reject' ? 'Motivo de rechazo' : 'Nota para el empleado'}
                            {actionModal.mode === 'reject' && <span className="text-red-400 ml-1">*</span>}
                        </label>
                        <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={3}
                            placeholder={actionModal.mode === 'approve' ? 'Opcional...' : 'Explica el motivo del rechazo...'}
                            disabled={isActioning}
                            className="w-full px-4 py-3 rounded-[1.5rem] border border-white/80 bg-white/60 backdrop-blur-md text-[13px] text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/25 focus:border-[#007AFF]/40 resize-none transition-all disabled:opacity-50" />
                        <div className="flex items-center gap-2 mt-4">
                            <button onClick={() => !isActioning && setActionModal(null)} disabled={isActioning}
                                className="flex-1 py-3 rounded-2xl border border-white/80 bg-white/60 text-slate-500 text-[13px] font-medium hover:bg-white/80 transition-all disabled:opacity-50">
                                Cancelar
                            </button>
                            <button onClick={handleConfirmAction}
                                disabled={!canApprove || isActioning || (actionModal.mode === 'reject' && !actionNote.trim())}
                                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-[13px] font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 ${
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
        </GlassViewLayout>
    );
};

export default RequestsView;
