import React, { useState, useCallback, useEffect, memo, useMemo } from 'react';
import {
    ClipboardList, Plus, Loader2, X, Palmtree, FileText, RefreshCw,
    DollarSign, FileCheck, CheckCircle2, Send, AlertCircle, XCircle, Check,
    Stethoscope, Upload, FileImage, CalendarDays, Clock, AlertTriangle, Info
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
import ConfirmModal from '../../components/common/ConfirmModal';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_ICONS = {
    VACATION: Palmtree, PERMIT: FileText, SHIFT_CHANGE: RefreshCw,
    ADVANCE: DollarSign, CERTIFICATE: FileCheck, DISABILITY: Stethoscope,
};

const TYPE_OPTIONS = [
    { key: 'VACATION',     icon: Palmtree,     label: 'Vacaciones'   },
    { key: 'PERMIT',       icon: FileText,     label: 'Permiso'      },
    { key: 'SHIFT_CHANGE', icon: RefreshCw,    label: 'Cambio Turno' },
    { key: 'ADVANCE',      icon: DollarSign,   label: 'Anticipo'     },
    { key: 'CERTIFICATE',  icon: FileCheck,    label: 'Constancia'   },
    { key: 'DISABILITY',   icon: Stethoscope,  label: 'Incapacidad'  },
];

const CERT_TYPES = [
    { key: 'LABORAL',  label: 'Constancia Laboral',  desc: 'Confirma tu relación de trabajo' },
    { key: 'SALARIO',  label: 'Constancia de Salario', desc: 'Incluye tu salario mensual' },
    { key: 'BANCARIA', label: 'Constancia Bancaria',  desc: 'Para gestión o apertura de cuenta' },
];

const TABS = [
    { key: 'PENDING',   label: 'Pendientes' },
    { key: 'APPROVED',  label: 'Aprobadas'  },
    { key: 'REJECTED',  label: 'Rechazadas' },
    { key: 'CANCELLED', label: 'Canceladas' },
];


// ─────────────────────────────────────────────────────────────────────────────
// PeerRequestCard — solicitud de cambio de turno que requiere mi aprobación
// ─────────────────────────────────────────────────────────────────────────────
const PeerRequestCard = memo(({ req, onAccept, onReject }) => {
    const meta = typeof req.metadata === 'object' && req.metadata !== null
        ? req.metadata
        : (() => { try { return JSON.parse(req.metadata); } catch { return {}; } })();

    const dateStr = meta.date
        ? new Date(meta.date + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: '2-digit', month: 'long' })
        : null;

    return (
        <div className="p-5 rounded-[2rem] border-2 border-cyan-300/60 bg-gradient-to-br from-cyan-50/60 to-white/80 backdrop-blur-2xl flex flex-col gap-4 shadow-[0_4px_20px_rgba(6,182,212,0.1)]">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-[0.875rem] bg-cyan-100 border border-cyan-200 flex items-center justify-center flex-shrink-0">
                        <RefreshCw size={16} strokeWidth={2} className="text-cyan-600" />
                    </div>
                    <div>
                        <p className="text-[13px] font-black text-slate-800 leading-tight">
                            {req.employee?.name || 'Compañero'}
                        </p>
                        <p className="text-[10px] text-slate-500 font-medium">quiere cambiar turno contigo</p>
                    </div>
                </div>
                {dateStr && (
                    <span className="text-[10px] font-bold text-cyan-700 bg-cyan-100 border border-cyan-200 px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0">
                        {dateStr}
                    </span>
                )}
            </div>

            {/* Shift comparison grid */}
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/80 border border-slate-100 rounded-2xl p-3">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tu turno ese día</p>
                    <p className="text-[12px] font-black text-slate-700">
                        {meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—'}
                    </p>
                    {(!meta.targetShift || meta.targetShift === 'No especificado') && (
                        <p className="text-[9px] text-slate-400 mt-0.5">Lo que darías</p>
                    )}
                </div>
                <div className="bg-cyan-50/80 border border-cyan-100 rounded-2xl p-3">
                    <p className="text-[9px] font-black text-cyan-500 uppercase tracking-widest mb-1">Turno que tomarías</p>
                    <p className="text-[12px] font-black text-cyan-700">
                        {meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—'}
                    </p>
                    {(!meta.myShift || meta.myShift === 'No especificado') && (
                        <p className="text-[9px] text-cyan-400 mt-0.5">Lo que recibirías</p>
                    )}
                </div>
            </div>

            {req.note && (
                <p className="text-[12px] text-slate-500 italic leading-relaxed">"{req.note}"</p>
            )}

            {/* Full-width action buttons */}
            <div className="grid grid-cols-2 gap-2">
                <button
                    onClick={() => onReject(req.id)}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-2xl border border-red-200 bg-red-50 text-red-600 text-[11px] font-bold uppercase tracking-widest hover:bg-red-100 transition-all active:scale-95"
                >
                    <X size={12} strokeWidth={2.5} /> Rechazar
                </button>
                <button
                    onClick={() => onAccept(req.id)}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-emerald-500 text-white text-[11px] font-bold uppercase tracking-widest shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:bg-emerald-600 transition-all active:scale-95"
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
const RequestCard = memo(({ req, onCancel, uploadFileToStorage }) => {
    const typeConf  = REQUEST_TYPES[req.type]    || { label: req.type,   color: 'bg-slate-100 text-slate-600', border: 'border-slate-200' };
    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const maxLevels = req.type === 'SHIFT_CHANGE' ? 2 : 3;
    const [meta, setMeta] = useState(
        typeof req.metadata === 'object' && req.metadata ? req.metadata : {}
    );
    const [uploadingDoc, setUploadingDoc] = useState(false);

    const cardBg =
        req.status === 'PENDING'   ? 'border-[#007AFF]/30 bg-white/80 backdrop-blur-2xl' :
        req.status === 'APPROVED'  ? 'border-emerald-300/70 bg-emerald-50/80 backdrop-blur-2xl' :
        req.status === 'REJECTED'  ? 'border-red-300 bg-white/90 backdrop-blur-xl' :
        'border-white/60 bg-white/40 backdrop-blur-md';

    return (
        <div className={`rounded-[2.5rem] border flex flex-col transition-all duration-300 relative transform-gpu shadow-[0_2px_10px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.07)] hover:-translate-y-0.5 ${cardBg}`}>
            {/* ── Header ── */}
            <div className="p-5 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-[0.875rem] flex items-center justify-center flex-shrink-0 transform-gpu overflow-hidden ${typeConf.color} border ${typeConf.border}`}>
                    <TypeIcon size={16} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${typeConf.color.split(' ')[1]}`}>
                            {typeConf.label}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className={`flex items-center gap-1 text-[10px] font-bold ${statConf.color.split(' ')[1]}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {statConf.label}
                        </span>
                        {req.status === 'PENDING' && req.current_level && req.type !== 'DISABILITY' && (
                            <span className="text-[9px] font-bold text-[#007AFF]">· Niv. {req.current_level}/{maxLevels}</span>
                        )}
                        {req.type === 'DISABILITY' && req.status === 'PENDING' && (
                            <span className="text-[9px] font-black text-red-500 uppercase tracking-widest">· Urgente</span>
                        )}
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {new Date(req.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                </div>
                {req.status === 'PENDING' && (
                    <button
                        onClick={() => onCancel(req.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full border border-transparent hover:border-red-200 transition-all flex-shrink-0"
                    >
                        <X size={11} strokeWidth={2.5} /> Cancelar
                    </button>
                )}
            </div>

            {/* ── Contenido ── */}
            <div className="px-5 pb-5 flex flex-col gap-3 border-t border-slate-100/80 pt-4">
                {req.note && (
                    <p className="text-slate-700 text-[14px] leading-relaxed font-medium whitespace-pre-wrap">
                        {req.note}
                    </p>
                )}

                {req.type === 'SHIFT_CHANGE' && (
                    <div className="space-y-2">
                        {(meta.targetEmployeeName || meta.date) && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-50/60 border border-cyan-200/60">
                                <RefreshCw size={13} className="text-cyan-500 flex-shrink-0" strokeWidth={2} />
                                <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    {meta.targetEmployeeName && (
                                        <span className="text-[12px] font-black text-cyan-700">↔ {meta.targetEmployeeName}</span>
                                    )}
                                    {meta.date && (
                                        <span className="text-[11px] font-bold text-cyan-600">
                                            {new Date(meta.date + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'short', day: '2-digit', month: 'short' })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-white/70 border border-slate-100 rounded-2xl p-3">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tu turno ese día</p>
                                <p className="text-[12px] font-black text-slate-700">
                                    {meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—'}
                                </p>
                            </div>
                            <div className="bg-cyan-50/80 border border-cyan-100 rounded-2xl p-3">
                                <p className="text-[9px] font-black text-cyan-500 uppercase tracking-widest mb-1">Turno de {meta.targetEmployeeName?.split(' ')[0] || 'compañero'}</p>
                                <p className="text-[12px] font-black text-slate-700">
                                    {meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {req.type === 'DISABILITY' && (
                    <div className="space-y-2">
                        {meta.startDate && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50/60 border border-red-200/60">
                                <Stethoscope size={13} className="text-red-500 flex-shrink-0" strokeWidth={2} />
                                <span className="text-[12px] font-bold text-red-700">
                                    {new Date(meta.startDate + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}
                                    {meta.endDate && meta.endDate !== meta.startDate && (
                                        <> – {new Date(meta.endDate + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}</>
                                    )}
                                    {meta.days && <span className="text-red-400 font-medium ml-1.5">({meta.days} días)</span>}
                                </span>
                            </div>
                        )}
                        {meta.docUrl ? (
                            <a href={meta.docUrl} target="_blank" rel="noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-600 hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all">
                                <FileImage size={13} strokeWidth={2} />
                                {meta.docName || 'Ver certificado adjunto'}
                            </a>
                        ) : req.status === 'PENDING' && uploadFileToStorage ? (
                            <label className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed cursor-pointer transition-all ${uploadingDoc ? 'border-slate-200 opacity-60' : 'border-amber-200 hover:border-amber-400 hover:bg-amber-50/40'}`}>
                                {uploadingDoc
                                    ? <Loader2 size={13} className="text-amber-500 animate-spin flex-shrink-0" />
                                    : <Upload size={13} className="text-amber-500 flex-shrink-0" strokeWidth={2} />
                                }
                                <span className="text-[11px] font-bold text-amber-700">
                                    {uploadingDoc ? 'Subiendo...' : 'Adjuntar certificado / boleta ISSS'}
                                </span>
                                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" disabled={uploadingDoc}
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file || !uploadFileToStorage) return;
                                        setUploadingDoc(true);
                                        const url = await uploadFileToStorage(file, 'documents', 'disability');
                                        if (url) {
                                            const newMeta = { ...meta, docUrl: url, docName: file.name };
                                            await supabase.from('approval_requests').update({ metadata: newMeta }).eq('id', req.id);
                                            setMeta(newMeta);
                                            useToastStore.getState().showToast('Documento adjuntado', 'El certificado fue adjuntado correctamente.', 'success');
                                        }
                                        setUploadingDoc(false);
                                        e.target.value = '';
                                    }}
                                />
                            </label>
                        ) : null}
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
            </div>
        </div>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Vista principal
// ─────────────────────────────────────────────────────────────────────────────
const EmployeeRequestsView = () => {
    const { user } = useAuth();
    const { createRequest, cancelRequest, approvePeerRequest, rejectPeerRequest, holidays, employees, uploadFileToStorage } = useStaffStore();

    const [requests, setRequests]         = useState([]);
    const [peerRequests, setPeerRequests] = useState([]);
    const [isLoading, setIsLoading]       = useState(false);
    const [statusFilter, setStatusFilter] = useState('PENDING');
    const [showOldApproved, setShowOldApproved] = useState(false);
    const [formType, setFormType]         = useState('VACATION');
    const [formNote, setFormNote]         = useState('');
    const [payload, setPayload]           = useState({});
    const [permPickerKey, setPermPickerKey] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError]               = useState('');
    const [cancelConfirmId, setCancelConfirmId] = useState(null);
    const [disabilityFile, setDisabilityFile]   = useState(null);
    const [typePickerOpen, setTypePickerOpen]   = useState(true);
    const [expandedNotice, setExpandedNotice]   = useState(null);

    // Compañeros de la misma sucursal (excluyendo al usuario actual)
    const branchEmployees = useMemo(() =>
        (employees || []).filter(e =>
            String(e.branch_id || e.branchId) === String(user?.branchId || user?.branch_id) &&
            String(e.id) !== String(user?.id) &&
            e.status === 'ACTIVO'
        ),
    [employees, user]);

    // Datos del empleado actual
    const selfEmp = useMemo(() =>
        (employees || []).find(e => String(e.id) === String(user?.id)),
    [employees, user?.id]);

    // Turno del empleado objetivo en la fecha seleccionada
    const targetEmp = useMemo(() =>
        employees?.find(e => String(e.id) === String(payload.targetEmployeeId)),
    [employees, payload.targetEmployeeId]);

    const targetEmpShift = useMemo(() => {
        if (!targetEmp?.weeklySchedule || !payload.date) return null;
        const dayOfWeek = new Date(payload.date + 'T12:00:00').getDay();
        return targetEmp.weeklySchedule[dayOfWeek] || null;
    }, [targetEmp, payload.date]);

    const myShiftOnDate = useMemo(() => {
        if (!selfEmp?.weeklySchedule || !payload.date) return null;
        const dayOfWeek = new Date(payload.date + 'T12:00:00').getDay();
        return selfEmp.weeklySchedule[dayOfWeek] || null;
    }, [selfEmp, payload.date]);

    // Estado de incapacidad/permiso del compañero en la fecha seleccionada
    const [targetEmpStatus, setTargetEmpStatus] = useState(null); // null | { blocked: bool, reason: string }
    useEffect(() => {
        if (!payload.targetEmployeeId || !payload.date) { setTargetEmpStatus(null); return; }
        let cancelled = false;
        supabase.from('employee_events')
            .select('type, date, metadata')
            .eq('employee_id', payload.targetEmployeeId)
            .in('type', ['DISABILITY', 'PERMIT', 'VACATION'])
            .then(({ data }) => {
                if (cancelled) return;
                if (!data?.length) { setTargetEmpStatus(null); return; }
                const d = payload.date;
                const blocking = data.find(ev => {
                    const start = ev.date;
                    const end = ev.metadata?.endDate || ev.date;
                    return d >= start && d <= end;
                });
                if (blocking) {
                    const labels = { DISABILITY: 'incapacitado', PERMIT: 'con permiso', VACATION: 'de vacaciones' };
                    setTargetEmpStatus({ blocked: true, reason: labels[blocking.type] || 'no disponible' });
                } else {
                    setTargetEmpStatus(null);
                }
            });
        return () => { cancelled = true; };
    }, [payload.targetEmployeeId, payload.date]);

    // ── Datos de vacaciones del empleado ──────────────────────────────────────
    const vacationInfo = useMemo(() => {
        if (!selfEmp?.hireDate) return null;
        const today = new Date(); today.setHours(0,0,0,0);
        const hire  = new Date(selfEmp.hireDate + 'T12:00:00'); hire.setHours(0,0,0,0);
        const msPerYear = 365.25 * 24 * 3600 * 1000;
        const yearsExact = (today - hire) / msPerYear;
        const totalMonths = Math.floor((today - hire) / (30.44 * 24 * 3600 * 1000));
        const years = Math.floor(yearsExact);
        const months = totalMonths - years * 12;

        if (yearsExact < 1) {
            // Calcular cuánto falta para el primer aniversario
            const firstAnniv = new Date(hire); firstAnniv.setFullYear(hire.getFullYear() + 1);
            const daysLeft = Math.ceil((firstAnniv - today) / (24 * 3600 * 1000));
            return { eligible: false, years, months, daysLeft, hire: selfEmp.hireDate };
        }

        // Aniversario más reciente
        const lastAnniv = new Date(hire); lastAnniv.setFullYear(hire.getFullYear() + years);
        const windowEnd = new Date(lastAnniv); windowEnd.setDate(windowEnd.getDate() + 90);
        const inWindow = today <= windowEnd;
        const nextAnniv = new Date(hire); nextAnniv.setFullYear(hire.getFullYear() + years + 1);
        const nextWindowEnd = new Date(nextAnniv); nextWindowEnd.setDate(nextWindowEnd.getDate() + 90);

        return {
            eligible: true,
            years,
            months,
            hire: selfEmp.hireDate,
            inWindow,
            windowStart: lastAnniv.toISOString().split('T')[0],
            windowEnd: windowEnd.toISOString().split('T')[0],
            nextAnniv: nextAnniv.toISOString().split('T')[0],
            nextWindowEnd: nextWindowEnd.toISOString().split('T')[0],
        };
    }, [selfEmp]);

    const existingVacation = useMemo(() => {
        const approved = requests.find(r => r.type === 'VACATION' && r.status === 'APPROVED');
        const pending  = requests.find(r => r.type === 'VACATION' && r.status === 'PENDING');
        return { approved, pending };
    }, [requests]);

    // Incapacidades aprobadas vigentes (endDate >= hoy, para no bloquear días ya pasados)
    const activeDisabilities = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return requests
            .filter(r => r.type === 'DISABILITY' && r.status === 'APPROVED')
            .map(r => {
                const meta = typeof r.metadata === 'object' && r.metadata !== null
                    ? r.metadata
                    : (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })();
                return { startDate: meta.startDate, endDate: meta.endDate };
            })
            .filter(d => d.startDate && d.endDate && d.endDate >= today);
    }, [requests]);

    // Devuelve la incapacidad vigente si una fecha cae dentro de alguna
    const disabilityConflict = useCallback((dateStr) =>
        activeDisabilities.find(d => dateStr >= d.startDate && dateStr <= d.endDate) ?? null
    , [activeDisabilities]);

    // Devuelve la incapacidad vigente si un rango se solapa con alguna.
    // Usa comparación ESTRICTA (<, >) para permitir que una nueva incapacidad
    // empiece el mismo día que otra termina (extensión/continuación médica).
    const disabilityConflictRange = useCallback((startStr, endStr) =>
        activeDisabilities.find(d => startStr < d.endDate && endStr > d.startDate) ?? null
    , [activeDisabilities]);

    // Íconos de alerta para el header del formulario (incapacidad)
    const disabilityHeaderAlerts = useMemo(() => {
        if (formType !== 'DISABILITY') return { overlap: null, needsISSS: false };
        const days = Number(payload.days) || 0;
        const needsISSS = days > 3;
        let overlap = null;
        if (payload.startDate && days >= 1) {
            const endD = new Date(payload.startDate + 'T00:00:00');
            endD.setDate(endD.getDate() + days - 1);
            overlap = disabilityConflictRange(payload.startDate, endD.toISOString().split('T')[0]);
        }
        return { overlap, needsISSS };
    }, [formType, payload.startDate, payload.days, disabilityConflictRange]);

    // Formatea un período de incapacidad para mostrar en mensajes
    const fmtDisabilityPeriod = (d) => {
        const fmt = (s) => new Date(s + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
        return `${fmt(d.startDate)} – ${fmt(d.endDate)}`;
    };

    // Bloqueo reactivo: deshabilita el botón submit cuando hay conflicto con incapacidad
    const formDisabilityBlocked = useMemo(() => {
        if (formType === 'PERMIT') {
            return (payload.permissionDates || []).some(d => disabilityConflict(d));
        }
        if (formType === 'SHIFT_CHANGE') {
            return payload.date ? !!disabilityConflict(payload.date) : false;
        }
        if (formType === 'DISABILITY' && payload.startDate && Number(payload.days) >= 1) {
            const endD = new Date(payload.startDate + 'T00:00:00');
            endD.setDate(endD.getDate() + Number(payload.days) - 1);
            return !!disabilityConflictRange(payload.startDate, endD.toISOString().split('T')[0]);
        }
        return false;
    }, [formType, payload, disabilityConflict, disabilityConflictRange]);

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

    const currentYM = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const filtered = useMemo(() => {
        let list = requests.filter(r => r.status === statusFilter);
        if (!showOldApproved) {
            list = list.filter(r =>
                r.status !== 'APPROVED' || (r.created_at?.slice(0, 7) === currentYM)
            );
        }
        return list;
    }, [requests, statusFilter, showOldApproved, currentYM]);

    const handleAddPermDate = (dateStr) => {
        if (!dateStr) return;
        const today = new Date(); today.setHours(0,0,0,0);
        if (new Date(dateStr + 'T12:00:00') < today) return;
        const conflict = disabilityConflict(dateStr);
        if (conflict) {
            setError(`Estás incapacitado del ${fmtDisabilityPeriod(conflict)} — no puedes solicitar permiso para ese día.`);
            return;
        }
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
        await approvePeerRequest(id, user.id, '');
        load();
    };

    const handlePeerReject = async (id) => {
        await rejectPeerRequest(id, user.id, 'Cambio rechazado por el compañero');
        load();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!formNote.trim()) { setError('El motivo es obligatorio.'); return; }

        if (formType === 'VACATION') {
            if (!payload.startDate || !payload.endDate) { setError('Selecciona el período de vacaciones.'); return; }
            if (!vacationInfo?.eligible) { setError('Aún no cumples 1 año en la empresa para solicitar vacaciones.'); return; }
            if (existingVacation.approved) { setError('Ya tienes vacaciones aprobadas para este período.'); return; }
            const thisYear = new Date().getFullYear();
            if (payload.startDate.slice(0, 4) < String(thisYear)) { setError('No puedes seleccionar fechas de años anteriores.'); return; }
        }
        if (formType === 'PERMIT') {
            if (!payload.permissionDates || payload.permissionDates.length === 0) { setError('Selecciona al menos un día de permiso.'); return; }
            const blocked = (payload.permissionDates).find(d => disabilityConflict(d));
            if (blocked) {
                const c = disabilityConflict(blocked);
                setError(`El día ${new Date(blocked + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })} cae dentro de tu incapacidad activa (${fmtDisabilityPeriod(c)}).`);
                return;
            }
        }
        if (formType === 'SHIFT_CHANGE') {
            if (!payload.targetEmployeeId || !payload.date) { setError('Selecciona el compañero y la fecha del cambio.'); return; }
            const selfBlock = disabilityConflict(payload.date);
            if (selfBlock) { setError(`Estás incapacitado del ${fmtDisabilityPeriod(selfBlock)} — no puedes solicitar cambios de turno para esa fecha.`); return; }
            if (targetEmpStatus?.blocked) { setError(`El compañero seleccionado está ${targetEmpStatus.reason} en esa fecha.`); return; }
        }
        if (formType === 'ADVANCE' && (!payload.amount || Number(payload.amount) <= 0)) {
            setError('Ingresa el monto del anticipo.'); return;
        }
        if (formType === 'CERTIFICATE' && !payload.certificateType) {
            setError('Selecciona el tipo de constancia.'); return;
        }
        if (formType === 'DISABILITY') {
            if (!payload.startDate || !payload.days || Number(payload.days) < 1) { setError('Ingresa la fecha de inicio y la cantidad de días.'); return; }
            const endD = new Date(payload.startDate + 'T00:00:00');
            endD.setDate(endD.getDate() + Number(payload.days) - 1);
            const overlap = disabilityConflictRange(payload.startDate, endD.toISOString().split('T')[0]);
            if (overlap) { setError(`Ya tienes una incapacidad aprobada del ${fmtDisabilityPeriod(overlap)} — esas fechas se solapan.`); return; }
        }

        setIsSubmitting(true);

        // Para DISABILITY: calcular endDate y subir boleta si la adjuntaron
        let finalPayload = { ...payload };
        if (formType === 'DISABILITY') {
            const start = new Date(payload.startDate + 'T00:00:00');
            start.setDate(start.getDate() + Number(payload.days) - 1);
            finalPayload.endDate = start.toISOString().split('T')[0];
            if (disabilityFile) {
                const docUrl = await uploadFileToStorage(disabilityFile, 'documents', 'disability');
                if (docUrl) finalPayload.docUrl = docUrl;
                finalPayload.docName = disabilityFile.name;
            }
        }

        const result = await createRequest(user.id, formType, finalPayload, formNote.trim());
        setIsSubmitting(false);
        if (result) {
            useToastStore.getState().showToast('Enviada', `Solicitud de ${REQUEST_TYPES[formType]?.label} registrada.`, 'success');
            setFormNote(''); setPayload({}); setPermPickerKey(0); setDisabilityFile(null); setStatusFilter('PENDING');
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
            const fmt = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
            const hasRange = payload.startDate && payload.endDate;

            return (
                <div className="space-y-3">
                    {/* Antigüedad */}
                    {vacationInfo && (
                        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl border text-[11px] font-bold ${
                            !vacationInfo.eligible
                                ? 'bg-amber-50 border-amber-200 text-amber-700'
                                : 'bg-emerald-50/70 border-emerald-200/60 text-emerald-700'
                        }`}>
                            <Clock size={13} className="flex-shrink-0" strokeWidth={2.5} />
                            {vacationInfo.eligible
                                ? <span>En la empresa hace <strong>{vacationInfo.years} año{vacationInfo.years !== 1 ? 's' : ''}{vacationInfo.months > 0 ? ` y ${vacationInfo.months} mes${vacationInfo.months !== 1 ? 'es' : ''}` : ''}</strong></span>
                                : <span>Faltan <strong>{vacationInfo.daysLeft} día{vacationInfo.daysLeft !== 1 ? 's' : ''}</strong> para cumplir 1 año · Ingreso: {fmt(vacationInfo.hire)}</span>
                            }
                        </div>
                    )}

                    {/* Vacación ya aprobada */}
                    {existingVacation.approved && (() => {
                        const m = typeof existingVacation.approved.metadata === 'object' ? existingVacation.approved.metadata : {};
                        return (
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-800">
                                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                                <span>Ya tienes vacaciones aprobadas{m.startDate ? ` del ${fmt(m.startDate)} al ${fmt(m.endDate)}` : ''}. No puedes solicitar otra.</span>
                            </div>
                        );
                    })()}

                    {/* Vacación pendiente */}
                    {!existingVacation.approved && existingVacation.pending && (() => {
                        const m = typeof existingVacation.pending.metadata === 'object' ? existingVacation.pending.metadata : {};
                        return (
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-[#007AFF]/8 border border-[#007AFF]/20 text-[11px] font-bold text-[#007AFF]">
                                <Info size={13} className="flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                                <span>Tienes vacaciones programadas en revisión{m.startDate ? ` — ${fmt(m.startDate)} al ${fmt(m.endDate)}` : ''}.</span>
                            </div>
                        );
                    })()}

                    {/* Selector de período */}
                    {!existingVacation.approved && vacationInfo?.eligible && (
                        <>
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] ml-1">
                                        Período de Vacaciones
                                    </label>
                                    {hasRange && (
                                        <button type="button" onClick={() => setPayload(prev => ({ ...prev, startDate: '', endDate: '' }))}
                                            className="flex items-center gap-1 text-[9px] font-black text-red-400 hover:text-red-600 uppercase tracking-widest transition-colors">
                                            <X size={11} strokeWidth={2.5} /> Limpiar
                                        </button>
                                    )}
                                </div>
                                <RangeDatePicker
                                    startDate={payload.startDate || ''} endDate={payload.endDate || ''}
                                    onRangeChange={(s, e) => setPayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                                    holidays={holidays} defaultDays={15} label="vacaciones"
                                />
                            </div>
                            {vacationInfo.inWindow && (
                                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70 text-[10px] font-bold text-slate-500">
                                    <CalendarDays size={11} strokeWidth={2} />
                                    Ventana disponible: {fmt(vacationInfo.windowStart)} — {fmt(vacationInfo.windowEnd)}
                                </div>
                            )}
                            {!vacationInfo.inWindow && (
                                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70 text-[10px] font-bold text-slate-400">
                                    <CalendarDays size={11} strokeWidth={2} />
                                    Próximo período disponible desde {fmt(vacationInfo.nextAnniv)}
                                </div>
                            )}
                        </>
                    )}
                </div>
            );
        }

        if (formType === 'PERMIT') {
            const permDates = payload.permissionDates || [];
            return (
                <div className="space-y-3">
                    {activeDisabilities.length > 0 && (
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-amber-50 border border-amber-200">
                            <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                            <div>
                                <p className="text-[10px] font-black text-amber-700 uppercase tracking-wide">Incapacidad activa</p>
                                <p className="text-[11px] font-medium text-amber-700 leading-snug">
                                    {activeDisabilities.map(d => fmtDisabilityPeriod(d)).join(', ')} — los días cubiertos no están disponibles.
                                </p>
                            </div>
                        </div>
                    )}
                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1.5 ml-1">
                            <CalendarDays size={11} strokeWidth={2.5} className="text-purple-400" />
                            Días de Permiso
                        </label>
                        <div className="bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                            <LiquidDatePicker
                                key={permPickerKey}
                                value=""
                                onChange={handleAddPermDate}
                                placeholder="Agregar fecha..."
                                holidays={holidays}
                            />
                        </div>
                    </div>
                    {permDates.length > 0 && (
                        <div className="flex flex-wrap gap-2">
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
            const showShifts = payload.targetEmployeeId && payload.date;
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
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1.5 ml-1">
                            <CalendarDays size={11} strokeWidth={2.5} className="text-cyan-400" />
                            Fecha del cambio
                        </label>
                        <div className="bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                            <LiquidDatePicker
                                value={payload.date || ''}
                                onChange={v => setPayload(prev => ({ ...prev, date: v }))}
                                placeholder="Seleccionar fecha"
                                holidays={holidays}
                            />
                        </div>
                    </div>

                    {/* Bloqueo: propia incapacidad */}
                    {payload.date && disabilityConflict(payload.date) && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-red-50 border border-red-200 text-[11px] font-bold text-red-700">
                            <AlertTriangle size={13} className="flex-shrink-0" strokeWidth={2.5} />
                            Estás incapacitado ese día ({fmtDisabilityPeriod(disabilityConflict(payload.date))}) — no puedes solicitar cambio de turno
                        </div>
                    )}
                    {/* Bloqueo: incapacidad / permiso / vacación del compañero */}
                    {targetEmpStatus?.blocked && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-red-50 border border-red-200 text-[11px] font-bold text-red-700">
                            <AlertTriangle size={13} className="flex-shrink-0" strokeWidth={2.5} />
                            {targetEmp?.name?.split(' ')[0] || 'El compañero'} está {targetEmpStatus.reason} ese día — no puede hacer el cambio
                        </div>
                    )}

                    {/* Turnos lado a lado */}
                    {showShifts && !targetEmpStatus?.blocked && (
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-white/70 border border-slate-100 rounded-2xl p-3">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Mi turno ese día</p>
                                <p className="text-[12px] font-black text-slate-700">
                                    {myShiftOnDate ? `${myShiftOnDate.start} – ${myShiftOnDate.end}` : '—'}
                                </p>
                                {!myShiftOnDate && <p className="text-[9px] text-slate-400 mt-0.5">Sin turno asignado</p>}
                            </div>
                            <div className="bg-cyan-50/80 border border-cyan-100 rounded-2xl p-3">
                                <p className="text-[9px] font-black text-cyan-500 uppercase tracking-widest mb-1">
                                    Turno de {targetEmp?.name?.split(' ')[0] || 'compañero'}
                                </p>
                                <p className="text-[12px] font-black text-cyan-700">
                                    {targetEmpShift ? `${targetEmpShift.start} – ${targetEmpShift.end}` : '—'}
                                </p>
                                {!targetEmpShift && <p className="text-[9px] text-cyan-400 mt-0.5">Sin turno asignado</p>}
                            </div>
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

        if (formType === 'DISABILITY') {
            const days = Number(payload.days) || 0;
            const endDate = payload.startDate && days > 0
                ? (() => { const d = new Date(payload.startDate + 'T00:00:00'); d.setDate(d.getDate() + days - 1); return d; })()
                : null;
            const needsISSS = days > 3;

            return (
                <div className="space-y-3">
                    {/* Fecha y días — 2 columnas */}
                    <div className="grid grid-cols-2 gap-3">
                        {/* Fecha de inicio */}
                        <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                Primer día
                            </label>
                            <div className="bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                                <LiquidDatePicker
                                    value={payload.startDate || ''}
                                    onChange={v => setPayload(prev => ({ ...prev, startDate: v }))}
                                    holidays={holidays}
                                />
                            </div>
                        </div>

                        {/* Cantidad de días */}
                        <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                Cantidad de días
                            </label>
                            <input
                                type="number" min="1" max="365"
                                value={payload.days || ''}
                                onChange={e => setPayload(prev => ({ ...prev, days: e.target.value }))}
                                placeholder="Ej. 3"
                                className="w-full py-2.5 px-4 bg-white border border-slate-200 focus:bg-white focus:border-red-300 focus:shadow-[0_0_0_4px_rgba(239,68,68,0.1)] rounded-xl text-[14px] font-black outline-none text-slate-700 transition-all duration-300 placeholder-slate-300 h-10"
                            />
                        </div>
                    </div>

                    {/* Fecha fin calculada — chip compacto */}
                    {endDate && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border bg-red-50 border-red-200 text-red-700 w-fit text-[10px] font-black uppercase tracking-widest">
                            <Stethoscope size={11} className="text-red-400 flex-shrink-0" strokeWidth={2.5} />
                            <span>Hasta {endDate.toLocaleDateString('es-VE', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                        </div>
                    )}

                    {/* Upload documento */}
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                            {needsISSS
                                ? <span>Boleta ISSS <span className="text-red-500">*</span><span className="text-slate-300 ml-1 normal-case font-medium">(obligatoria para cobertura ISSS)</span></span>
                                : <span>Certificado Médico <span className="text-slate-300 ml-1 normal-case font-medium">(opcional)</span></span>
                            }
                        </label>
                        <label className="flex items-center gap-3 px-4 py-3 bg-white/50 border-2 border-dashed border-red-200 hover:border-red-400 hover:bg-red-50/30 rounded-2xl cursor-pointer transition-all duration-200 group">
                            <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0 group-hover:bg-red-200 transition-colors">
                                {disabilityFile ? <FileImage size={16} className="text-red-600" /> : <Upload size={16} className="text-red-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                {disabilityFile
                                    ? <><p className="text-[12px] font-bold text-slate-700 truncate">{disabilityFile.name}</p>
                                       <p className="text-[10px] text-slate-400">{(disabilityFile.size / 1024).toFixed(0)} KB</p></>
                                    : <><p className="text-[12px] font-medium text-slate-500">Adjuntar boleta o certificado</p>
                                       <p className="text-[10px] text-slate-400">PDF, JPG, PNG — también puedes adjuntarlo después</p></>
                                }
                            </div>
                            {disabilityFile && (
                                <button type="button" onClick={e => { e.preventDefault(); setDisabilityFile(null); }}
                                    className="p-1 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-100 transition-all">
                                    <X size={14} strokeWidth={2.5} />
                                </button>
                            )}
                            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                                onChange={e => setDisabilityFile(e.target.files?.[0] || null)} />
                        </label>
                    </div>

                    <div className="px-4 py-2.5 rounded-2xl bg-red-50/60 border border-red-200/60">
                        <p className="text-[11px] font-bold text-red-700 leading-relaxed">
                            Talento Humano recibirá tu solicitud como urgente. Los días se marcarán automáticamente en tu horario al ser aprobada.
                        </p>
                    </div>

                </div>
            );
        }

        return null;
    };

    // ── Filtros ──────────────────────────────────────────────────────────────
    const renderFiltersContent = () => (
        <div className="flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu animate-in fade-in slide-in-from-right-8 w-max max-w-full">
            <div className="flex items-center gap-1 md:gap-1.5 pl-2 pr-2 md:pr-3">
                {TABS.map(tab => {
                    const isActive = statusFilter === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setStatusFilter(tab.key)}
                            className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${
                                isActive
                                    ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                    : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                            }`}
                        >
                            {tab.label}
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
                <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 px-2 -mx-2 group/panel transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] z-[50] transform-gpu">
                    <div className="bg-white/40 backdrop-blur-[30px] backdrop-saturate-[180%] border border-white/80 p-6 md:p-8 rounded-[2.5rem] shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.12),inset_0_2px_15px_rgba(255,255,255,0.7)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">

                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#007AFF] text-white shadow-sm">
                                <Plus size={16} strokeWidth={2.5} />
                            </div>
                            <h3 className="font-black text-slate-800 text-[15px] uppercase tracking-tight ml-1 flex-1">Nueva Solicitud</h3>
                            {/* Alertas de incapacidad — aparecen como íconos a la derecha */}
                            <div className="flex items-center gap-1.5">
                                {disabilityHeaderAlerts.overlap && (
                                    <div className="relative group/tip">
                                        <div className="w-7 h-7 rounded-full bg-red-100 border border-red-300 flex items-center justify-center cursor-default animate-in fade-in zoom-in-75 duration-200">
                                            <AlertTriangle size={13} className="text-red-500" strokeWidth={2.5} />
                                        </div>
                                        <div className="absolute right-0 top-full mt-1.5 w-64 z-50 pointer-events-none opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
                                            <div className="bg-red-700 text-white text-[10px] font-bold leading-snug px-3 py-2 rounded-xl shadow-lg">
                                                Ya tienes asignada una incapacidad del {fmtDisabilityPeriod(disabilityHeaderAlerts.overlap)} — las fechas seleccionadas se solapan con ese período.
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {disabilityHeaderAlerts.needsISSS && (
                                    <div className="relative group/tip2">
                                        <div className="w-7 h-7 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center cursor-default animate-in fade-in zoom-in-75 duration-200">
                                            <Info size={13} className="text-amber-500" strokeWidth={2.5} />
                                        </div>
                                        <div className="absolute right-0 top-full mt-1.5 w-72 z-50 pointer-events-none opacity-0 group-hover/tip2:opacity-100 transition-opacity duration-150">
                                            <div className="bg-amber-700 text-white text-[10px] font-bold leading-snug px-3 py-2 rounded-xl shadow-lg">
                                                Desde el día 4, aplica cobertura del ISSS. El ISSS cubre el 75% de tu salario a partir del día 4. Es obligatorio presentar la boleta oficial de incapacidad del ISSS dentro de 3 días hábiles para que la empresa pueda tramitar el reembolso. Puedes adjuntarla ahora o desde tu solicitud pendiente.
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
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
                                {!typePickerOpen ? (
                                    /* Tipo seleccionado — compacto */
                                    (() => {
                                        const sel  = TYPE_OPTIONS.find(o => o.key === formType);
                                        const conf = REQUEST_TYPES[formType];
                                        const Icon = sel?.icon || FileText;
                                        return (
                                            <button
                                                type="button"
                                                onClick={() => setTypePickerOpen(true)}
                                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-sm ${conf?.color} ${conf?.border} bg-white`}
                                            >
                                                <Icon size={16} strokeWidth={2} />
                                                <span className="flex-1 text-left text-[11px] font-black uppercase tracking-widest">{sel?.label}</span>
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border border-slate-200 rounded-full px-2 py-0.5 bg-white/60">Cambiar</span>
                                            </button>
                                        );
                                    })()
                                ) : (
                                    /* Todos los tipos — expandido */
                                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                                        {TYPE_OPTIONS.map(({ key, icon: Icon, label }) => {
                                            const conf     = REQUEST_TYPES[key];
                                            const isActive = formType === key;
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={() => { setFormType(key); setPayload({}); setError(''); setPermPickerKey(0); setDisabilityFile(null); setTypePickerOpen(false); }}
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
                                )}
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
                                disabled={isSubmitting || formDisabilityBlocked}
                                className="w-full py-4 mt-2 active:scale-[0.98] text-white rounded-[1.25rem] font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 border-none bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
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
                            <div className="col-span-full">
                                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-600 mb-3 flex items-center gap-1.5">
                                    <RefreshCw size={10} /> Requieren tu aprobación
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {peerRequests.map(req => (
                                        <PeerRequestCard
                                            key={req.id}
                                            req={req}
                                            onAccept={handlePeerAccept}
                                            onReject={handlePeerReject}
                                        />
                                    ))}
                                </div>
                                <div className="border-t border-slate-200/50 mt-5 mb-1" />
                            </div>
                        )}

                        <div className="col-span-full flex items-center justify-between">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                <ClipboardList size={10} /> Mis Solicitudes
                            </p>
                            <button
                                onClick={() => setShowOldApproved(v => !v)}
                                className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border transition-all duration-200 ${
                                    showOldApproved
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                        : 'bg-white/60 border-white/60 text-slate-400 hover:text-slate-600 hover:bg-white/80'
                                }`}
                            >
                                {showOldApproved ? 'Solo este mes' : 'Ver anteriores'}
                            </button>
                        </div>

                        {isLoading ? (
                            <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="animate-pulse bg-white/80 border border-white/60 rounded-[2.5rem] p-6 flex flex-col gap-3">
                                        <div className="flex items-center gap-2 pr-10">
                                            <div className="bg-slate-200/80 rounded-md h-6 w-24" />
                                            <div className="bg-slate-200/80 rounded-md h-6 w-20" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="bg-slate-200/80 rounded-full h-3.5 w-full" />
                                            <div className="bg-slate-200/80 rounded-full h-3.5 w-4/5" />
                                        </div>
                                        <div className="bg-slate-200/80 rounded-full h-3 w-28 mt-1" />
                                    </div>
                                ))}
                            </div>
                        ) : filtered.length === 0 ? (
                            <div key={statusFilter} className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] col-span-full">
                                <div className="relative group flex flex-col items-center text-center">
                                    <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-25 pointer-events-none ${
                                        statusFilter === 'PENDING' ? 'bg-[#007AFF]' :
                                        statusFilter === 'APPROVED' ? 'bg-emerald-500' :
                                        statusFilter === 'REJECTED' ? 'bg-red-500' : 'bg-slate-400'
                                    }`} />
                                    <div className={`relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/80 border border-white/90 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-700 group-hover:-translate-y-2 group-hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] transform-gpu overflow-hidden ${
                                        statusFilter === 'PENDING' ? 'text-[#007AFF]' :
                                        statusFilter === 'APPROVED' ? 'text-emerald-500' :
                                        statusFilter === 'REJECTED' ? 'text-red-500' : 'text-slate-400'
                                    }`}>
                                        {statusFilter === 'PENDING'
                                            ? <CheckCircle2 size={40} strokeWidth={2} />
                                            : <ClipboardList size={40} strokeWidth={2} />
                                        }
                                    </div>
                                    <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">
                                        {statusFilter === 'PENDING' ? 'Todo al día' : 'Sin resultados'}
                                    </h3>
                                    <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">
                                        {statusFilter === 'PENDING' ? 'No tienes solicitudes pendientes de respuesta.' : 'Sin solicitudes en esta categoría.'}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            filtered.map(req => (
                                <RequestCard
                                    key={req.id}
                                    req={req}
                                    onCancel={id => setCancelConfirmId(id)}
                                    uploadFileToStorage={uploadFileToStorage}
                                />
                            ))
                        )}
                    </div>
                </div>

            </div>
        <ConfirmModal
            isOpen={!!cancelConfirmId}
            onClose={() => setCancelConfirmId(null)}
            onConfirm={async () => { await handleCancel(cancelConfirmId); setCancelConfirmId(null); }}
            title="Cancelar Solicitud"
            message="¿Estás seguro que deseas cancelar esta solicitud? Esta acción no se puede deshacer."
            confirmText="Sí, cancelar"
            isDestructive={true}
        />
        </GlassViewLayout>
    );
};

export default EmployeeRequestsView;
