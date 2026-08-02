import React, { useState, useCallback, useEffect, memo, useMemo } from 'react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import {
    ClipboardList, Plus, Loader2, X, Palmtree, FileText, RefreshCw,
    DollarSign, FileCheck, CheckCircle2, Send, AlertCircle, XCircle, Check,
    Stethoscope, Upload, FileImage, CalendarDays, Clock, AlertTriangle, Info,
    BarChart2, ArrowRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { REQUEST_TYPES, REQUEST_STATUS } from '../../store/slices/requestsSlice';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import GlassViewLayout from '../../components/GlassViewLayout';
import LiquidSelect from '../../components/common/LiquidSelect';
import ConfirmModal from '../../components/common/ConfirmModal';
import {
    fetchOwnApprovalRequests, fetchPendingShiftChangeRequestsForApprover,
    fetchOwnMinMaxChangeRequests, fetchEmployeeNamesByIds, fetchEmployeeEventsByTypes,
} from '../../data/employeeSelfService';
import { updateApprovalRequest } from '../../data/requests';
import FileField from '../../components/common/FileField';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';

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

// Min/Max requests viven en su tabla; mapeo de estado UI → estado tabla
const MM_STATUS_MAP = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };
const MM_ERP_NAMES = { 1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5' };

// ─────────────────────────────────────────────────────────────────────────────
// MinMaxStatusCard — solicitud de ajuste Min/Max propia (solo lectura, ve estado)
// ─────────────────────────────────────────────────────────────────────────────
const MinMaxStatusCard = memo(({ req }) => {
    const cfg = req.status === 'approved'
        ? { border: 'border-success/40 bg-success/10', variante: 'success', label: 'Aprobada' }
        : req.status === 'rejected'
        ? { border: 'border-danger/40 bg-surface-card', variante: 'danger', label: 'Rechazada' }
        : { border: 'border-brand/30 bg-surface-card', variante: 'warning', label: 'Pendiente' };
    return (
        <div className={`p-5 rounded-modal border-2 ${cfg.border} backdrop-blur-2xl flex flex-col gap-3 shadow-[var(--shadow-elevation-sm)]`}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-chart-1/10 border border-chart-1/30 flex items-center justify-center flex-shrink-0">
                        <BarChart2 size={16} strokeWidth={2} className="text-chart-1-text" />
                    </div>
                    <div>
                        <p className="text-body font-black text-content leading-tight">Ajuste Min/Max</p>
                        <p className="text-caption text-content-3 font-medium">{MM_ERP_NAMES[req.erp_sucursal_id] || req.erp_sucursal_id}</p>
                    </div>
                </div>
                <Badge variant={cfg.variante} size="sm" className="flex-shrink-0" uppercase={false}>{cfg.label}</Badge>
            </div>

            <p className="text-body font-bold text-content leading-tight">{req.product_name || `Producto ${req.erp_product_id}`}</p>

            <div className="flex items-center justify-center gap-3 rounded-2xl bg-surface-card border border-divider py-2">
                <div className="text-right text-body-sm font-bold tabular-nums text-content-3">
                    <div>MIN {req.current_min ?? '—'}</div>
                    <div>MAX {req.current_max ?? '—'}</div>
                </div>
                <ArrowRight size={15} className="text-content-3" />
                <div className="text-left text-body-sm font-black tabular-nums">
                    <div className="text-chart-4-text">MIN {req.requested_min}</div>
                    <div className="text-chart-1-text">MAX {req.requested_max}</div>
                </div>
            </div>

            {req.reason && <p className="text-label text-content-3 italic leading-snug">“{req.reason}”</p>}
            {req.status !== 'pending' && req.decision_note && (
                <p className="text-label text-content-2 font-medium bg-surface-card-hover/70 border border-divider rounded-xl px-3 py-1.5">
                    Respuesta del supervisor: {req.decision_note}
                </p>
            )}
        </div>
    );
});


// ─────────────────────────────────────────────────────────────────────────────
// PeerRequestCard — solicitud de cambio de turno que requiere mi aprobación
// ─────────────────────────────────────────────────────────────────────────────
const PeerRequestCard = memo(({ req, onAccept, onReject }) => {
    const meta = typeof req.metadata === 'object' && req.metadata !== null
        ? req.metadata
        : (() => { try { return JSON.parse(req.metadata); } catch { return {}; } })();

    const dateStr = meta.date
        ? new Date(meta.date + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'long', day: '2-digit', month: 'long' })
        : null;

    return (
        <div className="p-5 rounded-modal border-2 border-chart-9/30 bg-gradient-to-br from-chart-9/10 to-[var(--card-tint-base)] backdrop-blur-2xl flex flex-col gap-4 shadow-[var(--shadow-glow-chart-9-lg)]">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-chart-9/10 border border-chart-9/30 flex items-center justify-center flex-shrink-0">
                        <RefreshCw size={16} strokeWidth={2} className="text-chart-9-text" />
                    </div>
                    <div>
                        <p className="text-body font-black text-content leading-tight">
                            {req.employee?.name || 'Compañero'}
                        </p>
                        <p className="text-caption text-content-3 font-medium">quiere cambiar turno contigo</p>
                    </div>
                </div>
                {dateStr && (
                    <Badge variant="chart-9" uppercase={false} className="flex-shrink-0 whitespace-nowrap"> {dateStr}</Badge>
                )}
            </div>

            {/* Shift comparison grid */}
            <div className="grid grid-cols-2 gap-2">
                <div data-surface="card" className="p-3">
                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">Tu turno ese día</p>
                    <p className="text-body-sm font-black text-content-2">
                        {meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—'}
                    </p>
                    {(!meta.targetShift || meta.targetShift === 'No especificado') && (
                        <p className="text-micro text-content-3 mt-0.5">Lo que darías</p>
                    )}
                </div>
                <div className="bg-chart-9/10 border border-chart-9/20 rounded-2xl p-3">
                    <p className="text-micro font-black text-chart-9-text uppercase tracking-widest mb-1">Turno que tomarías</p>
                    <p className="text-body-sm font-black text-chart-9-text">
                        {meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—'}
                    </p>
                    {(!meta.myShift || meta.myShift === 'No especificado') && (
                        <p className="text-micro text-chart-9 mt-0.5">Lo que recibirías</p>
                    )}
                </div>
            </div>

            {req.note && (
                <p className="text-body-sm text-content-3 italic leading-relaxed">"{req.note}"</p>
            )}

            {/* Full-width action buttons */}
            <div className="grid grid-cols-2 gap-2">
                <Button variant="destructive" icon={X} onClick={() => onReject(req.id)}>Rechazar</Button>
                <Button tone="success" icon={Check} onClick={() => onAccept(req.id)}>Aceptar</Button>
            </div>
        </div>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// RequestCard — solicitud propia
// ─────────────────────────────────────────────────────────────────────────────
const RequestCard = memo(({ req, onCancel, uploadFileToStorage }) => {
    const typeConf  = REQUEST_TYPES[req.type]    || { label: req.type,   color: 'bg-surface-card-hover text-content-2', border: 'border-divider' };
    const statConf  = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-surface-card-hover text-content-3', border: 'border-divider', dot: 'bg-content-3' };
    const TypeIcon  = TYPE_ICONS[req.type] || FileText;
    const maxLevels = req.type === 'SHIFT_CHANGE' ? 2 : 3;
    const [meta, setMeta] = useState(
        typeof req.metadata === 'object' && req.metadata ? req.metadata : {}
    );
    const [uploadingDoc, setUploadingDoc] = useState(false);

    const cardBg =
        req.status === 'PENDING'   ? 'border-brand/30 bg-surface-card backdrop-blur-2xl' :
        req.status === 'APPROVED'  ? 'border-success/40 bg-success/10 backdrop-blur-2xl' :
        req.status === 'REJECTED'  ? 'border-danger/40 bg-surface-card backdrop-blur-xl' :
        'border-border-card bg-surface-card backdrop-blur-md';

    return (
        <div className={`rounded-header border flex flex-col transition-all duration-300 relative transform-gpu shadow-[var(--shadow-elevation-xs)] hover:shadow-[var(--shadow-elevation-sm)] hover:translate-y-[var(--lift-card)] ${cardBg}`}>
            {/* ── Header ── */}
            <div className="p-5 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transform-gpu overflow-hidden ${typeConf.color} border ${typeConf.border}`}>
                    <TypeIcon size={16} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <span className={`text-caption font-black uppercase tracking-widest ${typeConf.color.split(' ')[1]}`}>
                            {typeConf.label}
                        </span>
                        <span className="text-content-3">·</span>
                        <span className={`flex items-center gap-1 text-caption font-bold ${statConf.color.split(' ')[1]}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {statConf.label}
                        </span>
                        {req.status === 'PENDING' && req.current_level && req.type !== 'DISABILITY' && (
                            <span className="text-micro font-bold text-brand-text">· Niv. {req.current_level}/{maxLevels}</span>
                        )}
                        {req.type === 'DISABILITY' && req.status === 'PENDING' && (
                            <span className="text-micro font-black text-danger uppercase tracking-widest">· Urgente</span>
                        )}
                    </div>
                    <p className="text-caption font-bold text-content-2 uppercase tracking-widest">
                        {new Date(req.created_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                </div>
                {req.status === 'PENDING' && (
                    <Button variant="destructive" icon={X} onClick={() => onCancel(req.id)}>Cancelar</Button>
                )}
            </div>

            {/* ── Contenido ── */}
            <div className="px-5 pb-5 flex flex-col gap-3 border-t border-divider pt-4">
                {req.note && (
                    <p className="text-content-2 text-body-lg leading-relaxed font-medium whitespace-pre-wrap">
                        {req.note}
                    </p>
                )}

                {req.type === 'SHIFT_CHANGE' && (
                    <div className="space-y-2">
                        {(meta.targetEmployeeName || meta.date) && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-chart-9/10 border border-chart-9/30">
                                <RefreshCw size={13} className="text-chart-9-text flex-shrink-0" strokeWidth={2} />
                                <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    {meta.targetEmployeeName && (
                                        <span className="text-body-sm font-black text-chart-9-text">↔ {meta.targetEmployeeName}</span>
                                    )}
                                    {meta.date && (
                                        <span className="text-label font-bold text-chart-9-text">
                                            {new Date(meta.date + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <div data-surface="card" className="p-3">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">Tu turno ese día</p>
                                <p className="text-body-sm font-black text-content-2">
                                    {meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—'}
                                </p>
                            </div>
                            <div className="bg-chart-9/10 border border-chart-9/20 rounded-2xl p-3">
                                <p className="text-micro font-black text-chart-9-text uppercase tracking-widest mb-1">Turno de {meta.targetEmployeeName?.split(' ')[0] || 'compañero'}</p>
                                <p className="text-body-sm font-black text-content-2">
                                    {meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {req.type === 'DISABILITY' && (
                    <div className="space-y-2">
                        {meta.startDate && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-danger/10 border border-danger/30">
                                <Stethoscope size={13} className="text-danger flex-shrink-0" strokeWidth={2} />
                                <span className="text-body-sm font-bold text-danger-text">
                                    {new Date(meta.startDate + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                                    {meta.endDate && meta.endDate !== meta.startDate && (
                                        <> – {new Date(meta.endDate + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}</>
                                    )}
                                    {meta.days && <span className="text-danger font-medium ml-1.5">({meta.days} días)</span>}
                                </span>
                            </div>
                        )}
                        {meta.docUrl && (
                            <a href={meta.docUrl} target="_blank" rel="noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-card-hover border border-divider text-label font-bold text-content-2 hover:text-brand-text hover:border-brand/30 transition-all">
                                <FileImage size={13} strokeWidth={2} />
                                {meta.docName || 'Ver certificado adjunto'}
                            </a>
                        )}
                        {/* Canónico `FileField` (2c, 2026-07-27). `busy` conserva el
                            "Subiendo…": acá el archivo se sube apenas se elige, y sin
                            esa señal la fila se queda muda varios segundos. */}
                        {req.status === 'PENDING' && uploadFileToStorage && (
                            <FileField
                                accept=".pdf,.jpg,.jpeg,.png"
                                density="sm"
                                emptyState="pending"
                                busy={uploadingDoc}
                                url={meta.docUrl}
                                name={meta.docName}
                                onChange={async (file) => {
                                    if (!file || !uploadFileToStorage) return;
                                    setUploadingDoc(true);
                                    const url = await uploadFileToStorage(file, 'documents', 'disability');
                                    if (url) {
                                        const newMeta = { ...meta, docUrl: url, docName: file.name };
                                        await updateApprovalRequest(req.id, { metadata: newMeta });
                                        setMeta(newMeta);
                                        useToastStore.getState().showToast('Documento actualizado', 'El certificado fue reemplazado correctamente.');
                                    }
                                    setUploadingDoc(false);
                                }}
                            />
                        )}
                    </div>
                )}

                {req.approver_note && (
                    <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-body-sm font-bold border ${
                        req.status === 'APPROVED' ? 'bg-success/10 border-success/30 text-success-text' :
                        req.status === 'REJECTED' ? 'bg-danger/10 border-danger/30 text-danger' :
                        'bg-surface-card-hover border-divider text-content-2'
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
    const createRequest = useStaffStore(s => s.createRequest);
    const cancelRequest = useStaffStore(s => s.cancelRequest);
    const approvePeerRequest = useStaffStore(s => s.approvePeerRequest);
    const rejectPeerRequest = useStaffStore(s => s.rejectPeerRequest);
    const holidays = useStaffStore(s => s.holidays);
    const employees = useStaffStore(s => s.employees);
    const uploadFileToStorage = useStaffStore(s => s.uploadFileToStorage);

    const [requests, setRequests]         = useState([]);
    const [peerRequests, setPeerRequests] = useState([]);
    const [minmaxReqs, setMinmaxReqs]     = useState([]);
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
        if (!payload.targetEmployeeId || !payload.date) { setTargetEmpStatus(null); return; } // eslint-disable-line react-hooks/set-state-in-effect -- reset antes de re-fetch al cambiar de compañero/fecha
        let cancelled = false;
        fetchEmployeeEventsByTypes(payload.targetEmployeeId)
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
        const fmt = (s) => new Date(s + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
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
        const [{ data: ownData }, { data: peerData }, { data: mmData }] = await Promise.all([
            fetchOwnApprovalRequests(user.id),
            fetchPendingShiftChangeRequestsForApprover(user.id),
            fetchOwnMinMaxChangeRequests(user.id),
        ]);

        setRequests(ownData || []);
        setMinmaxReqs(mmData || []);

        // Enriquecer peer requests con nombre del solicitante
        const rawPeer = (peerData || []).filter(r => {
            const meta = typeof r.metadata === 'object' ? r.metadata : (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })();
            return meta?.peerApprovalRequired === true;
        });

        if (rawPeer.length > 0) {
            const empIds = [...new Set(rawPeer.map(r => r.employee_id).filter(Boolean))];
            const { data: empRows } = await fetchEmployeeNamesByIds(empIds);
            const empMap = Object.fromEntries((empRows || []).map(e => [String(e.id), e]));
            setPeerRequests(rawPeer.map(r => ({ ...r, employee: empMap[String(r.employee_id)] || null })));
        } else {
            setPeerRequests([]);
        }

        setIsLoading(false);
    }, [user]);

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

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

    const filteredMinmax = useMemo(() => {
        const target = MM_STATUS_MAP[statusFilter];
        if (!target) return [];
        let list = minmaxReqs.filter(r => r.status === target);
        if (!showOldApproved) {
            list = list.filter(r => r.status !== 'approved' || ((r.decided_at || r.requested_at)?.slice(0, 7) === currentYM));
        }
        return list;
    }, [minmaxReqs, statusFilter, showOldApproved, currentYM]);

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
                setError(`El día ${new Date(blocked + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })} cae dentro de tu incapacidad activa (${fmtDisabilityPeriod(c)}).`);
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
            const fmt = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
            const hasRange = payload.startDate && payload.endDate;

            return (
                <div className="space-y-3">
                    {/* Antigüedad */}
                    {vacationInfo && (
                        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl border text-label font-bold ${
                            !vacationInfo.eligible
                                ? 'bg-warning/10 border-warning/30 text-warning-text'
                                : 'bg-success/10 border-success/30 text-success-text'
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
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-warning/10 border border-warning/30 text-label font-bold text-warning-text">
                                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                                <span>Ya tienes vacaciones aprobadas{m.startDate ? ` del ${fmt(m.startDate)} al ${fmt(m.endDate)}` : ''}. No puedes solicitar otra.</span>
                            </div>
                        );
                    })()}

                    {/* Vacación pendiente */}
                    {!existingVacation.approved && existingVacation.pending && (() => {
                        const m = typeof existingVacation.pending.metadata === 'object' ? existingVacation.pending.metadata : {};
                        return (
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-brand/8 border border-brand/20 text-label font-bold text-brand-text">
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
                                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] ml-1">
                                        Período de Vacaciones
                                    </label>
                                    {hasRange && (
                                        <Button variant="ghost" icon={X} onClick={() => setPayload(prev => ({ ...prev, startDate: '', endDate: '' }))}>Limpiar</Button>
                                    )}
                                </div>
                                <RangeDatePicker
                                    startDate={payload.startDate || ''} endDate={payload.endDate || ''}
                                    onRangeChange={(s, e) => setPayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                                    holidays={holidays} defaultDays={15} label="vacaciones"
                                />
                            </div>
                            {vacationInfo.inWindow && (
                                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card-hover border border-divider text-caption font-bold text-content-3">
                                    <CalendarDays size={11} strokeWidth={2} />
                                    Ventana disponible: {fmt(vacationInfo.windowStart)} — {fmt(vacationInfo.windowEnd)}
                                </div>
                            )}
                            {!vacationInfo.inWindow && (
                                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card-hover border border-divider text-caption font-bold text-content-3">
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
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-warning/10 border border-warning/30">
                            <AlertTriangle size={13} className="text-warning flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                            <div>
                                <p className="text-caption font-black text-warning-text uppercase tracking-wide">Incapacidad activa</p>
                                <p className="text-label font-medium text-warning-text leading-snug">
                                    {activeDisabilities.map(d => fmtDisabilityPeriod(d)).join(', ')} — los días cubiertos no están disponibles.
                                </p>
                            </div>
                        </div>
                    )}
                    <div>
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1.5 ml-1">
                            <CalendarDays size={11} strokeWidth={2.5} className="text-chart-3-text" />
                            Días de Permiso
                        </label>
                        <div className="bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
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
                                <Badge key={d} variant="chart-3" uppercase={false}>
                                    {new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                                    <Button variant="ghost" icon={XCircle} iconOnly onClick={() => handleRemovePermDate(d)} />
                                </Badge>
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
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
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
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1.5 ml-1">
                            <CalendarDays size={11} strokeWidth={2.5} className="text-chart-9" />
                            Fecha del cambio
                        </label>
                        <div className="bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
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
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30 text-label font-bold text-danger-text">
                            <AlertTriangle size={13} className="flex-shrink-0" strokeWidth={2.5} />
                            Estás incapacitado ese día ({fmtDisabilityPeriod(disabilityConflict(payload.date))}) — no puedes solicitar cambio de turno
                        </div>
                    )}
                    {/* Bloqueo: incapacidad / permiso / vacación del compañero */}
                    {targetEmpStatus?.blocked && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30 text-label font-bold text-danger-text">
                            <AlertTriangle size={13} className="flex-shrink-0" strokeWidth={2.5} />
                            {targetEmp?.name?.split(' ')[0] || 'El compañero'} está {targetEmpStatus.reason} ese día — no puede hacer el cambio
                        </div>
                    )}

                    {/* Turnos lado a lado */}
                    {showShifts && !targetEmpStatus?.blocked && (
                        <div className="grid grid-cols-2 gap-2">
                            <div data-surface="card" className="p-3">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">Mi turno ese día</p>
                                <p className="text-body-sm font-black text-content-2">
                                    {myShiftOnDate ? `${myShiftOnDate.start} – ${myShiftOnDate.end}` : '—'}
                                </p>
                                {!myShiftOnDate && <p className="text-micro text-content-3 mt-0.5">Sin turno asignado</p>}
                            </div>
                            <div className="bg-chart-9/10 border border-chart-9/20 rounded-2xl p-3">
                                <p className="text-micro font-black text-chart-9-text uppercase tracking-widest mb-1">
                                    Turno de {targetEmp?.name?.split(' ')[0] || 'compañero'}
                                </p>
                                <p className="text-body-sm font-black text-chart-9-text">
                                    {targetEmpShift ? `${targetEmpShift.start} – ${targetEmpShift.end}` : '—'}
                                </p>
                                {!targetEmpShift && <p className="text-micro text-chart-9 mt-0.5">Sin turno asignado</p>}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        if (formType === 'ADVANCE') {
            return (
                <PortalInput
                    label="Monto solicitado" name="sol-monto" prefix="$"
                    type="number" min="1" step="1"
                    value={payload.amount || ''}
                    onChange={e => setPayload(prev => ({ ...prev, amount: e.target.value }))}
                    placeholder="0.00"
                />
            );
        }

        if (formType === 'CERTIFICATE') {
            return (
                <div>
                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">
                        Tipo de Constancia
                    </label>
                    <LiquidSelect
                        value={payload.certificateType || ''}
                        onChange={v => setPayload(prev => ({ ...prev, certificateType: v }))}
                        placeholder="Seleccionar tipo de constancia..."
                        options={CERT_TYPES.map(c => ({ value: c.key, label: c.label }))}
                    />
                    {payload.certificateType && (
                        <p className="text-label text-content-3 mt-1.5 ml-1">
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
                            <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                Primer día
                            </label>
                            <div className="bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
                                <LiquidDatePicker
                                    value={payload.startDate || ''}
                                    onChange={v => setPayload(prev => ({ ...prev, startDate: v }))}
                                    holidays={holidays}
                                />
                            </div>
                        </div>

                        {/* Cantidad de días */}
                        <PortalInput
                                label="Cantidad de días" name="sol-dias"
                                type="number" min="1" max="365"
                                value={payload.days || ''}
                                onChange={e => setPayload(prev => ({ ...prev, days: e.target.value }))}
                                placeholder="Ej. 3"
                            />
                    </div>

                    {/* Fecha fin calculada — chip compacto */}
                    {endDate && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border bg-danger/10 border-danger/30 text-danger-text w-fit text-caption font-black uppercase tracking-widest">
                            <Stethoscope size={11} className="text-danger flex-shrink-0" strokeWidth={2.5} />
                            <span>Hasta {endDate.toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                        </div>
                    )}

                    {/* Upload documento */}
                    <div>
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                            {needsISSS
                                ? <span>Boleta ISSS <span className="text-danger">*</span><span className="text-content-3 ml-1 normal-case font-medium">(obligatoria para cobertura ISSS)</span></span>
                                : <span>Certificado Médico <span className="text-content-3 ml-1 normal-case font-medium">(opcional)</span></span>
                            }
                        </label>
                        <FileField
                            accept=".pdf,.jpg,.jpeg,.png"
                            file={disabilityFile}
                            onChange={setDisabilityFile}
                            hint="PDF, JPG o PNG — también podés adjuntarlo después"
                        />
                    </div>

                    <div className="px-4 py-2.5 rounded-2xl bg-danger/10 border border-danger/30">
                        <p className="text-label font-bold text-danger-text leading-relaxed">
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
        <div data-surface="card" className="flex items-center hover:shadow-[var(--shadow-glass-md)] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]  transform-gpu animate-in fade-in slide-in-from-right-8 w-max max-w-full">
            <div className="flex items-center gap-1 md:gap-1.5 pl-2 pr-2 md:pr-3">
                <SegmentedControl
                    label="Estado de las solicitudes"
                    tone="neutro"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={TABS.map(t => ({ value: t.key, label: t.label }))}
                />
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
            <div className="flex flex-col lg:flex-row items-start gap-6 lg:gap-8 px-2 lg:px-0 w-full lg:h-[calc(100vh-230px)]">

                {/* ── PANEL IZQUIERDO: Formulario ── */}
                <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 px-2 -mx-2 group/panel transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] z-sidebar transform-gpu">
                    <div data-surface="card" className="p-6 md:p-8 hover:shadow-[var(--shadow-glass-5)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">

                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand text-white shadow-sm">
                                <Plus size={16} strokeWidth={2.5} />
                            </div>
                            <h3 className="font-black text-content text-subtitle uppercase tracking-tight ml-1 flex-1">Nueva Solicitud</h3>
                            {/* Alertas de incapacidad — aparecen como íconos a la derecha */}
                            <div className="flex items-center gap-1.5">
                                {disabilityHeaderAlerts.overlap && (
                                    <div className="relative group/tip">
                                        <div className="w-7 h-7 rounded-full bg-danger/10 border border-danger/40 flex items-center justify-center cursor-default animate-in fade-in zoom-in-75 duration-200">
                                            <AlertTriangle size={13} className="text-danger" strokeWidth={2.5} />
                                        </div>
                                        <div className="absolute right-0 top-full mt-1.5 w-64 z-sidebar pointer-events-none opacity-0 group-hover/tip:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                                            <div className="bg-danger-solid text-white text-caption font-bold leading-snug px-3 py-2 rounded-xl shadow-lg">
                                                Ya tienes asignada una incapacidad del {fmtDisabilityPeriod(disabilityHeaderAlerts.overlap)} — las fechas seleccionadas se solapan con ese período.
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {disabilityHeaderAlerts.needsISSS && (
                                    <div className="relative group/tip2">
                                        <div className="w-7 h-7 rounded-full bg-warning/10 border border-warning/40 flex items-center justify-center cursor-default animate-in fade-in zoom-in-75 duration-200">
                                            <Info size={13} className="text-warning" strokeWidth={2.5} />
                                        </div>
                                        <div className="absolute right-0 top-full mt-1.5 w-72 z-sidebar pointer-events-none opacity-0 group-hover/tip2:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                                            <div className="bg-warning-solid text-white text-caption font-bold leading-snug px-3 py-2 rounded-xl shadow-lg">
                                                Desde el día 4, aplica cobertura del ISSS. El ISSS cubre el 75% de tu salario a partir del día 4. Es obligatorio presentar la boleta oficial de incapacidad del ISSS dentro de 3 días hábiles para que la empresa pueda tramitar el reembolso. Puedes adjuntarla ahora o desde tu solicitud pendiente.
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {error && (
                            <div className="mb-5 bg-warning/10 backdrop-blur-sm border border-warning/30 text-warning-text px-4 py-3 rounded-2xl text-label font-bold shadow-[var(--shadow-shine)] flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
                                <AlertCircle size={16} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                                <span className="leading-tight">{error}</span>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5 relative z-base">

                            {/* Selector de tipo */}
                            <div>
                                <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">Tipo de Solicitud</label>
                                {!typePickerOpen ? (
                                    /* Tipo seleccionado — compacto */
                                    (() => {
                                        const sel  = TYPE_OPTIONS.find(o => o.key === formType);
                                        const Icon = sel?.icon || FileText;
                                        return (
                                            <Button
                                                variant="secondary"
                                                tone={REQUEST_TYPES[formType]?.variante ?? 'brand'}
                                                soft
                                                size="lg"
                                                className="w-full justify-start"
                                                icon={Icon}
                                                aria-expanded={false}
                                                aria-label={`Tipo de solicitud: ${sel?.label}. Cambiar`}
                                                onClick={() => setTypePickerOpen(true)}
                                            >
                                                <span className="flex-1 text-left uppercase tracking-widest">{sel?.label}</span>
                                                <Badge size="sm" className="ml-2">Cambiar</Badge>
                                            </Button>
                                        );
                                    })()
                                ) : (
                                    /* Todos los tipos — expandido.
                                       OJO: acá había un `<div className="grid grid-cols-3">`
                                       envolviendo. `SegmentedControl` en bloque YA ES una grilla,
                                       así que dejarlo dentro lo metía en una sola celda y las seis
                                       tarjetas se encogían a un tercio del ancho con las etiquetas
                                       encimadas. Se vio en la verificación, no en el build. */
                                    <>
                                        {/* Seis tarjetas de elección excluyente: eso es
                                            `SegmentedControl` con `layout="block"`, que ya existía
                                            justamente para este caso. Lo que faltaba era `stacked`
                                            (ícono arriba del texto), agregado al canónico para no
                                            cambiarles la forma. El color por tipo se conserva:
                                            `tone` acepta un valor POR OPCIÓN, y el `bg-chart-N/10`
                                            de `REQUEST_TYPES` se mapea a su `chart-N`. */}
                                        <SegmentedControl
                                            layout="block" columns={3} stacked
                                            label="Tipo de solicitud"
                                            value={formType}
                                            onChange={(k) => { setFormType(k); setPayload({}); setError(''); setPermPickerKey(0); setDisabilityFile(null); setTypePickerOpen(false); }}
                                            options={TYPE_OPTIONS.map(({ key, icon, label }) => ({
                                                value: key,
                                                label,
                                                icon,
                                                tone: REQUEST_TYPES[key]?.variante ?? 'brand',
                                            }))}
                                        />
                                    </>
                                )}
                            </div>

                            {/* Sección específica por tipo */}
                            {renderTypeSection()}

                            {/* Motivo */}
                            <div>
                                <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                    Motivo / Descripción <span className="text-danger">*</span>
                                </label>
                                <PortalTextarea
                                    value={formNote}
                                    onChange={e => { setFormNote(e.target.value); if (error) setError(''); }}
                                    rows={4}
                                    placeholder="Describe tu solicitud..."
                                    disabled={isSubmitting}
                                />
                            </div>

                            <Button type="submit" size="lg" icon={Send} loading={isSubmitting}
                                disabled={isSubmitting || formDisabilityBlocked} className="w-full mt-2">
                                {isSubmitting ? 'Enviando…' : 'Enviar solicitud'}
                            </Button>
                        </form>
                    </div>
                </div>

                {/* ── PANEL DERECHO: Lista ── */}
                <div className="flex-1 flex flex-col min-w-0 w-full overflow-y-auto overscroll-contain pb-32 scrollbar-hide lg:h-[100dvh] lg:-mt-[180px] xl:-mt-[200px] lg:pt-[180px] xl:pt-[200px] pointer-events-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 pt-4 px-3 md:px-4 content-start">

                        {/* Solicitudes de cambio de turno que requieren mi aprobación */}
                        {peerRequests.length > 0 && (
                            <div className="col-span-full">
                                <p className="text-caption font-black uppercase tracking-widest text-chart-9-text mb-3 flex items-center gap-1.5">
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
                                <div className="border-t border-divider mt-5 mb-1" />
                            </div>
                        )}

                        <div className="col-span-full flex items-center justify-between">
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5">
                                <ClipboardList size={10} /> Mis Solicitudes
                            </p>
                            <Button
                                size="xs"
                                aria-pressed={showOldApproved}
                                variant="secondary"
                                tone={showOldApproved ? 'success' : null}
                                soft
                                onClick={() => setShowOldApproved(v => !v)}
                            >
                                {showOldApproved ? 'Solo este mes' : 'Ver anteriores'}
                            </Button>
                        </div>

                        {isLoading ? (
                            <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} data-surface="card" className="animate-stagger-child p-6 flex flex-col gap-3" style={{ '--stagger-delay': `${i * 60}ms` }}>
                                        <div className="flex items-center gap-2 pr-10">
                                            <div className="skeleton rounded-md h-6 w-24" />
                                            <div className="skeleton rounded-md h-6 w-20" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="skeleton rounded-full h-3.5 w-full" />
                                            <div className="skeleton rounded-full h-3.5 w-4/5" />
                                        </div>
                                        <div className="skeleton rounded-full h-3 w-28 mt-1" />
                                    </div>
                                ))}
                            </div>
                        ) : (filtered.length === 0 && filteredMinmax.length === 0) ? (
                            <div key={statusFilter} className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] col-span-full">
                                <div className="relative group flex flex-col items-center text-center">
                                    <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-25 pointer-events-none ${
                                        statusFilter === 'PENDING' ? 'bg-brand' :
                                        statusFilter === 'APPROVED' ? 'bg-success' :
                                        statusFilter === 'REJECTED' ? 'bg-danger' : 'bg-content-3'
                                    }`} />
                                    <div className={`relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card border border-border-card shadow-[var(--shadow-elevation-md)] transition-all duration-700 group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] transform-gpu overflow-hidden ${
                                        statusFilter === 'PENDING' ? 'text-brand-text' :
                                        statusFilter === 'APPROVED' ? 'text-success' :
                                        statusFilter === 'REJECTED' ? 'text-danger' : 'text-content-3'
                                    }`}>
                                        {statusFilter === 'PENDING'
                                            ? <CheckCircle2 size={40} strokeWidth={2} />
                                            : <ClipboardList size={40} strokeWidth={2} />
                                        }
                                    </div>
                                    <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">
                                        {statusFilter === 'PENDING' ? 'Todo al día' : 'Sin resultados'}
                                    </h3>
                                    <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">
                                        {statusFilter === 'PENDING' ? 'No tienes solicitudes pendientes de respuesta.' : 'Sin solicitudes en esta categoría.'}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                {filtered.map(req => (
                                    <RequestCard
                                        key={req.id}
                                        req={req}
                                        onCancel={id => setCancelConfirmId(id)}
                                        uploadFileToStorage={uploadFileToStorage}
                                    />
                                ))}
                                {filteredMinmax.map(req => (
                                    <MinMaxStatusCard key={`mm-${req.id}`} req={req} />
                                ))}
                            </>
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
