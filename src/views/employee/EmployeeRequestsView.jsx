import React, { useState, useCallback, useEffect, memo } from 'react';
import {
    ClipboardList, Plus, Loader2, X, Palmtree, FileText, RefreshCw,
    Coffee, DollarSign, FileCheck, CheckCircle2, Send, AlertCircle
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';
import { REQUEST_TYPES, REQUEST_STATUS } from '../../store/slices/requestsSlice';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import GlassViewLayout from '../../components/GlassViewLayout';

// ─────────────────────────────────────────────────────────────────────────────
// Card de solicitud
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_ICONS = {
    VACATION: Palmtree, PERMIT: FileText, SHIFT_CHANGE: RefreshCw,
    OVERTIME: Coffee,   ADVANCE: DollarSign, CERTIFICATE: FileCheck,
};

const RequestCard = memo(({ req, onCancel }) => {
    const typeConf  = REQUEST_TYPES[req.type]    || { label: req.type,   color: 'bg-slate-100 text-slate-600', border: 'border-slate-200' };
    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const maxLevels = req.type === 'SHIFT_CHANGE' ? 1 : 3;

    const cardBg =
        req.status === 'PENDING'   ? 'border-[#007AFF]/30 shadow-[0_4px_20px_rgba(0,122,255,0.05)] bg-white/80 backdrop-blur-2xl' :
        req.status === 'APPROVED'  ? 'border-emerald-300/60 shadow-[0_4px_20px_rgba(16,185,129,0.06)] bg-emerald-50/30 backdrop-blur-2xl' :
        req.status === 'REJECTED'  ? 'border-red-300 shadow-[0_4px_20px_rgba(239,68,68,0.08)] bg-white/90 backdrop-blur-xl' :
        'border-white/60 opacity-75 bg-white/40 backdrop-blur-md hover:opacity-100';

    return (
        <div className={`p-6 rounded-[2.5rem] border flex flex-col gap-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group relative transform-gpu hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] ${cardBg}`}>

            {/* Cancelar (hover-reveal) */}
            {req.status === 'PENDING' && (
                <div className="absolute top-5 right-5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]">
                    <button
                        onClick={() => onCancel(req.id)}
                        className="p-2.5 text-red-400 bg-white/80 border border-red-50 shadow-sm hover:text-red-600 hover:bg-red-50 hover:border-red-200 hover:-translate-y-0.5 hover:shadow-md rounded-full transition-all duration-300 active:scale-95"
                        title="Cancelar solicitud"
                    >
                        <X size={14} strokeWidth={2.5} />
                    </button>
                </div>
            )}

            {/* Row 1: badges */}
            <div className="flex flex-wrap items-center gap-2 pr-10">
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border ${typeConf.color} ${typeConf.border}`}>
                    <TypeIcon size={11} strokeWidth={2} /> {typeConf.label}
                </span>
                <span className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border ${statConf.color} ${statConf.border}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} /> {statConf.label}
                </span>
                {req.status === 'PENDING' && req.current_level && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest text-[#007AFF] bg-[#007AFF]/10 border border-[#007AFF]/20">
                        Nivel {req.current_level} / {maxLevels}
                    </span>
                )}
            </div>

            {/* Row 2: nota */}
            {req.note && (
                <p className="text-slate-700 text-[14px] leading-relaxed font-medium line-clamp-2 whitespace-pre-wrap">
                    {req.note}
                </p>
            )}

            {/* Row 3: approver_note */}
            {req.approver_note && (
                <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-[12px] font-bold border ${
                    req.status === 'APPROVED' ? 'bg-emerald-50 border-emerald-200/60 text-emerald-700' :
                    req.status === 'REJECTED' ? 'bg-red-50 border-red-200/60 text-red-600' :
                    'bg-slate-50 border-slate-200/60 text-slate-600'
                }`}>
                    <AlertCircle size={13} className="flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                    <span>{req.approver_note}</span>
                </div>
            )}

            {/* Row 4: fecha */}
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {new Date(req.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
        </div>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Vista principal
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_OPTIONS = [
    { key: 'VACATION',     icon: Palmtree,   label: 'Vacaciones'   },
    { key: 'PERMIT',       icon: FileText,   label: 'Permiso'      },
    { key: 'SHIFT_CHANGE', icon: RefreshCw,  label: 'Cambio Turno' },
    { key: 'OVERTIME',     icon: Coffee,     label: 'Horas Extra'  },
    { key: 'ADVANCE',      icon: DollarSign, label: 'Anticipo'     },
    { key: 'CERTIFICATE',  icon: FileCheck,  label: 'Constancia'   },
];

const TABS = [
    { key: 'ALL',       label: 'Todas'      },
    { key: 'PENDING',   label: 'Pendientes' },
    { key: 'APPROVED',  label: 'Aprobadas'  },
    { key: 'REJECTED',  label: 'Rechazadas' },
    { key: 'CANCELLED', label: 'Canceladas' },
];

const TAB_COLORS = {
    PENDING:   'bg-[#007AFF]',
    APPROVED:  'bg-emerald-500',
    REJECTED:  'bg-red-500',
    CANCELLED: 'bg-slate-400',
};

const EmployeeRequestsView = () => {
    const { user } = useAuth();
    const { createRequest, cancelRequest, holidays } = useStaffStore();

    const [requests, setRequests]         = useState([]);
    const [isLoading, setIsLoading]       = useState(false);
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [formType, setFormType]         = useState('VACATION');
    const [formNote, setFormNote]         = useState('');
    const [payload, setPayload]           = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError]               = useState('');

    const load = useCallback(async () => {
        if (!user?.id) return;
        setIsLoading(true);
        const { data } = await supabase
            .from('approval_requests')
            .select('id, type, status, note, approver_note, created_at, current_level, metadata')
            .eq('employee_id', user.id)
            .order('created_at', { ascending: false });
        setRequests(data || []);
        setIsLoading(false);
    }, [user?.id]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const handler = () => load();
        window.addEventListener('requests-updated', handler);
        return () => window.removeEventListener('requests-updated', handler);
    }, [load]);

    const counts = {
        ALL:       requests.length,
        PENDING:   requests.filter(r => r.status === 'PENDING').length,
        APPROVED:  requests.filter(r => r.status === 'APPROVED').length,
        REJECTED:  requests.filter(r => r.status === 'REJECTED').length,
        CANCELLED: requests.filter(r => r.status === 'CANCELLED').length,
    };

    const filtered = statusFilter === 'ALL' ? requests : requests.filter(r => r.status === statusFilter);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!formNote.trim()) { setError('El motivo es obligatorio.'); return; }
        if (formType === 'VACATION' && (!payload.startDate || !payload.endDate)) {
            setError('Selecciona el período de vacaciones.'); return;
        }
        if ((formType === 'PERMIT' || formType === 'SHIFT_CHANGE') && !payload.date) {
            setError('Selecciona una fecha.'); return;
        }
        setIsSubmitting(true);
        const result = await createRequest(user.id, formType, payload, formNote.trim());
        setIsSubmitting(false);
        if (result) {
            useToastStore.getState().showToast('Enviada', `Solicitud de ${REQUEST_TYPES[formType]?.label} registrada.`, 'success');
            setFormNote(''); setPayload({}); setStatusFilter('PENDING');
            load();
        } else {
            setError('No se pudo crear la solicitud. Intenta de nuevo.');
        }
    };

    const handleCancel = async (id) => {
        await cancelRequest(id);
        load();
    };

    const renderFiltersContent = () => (
        <div className="flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu overflow-hidden animate-in fade-in slide-in-from-right-8 w-max max-w-full">
            <div className="flex items-center gap-1 md:gap-1.5 pl-2 pr-2 md:pr-3">
                {TABS.map(tab => {
                    const isActive = statusFilter === tab.key;
                    const count = counts[tab.key];
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setStatusFilter(tab.key)}
                            className={`relative px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${
                                isActive
                                    ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                    : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                            }`}
                        >
                            {tab.label}
                            {tab.key !== 'ALL' && count > 0 && (
                                <span className={`w-4 h-4 flex items-center justify-center text-[8px] font-black text-white rounded-full border-2 border-white shadow-sm ${TAB_COLORS[tab.key] || 'bg-slate-400'}`}>
                                    {count > 9 ? '9+' : count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const needsDate = formType === 'VACATION' || formType === 'PERMIT' || formType === 'SHIFT_CHANGE';

    return (
        <GlassViewLayout
            icon={ClipboardList}
            title="Mis Solicitudes"
            filtersContent={renderFiltersContent()}
            transparentBody={true}
            fixedScrollMode={true}
        >
            <div className="flex flex-col lg:flex-row items-start gap-6 md:gap-8 px-2 md:px-0 w-full h-full lg:h-[calc(100vh-230px)]">

                {/* ── PANEL IZQUIERDO: Formulario ── */}
                <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 group/panel transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] z-[50] transform-gpu">
                    <div className="bg-white/40 backdrop-blur-[30px] backdrop-saturate-[180%] border border-white/80 p-6 md:p-8 rounded-[2.5rem] shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.12),inset_0_2px_15px_rgba(255,255,255,0.7)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">

                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#007AFF] text-white shadow-sm">
                                <Plus size={16} strokeWidth={2.5} />
                            </div>
                            <h3 className="font-black text-slate-800 text-[15px] uppercase tracking-tight ml-1">Nueva Solicitud</h3>
                        </div>

                        {error && (
                            <div className="mb-5 bg-amber-50/80 backdrop-blur-sm border border-amber-200/60 text-amber-700 px-4 py-3 rounded-2xl text-[11px] font-bold shadow-[inset_0_1px_4px_rgba(255,255,255,0.5)] flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
                                <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                                <span className="leading-tight">{error}</span>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5 relative z-10">

                            {/* Selector de tipo */}
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">Tipo de Solicitud</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {TYPE_OPTIONS.map(({ key, icon: Icon, label }) => {
                                        const conf     = REQUEST_TYPES[key];
                                        const isActive = formType === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => { setFormType(key); setPayload({}); setError(''); }}
                                                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl border text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${
                                                    isActive
                                                        ? `bg-white ${conf.color} ${conf.border} shadow-sm scale-[1.02]`
                                                        : 'bg-white/50 border-white/60 text-slate-500 hover:bg-white hover:-translate-y-0.5 hover:shadow-sm'
                                                }`}
                                            >
                                                <Icon size={18} strokeWidth={1.8} />
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Fechas (solo si aplica) */}
                            {needsDate && (
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                        {formType === 'VACATION' ? 'Período de Vacaciones' :
                                         formType === 'PERMIT'   ? 'Días de Permiso' : 'Fecha del Cambio'}
                                    </label>
                                    {formType === 'VACATION' ? (
                                        <RangeDatePicker
                                            startDate={payload.startDate || ''} endDate={payload.endDate || ''}
                                            onRangeChange={(s, e) => setPayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                                            holidays={holidays} defaultDays={15} label="vacaciones"
                                        />
                                    ) : (
                                        <LiquidDatePicker
                                            value={payload.date || ''}
                                            onChange={v => setPayload(prev => ({ ...prev, date: v }))}
                                            placeholder="Seleccionar fecha" holidays={holidays}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Motivo */}
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                    Motivo / Descripción <span className="text-red-400">*</span>
                                </label>
                                <textarea
                                    value={formNote}
                                    onChange={e => { setFormNote(e.target.value); if (error) setError(''); }}
                                    rows={4}
                                    placeholder="Describe tu solicitud..."
                                    className={`w-full py-3.5 px-4 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] rounded-2xl text-[13px] outline-none font-medium text-slate-700 resize-none h-24 transition-all duration-300 placeholder-slate-400 placeholder:font-normal placeholder:tracking-normal leading-relaxed ${error && !formNote.trim() ? 'border-amber-300' : ''}`}
                                    disabled={isSubmitting}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full py-4 mt-2 active:scale-[0.98] text-white rounded-[1.25rem] font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 border-none bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {isSubmitting
                                    ? <><Loader2 size={16} className="animate-spin" /> Enviando...</>
                                    : <><Send size={16} strokeWidth={2.5} /> Enviar Solicitud</>
                                }
                            </button>
                        </form>
                    </div>
                </div>

                {/* ── PANEL DERECHO: Lista ── */}
                <div className="flex-1 flex flex-col min-w-0 w-full h-[100dvh] overflow-y-auto overscroll-contain pb-32 scrollbar-hide -mt-[140px] md:-mt-[190px] pt-[140px] md:pt-[190px] pointer-events-auto">
                    <div className="space-y-5 flex-1 pt-4 px-3 md:px-4">
                        {isLoading ? (
                            <div className="flex justify-center py-16 text-slate-400 gap-2">
                                <Loader2 size={20} className="animate-spin" />
                                <span className="text-[13px] font-medium">Cargando solicitudes…</span>
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                                <div className="relative group flex flex-col items-center text-center">
                                    <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${
                                        statusFilter === 'PENDING' || statusFilter === 'ALL' ? 'bg-[#007AFF]' :
                                        statusFilter === 'APPROVED' ? 'bg-emerald-500' :
                                        statusFilter === 'REJECTED' ? 'bg-red-500' : 'bg-slate-400'
                                    }`} />
                                    <div className={`relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-700 group-hover:-translate-y-2 group-hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] ${
                                        statusFilter === 'PENDING' || statusFilter === 'ALL' ? 'text-[#007AFF]' :
                                        statusFilter === 'APPROVED' ? 'text-emerald-500' :
                                        statusFilter === 'REJECTED' ? 'text-red-500' : 'text-slate-400'
                                    }`}>
                                        {statusFilter === 'PENDING' || statusFilter === 'ALL'
                                            ? <CheckCircle2 size={40} strokeWidth={2} />
                                            : <ClipboardList size={40} strokeWidth={2} />
                                        }
                                    </div>
                                    <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">
                                        {statusFilter === 'PENDING' ? 'Todo al día' :
                                         statusFilter === 'ALL'     ? 'Sin solicitudes' : 'Sin resultados'}
                                    </h3>
                                    <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">
                                        {statusFilter === 'PENDING' ? 'No tienes solicitudes pendientes de respuesta.' :
                                         statusFilter === 'ALL'     ? 'Aún no has creado ninguna solicitud.' :
                                         'Sin solicitudes en esta categoría.'}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            filtered.map(req => (
                                <RequestCard key={req.id} req={req} onCancel={handleCancel} />
                            ))
                        )}
                    </div>
                </div>

            </div>
        </GlassViewLayout>
    );
};

export default EmployeeRequestsView;
