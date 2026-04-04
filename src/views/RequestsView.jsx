import React, { useState, useEffect, useCallback, memo } from 'react';
import {
    ClipboardList, Plus, Check, X, Clock, ChevronDown, ChevronUp,
    User, Building2, MessageSquare, Calendar, Loader2, AlertTriangle,
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Coffee,
    CheckCircle2, XCircle, Ban, Filter
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import GlassViewLayout from '../components/GlassViewLayout';
import { REQUEST_TYPES, REQUEST_STATUS } from '../store/slices/requestsSlice';

// ─── Icono por tipo ────────────────────────────────────────────────────────────
const TYPE_ICONS = {
    VACATION:    Palmtree,
    PERMIT:      FileText,
    SHIFT_CHANGE: RefreshCw,
    OVERTIME:    Coffee,
    ADVANCE:     DollarSign,
    CERTIFICATE: FileCheck,
};

const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ─── Tarjeta de solicitud ──────────────────────────────────────────────────────
const RequestCard = memo(({ req, isAdmin, currentUserId, onApprove, onReject, onCancel }) => {
    const [expanded, setExpanded] = useState(false);

    const typeConf  = REQUEST_TYPES[req.type]  || { label: req.type,   color: 'bg-slate-100 text-slate-700', border: 'border-slate-200' };
    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const isPending = req.status === 'PENDING';
    const isOwn     = String(req.employee?.id) === String(currentUserId);

    return (
        <div className={`rounded-[2rem] border bg-white/60 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 overflow-hidden ${typeConf.border}`}>
            {/* Header */}
            <div className="p-5 flex items-start gap-4">
                <div className={`w-10 h-10 rounded-[1.25rem] flex items-center justify-center flex-shrink-0 ${typeConf.color}`}>
                    <TypeIcon size={18} strokeWidth={1.8} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-md border ${typeConf.color} ${typeConf.border}`}>
                            {typeConf.label}
                        </span>
                        <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${statConf.color} ${statConf.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {statConf.label}
                        </span>
                    </div>

                    {isAdmin && req.employee && (
                        <p className="text-[13px] font-semibold text-slate-800 truncate flex items-center gap-1.5">
                            <User size={12} className="text-slate-400 flex-shrink-0" />
                            {req.employee.name}
                        </p>
                    )}

                    <p className="text-[12px] text-slate-500 mt-0.5 flex items-center gap-1">
                        <Calendar size={11} className="flex-shrink-0" />
                        {formatDate(req.created_at)}
                    </p>
                </div>

                <button
                    onClick={() => setExpanded(v => !v)}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                >
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>

            {/* Nota breve */}
            {req.note && !expanded && (
                <div className="px-5 pb-4">
                    <p className="text-[12px] text-slate-600 line-clamp-2">{req.note}</p>
                </div>
            )}

            {/* Detalle expandido */}
            {expanded && (
                <div className="px-5 pb-4 border-t border-slate-100 pt-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                    {req.note && (
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Motivo / Descripción</p>
                            <p className="text-[13px] text-slate-700 bg-slate-50 rounded-xl p-3 border border-slate-100">{req.note}</p>
                        </div>
                    )}

                    {req.approver_note && (
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                                Nota del {req.status === 'APPROVED' ? 'Aprobador' : 'Revisor'}
                            </p>
                            <p className={`text-[13px] rounded-xl p-3 border ${
                                req.status === 'APPROVED'
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                                    : 'bg-red-50 text-red-800 border-red-100'
                            }`}>{req.approver_note}</p>
                        </div>
                    )}

                    {req.approver && (
                        <p className="text-[11px] text-slate-400 flex items-center gap-1">
                            <User size={11} />
                            Revisado por <span className="font-semibold text-slate-600">{req.approver.name}</span>
                            {req.updated_at && <> · {formatDate(req.updated_at)}</>}
                        </p>
                    )}

                    {isAdmin && req.employee?.branch_id && (
                        <p className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Building2 size={11} />
                            Empleado ID <span className="font-mono text-slate-500">{req.employee.code}</span>
                        </p>
                    )}
                </div>
            )}

            {/* Acciones */}
            {(isAdmin && isPending) || (isOwn && isPending) ? (
                <div className="px-5 pb-4 flex items-center gap-2 flex-wrap">
                    {isAdmin && isPending && (
                        <>
                            <button
                                onClick={() => onApprove(req)}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-bold transition-all active:scale-95 shadow-sm"
                            >
                                <Check size={14} strokeWidth={2.5} /> Aprobar
                            </button>
                            <button
                                onClick={() => onReject(req)}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-[12px] font-bold transition-all active:scale-95 shadow-sm"
                            >
                                <X size={14} strokeWidth={2.5} /> Rechazar
                            </button>
                        </>
                    )}
                    {isOwn && isPending && (
                        <button
                            onClick={() => onCancel(req.id)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 text-[12px] font-medium transition-all active:scale-95"
                        >
                            <Ban size={13} strokeWidth={2} /> Cancelar
                        </button>
                    )}
                </div>
            ) : null}
        </div>
    );
});

// ─── Vista principal ───────────────────────────────────────────────────────────
const RequestsView = () => {
    const { user, isAdmin } = useAuth();

    const requests        = useStaff(s => s.requests);
    const isLoadingReqs   = useStaff(s => s.isLoadingRequests);
    const fetchRequests   = useStaff(s => s.fetchRequests);
    const createRequest   = useStaff(s => s.createRequest);
    const approveRequest  = useStaff(s => s.approveRequest);
    const rejectRequest   = useStaff(s => s.rejectRequest);
    const cancelRequest   = useStaff(s => s.cancelRequest);

    const [statusFilter, setStatusFilter] = useState('PENDING');
    const [showForm, setShowForm]         = useState(false);

    // New request form state
    const [formType, setFormType]     = useState('VACATION');
    const [formNote, setFormNote]     = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Approve/Reject modal state
    const [actionModal, setActionModal] = useState(null); // { mode: 'approve'|'reject', req }
    const [actionNote, setActionNote]   = useState('');
    const [isActioning, setIsActioning] = useState(false);

    useEffect(() => {
        if (isAdmin) {
            fetchRequests();
        } else if (user?.id) {
            fetchRequests(user.id);
        }
    }, [isAdmin, user?.id]);

    const filtered = requests.filter(r => {
        if (statusFilter === 'ALL') return true;
        return r.status === statusFilter;
    });

    const counts = {
        PENDING:  requests.filter(r => r.status === 'PENDING').length,
        APPROVED: requests.filter(r => r.status === 'APPROVED').length,
        REJECTED: requests.filter(r => r.status === 'REJECTED').length,
        ALL:      requests.length,
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!formNote.trim()) return;
        setIsSubmitting(true);
        const result = await createRequest(user.id, formType, {}, formNote.trim());
        setIsSubmitting(false);
        if (result) {
            useToastStore.getState().showToast('Solicitud Enviada', `Tu solicitud de ${REQUEST_TYPES[formType]?.label} fue registrada.`, 'success');
            setFormNote('');
            setShowForm(false);
            setStatusFilter('PENDING');
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo crear la solicitud. Intenta de nuevo.', 'error');
        }
    };

    const handleApprove = useCallback((req) => {
        setActionModal({ mode: 'approve', req });
        setActionNote('');
    }, []);

    const handleReject = useCallback((req) => {
        setActionModal({ mode: 'reject', req });
        setActionNote('');
    }, []);

    const handleConfirmAction = async () => {
        if (!actionModal) return;
        if (actionModal.mode === 'reject' && !actionNote.trim()) return;
        setIsActioning(true);
        const ok = actionModal.mode === 'approve'
            ? await approveRequest(actionModal.req.id, user.id, actionNote.trim())
            : await rejectRequest(actionModal.req.id, user.id, actionNote.trim());
        setIsActioning(false);
        if (ok) {
            const label = actionModal.mode === 'approve' ? 'aprobada' : 'rechazada';
            useToastStore.getState().showToast('Listo', `Solicitud ${label}.`, 'success');
            setActionModal(null);
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo procesar la acción.', 'error');
        }
    };

    const handleCancel = useCallback(async (reqId) => {
        const ok = await cancelRequest(reqId);
        if (ok) {
            useToastStore.getState().showToast('Cancelada', 'Tu solicitud fue cancelada.', 'success');
        }
    }, [cancelRequest]);

    // ── Filtros en header ────────────────────────────────────────────────────
    const TAB_OPTIONS = isAdmin
        ? [
            { key: 'PENDING',  label: 'Pendientes' },
            { key: 'APPROVED', label: 'Aprobadas'  },
            { key: 'REJECTED', label: 'Rechazadas' },
            { key: 'ALL',      label: 'Todas'      },
          ]
        : [
            { key: 'PENDING',   label: 'Pendientes'  },
            { key: 'APPROVED',  label: 'Aprobadas'   },
            { key: 'REJECTED',  label: 'Rechazadas'  },
            { key: 'CANCELLED', label: 'Canceladas'  },
          ];

    if (!isAdmin) {
        counts.CANCELLED = requests.filter(r => r.status === 'CANCELLED').length;
    }

    const filtersContent = (
        <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-white/70 backdrop-blur-md border border-white/80 rounded-[1.5rem] p-1 shadow-sm gap-1">
                {TAB_OPTIONS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setStatusFilter(tab.key)}
                        className={`px-3 py-1.5 rounded-[1.2rem] text-[12px] font-bold transition-all duration-200 relative ${
                            statusFilter === tab.key
                                ? 'bg-[#007AFF] text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                        }`}
                    >
                        {tab.label}
                        {counts[tab.key] > 0 && (
                            <span className={`ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                                statusFilter === tab.key ? 'bg-white/30 text-white' : 'bg-slate-100 text-slate-500'
                            }`}>{counts[tab.key]}</span>
                        )}
                    </button>
                ))}
            </div>

            {!isAdmin && (
                <button
                    onClick={() => setShowForm(v => !v)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-[1.5rem] bg-[#007AFF] hover:bg-[#0066DD] text-white text-[13px] font-bold shadow-[0_4px_14px_rgba(0,122,255,0.3)] hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] transition-all active:scale-95"
                >
                    <Plus size={16} strokeWidth={2.5} />
                    Nueva Solicitud
                </button>
            )}
        </div>
    );

    return (
        <GlassViewLayout icon={ClipboardList} title="Solicitudes" filtersContent={filtersContent}>

            <div className="pt-32 md:pt-28 px-4 md:px-6 pb-8 space-y-4">

                {/* ── Formulario nueva solicitud (empleado) ──────────────────── */}
                {!isAdmin && showForm && (
                    <div className="rounded-[2rem] border border-[#007AFF]/20 bg-white/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,122,255,0.08)] p-6 animate-in slide-in-from-top-4 duration-300">
                        <h3 className="text-[15px] font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <Plus size={16} className="text-[#007AFF]" /> Nueva Solicitud
                        </h3>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                                    Tipo de Solicitud
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {Object.entries(REQUEST_TYPES).map(([key, conf]) => {
                                        const Icon = TYPE_ICONS[key] || FileText;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => setFormType(key)}
                                                className={`flex items-center gap-2 px-3 py-2.5 rounded-[1.25rem] border text-[12px] font-semibold transition-all ${
                                                    formType === key
                                                        ? `${conf.color} ${conf.border} shadow-sm`
                                                        : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                                }`}
                                            >
                                                <Icon size={14} strokeWidth={2} />
                                                {conf.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                                    Descripción / Motivo <span className="text-red-400">*</span>
                                </label>
                                <textarea
                                    value={formNote}
                                    onChange={e => setFormNote(e.target.value)}
                                    rows={3}
                                    placeholder="Describe tu solicitud con detalle..."
                                    className="w-full px-4 py-3 rounded-[1.25rem] border border-slate-200 bg-white text-[13px] text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF]/50 resize-none transition-all"
                                />
                            </div>

                            <div className="flex items-center gap-2 justify-end">
                                <button
                                    type="button"
                                    onClick={() => { setShowForm(false); setFormNote(''); }}
                                    className="px-4 py-2 rounded-xl border border-slate-200 text-slate-500 text-[13px] font-medium hover:bg-slate-50 transition-all"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={!formNote.trim() || isSubmitting}
                                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#007AFF] hover:bg-[#0066DD] text-white text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                                >
                                    {isSubmitting
                                        ? <><Loader2 size={14} className="animate-spin" /> Enviando…</>
                                        : <><Check size={14} strokeWidth={2.5} /> Enviar Solicitud</>
                                    }
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* ── Lista ──────────────────────────────────────────────────── */}
                {isLoadingReqs ? (
                    <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                        <Loader2 size={22} className="animate-spin" />
                        <span className="text-[13px] font-medium">Cargando solicitudes…</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                        {statusFilter === 'PENDING'
                            ? <CheckCircle2 size={40} strokeWidth={1.2} className="text-emerald-300" />
                            : <ClipboardList size={40} strokeWidth={1.2} />
                        }
                        <p className="text-[14px] font-semibold">
                            {statusFilter === 'PENDING' ? '¡Sin solicitudes pendientes!' : 'No hay solicitudes aquí'}
                        </p>
                        <p className="text-[12px] text-slate-300">
                            {statusFilter === 'PENDING'
                                ? 'Todo al día.'
                                : 'Cambia el filtro para ver otras solicitudes.'
                            }
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {filtered.map(req => (
                            <RequestCard
                                key={req.id}
                                req={req}
                                isAdmin={isAdmin}
                                currentUserId={user?.id}
                                onApprove={handleApprove}
                                onReject={handleReject}
                                onCancel={handleCancel}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* ── Modal Aprobar / Rechazar ────────────────────────────────────── */}
            {actionModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                        onClick={() => !isActioning && setActionModal(null)}
                    />
                    <div className="relative bg-white/95 backdrop-blur-xl border border-white/80 rounded-[2rem] shadow-[0_32px_80px_rgba(0,0,0,0.18)] w-full max-w-md p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className={`w-12 h-12 rounded-[1.5rem] flex items-center justify-center mx-auto mb-4 ${
                            actionModal.mode === 'approve' ? 'bg-emerald-100' : 'bg-red-100'
                        }`}>
                            {actionModal.mode === 'approve'
                                ? <CheckCircle2 size={24} className="text-emerald-600" strokeWidth={2} />
                                : <XCircle size={24} className="text-red-600" strokeWidth={2} />
                            }
                        </div>

                        <h3 className="text-[17px] font-bold text-slate-800 text-center mb-1">
                            {actionModal.mode === 'approve' ? 'Aprobar Solicitud' : 'Rechazar Solicitud'}
                        </h3>
                        <p className="text-[12px] text-slate-400 text-center mb-5">
                            {REQUEST_TYPES[actionModal.req.type]?.label} · {actionModal.req.employee?.name}
                        </p>

                        <div>
                            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                                Nota para el empleado
                                {actionModal.mode === 'reject' && <span className="text-red-400 ml-1">*</span>}
                            </label>
                            <textarea
                                value={actionNote}
                                onChange={e => setActionNote(e.target.value)}
                                rows={3}
                                placeholder={
                                    actionModal.mode === 'approve'
                                        ? 'Opcional: agrega un comentario...'
                                        : 'Explica el motivo del rechazo...'
                                }
                                disabled={isActioning}
                                className="w-full px-4 py-3 rounded-[1.25rem] border border-slate-200 bg-white text-[13px] text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF]/50 resize-none transition-all disabled:opacity-50"
                            />
                        </div>

                        <div className="flex items-center gap-2 mt-4">
                            <button
                                onClick={() => !isActioning && setActionModal(null)}
                                disabled={isActioning}
                                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-[13px] font-medium hover:bg-slate-50 transition-all disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmAction}
                                disabled={isActioning || (actionModal.mode === 'reject' && !actionNote.trim())}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                                    actionModal.mode === 'approve'
                                        ? 'bg-emerald-500 hover:bg-emerald-600'
                                        : 'bg-red-500 hover:bg-red-600'
                                }`}
                            >
                                {isActioning
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : actionModal.mode === 'approve'
                                        ? <><Check size={14} strokeWidth={2.5} /> Aprobar</>
                                        : <><X size={14} strokeWidth={2.5} /> Rechazar</>
                                }
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </GlassViewLayout>
    );
};

export default RequestsView;
