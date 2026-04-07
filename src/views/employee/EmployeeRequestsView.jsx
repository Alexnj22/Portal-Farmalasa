import React, { useState, useCallback, useEffect, memo, useMemo } from 'react';
import {
    ClipboardList, Plus, Loader2, X, Palmtree, FileText, RefreshCw,
    DollarSign, FileCheck, CheckCircle2, Send, AlertCircle, XCircle, Check
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';
import { REQUEST_TYPES, REQUEST_STATUS } from '../../store/slices/requestsSlice';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import GlassViewLayout from '../../components/GlassViewLayout';
import LiquidSelect from '../../components/common/LiquidSelect';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_ICONS = {
    VACATION: Palmtree, PERMIT: FileText, SHIFT_CHANGE: RefreshCw,
    ADVANCE: DollarSign, CERTIFICATE: FileCheck,
};

const TYPE_OPTIONS = [
    { key: 'VACATION',     icon: Palmtree,   label: 'Vacaciones'   },
    { key: 'PERMIT',       icon: FileText,   label: 'Permiso'      },
    { key: 'SHIFT_CHANGE', icon: RefreshCw,  label: 'Cambio Turno' },
    { key: 'ADVANCE',      icon: DollarSign, label: 'Anticipo'     },
    { key: 'CERTIFICATE',  icon: FileCheck,  label: 'Constancia'   },
];

const CERT_TYPES = [
    { key: 'LABORAL',  label: 'Constancia Laboral',  desc: 'Confirma tu relación de trabajo' },
    { key: 'SALARIO',  label: 'Constancia de Salario', desc: 'Incluye tu salario mensual' },
    { key: 'BANCARIA', label: 'Constancia Bancaria',  desc: 'Para gestión o apertura de cuenta' },
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

// ─────────────────────────────────────────────────────────────────────────────
// PeerRequestCard — solicitud de cambio de turno que requiere mi aprobación
// ─────────────────────────────────────────────────────────────────────────────
const PeerRequestCard = memo(({ req, onAccept, onReject }) => {
    const meta = typeof req.metadata === 'object' && req.metadata !== null
        ? req.metadata
        : (() => { try { return JSON.parse(req.metadata); } catch { return {}; } })();

    return (
        <div className="p-5 rounded-[2rem] border border-cyan-300/60 bg-cyan-50/40 backdrop-blur-xl flex flex-col gap-3 shadow-[0_4px_16px_rgba(6,182,212,0.08)]">
            <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest bg-cyan-100 text-cyan-800 border border-cyan-200">
                    <RefreshCw size={11} strokeWidth={2} /> Cambio de Turno
                </span>
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-200">
                    Requiere tu aprobación
                </span>
            </div>
            <div>
                <p className="text-[13px] font-bold text-slate-700">
                    <span className="text-slate-500 font-medium">Solicitado por: </span>
                    {req.employee?.name || 'Compañero'}
                </p>
                {meta.date && (
                    <p className="text-[12px] text-slate-500 font-medium mt-0.5">
                        Fecha: {new Date(meta.date + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: '2-digit', month: 'long' })}
                    </p>
                )}
                {req.note && (
                    <p className="text-[12px] text-slate-500 italic mt-1">"{req.note}"</p>
                )}
            </div>
            <div className="flex gap-2 justify-end">
                <button
                    onClick={() => onReject(req.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 text-[11px] font-bold uppercase tracking-widest hover:bg-red-100 transition-all active:scale-95"
                >
                    <X size={12} strokeWidth={2.5} /> Rechazar
                </button>
                <button
                    onClick={() => onAccept(req.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 text-white text-[11px] font-bold uppercase tracking-widest shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:bg-emerald-600 transition-all active:scale-95"
                >
                    <Check size={12} strokeWidth={2.5} /> Aceptar
                </button>
            </div>
        </div>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// RequestCard — solicitud propia
// ─────────────────────────────────────────────────────────────────────────────
const RequestCard = memo(({ req, onCancel }) => {
    const typeConf  = REQUEST_TYPES[req.type]    || { label: req.type,   color: 'bg-slate-100 text-slate-600', border: 'border-slate-200' };
    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const maxLevels = req.type === 'SHIFT_CHANGE' ? 2 : 3;
    const meta      = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};

    const cardBg =
        req.status === 'PENDING'   ? 'border-[#007AFF]/30 shadow-[0_4px_20px_rgba(0,122,255,0.05)] bg-white/80 backdrop-blur-2xl' :
        req.status === 'APPROVED'  ? 'border-emerald-300/60 shadow-[0_4px_20px_rgba(16,185,129,0.06)] bg-emerald-50/30 backdrop-blur-2xl' :
        req.status === 'REJECTED'  ? 'border-red-300 shadow-[0_4px_20px_rgba(239,68,68,0.08)] bg-white/90 backdrop-blur-xl' :
        'border-white/60 opacity-75 bg-white/40 backdrop-blur-md hover:opacity-100';

    return (
        <div className={`p-6 rounded-[2.5rem] border flex flex-col gap-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group relative transform-gpu hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] ${cardBg}`}>

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

            {req.note && (
                <p className="text-slate-700 text-[14px] leading-relaxed font-medium line-clamp-2 whitespace-pre-wrap">
                    {req.note}
                </p>
            )}

            {req.type === 'SHIFT_CHANGE' && (
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/70 border border-slate-100 rounded-2xl p-3">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tu turno actual</p>
                        <p className="text-[12px] font-black text-slate-700">{meta.myShift || 'No especificado'}</p>
                    </div>
                    <div className="bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-2xl p-3">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Turno a tomar</p>
                        <p className="text-[12px] font-black text-slate-700">{meta.targetShift || meta.targetEmployeeName || 'No especificado'}</p>
                    </div>
                </div>
            )}

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

            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {new Date(req.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
        </div>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Vista principal
// ─────────────────────────────────────────────────────────────────────────────
const EmployeeRequestsView = () => {
    const { user } = useAuth();
    const { createRequest, cancelRequest, approveRequest, rejectRequest, holidays, employees } = useStaffStore();

    const [requests, setRequests]         = useState([]);
    const [peerRequests, setPeerRequests] = useState([]);
    const [isLoading, setIsLoading]       = useState(false);
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [formType, setFormType]         = useState('VACATION');
    const [formNote, setFormNote]         = useState('');
    const [payload, setPayload]           = useState({});
    const [permPickerKey, setPermPickerKey] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError]               = useState('');

    // Compañeros de la misma sucursal (excluyendo al usuario actual)
    const branchEmployees = useMemo(() =>
        (employees || []).filter(e =>
            String(e.branch_id || e.branchId) === String(user?.branchId || user?.branch_id) &&
            String(e.id) !== String(user?.id) &&
            e.status === 'ACTIVO'
        ),
    [employees, user]);

    // Turno del empleado objetivo en la fecha seleccionada
    const targetEmpShift = useMemo(() => {
        if (!payload.targetEmployeeId || !payload.date) return null;
        const targetEmp = employees?.find(e => String(e.id) === String(payload.targetEmployeeId));
        if (!targetEmp?.weeklySchedule) return null;
        const dayOfWeek = new Date(payload.date + 'T12:00:00').getDay();
        return targetEmp.weeklySchedule[dayOfWeek] || null;
    }, [payload.targetEmployeeId, payload.date, employees]);

    const load = useCallback(async () => {
        if (!user?.id) return;
        setIsLoading(true);
        const [{ data: ownData }, { data: peerData }] = await Promise.all([
            supabase
                .from('approval_requests')
                .select('id, type, status, note, approver_note, created_at, current_level, metadata')
                .eq('employee_id', user.id)
                .order('created_at', { ascending: false }),
            supabase
                .from('approval_requests')
                .select('id, type, status, note, metadata, created_at, employee_id')
                .eq('approver_id', user.id)
                .eq('type', 'SHIFT_CHANGE')
                .eq('status', 'PENDING'),
        ]);

        setRequests(ownData || []);

        // Enriquecer peer requests con nombre del solicitante
        const rawPeer = (peerData || []).filter(r => {
            const meta = typeof r.metadata === 'object' ? r.metadata : (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })();
            return meta?.peerApprovalRequired === true;
        });

        if (rawPeer.length > 0) {
            const empIds = [...new Set(rawPeer.map(r => r.employee_id).filter(Boolean))];
            const { data: empRows } = await supabase
                .from('employees').select('id, name').in('id', empIds);
            const empMap = Object.fromEntries((empRows || []).map(e => [String(e.id), e]));
            setPeerRequests(rawPeer.map(r => ({ ...r, employee: empMap[String(r.employee_id)] || null })));
        } else {
            setPeerRequests([]);
        }

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

    const handleAddPermDate = (dateStr) => {
        if (!dateStr) return;
        setPayload(prev => {
            const existing = prev.permissionDates || [];
            if (existing.includes(dateStr)) return prev;
            return { ...prev, permissionDates: [...existing, dateStr] };
        });
        setPermPickerKey(k => k + 1);
    };

    const handleRemovePermDate = (dateStr) => {
        setPayload(prev => ({
            ...prev,
            permissionDates: (prev.permissionDates || []).filter(d => d !== dateStr),
        }));
    };

    const handlePeerAccept = async (id) => {
        await approveRequest(id, user.id, '');
        load();
    };

    const handlePeerReject = async (id) => {
        await rejectRequest(id, user.id, 'Cambio rechazado por el empleado');
        load();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!formNote.trim()) { setError('El motivo es obligatorio.'); return; }

        if (formType === 'VACATION' && (!payload.startDate || !payload.endDate)) {
            setError('Selecciona el período de vacaciones.'); return;
        }
        if (formType === 'PERMIT' && (!payload.permissionDates || payload.permissionDates.length === 0)) {
            setError('Selecciona al menos un día de permiso.'); return;
        }
        if (formType === 'SHIFT_CHANGE' && (!payload.targetEmployeeId || !payload.date)) {
            setError('Selecciona el compañero y la fecha del cambio.'); return;
        }
        if (formType === 'ADVANCE' && (!payload.amount || Number(payload.amount) <= 0)) {
            setError('Ingresa el monto del anticipo.'); return;
        }
        if (formType === 'CERTIFICATE' && !payload.certificateType) {
            setError('Selecciona el tipo de constancia.'); return;
        }

        setIsSubmitting(true);
        const result = await createRequest(user.id, formType, payload, formNote.trim());
        setIsSubmitting(false);
        if (result) {
            useToastStore.getState().showToast('Enviada', `Solicitud de ${REQUEST_TYPES[formType]?.label} registrada.`, 'success');
            setFormNote(''); setPayload({}); setPermPickerKey(0); setStatusFilter('PENDING');
            load();
        } else {
            setError('No se pudo crear la solicitud. Intenta de nuevo.');
        }
    };

    const handleCancel = async (id) => {
        await cancelRequest(id);
        load();
    };

    // ── Sección específica por tipo ──────────────────────────────────────────
    const renderTypeSection = () => {
        if (formType === 'VACATION') {
            return (
                <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                        Período de Vacaciones
                    </label>
                    <RangeDatePicker
                        startDate={payload.startDate || ''} endDate={payload.endDate || ''}
                        onRangeChange={(s, e) => setPayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                        holidays={holidays} defaultDays={15} label="vacaciones"
                    />
                </div>
            );
        }

        if (formType === 'PERMIT') {
            const permDates = payload.permissionDates || [];
            return (
                <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                        Días de Permiso
                    </label>
                    <LiquidDatePicker
                        key={permPickerKey}
                        value=""
                        onChange={handleAddPermDate}
                        placeholder="Agregar fecha..."
                        holidays={holidays}
                    />
                    {permDates.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                            {permDates.map(d => (
                                <span key={d} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-100 border border-purple-200 text-purple-800 text-[11px] font-bold">
                                    {new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}
                                    <button type="button" onClick={() => handleRemovePermDate(d)} className="text-purple-400 hover:text-purple-700 transition-colors">
                                        <XCircle size={13} strokeWidth={2} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

        if (formType === 'SHIFT_CHANGE') {
            return (
                <div className="space-y-3">
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                            Compañero de intercambio
                        </label>
                        <LiquidSelect
                            value={payload.targetEmployeeId || ''}
                            onChange={v => setPayload(prev => ({ ...prev, targetEmployeeId: v }))}
                            placeholder="Seleccionar compañero..."
                            options={branchEmployees.map(e => ({ value: String(e.id), label: `${e.name} — ${e.role || 'Empleado'}` }))}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                            Fecha del cambio
                        </label>
                        <LiquidDatePicker
                            value={payload.date || ''}
                            onChange={v => setPayload(prev => ({ ...prev, date: v }))}
                            placeholder="Seleccionar fecha"
                            holidays={holidays}
                        />
                    </div>
                    {targetEmpShift && (
                        <div className="px-4 py-3 rounded-2xl bg-cyan-50/60 border border-cyan-200/60 text-[12px] font-bold text-cyan-700">
                            Turno del compañero ese día: {targetEmpShift.start} – {targetEmpShift.end}
                        </div>
                    )}
                    {payload.targetEmployeeId && payload.date && !targetEmpShift && (
                        <div className="px-4 py-3 rounded-2xl bg-slate-50/60 border border-slate-200/60 text-[12px] font-medium text-slate-400">
                            Sin turno asignado ese día
                        </div>
                    )}
                </div>
            );
        }

        if (formType === 'ADVANCE') {
            return (
                <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                        Monto solicitado
                    </label>
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-[14px]">$</span>
                        <input
                            type="number"
                            min="1"
                            step="1"
                            value={payload.amount || ''}
                            onChange={e => setPayload(prev => ({ ...prev, amount: e.target.value }))}
                            placeholder="0.00"
                            className="w-full pl-8 pr-4 py-3 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] rounded-2xl text-[13px] outline-none font-medium text-slate-700 transition-all duration-300 placeholder-slate-300"
                        />
                    </div>
                </div>
            );
        }

        if (formType === 'CERTIFICATE') {
            return (
                <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">
                        Tipo de Constancia
                    </label>
                    <LiquidSelect
                        value={payload.certificateType || ''}
                        onChange={v => setPayload(prev => ({ ...prev, certificateType: v }))}
                        placeholder="Seleccionar tipo de constancia..."
                        options={CERT_TYPES.map(c => ({ value: c.key, label: c.label }))}
                    />
                    {payload.certificateType && (
                        <p className="text-[11px] text-slate-400 mt-1.5 ml-1">
                            {CERT_TYPES.find(c => c.key === payload.certificateType)?.desc}
                        </p>
                    )}
                </div>
            );
        }

        return null;
    };

    // ── Filtros ──────────────────────────────────────────────────────────────
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
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                                    {TYPE_OPTIONS.map(({ key, icon: Icon, label }) => {
                                        const conf     = REQUEST_TYPES[key];
                                        const isActive = formType === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => { setFormType(key); setPayload({}); setError(''); setPermPickerKey(0); }}
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

                            {/* Sección específica por tipo */}
                            {renderTypeSection()}

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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 pt-4 px-3 md:px-4 content-start">

                        {/* Solicitudes de cambio de turno que requieren mi aprobación */}
                        {peerRequests.length > 0 && (
                            <div className="space-y-3">
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] ml-1">
                                    Requieren tu aprobación
                                </p>
                                {peerRequests.map(req => (
                                    <PeerRequestCard
                                        key={req.id}
                                        req={req}
                                        onAccept={handlePeerAccept}
                                        onReject={handlePeerReject}
                                    />
                                ))}
                                <div className="border-t border-white/40 my-2" />
                            </div>
                        )}

                        {isLoading ? (
                            <div className="flex justify-center py-16 text-slate-400 gap-2">
                                <Loader2 size={20} className="animate-spin" />
                                <span className="text-[13px] font-medium">Cargando solicitudes…</span>
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] col-span-full">
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
