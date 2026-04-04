import React, { useState, useEffect, useCallback, memo } from 'react';
import {
    Inbox, Check, X, ChevronDown, ChevronUp,
    User, Calendar, Loader2,
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Coffee,
    CheckCircle2, XCircle,
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
};

const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
const RequestCard = memo(({ req, userId, onApprove, onReject }) => {
    const [expanded, setExpanded] = useState(false);
    const typeConf = REQUEST_TYPES[req.type]  || { label: req.type,   color: 'bg-slate-100 text-slate-700', border: 'border-slate-200' };
    const statConf = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
    const TypeIcon = TYPE_ICONS[req.type] || FileText;

    return (
        <div className={`rounded-[2rem] border bg-white/70 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 overflow-hidden ${typeConf.border}`}>
            <div className="p-5 flex items-start gap-4">
                <div className={`w-10 h-10 rounded-[1.25rem] flex items-center justify-center flex-shrink-0 ${typeConf.color}`}>
                    <TypeIcon size={18} strokeWidth={1.8} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-md border ${typeConf.color} ${typeConf.border}`}>
                            {typeConf.label}
                        </span>
                        <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${statConf.color} ${statConf.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {statConf.label}
                        </span>
                    </div>

                    {req.employee && (
                        <p className="text-[14px] font-semibold text-slate-800 flex items-center gap-1.5">
                            <User size={12} className="text-slate-400 flex-shrink-0" />
                            {req.employee.name}
                        </p>
                    )}
                    <p className="text-[12px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <Calendar size={11} className="flex-shrink-0" />
                        {formatDate(req.created_at)}
                    </p>
                </div>

                <button
                    onClick={() => setExpanded(v => !v)}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all flex-shrink-0"
                >
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>

            {req.note && !expanded && (
                <div className="px-5 pb-4">
                    <p className="text-[12px] text-slate-500 line-clamp-2 italic">"{req.note}"</p>
                </div>
            )}

            {expanded && (
                <div className="px-5 pb-4 border-t border-slate-100/80 pt-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                    {req.note && (
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Motivo del empleado</p>
                            <p className="text-[13px] text-slate-700 bg-slate-50 rounded-xl p-3 border border-slate-100">{req.note}</p>
                        </div>
                    )}
                    {req.approver_note && (
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Tu nota</p>
                            <p className={`text-[13px] rounded-xl p-3 border ${req.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-red-50 text-red-800 border-red-100'}`}>
                                {req.approver_note}
                            </p>
                        </div>
                    )}
                    {req.employee?.code && (
                        <p className="text-[11px] text-slate-400">Código: <span className="font-mono font-bold text-slate-600">{req.employee.code}</span></p>
                    )}
                </div>
            )}

            {req.status === 'PENDING' && (
                <div className="px-5 pb-5 flex items-center gap-2">
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
                </div>
            )}
        </div>
    );
});

// ─── Vista principal (solo admin) ─────────────────────────────────────────────
const RequestsView = () => {
    const { user } = useAuth();

    const requests       = useStaff(s => s.requests);
    const isLoadingReqs  = useStaff(s => s.isLoadingRequests);
    const fetchRequests  = useStaff(s => s.fetchRequests);
    const approveRequest = useStaff(s => s.approveRequest);
    const rejectRequest  = useStaff(s => s.rejectRequest);

    const [statusFilter, setStatusFilter] = useState('PENDING');
    const [actionModal, setActionModal]   = useState(null); // { mode, req }
    const [actionNote, setActionNote]     = useState('');
    const [isActioning, setIsActioning]   = useState(false);

    useEffect(() => { fetchRequests(); }, []);

    // PENDING: asignadas a mí o sin aprobador
    // APPROVED/REJECTED: procesadas por mí
    // ALL: todas
    const filtered = requests.filter(r => {
        const myId = String(user?.id);
        const assignedToMe = !r.approver || String(r.approver?.id) === myId;
        const processedByMe = String(r.approver?.id) === myId;

        if (statusFilter === 'PENDING')  return r.status === 'PENDING'  && assignedToMe;
        if (statusFilter === 'APPROVED') return r.status === 'APPROVED' && processedByMe;
        if (statusFilter === 'REJECTED') return r.status === 'REJECTED' && processedByMe;
        return true; // ALL
    });

    const pendingCount = requests.filter(r => {
        const myId = String(user?.id);
        return r.status === 'PENDING' && (!r.approver || String(r.approver?.id) === myId);
    }).length;

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

    const TABS = [
        { key: 'PENDING',  label: 'Pendientes' },
        { key: 'APPROVED', label: 'Aprobadas'  },
        { key: 'REJECTED', label: 'Rechazadas' },
        { key: 'ALL',      label: 'Todas'      },
    ];

    const filtersContent = (
        <div className="flex items-center bg-white/70 backdrop-blur-md border border-white/80 rounded-[1.5rem] p-1 shadow-sm gap-1">
            {TABS.map(tab => (
                <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={`relative px-3 py-1.5 rounded-[1.2rem] text-[12px] font-bold transition-all duration-200 ${
                        statusFilter === tab.key ? 'bg-[#007AFF] text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                    }`}
                >
                    {tab.label}
                    {tab.key === 'PENDING' && pendingCount > 0 && (
                        <span className={`ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full ${statusFilter === 'PENDING' ? 'bg-white/30 text-white' : 'bg-red-100 text-red-600'}`}>
                            {pendingCount}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );

    return (
        <GlassViewLayout icon={Inbox} title="Bandeja de Aprobaciones" filtersContent={filtersContent}>
            <div className="pt-32 md:pt-28 px-4 md:px-6 pb-8 space-y-4">

                {isLoadingReqs ? (
                    <div className="flex items-center justify-center py-24 gap-3 text-slate-400">
                        <Loader2 size={22} className="animate-spin" />
                        <span className="text-[13px] font-medium">Cargando solicitudes…</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
                        <CheckCircle2 size={48} strokeWidth={1} className="text-emerald-300" />
                        <p className="text-[15px] font-bold text-slate-600">Todo al día</p>
                        <p className="text-[12px] text-slate-400">
                            {statusFilter === 'PENDING' ? 'No hay solicitudes pendientes de revisión.' : 'No hay solicitudes en esta categoría.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {filtered.map(req => (
                            <RequestCard
                                key={req.id}
                                req={req}
                                userId={user?.id}
                                onApprove={(r) => { setActionModal({ mode: 'approve', req: r }); setActionNote(''); }}
                                onReject={(r)  => { setActionModal({ mode: 'reject',  req: r }); setActionNote(''); }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Modal aprobar / rechazar */}
            {actionModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => !isActioning && setActionModal(null)} />
                    <div className="relative bg-white/95 backdrop-blur-xl border border-white/80 rounded-[2rem] shadow-[0_32px_80px_rgba(0,0,0,0.18)] w-full max-w-md p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className={`w-12 h-12 rounded-[1.5rem] flex items-center justify-center mx-auto mb-4 ${actionModal.mode === 'approve' ? 'bg-emerald-100' : 'bg-red-100'}`}>
                            {actionModal.mode === 'approve'
                                ? <CheckCircle2 size={24} className="text-emerald-600" strokeWidth={2} />
                                : <XCircle     size={24} className="text-red-600"     strokeWidth={2} />
                            }
                        </div>

                        <h3 className="text-[17px] font-bold text-slate-800 text-center mb-1">
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
                            className="w-full px-4 py-3 rounded-[1.25rem] border border-slate-200 bg-white text-[13px] text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF]/50 resize-none transition-all disabled:opacity-50"
                        />

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
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${actionModal.mode === 'approve' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'}`}
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
                </div>
            )}
        </GlassViewLayout>
    );
};

export default RequestsView;
