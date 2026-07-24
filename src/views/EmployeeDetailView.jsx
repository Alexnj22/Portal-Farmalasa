import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { tokenMatch } from '../utils/searchUtils';
import {
    Edit, Mail, Phone, Shield,
    Clock, FileText, Paperclip,
    CheckCircle, Plus, UploadCloud, Activity, ShieldAlert,
    MapPin, Briefcase, HeartPulse,
    Cake, AlertCircle, AlertTriangle, Wallet, CalendarDays, Coffee, User, ArrowLeft, ArrowRightLeft, Ban, Loader2,
    KeyRound, Camera, ClipboardList, Palmtree, RefreshCw, DollarSign, FileCheck, Check, X, Search, Stethoscope, ChevronLeft, ChevronRight,
    Copy
} from 'lucide-react';
import { REQUEST_TYPES, REQUEST_STATUS } from '../store/slices/requestsSlice';
import { EVENT_TYPES, WEEK_DAYS } from '../data/constants';
import { formatDate, formatTime12h, getEffectiveStatus } from '../utils/helpers';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import { useToastStore } from '../store/toastStore';
import { fetchEmployeeApprovalRequestsDetail } from '../data/requests';
import { fetchEmployeeTimeline } from '../data/employees';
import LiquidAvatar from '../components/common/LiquidAvatar';
import GlassViewLayout from '../components/GlassViewLayout';
import ConfirmModal from '../components/common/ConfirmModal';
import EmployeeDocumentsList from '../components/common/EmployeeDocumentsList';

const EmployeeDetailView = ({ activeEmployee, openModal, setView, activeTab, setActiveTab }) => {
    const navigate = useNavigate(); 
    const employees = useStaffStore(s => s.employees);
    const branches = useStaffStore(s => s.branches);
    const shifts = useStaffStore(s => s.shifts);
    const employeesStatus = useStaffStore(s => s.employeesStatus);
    const { user, hasPermission } = useAuth();
    const canEdit = hasPermission('staff_detail', 'can_edit');
    
    const [_activeTab, _setActiveTab] = useState('history');
    const currentTab = activeTab || _activeTab;
    const setCurrentTab = setActiveTab || _setActiveTab;

    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [resetResult, setResetResult] = useState(null); // contraseña temporal generada
    const [copiedPwd, setCopiedPwd]     = useState(false);
    const [cancelingEventId, setCancelingEventId] = useState(null);
    const [cancelReason, setCancelReason] = useState('');
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelModalRender, setCancelModalRender] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);

    // ── Timeline: fuente de verdad desde employee_timeline view ──────────────
    const [timelineData, setTimelineData]         = useState([]);
    const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);

    // ── Tab Solicitudes: solo lectura, historial del empleado (crear/cancelar
    // se hace desde Gestión de Solicitudes — ver botón "Nueva Solicitud" abajo) ──
    const [empRequests, setEmpRequests]       = useState([]);
    const [isLoadingEmpReqs, setIsLoadingEmpReqs] = useState(false);

    const loadEmpRequests = useCallback(async () => {
        const eid = activeEmployee?.id || user?.id;
        if (!eid) return;
        setIsLoadingEmpReqs(true);
        try {
            const { data, error } = await fetchEmployeeApprovalRequestsDetail(eid);
            if (error) console.error('loadEmpRequests failed:', error.message);
            setEmpRequests(data || []);
        } catch { /* silencioso */ }
        finally { setIsLoadingEmpReqs(false); }
    }, [activeEmployee?.id, user?.id]);

    useEffect(() => {
        if (currentTab === 'requests') loadEmpRequests();
    }, [currentTab, loadEmpRequests]);

    useEffect(() => {
        if (showCancelModal) setCancelModalRender(true);
        else { const t = setTimeout(() => setCancelModalRender(false), 300); return () => clearTimeout(t); }
    }, [showCancelModal]);

    // ── Cargar timeline desde la VIEW employee_timeline ──────────────────────
    const fetchTimeline = useCallback(async () => {
        const eid = activeEmployee?.id || user?.id;
        if (!eid) return;
        setIsLoadingTimeline(true);
        try {
            const { data, error } = await fetchEmployeeTimeline(eid);
            if (error) console.error('fetchTimeline failed:', error.message);
            setTimelineData(data || []);
        } catch (e) {
            console.error('Error cargando timeline:', e);
        } finally {
            setIsLoadingTimeline(false);
        }
    }, [activeEmployee?.id, user?.id]);

    useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

    useEffect(() => {
        window.addEventListener('force-history-refresh', fetchTimeline);
        return () => window.removeEventListener('force-history-refresh', fetchTimeline);
    }, [fetchTimeline]);

    const targetId = activeEmployee?.id || user?.id;
    const emp = employees.find(e => String(e.id) === String(targetId)) || (activeEmployee || user);

    const branch = branches.find(b => String(b.id) === String(emp?.branchId || emp?.branch_id));

    const [ausenciasSearch, setAusenciasSearch]           = useState('');
    const [ausenciasSearchOpen, setAusenciasSearchOpen]   = useState(false);
    const [ausenciasSelectedDay, setAusenciasSelectedDay] = useState(null);
    const [ausenciasCalMonth, setAusenciasCalMonth]       = useState(() => new Date());

    const timeline = useMemo(() => {
        if (!emp) return [];
        return timelineData.map(ev => ({
            id: `${ev.event_type}_${ev.event_date}_${ev.created_at}`,
            type: ev.event_type,
            category: ev.category,
            date: ev.event_date,
            endDate: ev.event_end_date,
            note: ev.note || ev.metadata?.note || ev.metadata?.details?.note || 'Evento registrado en el sistema.',
            metadata: ev.metadata || {},
            documentId: ev.metadata?.document_id || null,
            isSystem: ['HIRE', 'ROSTER_PUBLISHED'].includes(ev.event_type),
        }));
    }, [timelineData, emp]);

    const ausenciasData = useMemo(() => {
        let list = timeline.filter(ev => ev.type === 'PERMIT' || ev.type === 'DISABILITY');
        if (ausenciasSelectedDay) {
            list = list.filter(ev => {
                const meta = ev.metadata || {};
                if (ev.type === 'PERMIT' && meta.permissionDates?.length > 0) return meta.permissionDates.includes(ausenciasSelectedDay);
                const start = ev.date || ausenciasSelectedDay;
                const end   = meta.endDate || ev.date || ausenciasSelectedDay;
                return ausenciasSelectedDay >= start && ausenciasSelectedDay <= end;
            });
        } else {
            const y = ausenciasCalMonth.getFullYear();
            const m = String(ausenciasCalMonth.getMonth() + 1).padStart(2, '0');
            const monthStr = `${y}-${m}`;
            list = list.filter(ev => {
                const meta = ev.metadata || {};
                if (ev.type === 'PERMIT' && meta.permissionDates?.length > 0) return meta.permissionDates.some(d => d.startsWith(monthStr));
                return (ev.date || '').startsWith(monthStr) || (meta.endDate || '').startsWith(monthStr);
            });
        }
        if (ausenciasSearch.trim()) {
            list = list.filter(ev => tokenMatch(ausenciasSearch, ev.note, ev.type));
        }
        return list;
    }, [timeline, ausenciasSelectedDay, ausenciasCalMonth, ausenciasSearch]);

    // Calendar: expand date ranges → map { dateStr: { types, events, isInsuranceDay } }
    const ausenciasCalEvents = useMemo(() => {
        const map = {};
        const addDay = (d, type, ev, dayIndex) => {
            if (!map[d]) map[d] = { types: new Set(), events: [], isInsuranceDay: false };
            map[d].types.add(type);
            if (!map[d].events.find(e => e.id === ev.id)) map[d].events.push(ev);
            if (type === 'DISABILITY' && dayIndex >= 3) map[d].isInsuranceDay = true;
        };
        timeline.filter(ev => ev.type === 'PERMIT' || ev.type === 'DISABILITY').forEach(ev => {
            const meta = ev.metadata || {};
            if (ev.type === 'PERMIT' && meta.permissionDates?.length > 0) {
                meta.permissionDates.forEach(d => addDay(d, 'PERMIT', ev, 0));
            } else {
                const start = new Date((ev.date || new Date().toISOString().split('T')[0]) + 'T12:00:00');
                const end   = new Date((meta.endDate || ev.date || new Date().toISOString().split('T')[0]) + 'T12:00:00');
                const cur   = new Date(start);
                let dayIndex = 0;
                while (cur <= end) {
                    addDay(cur.toISOString().split('T')[0], ev.type, ev, dayIndex);
                    cur.setDate(cur.getDate() + 1);
                    dayIndex++;
                }
            }
        });
        return map;
    }, [timeline]);

    // Shift hours per Spanish day name, for tooltip "horas de turno"
    const shiftHoursMap = useMemo(() => {
        const map = {};
        const scheduleMap = emp.weeklySchedule || {};
        WEEK_DAYS.forEach(wd => {
            const shiftId = scheduleMap[wd.id];
            if (!shiftId || shiftId === 'LIBRE') return;
            const shift = shifts.find(s => String(s.id) === String(shiftId));
            if (!shift?.start || !shift?.end) return;
            const [sh, sm] = shift.start.split(':').map(Number);
            const [eh, em] = shift.end.split(':').map(Number);
            let mins = (eh * 60 + em) - (sh * 60 + sm);
            if (mins < 0) mins += 24 * 60;
            map[wd.name] = Math.round(mins / 6) / 10;
        });
        return map;
    }, [emp?.weeklySchedule, shifts]);

    const ausenciasCalDays = useMemo(() => {
        const y = ausenciasCalMonth.getFullYear(), m = ausenciasCalMonth.getMonth();
        const firstDow = new Date(y, m, 1).getDay();
        const dim = new Date(y, m + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < firstDow; i++) cells.push(null);
        for (let d = 1; d <= dim; d++) cells.push(d);
        return { cells, year: y, month: m };
    }, [ausenciasCalMonth]);

    const fallbackInitials = emp?.name ? emp.name.charAt(0).toUpperCase() : '👤';

    const age = useMemo(() => {
        if (!emp?.birth_date && !emp?.birthDate) return null;
        const bDate = new Date((emp.birth_date || emp.birthDate) + 'T12:00:00');
        const diff = Date.now() - bDate.getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
    }, [emp?.birth_date, emp?.birthDate]);

    const tenure = useMemo(() => {
        if (!emp?.hire_date && !emp?.hireDate) return 'Sin fecha';
        const hDate = new Date((emp.hire_date || emp.hireDate) + 'T12:00:00');
        const now = new Date();
        let years = now.getFullYear() - hDate.getFullYear();
        let months = now.getMonth() - hDate.getMonth();
        if (months < 0) { years--; months += 12; }
        if (years === 0 && months === 0) return 'Nuevo Ingreso';
        return `${years > 0 ? `${years} Año${years > 1 ? 's' : ''} ` : ''}${months > 0 ? `${months} Mes${months > 1 ? 'es' : ''}` : ''}`;
    }, [emp?.hire_date, emp?.hireDate]);

    const latePunches = useMemo(() => {
        return (emp?.attendance || []).filter(a => a.type === 'LATE').length;
    }, [emp?.attendance]);

    const scheduleData = useMemo(() => {
        const scheduleMap = emp?.weeklySchedule || {};
        return WEEK_DAYS.map(wd => {
            const shiftId = scheduleMap[wd.id];
            if (!shiftId || shiftId === 'LIBRE') {
                return { day: wd.name, active: false, start: '-', end: '-', break: '-' };
            }
            const assignedShift = shifts.find(s => String(s.id) === String(shiftId));
            if (!assignedShift) {
                return { day: wd.name, active: false, start: '-', end: '-', break: '-' };
            }
            return {
                day: wd.name, active: true, start: formatTime12h(assignedShift.start),
                end: formatTime12h(assignedShift.end), break: 'Definido por Ley'
            };
        });
    }, [emp?.weeklySchedule, shifts]);

    const todayName = useMemo(() => {
        const days = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };
        return days[new Date().getDay()];
    }, []);

    // 🚨 MODO PRO 1: useCallback para evitar re-renders innecesarios en componentes hijos
    // Mismo gate que StaffManagementView.jsx (Bloque 6.B): sin employeesStatus==='ready',
    // `emp` puede venir del snapshot sanitizado de localStorage (sin DUI/ISSS/AFP/banco/
    // kiosk_pin) y guardar sin darse cuenta los sobrescribe con NULL en la BD.
    const handleEditProfile = useCallback((e) => {
        if(e) { e.preventDefault(); e.stopPropagation(); }
        if (employeesStatus !== 'ready') {
            useToastStore.getState().showToast(
                'Cargando datos completos…',
                'Espera un momento y vuelve a intentar — se están terminando de sincronizar los datos del empleado.',
                'info'
            );
            return;
        }
        if (typeof openModal === 'function') openModal('editEmployee', emp);
    }, [openModal, emp, employeesStatus]);

    const handleNewHRAction = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof openModal === 'function') openModal('newEvent', { type: 'TRANSFER', employeeId: emp?.id });
    }, [openModal, emp?.id]);

    const handleVacationRecall = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof openModal === 'function') openModal('vacationRecall', { employee: emp });
    }, [openModal, emp]);

    // 🚨 MODO PRO 4: Fallback Skeleton en lugar de pantalla blanca (return null)
    if (!emp) return (
        <div className="w-full h-[100dvh] flex items-center justify-center bg-[#E6F0FF]">
            <div className="flex flex-col items-center gap-4">
                <div className="w-24 h-24 skeleton rounded-full" />
                <div className="h-4 w-40 skeleton rounded-full" />
                <div className="h-3 w-24 skeleton rounded-full" />
            </div>
        </div>
    );

    const handleResetPassword = () => setShowResetConfirm(true);

    const executeResetPassword = async () => {
        setIsResetting(true);
        try {
            const { data } = await supabase.functions.invoke(
                'set-employee-password',
                { body: { username: emp.username, password: '1234' } }
            );
            if (data?.ok) {
                setShowResetConfirm(false);
                if (data.tempPassword) {
                    setCopiedPwd(false);
                    setResetResult({ password: data.tempPassword });
                } else {
                    useToastStore.getState().showToast(
                        'Contraseña Restablecida',
                        `${emp.name} deberá cambiar su contraseña en su próximo acceso.`,
                        'success'
                    );
                }
            } else {
                useToastStore.getState().showToast('Error', 'No se pudo restablecer.', 'error');
            }
        } catch {
            useToastStore.getState().showToast('Error', 'Error de conexión.', 'error');
        } finally {
            setIsResetting(false);
        }
    };

    // 🚨 MODO PRO 2: Inteligencia Regional (WhatsApp SV)
    const formatWhatsAppLink = (phoneString) => {
        if (!phoneString) return '#';
        const cleanPhone = phoneString.replace(/\D/g, '');
        // Si tiene exactamente 8 dígitos, asumimos que es número local de SV y le ponemos el 503
        if (cleanPhone.length === 8) return `https://wa.me/503${cleanPhone}`;
        return `https://wa.me/${cleanPhone}`;
    };

    const headerControls = (
        <div className="flex items-center gap-2 md:gap-3 bg-surface-card backdrop-blur-2xl border border-border-card p-2 md:p-2.5 rounded-[2.5rem] shadow-sm w-max max-w-full overflow-x-auto hide-scrollbar">
            
            <div className="flex items-center relative bg-surface-card border border-border-card rounded-full p-1 shrink-0 shadow-[inset_0_1px_4px_rgba(0,0,0,0.02)]">
                <div
                    className="absolute top-1 bottom-1 w-[calc(20%-2px)] bg-white rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
                    style={{
                        transform: currentTab === 'history'     ? 'translateX(0%)' :
                                   currentTab === 'documents'   ? 'translateX(100%)' :
                                   currentTab === 'permissions' ? 'translateX(200%)' :
                                   currentTab === 'payroll'     ? 'translateX(300%)' :
                                   'translateX(400%)'
                    }}
                ></div>

                <button onClick={() => setCurrentTab('history')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'history' ? 'text-brand' : 'text-content-3 hover:text-content-2'}`}>
                    <Clock size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Historial</span>
                </button>
                <button onClick={() => setCurrentTab('documents')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'documents' ? 'text-brand' : 'text-content-3 hover:text-content-2'}`}>
                    <FileText size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Archivo</span>
                </button>
                <button onClick={() => setCurrentTab('permissions')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'permissions' ? 'text-brand' : 'text-content-3 hover:text-content-2'}`}>
                    <Stethoscope size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Ausencias</span>
                </button>
                <button onClick={() => setCurrentTab('payroll')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'payroll' ? 'text-brand' : 'text-content-3 hover:text-content-2'}`}>
                    <Wallet size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Horarios</span>
                </button>
                <button onClick={() => setCurrentTab('requests')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'requests' ? 'text-brand' : 'text-content-3 hover:text-content-2'}`}>
                    <ClipboardList size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Solicitudes</span>
                </button>
            </div>

            {canEdit && <div className="w-px h-6 bg-surface-card mx-1 shrink-0"></div>}

            {canEdit && getEffectiveStatus(emp) === 'En Vacaciones' && (
                <button onClick={handleVacationRecall} disabled={!canEdit}
                    className="flex items-center gap-2 h-9 md:h-10 px-4 md:px-5 bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-full font-black text-[9px] md:text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(245,158,11,0.3)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.4)] transition-all hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed">
                    <Palmtree size={14} strokeWidth={3}/> <span className="hidden sm:inline">Ingreso en Vacaciones</span>
                </button>
            )}
            {canEdit && (
                <button onClick={handleNewHRAction} disabled={!canEdit} className="flex items-center gap-2 h-9 md:h-10 px-4 md:px-5 bg-gradient-to-br from-brand to-brand-hover text-white rounded-full font-black text-[9px] md:text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,82,204,0.3)] hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] transition-all hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed">
                    <Plus size={14} strokeWidth={3}/> <span className="hidden sm:inline">Acción RRHH</span>
                </button>
            )}
        </div>
    );

    return (
        <>
        <GlassViewLayout
            icon={null} 
            title={
                <div className="flex items-center gap-3 md:gap-4">
                    {canEdit && (
                        <button 
                            onClick={() => {
                                if (typeof setView === 'function') setView('dashboard');
                                else navigate('/dashboard');
                            }} 
                            className="relative group/back w-11 h-11 flex items-center justify-center rounded-full shrink-0 active:scale-[0.97] transition-all duration-300 border border-slate-200/60 shadow-[0_2px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_6px_20px_rgba(0,82,204,0.2)] hover:-translate-y-0.5 z-50 bg-white"
                            title="Volver a Personal"
                        >
                            <div className="absolute inset-0 bg-gradient-to-tr from-brand/20 to-cyan-400/20 rounded-full opacity-0 group-hover/back:opacity-100 transition-opacity duration-300"></div>
                            <ArrowLeft size={18} strokeWidth={2.5} className="text-content-3 group-hover/back:text-brand transition-colors relative z-10" />
                        </button>
                    )}

                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-[1rem] md:rounded-[1.25rem] bg-brand text-white flex items-center justify-center shadow-[0_8px_20px_rgba(0,82,204,0.3)] shrink-0">
                        <User size={20} className="md:w-6 md:h-6" strokeWidth={2} />
                    </div>

                    <div className="flex flex-col items-start justify-center cursor-default">
                        <h2 className="text-[20px] md:text-[22px] font-black text-content leading-none tracking-tight">Perfil de Empleado</h2>
                    </div>
                </div>
            }
            filtersContent={headerControls}
            transparentBody={true}
        >
            <div className="w-full relative z-10 animate-in fade-in duration-500">
                <div className="max-w-7xl mx-auto w-full pb-12">


                    {/* --- MINI-DASHBOARD (SIGNOS VITALES) --- */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0 mb-4 md:mb-5">
                        <div className="bg-surface-card backdrop-blur-md border border-border-card rounded-[1.5rem] p-4 md:p-5 shadow-sm flex items-center gap-4 transition-all hover:bg-white">
                            <div className="p-2.5 bg-success/10 text-success rounded-xl shadow-sm border border-success/30"><CheckCircle size={18} strokeWidth={2.5}/></div>
                            <div>
                                <p className="text-[9px] font-black text-content-2 uppercase tracking-widest">Estado</p>
                                <p className="text-[13px] md:text-[14px] font-bold text-content">{emp.effectiveStatus || emp.status || 'Activo'}</p>
                            </div>
                        </div>
                        <div className="bg-surface-card backdrop-blur-md border border-border-card rounded-[1.5rem] p-4 md:p-5 shadow-sm flex items-center gap-4 transition-all hover:bg-white">
                            <div className="p-2.5 bg-blue-50 text-brand rounded-xl shadow-sm border border-blue-100/50"><Briefcase size={18} strokeWidth={2.5}/></div>
                            <div>
                                <p className="text-[9px] font-black text-content-2 uppercase tracking-widest">Antigüedad</p>
                                <p className="text-[13px] md:text-[14px] font-bold text-content truncate">{tenure}</p>
                            </div>
                        </div>
                        <div className="bg-surface-card backdrop-blur-md border border-border-card rounded-[1.5rem] p-4 md:p-5 shadow-sm flex items-center gap-4 transition-all hover:bg-white">
                            <div className="p-2.5 bg-pink-50 text-pink-500 rounded-xl shadow-sm border border-pink-100/50"><Cake size={18} strokeWidth={2.5}/></div>
                            <div>
                                <p className="text-[9px] font-black text-content-2 uppercase tracking-widest">Edad</p>
                                <p className="text-[13px] md:text-[14px] font-bold text-content">{age ? `${age} Años` : 'N/D'}</p>
                            </div>
                        </div>
                        <div className="bg-surface-card backdrop-blur-md border border-border-card rounded-[1.5rem] p-4 md:p-5 shadow-sm flex items-center gap-4 transition-all hover:bg-white">
                            <div className={`p-2.5 rounded-xl shadow-sm border ${latePunches > 0 ? 'bg-danger/10 text-danger border-danger/30' : 'bg-surface-card-hover text-content-3 border-slate-100/50'}`}><AlertCircle size={18} strokeWidth={2.5}/></div>
                            <div>
                                <p className="text-[9px] font-black text-content-2 uppercase tracking-widest">Tardanzas (Mes)</p>
                                <p className={`text-[13px] md:text-[14px] font-bold ${latePunches > 0 ? 'text-danger' : 'text-content'}`}>{latePunches} Acumuladas</p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
                        
                        {/* --- TARJETA DE PERFIL (IZQUIERDA) --- */}
                        <div className="lg:col-span-4 space-y-5">
                            <div className="relative w-full overflow-hidden rounded-[2.5rem] border border-border-card bg-surface-card shadow-[0_8px_32px_rgba(0,0,0,0.05)] backdrop-blur-2xl">
                                
                                <div className="absolute top-0 h-32 w-full bg-gradient-to-b from-brand/15 to-transparent"></div>
                                
                                <div className="px-6 pb-8 pt-10 flex flex-col items-center relative z-10">
                                    
                                    <div className="h-36 w-36 md:h-40 md:w-40 rounded-full p-1.5 bg-surface-card border border-white shadow-xl backdrop-blur-md mb-5 group relative">
                                        <div className="h-full w-full rounded-full overflow-hidden bg-surface-card-hover relative shadow-inner">
                                            <LiquidAvatar src={emp.photo || emp.photo_url} alt={emp.name} fallbackText={fallbackInitials} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                        </div>
                                        {canEdit && (
                                            <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center cursor-pointer"
                                                onClick={handleEditProfile}>
                                                <Camera size={24} className="text-white"/>
                                            </div>
                                        )}
                                        {(emp.effectiveStatus === 'Activo' || emp.effectiveStatus === 'En Apoyo') && (
                                            <span className="absolute bottom-2 right-4 w-5 h-5 bg-emerald-500 border-4 border-white rounded-full shadow-sm z-10"></span>
                                        )}
                                    </div>
                                    
                                    <h2 className="text-2xl md:text-3xl font-black text-content text-center leading-tight mb-1.5 tracking-tight">
                                        {emp.name}
                                    </h2>
                                    
                                    <div className="flex flex-col items-center gap-2 mb-8">
                                        <span className="px-4 py-1 rounded-full bg-brand/10 border border-brand/20 text-brand font-black text-[10px] uppercase tracking-[0.15em] text-center shadow-sm">
                                            {emp.role || 'Sin Cargo Asignado'}
                                        </span>
                                        <span className="text-[10px] font-black text-content-2 uppercase tracking-widest">
                                            CÓD: {emp.code || 'S/N'}
                                        </span>
                                        {canEdit && (
                                            <div className="flex gap-2 mt-3 justify-center animate-in fade-in duration-300">
                                                <button onClick={handleEditProfile}
                                                    disabled={!canEdit}
                                                    className="flex items-center gap-1.5 px-4 py-2 bg-surface-card hover:bg-brand text-content-2 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97] shadow-sm hover:shadow-[0_4px_15px_rgba(0,82,204,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
                                                    <Edit size={12}/> Editar
                                                </button>
                                                <button onClick={handleResetPassword}
                                                    className="flex items-center gap-1.5 px-4 py-2 bg-surface-card hover:bg-amber-500 text-content-2 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97] shadow-sm hover:shadow-[0_4px_15px_rgba(245,158,11,0.3)]">
                                                    <KeyRound size={12}/> Contraseña
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="w-full space-y-3">
                                        <div className="group flex items-center gap-3.5 p-3.5 rounded-2xl bg-surface-card border border-border-card hover:bg-white transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                                            <div className="p-2.5 bg-white border border-slate-100 rounded-[0.8rem] shadow-sm text-brand group-hover:scale-110 transition-transform"><Mail size={16} strokeWidth={2.5}/></div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black text-content-3 uppercase tracking-[0.15em] mb-0.5">Correo</p>
                                                <p className="text-[12px] font-bold text-content-2 truncate">{emp.email || emp.username || 'No registrado'}</p>
                                            </div>
                                        </div>

                                        <div className="group flex items-center gap-3.5 p-3.5 rounded-2xl bg-surface-card border border-border-card hover:bg-white transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.02)] relative">
                                            <div className="p-2.5 bg-white border border-slate-100 rounded-[0.8rem] shadow-sm text-success group-hover:scale-110 transition-transform"><Phone size={16} strokeWidth={2.5}/></div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black text-content-3 uppercase tracking-[0.15em] mb-0.5">Celular</p>
                                                <p className="text-[12px] font-bold text-content-2">{emp.phone || 'No registrado'}</p>
                                            </div>
                                            {emp.phone && (
                                                <a href={formatWhatsAppLink(emp.phone)} target="_blank" rel="noreferrer" className="absolute right-3 p-2 bg-success/10 text-success rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Phone size={14} strokeWidth={3}/>
                                                </a>
                                            )}
                                        </div>

                                        <div className="group flex items-center gap-3.5 p-3.5 rounded-2xl bg-surface-card border border-border-card hover:bg-white transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                                            <div className="p-2.5 bg-white border border-slate-100 rounded-[0.8rem] shadow-sm text-purple-500 group-hover:scale-110 transition-transform"><Shield size={16} strokeWidth={2.5}/></div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black text-content-3 uppercase tracking-[0.15em] mb-0.5">Documento (DUI)</p>
                                                <p className="text-[12px] font-bold text-content-2">{emp.dui || 'No registrado'}</p>
                                            </div>
                                        </div>

                                        <div className="group flex items-center gap-3.5 p-3.5 rounded-2xl bg-surface-card border border-border-card hover:bg-white transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                                            <div className="p-2.5 bg-white border border-slate-100 rounded-[0.8rem] shadow-sm text-orange-500 group-hover:scale-110 transition-transform"><MapPin size={16} strokeWidth={2.5}/></div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black text-content-3 uppercase tracking-[0.15em] mb-0.5">Sucursal Base</p>
                                                <p className="text-[12px] font-bold text-content-2 truncate">{branch ? branch.name : 'Sin Asignar'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* TARJETA DE EMERGENCIA */}
                            {(emp.emergency_contact_name || emp.emergency_contact_phone || emp.blood_type) && (
                                <div className="w-full bg-danger/10 backdrop-blur-md rounded-[2rem] border border-danger/30 shadow-sm p-6 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-4 opacity-10 text-danger group-hover:scale-110 transition-transform duration-500"><HeartPulse size={80} /></div>
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-danger mb-4 flex items-center gap-2">
                                        <HeartPulse size={14} strokeWidth={3}/> Contacto de Emergencia
                                    </h3>
                                    <div className="space-y-3 relative z-10">
                                        {emp.emergency_contact_name && (
                                            <div>
                                                <p className="text-[9px] font-bold text-content-2 uppercase tracking-widest">Avisar a</p>
                                                <p className="text-[13px] font-bold text-content">{emp.emergency_contact_name}</p>
                                            </div>
                                        )}
                                        {emp.emergency_contact_phone && (
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-[9px] font-bold text-content-2 uppercase tracking-widest">Teléfono</p>
                                                    <p className="text-[13px] font-bold text-content">{emp.emergency_contact_phone}</p>
                                                </div>
                                                <a href={`tel:${emp.emergency_contact_phone.replace(/\D/g,'')}`} className="p-2.5 bg-danger/10 text-danger rounded-full hover:bg-red-500 hover:text-white transition-colors shadow-sm">
                                                    <Phone size={14} strokeWidth={2.5}/>
                                                </a>
                                            </div>
                                        )}
                                        {emp.blood_type && (
                                            <div className="pt-2 border-t border-danger/30">
                                                <p className="text-[9px] font-bold text-content-2 uppercase tracking-widest">Tipo de Sangre</p>
                                                <p className="text-[13px] font-black text-danger">{emp.blood_type}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* --- CONTENIDO PRINCIPAL (DERECHA) --- */}
                        <div className="lg:col-span-8">
                            <div className="bg-surface-card backdrop-blur-2xl rounded-[2.5rem] border border-border-card shadow-[0_8px_32px_rgba(0,0,0,0.03)] p-5 md:p-8 min-h-[600px] overflow-hidden relative">
                                
                                {/* PESTAÑA 1: HISTORIAL */}
                                {currentTab === 'history' && (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                                        <div className="flex justify-between items-center mb-6">
                                            <h3 className="font-black text-content uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                <Clock size={18} className="text-brand"/> Historial Operativo
                                            </h3>
                                            <div className="px-3 py-1 bg-surface-card text-content-3 rounded-full text-[9px] font-black uppercase tracking-widest border border-white shadow-sm flex items-center gap-1.5">
                                                {isLoadingTimeline && <Loader2 size={10} className="animate-spin"/>}
                                                {timeline.length} Eventos
                                            </div>
                                        </div>

                                        <div className="relative border-l-[3px] border-slate-200/70 ml-4 md:ml-6 space-y-8 pb-4">
                                            {timeline.length > 0 ? timeline.map((ev, idx) => {
                                                const label = ev.category || EVENT_TYPES[ev.type]?.label || ev.type;
                                                const isHiring = ev.type === 'HIRE' || ev.type === 'HIRING';
                                                let evTheme = { label, bg: 'bg-surface-card-hover', text: 'text-content-2', border: 'border-slate-200' };

                                                // Tokenizado T7 — mismo criterio en toda la app: hitos claramente
                                                // buenos/malos usan success/warning/danger; el resto (transferencias,
                                                // categorías de puesto, etc.) es categórico puro sin severidad, mapeado
                                                // a los mismos chart-N que EmployeeProfileView.jsx para el tipo compartido.
                                                if (isHiring) {
                                                    evTheme = { label, bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30' };
                                                } else if (ev.type === 'ROSTER_PUBLISHED') {
                                                    evTheme = { label, bg: 'bg-surface-card-hover', text: 'text-content-3', border: 'border-border-card' };
                                                } else if (ev.type === 'EMPLEADO_ASIGNADO' || ev.type === 'REASSIGNMENT') {
                                                    evTheme = { label, bg: 'bg-chart-1/10', text: 'text-chart-1-text', border: 'border-chart-1/30' };
                                                } else if (ev.type === 'EMPLEADO_RELEVADO') {
                                                    evTheme = { label, bg: 'bg-warning/10', text: 'text-warning-text', border: 'border-warning/30' };
                                                } else if (ev.type === 'EMPLEADO_DESVINCULADO_SUCURSAL' || ev.type === 'UNASSIGNED') {
                                                    evTheme = { label, bg: 'bg-danger/10', text: 'text-danger-text', border: 'border-danger/30' };
                                                } else if (EVENT_TYPES[ev.type]) {
                                                    if (ev.type.includes('TRANSFER'))   evTheme = { label, bg: 'bg-chart-1/10',   text: 'text-chart-1-text',   border: 'border-chart-1/30' };
                                                    else if (ev.type.includes('PROMOTION')) evTheme = { label, bg: 'bg-success/10',  text: 'text-success-text',  border: 'border-success/30' };
                                                    else if (ev.type.includes('SALARY'))    evTheme = { label, bg: 'bg-chart-6/10', text: 'text-chart-6-text', border: 'border-chart-6/30' };
                                                    else if (ev.type.includes('TERMINATION')) evTheme = { label, bg: 'bg-danger/10', text: 'text-danger-text',   border: 'border-danger/30' };
                                                    else if (ev.type === 'REHIRE')          evTheme = { label, bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30' };
                                                    else if (ev.type === 'VACATION_RECALL') evTheme = { label, bg: 'bg-warning/10', text: 'text-warning-text',  border: 'border-warning/30' };
                                                    else if (ev.type === 'DISABILITY')      evTheme = { label, bg: 'bg-danger/10',   text: 'text-danger-text',   border: 'border-danger/30' };
                                                    else if (ev.type === 'VACATION')        evTheme = { label, bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30' };
                                                    else if (ev.type === 'PERMIT')          evTheme = { label, bg: 'bg-chart-2/10', text: 'text-chart-2-text', border: 'border-chart-2/30' };
                                                    else if (ev.type === 'SUPPORT')         evTheme = { label, bg: 'bg-chart-4/10', text: 'text-chart-4-text', border: 'border-chart-4/30' };
                                                    else if (ev.type === 'INDUCTION')       evTheme = { label, bg: 'bg-chart-9/10',  text: 'text-chart-9-text',  border: 'border-chart-9/30' };
                                                }

                                                return (
                                                    <div key={ev.id || `evt-${idx}`} className="relative pl-8 group">
                                                        <div className={`absolute -left-[10px] top-1.5 w-4 h-4 rounded-full bg-white border-[4px] shadow-sm group-hover:scale-125 transition-transform duration-300 z-10 ${isHiring ? 'border-success' : 'border-brand'}`}></div>
                                                        
                                                        <div className={`bg-surface-card hover:bg-surface-card rounded-3xl p-5 border border-border-card transition-all duration-300 shadow-[0_4px_15px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_25px_rgba(0,0,0,0.04)] ${ev.metadata?.status === 'CANCELLED' || ev.metadata?.status === 'SUPERSEDED' ? 'opacity-50' : ''}`}>
                                                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-3">
                                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border shadow-sm ${evTheme.bg} ${evTheme.text} ${evTheme.border}`}>
                                                                    {evTheme.label}
                                                                </span>
                                                                <span className="text-[10px] font-black uppercase tracking-widest text-content-2 bg-surface-card-hover/50 px-2 py-1 rounded-md">
                                                                    {formatDate(ev.date)}
                                                                </span>
                                                            </div>
                                                            
                                                            <p className="text-[13px] text-content-2 leading-relaxed font-semibold mb-1">
                                                                {ev.note}
                                                            </p>

                                                            {ev.metadata?.permissionDates && ev.metadata.permissionDates.length > 0 && (
                                                                <div className="mt-3 flex flex-wrap gap-1.5">
                                                                    <span className="text-[9px] font-black uppercase text-content-3 w-full mb-0.5">Días de Ausencia Autorizada:</span>
                                                                    {ev.metadata.permissionDates.map((d, i) => (
                                                                        <span key={i} className="px-2 py-1 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg text-[10px] font-black tracking-widest">{formatDate(d)}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            
                                                            {ev.metadata?.old_value && ev.metadata?.new_value && (
                                                                 <p className="text-[11px] font-medium text-content-3 mt-2 bg-surface-card-hover p-2 rounded-lg border border-slate-100 flex gap-2 items-center">
                                                                     <span className="font-bold line-through opacity-70">{ev.metadata.old_value}</span> <ArrowRightLeft size={10}/> <span className="font-bold text-brand">{ev.metadata.new_value}</span>
                                                                 </p>
                                                            )}
                                                            
                                                            {!ev.isSystem && typeof openModal === 'function' && (
                                                                <div className="pt-4 mt-3 border-t border-slate-200/60 flex justify-between items-center">
                                                                    {ev.metadata?.status === 'CANCELLED' ? (
                                                                        <span className="px-2 py-1 bg-danger/10 text-danger rounded-full text-[9px] font-black uppercase tracking-widest">
                                                                            CANCELADO
                                                                        </span>
                                                                    ) : ev.metadata?.status === 'SUPERSEDED' ? (
                                                                        <span className="px-2 py-1 bg-surface-card-hover text-content-3 rounded-full text-[9px] font-black uppercase tracking-widest">
                                                                            EDITADO
                                                                        </span>
                                                                    ) : ev.documentId ? (
                                                                        <button className="flex items-center gap-1.5 text-brand bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-black text-[9px] uppercase tracking-widest transition-colors shadow-sm">
                                                                            <FileText size={12} strokeWidth={2.5}/> Ver Respaldo Legal
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => openModal('uploadDocument', {}, ev.id)}
                                                                            disabled={!canEdit}
                                                                            className="flex items-center gap-1.5 text-content-2 hover:text-orange-600 hover:bg-orange-50 px-3 py-1.5 rounded-lg font-black text-[9px] uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                                        >
                                                                            <Paperclip size={12} strokeWidth={2.5}/> Adjuntar Soporte
                                                                        </button>
                                                                    )}
                                                                    {canEdit && ev.metadata?.status !== 'CANCELLED' && ev.metadata?.status !== 'SUPERSEDED' && (
                                                                        <button
                                                                            onClick={() => openModal('newEvent', {
                                                                                type: ev.type,
                                                                                date: ev.date,
                                                                                endDate: ev.metadata?.endDate,
                                                                                note: ev.note,
                                                                                ...ev.metadata,
                                                                                employeeId: emp.id,
                                                                                _editingEventId: ev.id
                                                                            })}
                                                                            disabled={!canEdit}
                                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-500 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed">
                                                                            <Edit size={11} strokeWidth={2.5}/> Editar
                                                                        </button>
                                                                    )}
                                                                    {canEdit && ev.metadata?.status !== 'CANCELLED' && ev.metadata?.status !== 'SUPERSEDED' && (
                                                                        <button
                                                                            onClick={() => { setCancelingEventId(ev.id); setShowCancelModal(true); }}
                                                                            disabled={!canEdit}
                                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-danger/10 hover:bg-danger/10 text-danger rounded-xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed">
                                                                            <Ban size={11} strokeWidth={2.5}/> Cancelar
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {isHiring && (
                                                                <div className="pt-3 mt-1 flex items-center gap-1.5 text-success opacity-70">
                                                                    <Briefcase size={12} strokeWidth={2.5}/> 
                                                                    <span className="text-[9px] font-black uppercase tracking-widest">Hito de Inicio Operativo</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            }) : (
                                                <div className="flex flex-col items-center justify-center py-20 opacity-50 px-4">
                                                    <div className="w-16 h-16 bg-surface-card-hover rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-slate-200">
                                                        <Clock size={28} className="text-content-3" strokeWidth={2}/>
                                                    </div>
                                                    <p className="font-black uppercase tracking-widest text-[11px] text-content-2">Historial en Blanco</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                
                                {/* PESTAÑA 2: DOCUMENTOS */}
                                {currentTab === 'documents' && (
                                    <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                         <div className="flex justify-between items-center mb-6">
                                            <h3 className="font-black text-content uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                <FileText size={18} className="text-brand"/> Expediente Digital
                                            </h3>
                                        </div>
                                        <EmployeeDocumentsList documents={emp.employee_documents} emptyLabel="Expediente vacío" />
                                    </div>
                                )}

                                {/* PESTAÑA 3: AUSENCIAS (Permisos + Incapacidades) */}
                                {currentTab === 'permissions' && (() => {
                                    const todayStr = new Date().toISOString().split('T')[0];
                                    return (
                                    <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-5">

                                        {/* ── Cabecera ── */}
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <h3 className="font-black text-content uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                <Stethoscope size={18} className="text-warning"/> Ausencias
                                                <span className="text-[11px] font-bold text-content-3 normal-case tracking-normal">Permisos e Incapacidades</span>
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                {ausenciasSelectedDay && (
                                                    <button onClick={() => setAusenciasSelectedDay(null)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-danger/10 border border-danger/30 text-danger text-[11px] font-black hover:bg-danger/10 transition-all active:scale-[0.97]">
                                                        <X size={10} strokeWidth={3}/> {ausenciasSelectedDay}
                                                    </button>
                                                )}
                                                <div className={`flex items-center gap-1.5 rounded-full border transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden ${ausenciasSearchOpen ? 'bg-white border-slate-200 px-2.5 py-1 w-40' : 'bg-surface-card border-slate-200/60 w-8 h-8 justify-center'}`}>
                                                    <button type="button"
                                                        onClick={() => { setAusenciasSearchOpen(v => !v); if (ausenciasSearchOpen) setAusenciasSearch(''); }}
                                                        className="flex-shrink-0 text-content-3 hover:text-content-2 transition-colors">
                                                        {ausenciasSearchOpen ? <X size={11} strokeWidth={2.5}/> : <Search size={12} strokeWidth={2.5}/>}
                                                    </button>
                                                    {ausenciasSearchOpen && (
                                                        <input autoFocus type="text" value={ausenciasSearch}
                                                            onChange={e => setAusenciasSearch(e.target.value)}
                                                            placeholder="Buscar..."
                                                            className="flex-1 min-w-0 text-[16px] font-medium text-content-2 placeholder-slate-300 outline-none bg-transparent" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── Calendario ── */}
                                        <div className="bg-surface-card backdrop-blur-xl border border-border-card rounded-[1.5rem] p-4 shadow-sm overflow-visible">
                                            {/* Navegación de mes */}
                                            <div className="flex items-center justify-between mb-3">
                                                <button onClick={() => { setAusenciasCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)); setAusenciasSelectedDay(null); }}
                                                    className="w-7 h-7 rounded-full flex items-center justify-center text-content-3 hover:text-brand hover:bg-blue-50 transition-all active:scale-[0.97]">
                                                    <ChevronLeft size={14} strokeWidth={2.5}/>
                                                </button>
                                                <span className="text-[13px] font-black text-content-2 capitalize">
                                                    {ausenciasCalMonth.toLocaleDateString('es', { month: 'long', year: 'numeric' })}
                                                </span>
                                                <button onClick={() => { setAusenciasCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)); setAusenciasSelectedDay(null); }}
                                                    className="w-7 h-7 rounded-full flex items-center justify-center text-content-3 hover:text-brand hover:bg-blue-50 transition-all active:scale-[0.97]">
                                                    <ChevronRight size={14} strokeWidth={2.5}/>
                                                </button>
                                            </div>
                                            {/* Encabezados días */}
                                            <div className="grid grid-cols-7 mb-1">
                                                {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d => (
                                                    <div key={d} className="text-center text-[9px] font-black text-content-3 uppercase py-1">{d}</div>
                                                ))}
                                            </div>
                                            {/* Celdas */}
                                            <div className="grid grid-cols-7 overflow-visible" style={{ gridAutoRows: 'minmax(34px,1fr)' }}>
                                                {ausenciasCalDays.cells.map((day, i) => {
                                                    if (!day) return <div key={`pad-${i}`}/>;
                                                    const mm = String(ausenciasCalDays.month + 1).padStart(2,'0');
                                                    const dd = String(day).padStart(2,'0');
                                                    const ds = `${ausenciasCalDays.year}-${mm}-${dd}`;
                                                    const isToday      = ds === todayStr;
                                                    const isSelected   = ds === ausenciasSelectedDay;
                                                    const cell         = ausenciasCalEvents[ds];
                                                    const hasPermit    = cell?.types?.has('PERMIT');
                                                    const hasDisab     = cell?.types?.has('DISABILITY');
                                                    const isInsurance  = cell?.isInsuranceDay;
                                                    const hasEvents    = hasPermit || hasDisab;

                                                    const _dow     = new Date(ds + 'T12:00:00').getDay();
                                                    const _dayName = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][_dow];
                                                    const shiftHrs = shiftHoursMap[_dayName];
                                                    const tooltipLines = (cell?.events || []).map(ev => {
                                                        const meta      = ev.metadata || {};
                                                        const isHours   = !!(meta.hours || meta.hoursOnly);
                                                        const label     = ev.type === 'DISABILITY' ? 'Incapacidad' : isHours ? 'Permiso por Horas' : 'Permiso';
                                                        const hoursStr  = isHours ? `${meta.hours || meta.hoursOnly}h ausente` : shiftHrs ? `${shiftHrs}h de turno` : null;
                                                        const note      = ev.note ? ev.note.slice(0, 45) + (ev.note.length > 45 ? '…' : '') : null;
                                                        return { label, hoursStr, note };
                                                    });

                                                    let cellBg;
                                                    if (isSelected) {
                                                        cellBg = 'bg-emerald-500 shadow-[0_2px_8px_rgba(16,185,129,0.45)] ring-2 ring-emerald-400/40';
                                                    } else if (isToday) {
                                                        cellBg = 'bg-brand';
                                                    } else if (isInsurance && hasPermit) {
                                                        cellBg = 'bg-gradient-to-br from-amber-100 to-violet-100 border border-violet-200';
                                                    } else if (isInsurance) {
                                                        cellBg = 'bg-violet-100 border border-violet-300';
                                                    } else if (hasPermit && hasDisab) {
                                                        cellBg = 'bg-gradient-to-br from-amber-100 to-red-100 border border-warning/30';
                                                    } else if (hasPermit) {
                                                        cellBg = 'bg-warning/10 border border-warning/30';
                                                    } else if (hasDisab) {
                                                        cellBg = 'bg-danger/10 border border-danger/30';
                                                    } else {
                                                        cellBg = 'hover:bg-blue-50/60';
                                                    }

                                                    return (
                                                        <div key={ds}
                                                            className={`relative group/cal flex flex-col items-center justify-center rounded-lg transition-all duration-200 ${hasEvents ? 'cursor-pointer hover:scale-110 hover:z-20 hover:shadow-md' : 'cursor-default'} ${cellBg}`}
                                                            onClick={() => hasEvents && setAusenciasSelectedDay(prev => prev === ds ? null : ds)}>
                                                            <span className={`text-[12px] font-bold leading-none select-none ${isSelected || isToday ? 'text-white' : hasEvents ? 'text-content-2' : 'text-content-3'}`}>
                                                                {day}
                                                            </span>
                                                            {hasEvents && !isSelected && !isToday && (
                                                                <div className="flex gap-0.5 mt-0.5">
                                                                    {hasPermit   && <span className="w-1 h-1 rounded-full bg-amber-500"/>}
                                                                    {hasDisab    && <span className="w-1 h-1 rounded-full bg-red-500"/>}
                                                                    {isInsurance && <span className="w-1 h-1 rounded-full bg-violet-500"/>}
                                                                </div>
                                                            )}
                                                            {/* Tooltip */}
                                                            {hasEvents && tooltipLines.length > 0 && (
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800/95 backdrop-blur-sm text-white rounded-xl shadow-xl z-[999] min-w-[170px] max-w-[230px] pointer-events-none opacity-0 group-hover/cal:opacity-100 transition-opacity duration-200 text-left">
                                                                    <p className="text-[9px] font-black uppercase tracking-widest text-content-2 mb-1.5">{ds}</p>
                                                                    {tooltipLines.map((item, li) => (
                                                                        <div key={li} className={li > 0 ? 'mt-2 pt-2 border-t border-slate-700' : ''}>
                                                                            <div className="flex items-center justify-between gap-3">
                                                                                <span className="text-[11px] font-black">{item.label}</span>
                                                                                {item.hoursStr && <span className="text-[10px] font-bold text-amber-300 whitespace-nowrap">{item.hoursStr}</span>}
                                                                            </div>
                                                                            {item.note && <p className="text-[10px] text-content-3 mt-0.5 leading-snug whitespace-normal">{item.note}</p>}
                                                                        </div>
                                                                    ))}
                                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-slate-800/95"/>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            {/* Leyenda */}
                                            <div className="flex flex-wrap items-center gap-3 mt-3 pt-2.5 border-t border-slate-100">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-3 h-3 rounded-sm bg-warning/10 border border-warning/30 flex-shrink-0"/>
                                                    <span className="text-[9px] font-black text-content-2 uppercase tracking-widest">Permiso</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-3 h-3 rounded-sm bg-danger/10 border border-danger/30 flex-shrink-0"/>
                                                    <span className="text-[9px] font-black text-content-2 uppercase tracking-widest">Incapacidad</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-3 h-3 rounded-sm bg-violet-100 border border-violet-300 flex-shrink-0"/>
                                                    <span className="text-[9px] font-black text-content-2 uppercase tracking-widest">Día 4+ Seguro</span>
                                                </div>
                                                {ausenciasSelectedDay && (
                                                    <div className="flex items-center gap-1.5 ml-auto">
                                                        <span className="w-3 h-3 rounded-sm bg-emerald-500 flex-shrink-0"/>
                                                        <span className="text-[9px] font-black text-success uppercase tracking-widest">Seleccionado</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* ── Cards 2 columnas ── */}
                                        {ausenciasData.length > 0 ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {ausenciasData.map((ev, idx) => {
                                                    const isDisability = ev.type === 'DISABILITY';
                                                    const meta         = ev.metadata || {};
                                                    const hasHours     = !!(meta.hours || meta.hoursOnly);
                                                    const daysNum      = meta.days ? Number(meta.days) : 0;
                                                    const isInsuranceDays = isDisability && daysNum > 3;

                                                    const cfg = isDisability
                                                        ? { bg: 'bg-danger/10',    border: 'border-danger/30',    text: 'text-red-700',    badge: 'bg-danger/10 text-red-700 border-danger/30',       leftBorder: 'border-red-300',    Icon: Stethoscope, label: 'Incapacidad',
                                                            hover: 'hover:bg-danger/10 hover:border-red-300 hover:shadow-[0_8px_24px_rgba(239,68,68,0.12)]' }
                                                        : hasHours
                                                        ? { bg: 'bg-orange-50/60', border: 'border-orange-200/60', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700 border-orange-200', leftBorder: 'border-orange-300', Icon: Clock,       label: 'Permiso por Horas',
                                                            hover: 'hover:bg-orange-50 hover:border-orange-300 hover:shadow-[0_8px_24px_rgba(249,115,22,0.12)]' }
                                                        : { bg: 'bg-warning/10',  border: 'border-warning/30',  text: 'text-amber-700',  badge: 'bg-warning/10 text-amber-700 border-warning/30',  leftBorder: 'border-amber-300',  Icon: FileText,    label: 'Permiso',
                                                            hover: 'hover:bg-warning/10 hover:border-amber-300 hover:shadow-[0_8px_24px_rgba(245,158,11,0.12)]' };

                                                    return (
                                                        <div key={ev.id || idx} className={`group/card ${cfg.bg} border ${cfg.border} rounded-[1.5rem] p-4 flex flex-col gap-3 ${cfg.hover} hover:-translate-y-0.5 transition-all duration-300 shadow-sm cursor-default`}>
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="flex items-center gap-2.5">
                                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.badge} border group-hover/card:scale-110 transition-transform duration-300`}>
                                                                        <cfg.Icon size={15} strokeWidth={2}/>
                                                                    </div>
                                                                    <div>
                                                                        <span className={`text-[10px] font-black uppercase tracking-widest ${cfg.text}`}>{cfg.label}</span>
                                                                        <p className="text-[10px] text-content-3 font-bold">
                                                                            {formatDate(ev.date)}{meta.endDate && meta.endDate !== ev.date && ` → ${formatDate(meta.endDate)}`}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                                                    {daysNum > 0 && (
                                                                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${cfg.badge}`}>
                                                                            {daysNum} día{daysNum !== 1 ? 's' : ''}
                                                                        </span>
                                                                    )}
                                                                    {hasHours && (
                                                                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${cfg.badge}`}>
                                                                            {meta.hours || meta.hoursOnly}h ausente
                                                                        </span>
                                                                    )}
                                                                    {isInsuranceDays && (
                                                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                                                                            {daysNum - 3}d Seguro
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {ev.note && (
                                                                <p className={`text-[12px] font-medium text-content-2 border-l-[3px] pl-3 py-0.5 ${cfg.leftBorder}`}>
                                                                    {ev.note}
                                                                </p>
                                                            )}
                                                            {meta.permissionDates?.length > 0 && (
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {meta.permissionDates.map((d, i) => (
                                                                        <span key={i} className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${cfg.badge}`}>{formatDate(d)}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center py-16 opacity-50">
                                                <div className="w-14 h-14 bg-surface-card-hover rounded-2xl flex items-center justify-center mb-3 border border-slate-200">
                                                    <Stethoscope size={24} className="text-content-3" strokeWidth={1.5}/>
                                                </div>
                                                <p className="font-black uppercase tracking-widest text-[11px] text-content-3">
                                                    {ausenciasSelectedDay ? `Sin ausencias el ${ausenciasSelectedDay}` : 'Sin Ausencias este Mes'}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                    );
                                })()}

                                {/* PESTAÑA 4: HORARIOS */}
                                {currentTab === 'payroll' && (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                                        
                                        {canEdit && (
                                            <div>
                                                <div className="flex justify-between items-center mb-5">
                                                    <h3 className="font-black text-content uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                        <Wallet size={18} className="text-success"/> Información Salarial
                                                    </h3>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="p-5 bg-gradient-to-br from-emerald-50 to-white rounded-[1.5rem] border border-success/30 shadow-sm">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-success/70 mb-1">Salario Base Contractual</p>
                                                        <p className="text-2xl font-black text-emerald-700 tracking-tight">${emp.salary || emp.base_salary || '0.00'}</p>
                                                    </div>
                                                    <div className="p-5 bg-surface-card rounded-[1.5rem] border border-border-card shadow-sm flex flex-col justify-center">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-content-2 mb-2">Depósito de Planilla</p>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[14px] font-bold text-content-2">{emp.bank_name || 'No configurado'}</span>
                                                            <span className="px-3 py-1 bg-surface-card-hover text-content-2 rounded-lg text-[11px] font-black tracking-wider border border-slate-200">CTA: {emp.account_number || '---'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <div className="flex justify-between items-center mb-5 pt-4 border-t border-slate-200/50">
                                                <h3 className="font-black text-content uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                    <CalendarDays size={18} className="text-brand"/> Turnos de la Semana
                                                </h3>
                                            </div>
                                            
                                            <div className="bg-surface-card border border-border-card rounded-[2rem] overflow-hidden shadow-sm">
                                                <div className="grid grid-cols-1 divide-y divide-slate-100/50">
                                                    {scheduleData.map((dia, idx) => {
                                                        const isToday = dia.day === todayName; 

                                                        return (
                                                            <div key={idx} className={`relative p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-colors ${dia.active ? 'hover:bg-surface-card' : 'opacity-50 grayscale bg-surface-card-hover/50'} ${isToday ? 'bg-blue-50/50 ring-1 ring-brand/20 shadow-[inset_0_0_20px_rgba(0,82,204,0.05)]' : ''}`}>
                                                                
                                                                {isToday && (
                                                                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-brand shadow-[0_0_10px_rgba(0,82,204,0.4)]"></div>
                                                                )}

                                                                <div className="flex items-center gap-3 w-32 shrink-0 relative">
                                                                    <div className={`w-2.5 h-2.5 rounded-full ${dia.active ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-content-3'}`}></div>
                                                                    <span className={`text-[12px] font-black uppercase tracking-widest ${dia.active ? 'text-content-2' : 'text-content-2'}`}>{dia.day}</span>
                                                                    {isToday && (
                                                                        <span className="ml-2 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-brand text-white shadow-sm animate-pulse">Hoy</span>
                                                                    )}
                                                                </div>
                                                                
                                                                {dia.active ? (
                                                                    <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4 w-full">
                                                                        <div>
                                                                            <p className="text-[9px] font-black text-content-2 uppercase tracking-widest mb-1">Entrada</p>
                                                                            <p className="text-[13px] font-bold text-content bg-white px-3 py-1.5 rounded-xl shadow-sm border border-slate-100 w-max">{dia.start}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[9px] font-black text-content-2 uppercase tracking-widest mb-1">Salida</p>
                                                                            <p className="text-[13px] font-bold text-content bg-white px-3 py-1.5 rounded-xl shadow-sm border border-slate-100 w-max">{dia.end}</p>
                                                                        </div>
                                                                        <div className="col-span-2 md:col-span-1">
                                                                            <p className="text-[9px] font-black text-content-2 uppercase tracking-widest mb-1">Almuerzo / Receso</p>
                                                                            <p className="text-[11px] font-bold text-orange-600 flex items-center gap-1.5 bg-orange-50 px-3 py-1.5 rounded-xl border border-orange-100 w-max">
                                                                                <Coffee size={12} strokeWidth={3}/> {dia.break}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex-1">
                                                                        <span className="text-[11px] font-black text-content-2 uppercase tracking-widest bg-surface-card-hover/50 px-3 py-1.5 rounded-xl">Día Libre / Descanso</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* PESTAÑA 5: SOLICITUDES */}
                                {currentTab === 'requests' && (
                                    <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">

                                        {/* Solo lectura — crear/aprobar vive en Gestión de Solicitudes */}
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-black text-content uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                <ClipboardList size={18} className="text-brand"/> Solicitudes del Empleado
                                            </h3>
                                            <button
                                                onClick={() => navigate('/requests', { state: { prefillEmployeeId: emp.id } })}
                                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-brand to-brand-hover text-white rounded-full font-black text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,82,204,0.3)] hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] transition-all hover:-translate-y-0.5 active:scale-[0.97]"
                                            >
                                                <Plus size={13} strokeWidth={3}/> Nueva Solicitud
                                            </button>
                                        </div>

                                        {isLoadingEmpReqs ? (
                                            <div className="space-y-3">
                                                {Array.from({ length: 4 }).map((_, i) => (
                                                    <div key={i} className="flex items-start gap-4 p-4 rounded-[1.5rem] border border-black/[0.06] bg-surface-card">
                                                        <div className="w-9 h-9 skeleton rounded-[1rem] shrink-0" />
                                                        <div className="flex-1 space-y-2">
                                                            <div className="flex gap-2">
                                                                <div className="h-5 w-20 skeleton rounded-md" />
                                                                <div className="h-5 w-16 skeleton rounded-md" />
                                                            </div>
                                                            <div className="h-3 w-40 skeleton rounded-full" />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : empRequests.length === 0 ? (
                                            <div className="flex flex-col items-center py-12 gap-2 text-content-3">
                                                <ClipboardList size={36} strokeWidth={1.2} />
                                                <p className="text-[13px] font-semibold">Sin solicitudes registradas</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {empRequests.map(req => {
                                                    const typeConf = REQUEST_TYPES[req.type]  || { label: req.type,   color: 'bg-surface-card-hover text-content-2', border: 'border-slate-200' };
                                                    const statConf = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-surface-card-hover text-content-3', border: 'border-slate-200', dot: 'bg-content-3' };
                                                    const TypeIcon = { VACATION: Palmtree, PERMIT: FileText, SHIFT_CHANGE: RefreshCw, OVERTIME: Coffee, ADVANCE: DollarSign, CERTIFICATE: FileCheck }[req.type] || FileText;
                                                    return (
                                                        <div key={req.id} className={`flex items-start gap-4 p-4 rounded-[1.5rem] border bg-surface-card backdrop-blur-md ${typeConf.border}`}>
                                                            <div className={`w-9 h-9 rounded-[1rem] flex items-center justify-center flex-shrink-0 ${typeConf.color}`}>
                                                                <TypeIcon size={16} strokeWidth={2} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${typeConf.color} ${typeConf.border}`}>{typeConf.label}</span>
                                                                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${statConf.color} ${statConf.border}`}>
                                                                        <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />{statConf.label}
                                                                    </span>
                                                                </div>
                                                                {req.note && <p className="text-[12px] text-content-2 line-clamp-2">{req.note}</p>}
                                                                {req.approver_note && <p className="text-[11px] text-content-3 mt-1 italic">Nota: {req.approver_note}</p>}
                                                                <p className="text-[10px] text-content-3 mt-1">{new Date(req.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>

                        </div>
                    </div>

                </div>
            </div>
        </GlassViewLayout>

        {showResetConfirm && (
            <ConfirmModal
                isOpen={showResetConfirm}
                onClose={() => !isResetting && setShowResetConfirm(false)}
                onConfirm={executeResetPassword}
                title="Restablecer Contraseña"
                message={`¿Restablecer contraseña de ${emp.name}? Deberá cambiarla en su próximo acceso.`}
                confirmText="Restablecer"
                isDestructive={false}
                isProcessing={isResetting}
            />
        )}

        {resetResult && createPortal(
            <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setResetResult(null)} />
                <div className="relative w-full max-w-sm bg-surface-card backdrop-blur-2xl border border-border-card rounded-[2rem] overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.2)]">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 blur-[50px] rounded-full pointer-events-none w-40 h-40 opacity-20 bg-emerald-500" />
                    <div className="p-6 sm:p-8 flex flex-col items-center relative z-10">
                        <div className="w-14 h-14 rounded-[1.2rem] flex items-center justify-center mb-4 border bg-surface-card border-success/30 shadow-sm text-success">
                            <KeyRound size={26} strokeWidth={2.5} />
                        </div>
                        <h3 className="text-[18px] font-black uppercase tracking-tight mb-1 text-content text-center">Contraseña temporal</h3>
                        <p className="text-[12px] text-content-3 font-medium text-center mb-4 leading-relaxed">
                            Compártela con <span className="font-bold text-content-2">{emp.name}</span>. Deberá cambiarla en su próximo acceso.
                            <br /><span className="text-warning font-bold">No se volverá a mostrar.</span>
                        </p>
                        <div className="w-full flex items-center gap-2 bg-surface-card-hover border border-slate-200 rounded-2xl pl-4 pr-2 py-2.5 mb-4">
                            <span className="flex-1 text-[20px] font-black tracking-[0.2em] text-content text-center select-all">{resetResult.password}</span>
                            <button
                                onClick={async () => {
                                    try { await navigator.clipboard.writeText(resetResult.password); } catch { /* noop */ }
                                    setCopiedPwd(true);
                                    setTimeout(() => setCopiedPwd(false), 2000);
                                }}
                                title="Copiar"
                                className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${copiedPwd ? 'bg-emerald-500 text-white' : 'bg-brand text-white hover:bg-blue-700'}`}>
                                {copiedPwd ? <Check size={18} strokeWidth={2.5} /> : <Copy size={17} strokeWidth={2.2} />}
                            </button>
                        </div>
                        <button onClick={() => setResetResult(null)}
                            className="w-full py-2.5 rounded-2xl bg-surface-card-hover text-content-2 text-[13px] font-bold hover:bg-surface-card-hover transition-colors">
                            Listo
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        )}

        {cancelModalRender && createPortal(
            <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                <div
                    className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${showCancelModal ? 'opacity-100' : 'opacity-0'}`}
                    onClick={!isCancelling ? () => { setShowCancelModal(false); setCancelReason(''); setCancelingEventId(null); } : undefined}
                />
                <div className={`relative w-full max-w-sm bg-surface-card backdrop-blur-2xl border border-border-card rounded-[2rem] overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.2)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ${showCancelModal ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'}`}>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 blur-[50px] rounded-full pointer-events-none w-40 h-40 opacity-20 bg-red-500"></div>
                    <div className="p-6 sm:p-8 flex flex-col items-center relative z-10">
                        <div className="w-14 h-14 rounded-[1.2rem] flex items-center justify-center mb-5 border bg-surface-card border-border-card shadow-sm text-danger">
                            {isCancelling ? <Loader2 size={28} strokeWidth={2.5} className="animate-spin"/> : <AlertTriangle size={28} strokeWidth={2.5}/>}
                        </div>
                        <h3 className="text-[18px] font-black uppercase tracking-tight mb-2 text-content text-center">
                            {isCancelling ? 'Procesando...' : 'Cancelar Acción de RRHH'}
                        </h3>
                        <p className={`text-[13px] font-medium text-content-3 text-center mb-5 transition-opacity duration-300 ${isCancelling ? 'opacity-60' : 'opacity-100'}`}>
                            {isCancelling ? 'Por favor, no cierres esta ventana.' : 'Esta acción quedará registrada como cancelada. No se puede deshacer.'}
                        </p>
                        {!isCancelling && (
                            <>
                                <label className="text-[10px] font-black uppercase tracking-widest text-content-3 mb-2 self-start">Motivo de cancelación *</label>
                                <textarea
                                    value={cancelReason}
                                    onChange={e => setCancelReason(e.target.value)}
                                    placeholder="Explica el motivo de la cancelación..."
                                    rows={3}
                                    className="w-full bg-surface-card border border-border-card rounded-2xl p-3 text-[16px] text-content-2 outline-none focus:ring-2 focus:ring-red-200 resize-none"
                                />
                            </>
                        )}
                    </div>
                    <div className="p-4 sm:p-5 backdrop-blur-md border-t bg-surface-card-hover/50 border-slate-100 flex gap-3 relative z-10">
                        <button
                            onClick={() => { setShowCancelModal(false); setCancelReason(''); setCancelingEventId(null); }}
                            disabled={isCancelling}
                            className={`py-3 px-4 rounded-xl font-black text-[11px] uppercase tracking-widest border flex-1 transition-all ${isCancelling ? 'hidden' : 'text-content-2 bg-white border-slate-200 hover:bg-surface-card-hover hover:-translate-y-0.5 shadow-sm'}`}>
                            Volver
                        </button>
                        <button
                            disabled={!cancelReason.trim() || isCancelling}
                            onClick={async () => {
                                setIsCancelling(true);
                                const { cancelEmployeeEvent } = useStaffStore.getState();
                                const ok = await cancelEmployeeEvent(cancelingEventId, cancelReason.trim());
                                if (ok) useToastStore.getState().showToast('Acción Cancelada', 'El evento fue cancelado exitosamente.', 'success');
                                setIsCancelling(false);
                                setShowCancelModal(false);
                                setCancelReason('');
                                setCancelingEventId(null);
                            }}
                            className="py-3 px-4 rounded-xl font-black text-[11px] uppercase tracking-widest text-white flex-1 transition-all shadow-sm border-transparent bg-red-500 hover:bg-red-600 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0">
                            Confirmar Cancelación
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        )}
        </>
    );
};

export default EmployeeDetailView;