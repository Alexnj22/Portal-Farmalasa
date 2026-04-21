import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
    Inbox, Check, X, ChevronRight,
    User, Calendar, Loader2,
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Coffee,
    CheckCircle2, XCircle, Stethoscope, FileImage, AlertTriangle,
    Search,
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

const TYPE_COLORS = {
    VACATION:     { icon: 'text-emerald-600 bg-emerald-50 border-emerald-200/50', glow: 'hover:shadow-[0_12px_40px_rgba(16,185,129,0.12)]', section: 'text-emerald-700' },
    PERMIT:       { icon: 'text-blue-600 bg-blue-50 border-blue-200/50',         glow: 'hover:shadow-[0_12px_40px_rgba(59,130,246,0.12)]',  section: 'text-blue-700' },
    SHIFT_CHANGE: { icon: 'text-cyan-600 bg-cyan-50 border-cyan-200/50',         glow: 'hover:shadow-[0_12px_40px_rgba(6,182,212,0.12)]',   section: 'text-cyan-700' },
    OVERTIME:     { icon: 'text-amber-600 bg-amber-50 border-amber-200/50',      glow: 'hover:shadow-[0_12px_40px_rgba(245,158,11,0.12)]',  section: 'text-amber-700' },
    ADVANCE:      { icon: 'text-violet-600 bg-violet-50 border-violet-200/50',   glow: 'hover:shadow-[0_12px_40px_rgba(139,92,246,0.12)]',  section: 'text-violet-700' },
    CERTIFICATE:  { icon: 'text-indigo-600 bg-indigo-50 border-indigo-200/50',   glow: 'hover:shadow-[0_12px_40px_rgba(99,102,241,0.12)]',  section: 'text-indigo-700' },
    DISABILITY:   { icon: 'text-red-600 bg-red-50 border-red-200/50',           glow: 'hover:shadow-[0_12px_40px_rgba(239,68,68,0.14)]',   section: 'text-red-700' },
};

const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
const RequestCard = memo(({ req, onApprove, onReject, canApprove = false }) => {
    const typeConf  = REQUEST_TYPES[req.type]   || { label: req.type,   color: 'bg-slate-100 text-slate-700', border: 'border-slate-200' };
    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const typeColor = TYPE_COLORS[req.type] || { icon: 'text-slate-600 bg-slate-50 border-slate-200', glow: '' };
    const isDisabilityUrgent = req.type === 'DISABILITY' && req.status === 'PENDING';

    return (
        <div className={`rounded-[2.5rem] border bg-white/60 backdrop-blur-2xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:-translate-y-1 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden group transform-gpu
            ${isDisabilityUrgent ? 'border-red-300 shadow-[0_8px_30px_rgba(239,68,68,0.10)] hover:shadow-[0_16px_48px_rgba(239,68,68,0.18)]' : `border-white/80 ${typeColor.glow}`}`}>

            {/* Header */}
            <div className="p-5 sm:p-6 flex items-start gap-4">
                <div className={`w-11 h-11 rounded-[1.4rem] flex items-center justify-center flex-shrink-0 border ${typeColor.icon}`}>
                    <TypeIcon size={20} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-xl border ${statConf.color} ${statConf.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {statConf.label}
                        </span>
                        {isDisabilityUrgent && (
                            <span className="flex items-center gap-1 text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-xl animate-pulse">
                                <AlertTriangle size={10} strokeWidth={2.5} /> URGENTE
                            </span>
                        )}
                        {req.current_level && req.status === 'PENDING' && req.type !== 'DISABILITY' && (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl">
                                Nivel {req.current_level}/{req.type === 'SHIFT_CHANGE' ? 2 : 3}
                            </span>
                        )}
                    </div>
                    {req.employee && (
                        <p className="text-[14px] font-semibold text-slate-800 flex items-center gap-1.5 leading-tight">
                            <User size={12} className="text-slate-400 flex-shrink-0" />
                            {req.employee.name}
                        </p>
                    )}
                    <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
                        <Calendar size={10} className="flex-shrink-0" />
                        {formatDate(req.created_at)}
                    </p>
                </div>
            </div>

            {/* Body */}
            <div className="px-5 sm:px-6 pb-4 border-t border-white/60 pt-4 space-y-3">
                {req.type === 'SHIFT_CHANGE' && (() => {
                    const meta = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
                    return (
                        <div className="space-y-2">
                            {meta.targetEmployeeName && (
                                <p className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5">
                                    <RefreshCw size={11} className="text-cyan-500" />
                                    {req.employee?.name} ↔ {meta.targetEmployeeName}
                                </p>
                            )}
                            {meta.date && (
                                <p className="text-[11px] text-slate-500 font-medium">
                                    Fecha: {new Date(meta.date + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: '2-digit', month: 'long' })}
                                </p>
                            )}
                            {(meta.myShift || meta.targetShift) && (
                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <div className="bg-white/70 border border-white/80 rounded-2xl p-2.5">
                                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                                            Turno de {req.employee?.name?.split(' ')[0]}
                                        </p>
                                        <p className="text-[11px] font-black text-slate-700">{meta.myShift || '—'}</p>
                                    </div>
                                    <div className="bg-cyan-50/80 border border-cyan-200/60 rounded-2xl p-2.5">
                                        <p className="text-[8px] font-black text-cyan-600 uppercase tracking-widest mb-0.5">
                                            Turno de {meta.targetEmployeeName?.split(' ')[0]}
                                        </p>
                                        <p className="text-[11px] font-black text-slate-700">{meta.targetShift || '—'}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}
                {req.type === 'DISABILITY' && (() => {
                    const meta = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
                    return (
                        <div className="space-y-2">
                            {meta.startDate && (
                                <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-red-50/80 border border-red-200/70">
                                    <Stethoscope size={14} className="text-red-500 flex-shrink-0" strokeWidth={2} />
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mb-0.5">Período de Incapacidad</p>
                                        <p className="text-[13px] font-bold text-red-700">
                                            {new Date(meta.startDate + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: '2-digit', month: 'long' })}
                                            {meta.endDate && meta.endDate !== meta.startDate && (
                                                <> — {new Date(meta.endDate + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: '2-digit', month: 'long' })}</>
                                            )}
                                        </p>
                                        <p className="text-[11px] text-red-500 font-medium mt-0.5">
                                            {meta.days
                                                ? `${meta.days} día${meta.days != 1 ? 's' : ''}`
                                                : meta.startDate && meta.endDate
                                                    ? `${Math.max(1, Math.round((new Date(meta.endDate + 'T00:00:00') - new Date(meta.startDate + 'T00:00:00')) / 86400000) + 1)} días`
                                                    : null
                                            }
                                            {Number(meta.days) > 3 && <span className="ml-1.5 text-amber-600 font-black">— Requiere boleta ISSS</span>}
                                        </p>
                                    </div>
                                </div>
                            )}
                            {meta.docUrl && (
                                <a href={meta.docUrl} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-white/70 border border-white/80 text-[12px] font-bold text-slate-600 hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all group/link">
                                    <FileImage size={14} className="group-hover/link:text-[#007AFF] transition-colors" strokeWidth={2} />
                                    {meta.docName || 'Ver certificado / boleta ISSS adjunta'}
                                </a>
                            )}
                            {!meta.docUrl && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-amber-50/80 border border-amber-200/70">
                                    <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" strokeWidth={2} />
                                    <p className="text-[11px] text-amber-700 font-medium">Sin certificado adjunto — el empleado puede adjuntarlo o presentarlo físicamente.</p>
                                </div>
                            )}
                        </div>
                    );
                })()}
                {req.note && (
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Motivo del empleado</p>
                        <p className="text-[13px] text-slate-700 bg-white/70 rounded-2xl p-3 border border-white/80">{req.note}</p>
                    </div>
                )}
                {req.approver_note && (
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Tu nota</p>
                        <p className={`text-[13px] rounded-2xl p-3 border ${req.status === 'APPROVED' ? 'bg-emerald-50/80 text-emerald-800 border-emerald-200/60' : 'bg-red-50/80 text-red-800 border-red-200/60'}`}>
                            {req.approver_note}
                        </p>
                    </div>
                )}
                {req.approvals && req.approvals.length > 0 && (
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Historial de Aprobaciones</p>
                        <div className="space-y-2">
                            {req.approvals.map((ap, i) => (
                                <div key={i} className="flex items-start gap-2 bg-emerald-50/80 border border-emerald-200/60 rounded-2xl p-2.5">
                                    <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                                    <div>
                                        <p className="text-[10px] font-black text-emerald-700">Nivel {ap.level} aprobado</p>
                                        {ap.approverNote && <p className="text-[11px] text-slate-600 mt-0.5">"{ap.approverNote}"</p>}
                                        <p className="text-[10px] text-slate-400 mt-0.5">
                                            {new Date(ap.approvedAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {req.employee?.code && (
                    <p className="text-[11px] text-slate-400">Código: <span className="font-mono font-bold text-slate-600">{req.employee.code}</span></p>
                )}
            </div>

            {/* Actions */}
            {req.status === 'PENDING' && (
                <div className="px-5 sm:px-6 pb-5 flex items-center gap-2">
                    <button
                        onClick={() => onApprove(req)}
                        disabled={!canApprove}
                        className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-bold transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(16,185,129,0.3)]"
                    >
                        <Check size={14} strokeWidth={2.5} /> Aprobar
                    </button>
                    <button
                        onClick={() => onReject(req)}
                        disabled={!canApprove}
                        className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-[12px] font-bold transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(239,68,68,0.3)]"
                    >
                        <X size={14} strokeWidth={2.5} /> Rechazar
                    </button>
                </div>
            )}
        </div>
    );
});

// ─── Vista principal ───────────────────────────────────────────────────────────
const RequestsView = () => {
    const { user, isJefe, isSupervisor, rolePerms } = useAuth();
    const canApprove = rolePerms === 'ALL' || !!rolePerms?.['requests']?.can_approve;

    const requests       = useStaff(s => s.requests);
    const isLoadingReqs  = useStaff(s => s.isLoadingRequests);
    const fetchRequests  = useStaff(s => s.fetchRequests);
    const approveRequest = useStaff(s => s.approveRequest);
    const rejectRequest  = useStaff(s => s.rejectRequest);

    const [statusFilter,  setStatusFilter]  = useState('PENDING');
    const [isSearchMode,  setIsSearchMode]  = useState(false);
    const [rawSearch,     setRawSearch]     = useState('');
    const [actionModal,   setActionModal]   = useState(null);
    const [actionNote,    setActionNote]    = useState('');
    const [isActioning,   setIsActioning]   = useState(false);
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
        if (isSearchMode && searchInputRef.current) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [isSearchMode]);

    const pendingCount = requests.filter(r => {
        const myId = String(user?.id);
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && String(r.approver_id) !== myId) return false;
        return r.status === 'PENDING' && (!r.approver || String(r.approver?.id) === myId);
    }).length;

    // Base filter by status + search
    const baseFiltered = requests.filter(r => {
        const myId = String(user?.id);
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && String(r.approver_id) !== myId) return false;
        const assignedToMe  = !r.approver || String(r.approver?.id) === myId;
        const processedByMe = String(r.approver?.id) === myId;

        if (statusFilter === 'PENDING'  && !(r.status === 'PENDING'  && assignedToMe))  return false;
        if (statusFilter === 'APPROVED' && !(r.status === 'APPROVED' && processedByMe)) return false;
        if (statusFilter === 'REJECTED' && !(r.status === 'REJECTED' && processedByMe)) return false;

        if (rawSearch.trim()) {
            const q = rawSearch.trim().toLowerCase();
            if (!(r.employee?.name || '').toLowerCase().includes(q)) return false;
        }
        return true;
    });

    // Group by type
    const groupedByType = Object.entries(
        baseFiltered.reduce((acc, r) => {
            const t = r.type || 'OTHER';
            if (!acc[t]) acc[t] = [];
            acc[t].push(r);
            return acc;
        }, {})
    );

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
        <div className="flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">

            {/* Search mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left
                ${isSearchMode ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Buscar empleado..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[180px] sm:w-[280px] md:w-[400px] placeholder:text-slate-400 focus:ring-0"
                    value={rawSearch}
                    onChange={e => setRawSearch(e.target.value)}
                />
                {rawSearch && (
                    <button onClick={() => setRawSearch('')} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-95 shrink-0">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                )}
                <button
                    onClick={() => { setIsSearchMode(false); setRawSearch(''); }}
                    className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2"
                >
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {/* Normal mode: tabs + search button */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right
                ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[800px] opacity-100 pl-2 pr-2 md:pr-3 gap-1 md:gap-1.5'}`}>
                {STATUS_TABS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setStatusFilter(tab.key)}
                        className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${
                            statusFilter === tab.key
                                ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                        }`}
                    >
                        {tab.label}
                        {tab.key === 'PENDING' && pendingCount > 0 && (
                            <span className={`ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${statusFilter === 'PENDING' ? 'bg-slate-200 text-slate-700' : 'bg-red-100 text-red-600'}`}>
                                {pendingCount}
                            </span>
                        )}
                    </button>
                ))}

                {/* Divider */}
                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />

                {/* Search button */}
                <button
                    onClick={() => setIsSearchMode(true)}
                    className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu"
                >
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {rawSearch && (
                        <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />
                    )}
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={Inbox} title="Bandeja de Aprobaciones" filtersContent={filtersContent}>
            <div className="pt-32 md:pt-28 px-4 md:px-6 pb-8 space-y-8">

                {isLoadingReqs ? (
                    <div className="flex flex-col items-center justify-center py-28 gap-3 text-slate-400">
                        <Loader2 size={28} className="animate-spin text-[#007AFF]/60" strokeWidth={1.5} />
                        <span className="text-[13px] font-medium">Cargando solicitudes…</span>
                    </div>
                ) : baseFiltered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-28 gap-3">
                        <div className="w-16 h-16 rounded-[2rem] bg-white/60 backdrop-blur-xl border border-white/80 shadow-sm flex items-center justify-center mb-1">
                            <CheckCircle2 size={32} strokeWidth={1} className="text-emerald-400" />
                        </div>
                        <p className="text-[15px] font-bold text-slate-600">Todo al día</p>
                        <p className="text-[12px] text-slate-400 text-center max-w-[200px]">
                            {statusFilter === 'PENDING' ? 'No hay solicitudes pendientes de revisión.' : 'No hay solicitudes en esta categoría.'}
                        </p>
                    </div>
                ) : (
                    groupedByType.map(([type, cards]) => {
                        const TypeIcon  = TYPE_ICONS[type] || FileText;
                        const typeConf  = REQUEST_TYPES[type] || { label: type };
                        const typeColor = TYPE_COLORS[type] || { icon: 'text-slate-600 bg-slate-50 border-slate-200', section: 'text-slate-700' };
                        return (
                            <section key={type}>
                                {/* Section label */}
                                <div className="flex items-center gap-2 mb-4">
                                    <div className={`w-7 h-7 rounded-xl flex items-center justify-center border ${typeColor.icon}`}>
                                        <TypeIcon size={14} strokeWidth={2} />
                                    </div>
                                    <h3 className={`text-[11px] font-black uppercase tracking-widest ${typeColor.section}`}>
                                        {typeConf.label}
                                    </h3>
                                    <span className="text-[11px] font-bold text-slate-400">
                                        {cards.length} solicitud{cards.length !== 1 ? 'es' : ''}
                                    </span>
                                    <div className="flex-1 h-px bg-slate-200/60 ml-1" />
                                </div>

                                {/* Cards grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {cards.map(req => (
                                        <RequestCard
                                            key={req.id}
                                            req={req}
                                            onApprove={(r) => { setActionModal({ mode: 'approve', req: r }); setActionNote(''); }}
                                            onReject={(r)  => { setActionModal({ mode: 'reject',  req: r }); setActionNote(''); }}
                                            canApprove={canApprove}
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })
                )}
            </div>

            {/* Modal aprobar / rechazar */}
            {actionModal && ReactDOM.createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={() => !isActioning && setActionModal(null)} />
                    <div className="relative bg-white/80 backdrop-blur-2xl border border-white/80 rounded-[2.5rem] shadow-[0_32px_80px_rgba(0,0,0,0.15)] w-full max-w-md p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">

                        <div className={`w-14 h-14 rounded-[1.75rem] flex items-center justify-center mx-auto mb-4 border ${actionModal.mode === 'approve' ? 'bg-emerald-50 border-emerald-200/60 shadow-[0_6px_20px_rgba(16,185,129,0.15)]' : 'bg-red-50 border-red-200/60 shadow-[0_6px_20px_rgba(239,68,68,0.15)]'}`}>
                            {actionModal.mode === 'approve'
                                ? <CheckCircle2 size={26} className="text-emerald-600" strokeWidth={2} />
                                : <XCircle      size={26} className="text-red-600"     strokeWidth={2} />
                            }
                        </div>

                        <h3 className="text-[18px] font-bold text-slate-800 text-center mb-1">
                            {actionModal.mode === 'approve' ? 'Aprobar Solicitud' : 'Rechazar Solicitud'}
                        </h3>
                        <p className="text-[12px] text-slate-400 text-center mb-5">
                            {REQUEST_TYPES[actionModal.req.type]?.label} · {actionModal.req.employee?.name}
                        </p>

                        <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                            Nota para el empleado
                            {actionModal.mode === 'reject' && <span className="text-red-400 ml-1">*</span>}
                        </label>
                        <textarea
                            value={actionNote}
                            onChange={e => setActionNote(e.target.value)}
                            rows={3}
                            placeholder={actionModal.mode === 'approve' ? 'Opcional: agrega un comentario...' : 'Explica el motivo del rechazo...'}
                            disabled={isActioning}
                            className="w-full px-4 py-3 rounded-[1.5rem] border border-white/80 bg-white/60 backdrop-blur-md text-[13px] text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/25 focus:border-[#007AFF]/40 resize-none transition-all disabled:opacity-50"
                        />

                        <div className="flex items-center gap-2 mt-4">
                            <button
                                onClick={() => !isActioning && setActionModal(null)}
                                disabled={isActioning}
                                className="flex-1 py-3 rounded-2xl border border-white/80 bg-white/60 text-slate-500 text-[13px] font-medium hover:bg-white/80 transition-all disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmAction}
                                disabled={!canApprove || isActioning || (actionModal.mode === 'reject' && !actionNote.trim())}
                                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-[13px] font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 ${
                                    actionModal.mode === 'approve'
                                        ? 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_4px_16px_rgba(16,185,129,0.3)] hover:shadow-[0_8px_24px_rgba(16,185,129,0.4)]'
                                        : 'bg-red-500 hover:bg-red-600 shadow-[0_4px_16px_rgba(239,68,68,0.3)] hover:shadow-[0_8px_24px_rgba(239,68,68,0.4)]'
                                }`}
                            >
                                {isActioning
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : actionModal.mode === 'approve'
                                        ? <><Check size={14} strokeWidth={2.5} /> Aprobar</>
                                        : <><X     size={14} strokeWidth={2.5} /> Rechazar</>
                                }
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
