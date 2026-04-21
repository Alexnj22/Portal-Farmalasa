import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
    Edit, Mail, Phone, Shield,
    Clock, FileText, Paperclip,
    CheckCircle, Plus, UploadCloud, Activity, ShieldAlert,
    MapPin, Briefcase, HeartPulse, Download,
    Cake, AlertCircle, AlertTriangle, Wallet, CalendarDays, Coffee, User, ArrowLeft, ArrowRightLeft, Ban, Loader2,
    KeyRound, Camera, ClipboardList, Palmtree, RefreshCw, DollarSign, FileCheck, Check, X, Search, Stethoscope, ChevronLeft, ChevronRight
} from 'lucide-react';
import { REQUEST_TYPES, REQUEST_STATUS } from '../store/slices/requestsSlice';
import { EVENT_TYPES, WEEK_DAYS } from '../data/constants';
import { formatDate, formatTime12h } from '../utils/helpers';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import { useToastStore } from '../store/toastStore';
import ShiftExceptionModal from '../components/ShiftExceptionModal';
import LiquidAvatar from '../components/common/LiquidAvatar';
import GlassViewLayout from '../components/GlassViewLayout';
import ConfirmModal from '../components/common/ConfirmModal';
import RangeDatePicker from '../components/common/RangeDatePicker';
import LiquidDatePicker from '../components/common/LiquidDatePicker';

const EmployeeDetailView = ({ activeEmployee, openModal, setView, activeTab, setActiveTab }) => {
    const navigate = useNavigate(); 
    const { employees, branches, shifts, holidays } = useStaffStore();
    const { user, isAdmin, rolePerms } = useAuth();
    const canEdit = rolePerms === 'ALL' || !!rolePerms?.['staff_detail']?.can_edit;
    
    const [_activeTab, _setActiveTab] = useState('history');
    const currentTab = activeTab || _activeTab;
    const setCurrentTab = setActiveTab || _setActiveTab;

    const [showExceptionModal, setShowExceptionModal] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [cancelingEventId, setCancelingEventId] = useState(null);
    const [cancelReason, setCancelReason] = useState('');
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelModalRender, setCancelModalRender] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);

    // ── Tab Solicitudes: estado local (no contamina store admin) ──────────────
    const [empRequests, setEmpRequests]       = useState([]);
    const [isLoadingEmpReqs, setIsLoadingEmpReqs] = useState(false);
    const [reqFormType, setReqFormType]       = useState('VACATION');
    const [reqFormNote, setReqFormNote]       = useState('');
    const [reqPayload, setReqPayload]         = useState({});
    const [isCreatingReq, setIsCreatingReq]   = useState(false);
    const [showReqForm, setShowReqForm]       = useState(false);

    const createRequest = useStaffStore(s => s.createRequest);
    const cancelRequest = useStaffStore(s => s.cancelRequest);

    const loadEmpRequests = useCallback(async () => {
        const eid = activeEmployee?.id || user?.id;
        if (!eid) return;
        setIsLoadingEmpReqs(true);
        try {
            const { data } = await supabase
                .from('approval_requests')
                .select('id, type, status, note, approver_note, created_at, updated_at')
                .eq('employee_id', eid)
                .order('created_at', { ascending: false });
            setEmpRequests(data || []);
        } catch { /* silencioso */ }
        finally { setIsLoadingEmpReqs(false); }
    }, [activeEmployee?.id, user?.id]);

    useEffect(() => {
        if (currentTab === 'requests') loadEmpRequests();
    }, [currentTab]);

    useEffect(() => {
        if (showCancelModal) setCancelModalRender(true);
        else { const t = setTimeout(() => setCancelModalRender(false), 300); return () => clearTimeout(t); }
    }, [showCancelModal]);

    const targetId = activeEmployee?.id || user?.id;
    const emp = employees.find(e => String(e.id) === String(targetId)) || (activeEmployee || user);

    // 🚨 MODO PRO 4: Fallback Skeleton en lugar de pantalla blanca (return null)
    if (!emp) return (
        <div className="w-full h-[100dvh] flex items-center justify-center bg-[#F2F2F7]">
            <div className="flex flex-col items-center gap-4 text-slate-400 animate-pulse">
                <div className="w-16 h-16 border-4 border-slate-200 border-t-[#007AFF] rounded-full animate-spin"></div>
                <p className="text-[10px] font-black uppercase tracking-widest">Cargando Perfil...</p>
            </div>
        </div>
    );

    const branch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));

    const [ausenciasSearch, setAusenciasSearch]           = useState('');
    const [ausenciasSearchOpen, setAusenciasSearchOpen]   = useState(false);
    const [ausenciasSelectedDay, setAusenciasSelectedDay] = useState(null);
    const [ausenciasCalMonth, setAusenciasCalMonth]       = useState(() => new Date());

    const timeline = useMemo(() => {
        const rawHistory = Array.isArray(emp.history) ? emp.history : [];
        const syntheticEvents = [];

        if (emp.hireDate || emp.hire_date) {
            syntheticEvents.push({
                id: 'hiring-event',
                type: 'HIRING',
                date: emp.hireDate || emp.hire_date,
                note: `Inicio de labores en la empresa. Asignado a: ${branch ? branch.name : 'Sucursal Matriz'}.`,
                isSystem: true
            });
        }

        const mappedHistory = rawHistory.map(ev => {
            const safeNote = ev.note || ev.metadata?.note || ev.details?.note || 'Evento registrado en el sistema.';
            return {
                id: ev.id,
                type: ev.type,
                date: ev.date || (ev.created_at ? ev.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
                note: safeNote,
                metadata: ev.metadata || ev.details || {},
                documentId: ev.document_id || ev.documentId || null,
                isSystem: false
            };
        });

        return [...mappedHistory, ...syntheticEvents].sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [emp.history, emp.hireDate, emp.hire_date, branch]);

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
            const q = ausenciasSearch.toLowerCase();
            list = list.filter(ev => (ev.note || '').toLowerCase().includes(q) || (ev.type || '').toLowerCase().includes(q));
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
    }, [emp.weeklySchedule, shifts]);

    const ausenciasCalDays = useMemo(() => {
        const y = ausenciasCalMonth.getFullYear(), m = ausenciasCalMonth.getMonth();
        const firstDow = new Date(y, m, 1).getDay();
        const dim = new Date(y, m + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < firstDow; i++) cells.push(null);
        for (let d = 1; d <= dim; d++) cells.push(d);
        return { cells, year: y, month: m };
    }, [ausenciasCalMonth]);

    const fallbackInitials = emp.name ? emp.name.charAt(0).toUpperCase() : '👤';

    const age = useMemo(() => {
        if (!emp.birth_date && !emp.birthDate) return null;
        const bDate = new Date((emp.birth_date || emp.birthDate) + 'T12:00:00');
        const diff = Date.now() - bDate.getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
    }, [emp.birth_date, emp.birthDate]);

    const tenure = useMemo(() => {
        if (!emp.hire_date && !emp.hireDate) return 'Sin fecha';
        const hDate = new Date((emp.hire_date || emp.hireDate) + 'T12:00:00');
        const now = new Date();
        let years = now.getFullYear() - hDate.getFullYear();
        let months = now.getMonth() - hDate.getMonth();
        if (months < 0) { years--; months += 12; }
        if (years === 0 && months === 0) return 'Nuevo Ingreso';
        return `${years > 0 ? `${years} Año${years > 1 ? 's' : ''} ` : ''}${months > 0 ? `${months} Mes${months > 1 ? 'es' : ''}` : ''}`;
    }, [emp.hire_date, emp.hireDate]);

    const latePunches = useMemo(() => {
        return (emp.attendance || []).filter(a => a.type === 'LATE').length;
    }, [emp.attendance]);

    const scheduleData = useMemo(() => {
        const scheduleMap = emp.weeklySchedule || {};
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
    }, [emp.weeklySchedule, shifts]);

    const todayName = useMemo(() => {
        const days = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };
        return days[new Date().getDay()];
    }, []);

    // 🚨 MODO PRO 1: useCallback para evitar re-renders innecesarios en componentes hijos
    const handleEditProfile = useCallback((e) => {
        if(e) { e.preventDefault(); e.stopPropagation(); }
        if (typeof openModal === 'function') openModal('editEmployee', emp);
    }, [openModal, emp]);

    const handleNewHRAction = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof openModal === 'function') openModal('newEvent', { type: 'TRANSFER', employeeId: emp.id });
    }, [openModal, emp.id]);

    const handleUploadConstancia = useCallback((e, punchTimestamp) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof openModal === 'function') openModal('uploadConstancia', { employeeId: emp.id, punchTimestamp });
    }, [openModal, emp.id]);

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
                useToastStore.getState().showToast(
                    'Contraseña Restablecida',
                    `${emp.name} deberá cambiar su contraseña en su próximo acceso.`,
                    'success'
                );
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
        <div className="flex items-center gap-2 md:gap-3 bg-white/40 backdrop-blur-2xl border border-white/60 p-2 md:p-2.5 rounded-[2.5rem] shadow-sm w-max max-w-full overflow-x-auto hide-scrollbar">
            
            <div className="flex items-center relative bg-white/50 border border-white/60 rounded-full p-1 shrink-0 shadow-[inset_0_1px_4px_rgba(0,0,0,0.02)]">
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

                <button onClick={() => setCurrentTab('history')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'history' ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Clock size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Historial</span>
                </button>
                <button onClick={() => setCurrentTab('documents')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'documents' ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}>
                    <FileText size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Archivo</span>
                </button>
                <button onClick={() => setCurrentTab('permissions')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'permissions' ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Stethoscope size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Ausencias</span>
                </button>
                <button onClick={() => setCurrentTab('payroll')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'payroll' ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Wallet size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Horarios</span>
                </button>
                <button onClick={() => setCurrentTab('requests')} className={`relative z-10 px-4 md:px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors flex items-center gap-2 ${currentTab === 'requests' ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}>
                    <ClipboardList size={14} strokeWidth={2.5}/> <span className="hidden sm:inline">Solicitudes</span>
                </button>
            </div>

            {isAdmin && <div className="w-px h-6 bg-white/50 mx-1 shrink-0"></div>}

            {isAdmin && (
                <button onClick={handleNewHRAction} disabled={!canEdit} className="flex items-center gap-2 h-9 md:h-10 px-4 md:px-5 bg-gradient-to-br from-[#007AFF] to-[#005CE6] text-white rounded-full font-black text-[9px] md:text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
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
                    {isAdmin && (
                        <button 
                            onClick={() => {
                                if (typeof setView === 'function') setView('dashboard');
                                else navigate('/dashboard');
                            }} 
                            className="relative group/back w-10 h-10 md:w-11 md:h-11 flex items-center justify-center rounded-full shrink-0 active:scale-95 transition-all duration-300 border border-slate-200/60 shadow-[0_2px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_6px_20px_rgba(0,122,255,0.2)] hover:-translate-y-0.5 z-50 bg-white"
                            title="Volver a Personal"
                        >
                            <div className="absolute inset-0 bg-gradient-to-tr from-[#007AFF]/20 to-cyan-400/20 rounded-full opacity-0 group-hover/back:opacity-100 transition-opacity duration-300"></div>
                            <ArrowLeft size={18} strokeWidth={2.5} className="text-slate-400 group-hover/back:text-[#007AFF] transition-colors relative z-10" />
                        </button>
                    )}

                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-[1rem] md:rounded-[1.25rem] bg-[#007AFF] text-white flex items-center justify-center shadow-[0_8px_20px_rgba(0,122,255,0.3)] shrink-0">
                        <User size={20} className="md:w-6 md:h-6" strokeWidth={2} />
                    </div>

                    <div className="flex flex-col items-start justify-center cursor-default">
                        <h2 className="text-[20px] md:text-[22px] font-black text-slate-800 leading-none tracking-tight">Perfil de Empleado</h2>
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
                        <div className="bg-white/60 backdrop-blur-md border border-white/60 rounded-[1.5rem] p-4 md:p-5 shadow-sm flex items-center gap-4 transition-all hover:bg-white">
                            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl shadow-sm border border-emerald-100/50"><CheckCircle size={18} strokeWidth={2.5}/></div>
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Estado</p>
                                <p className="text-[13px] md:text-[14px] font-bold text-slate-800">{emp.effectiveStatus || emp.status || 'Activo'}</p>
                            </div>
                        </div>
                        <div className="bg-white/60 backdrop-blur-md border border-white/60 rounded-[1.5rem] p-4 md:p-5 shadow-sm flex items-center gap-4 transition-all hover:bg-white">
                            <div className="p-2.5 bg-blue-50 text-[#007AFF] rounded-xl shadow-sm border border-blue-100/50"><Briefcase size={18} strokeWidth={2.5}/></div>
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Antigüedad</p>
                                <p className="text-[13px] md:text-[14px] font-bold text-slate-800 truncate">{tenure}</p>
                            </div>
                        </div>
                        <div className="bg-white/60 backdrop-blur-md border border-white/60 rounded-[1.5rem] p-4 md:p-5 shadow-sm flex items-center gap-4 transition-all hover:bg-white">
                            <div className="p-2.5 bg-pink-50 text-pink-500 rounded-xl shadow-sm border border-pink-100/50"><Cake size={18} strokeWidth={2.5}/></div>
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Edad</p>
                                <p className="text-[13px] md:text-[14px] font-bold text-slate-800">{age ? `${age} Años` : 'N/D'}</p>
                            </div>
                        </div>
                        <div className="bg-white/60 backdrop-blur-md border border-white/60 rounded-[1.5rem] p-4 md:p-5 shadow-sm flex items-center gap-4 transition-all hover:bg-white">
                            <div className={`p-2.5 rounded-xl shadow-sm border ${latePunches > 0 ? 'bg-red-50 text-red-500 border-red-100/50' : 'bg-slate-50 text-slate-400 border-slate-100/50'}`}><AlertCircle size={18} strokeWidth={2.5}/></div>
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tardanzas (Mes)</p>
                                <p className={`text-[13px] md:text-[14px] font-bold ${latePunches > 0 ? 'text-red-500' : 'text-slate-800'}`}>{latePunches} Acumuladas</p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
                        
                        {/* --- TARJETA DE PERFIL (IZQUIERDA) --- */}
                        <div className="lg:col-span-4 space-y-5">
                            <div className="relative w-full overflow-hidden rounded-[2.5rem] border border-white/60 bg-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.05)] backdrop-blur-2xl">
                                
                                <div className="absolute top-0 h-32 w-full bg-gradient-to-b from-[#007AFF]/15 to-transparent"></div>
                                
                                <div className="px-6 pb-8 pt-10 flex flex-col items-center relative z-10">
                                    
                                    <div className="h-36 w-36 md:h-40 md:w-40 rounded-full p-1.5 bg-white/60 border border-white shadow-xl backdrop-blur-md mb-5 group relative">
                                        <div className="h-full w-full rounded-full overflow-hidden bg-slate-100 relative shadow-inner">
                                            <LiquidAvatar src={emp.photo_url || emp.photo} alt={emp.name} fallbackText={fallbackInitials} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                        </div>
                                        {isAdmin && canEdit && (
                                            <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center cursor-pointer"
                                                onClick={handleEditProfile}>
                                                <Camera size={24} className="text-white"/>
                                            </div>
                                        )}
                                        {(emp.effectiveStatus === 'Activo' || emp.effectiveStatus === 'En Apoyo') && (
                                            <span className="absolute bottom-2 right-4 w-5 h-5 bg-emerald-500 border-4 border-white rounded-full shadow-sm z-10"></span>
                                        )}
                                    </div>
                                    
                                    <h2 className="text-2xl md:text-3xl font-black text-slate-800 text-center leading-tight mb-1.5 tracking-tight">
                                        {emp.name}
                                    </h2>
                                    
                                    <div className="flex flex-col items-center gap-2 mb-8">
                                        <span className="px-4 py-1 rounded-full bg-[#007AFF]/10 border border-[#007AFF]/20 text-[#007AFF] font-black text-[10px] uppercase tracking-[0.15em] text-center shadow-sm">
                                            {emp.role || 'Sin Cargo Asignado'}
                                        </span>
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                            CÓD: {emp.code || 'S/N'}
                                        </span>
                                        {isAdmin && (
                                            <div className="flex gap-2 mt-3 justify-center animate-in fade-in duration-300">
                                                <button onClick={handleEditProfile}
                                                    disabled={!canEdit}
                                                    className="flex items-center gap-1.5 px-4 py-2 bg-white/80 hover:bg-[#007AFF] text-slate-600 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 hover:-translate-y-0.5 active:scale-95 shadow-sm hover:shadow-[0_4px_15px_rgba(0,122,255,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
                                                    <Edit size={12}/> Editar
                                                </button>
                                                <button onClick={handleResetPassword}
                                                    className="flex items-center gap-1.5 px-4 py-2 bg-white/80 hover:bg-amber-500 text-slate-600 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 hover:-translate-y-0.5 active:scale-95 shadow-sm hover:shadow-[0_4px_15px_rgba(245,158,11,0.3)]">
                                                    <KeyRound size={12}/> Contraseña
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="w-full space-y-3">
                                        <div className="group flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/60 border border-white/80 hover:bg-white transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                                            <div className="p-2.5 bg-white border border-slate-100 rounded-[0.8rem] shadow-sm text-[#007AFF] group-hover:scale-110 transition-transform"><Mail size={16} strokeWidth={2.5}/></div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-0.5">Correo</p>
                                                <p className="text-[12px] font-bold text-slate-700 truncate">{emp.email || emp.username || 'No registrado'}</p>
                                            </div>
                                        </div>

                                        <div className="group flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/60 border border-white/80 hover:bg-white transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.02)] relative">
                                            <div className="p-2.5 bg-white border border-slate-100 rounded-[0.8rem] shadow-sm text-emerald-500 group-hover:scale-110 transition-transform"><Phone size={16} strokeWidth={2.5}/></div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-0.5">Celular</p>
                                                <p className="text-[12px] font-bold text-slate-700">{emp.phone || 'No registrado'}</p>
                                            </div>
                                            {emp.phone && (
                                                <a href={formatWhatsAppLink(emp.phone)} target="_blank" rel="noreferrer" className="absolute right-3 p-2 bg-emerald-50 text-emerald-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Phone size={14} strokeWidth={3}/>
                                                </a>
                                            )}
                                        </div>

                                        <div className="group flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/60 border border-white/80 hover:bg-white transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                                            <div className="p-2.5 bg-white border border-slate-100 rounded-[0.8rem] shadow-sm text-purple-500 group-hover:scale-110 transition-transform"><Shield size={16} strokeWidth={2.5}/></div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-0.5">Documento (DUI)</p>
                                                <p className="text-[12px] font-bold text-slate-700">{emp.dui || 'No registrado'}</p>
                                            </div>
                                        </div>

                                        <div className="group flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/60 border border-white/80 hover:bg-white transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                                            <div className="p-2.5 bg-white border border-slate-100 rounded-[0.8rem] shadow-sm text-orange-500 group-hover:scale-110 transition-transform"><MapPin size={16} strokeWidth={2.5}/></div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-0.5">Sucursal Base</p>
                                                <p className="text-[12px] font-bold text-slate-700 truncate">{branch ? branch.name : 'Sin Asignar'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* TARJETA DE EMERGENCIA */}
                            {(emp.emergency_contact_name || emp.emergency_contact_phone || emp.blood_type) && (
                                <div className="w-full bg-red-50/50 backdrop-blur-md rounded-[2rem] border border-red-100/50 shadow-sm p-6 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-4 opacity-10 text-red-600 group-hover:scale-110 transition-transform duration-500"><HeartPulse size={80} /></div>
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-4 flex items-center gap-2">
                                        <HeartPulse size={14} strokeWidth={3}/> Contacto de Emergencia
                                    </h3>
                                    <div className="space-y-3 relative z-10">
                                        {emp.emergency_contact_name && (
                                            <div>
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Avisar a</p>
                                                <p className="text-[13px] font-bold text-slate-800">{emp.emergency_contact_name}</p>
                                            </div>
                                        )}
                                        {emp.emergency_contact_phone && (
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Teléfono</p>
                                                    <p className="text-[13px] font-bold text-slate-800">{emp.emergency_contact_phone}</p>
                                                </div>
                                                <a href={`tel:${emp.emergency_contact_phone.replace(/\D/g,'')}`} className="p-2.5 bg-red-100 text-red-600 rounded-full hover:bg-red-500 hover:text-white transition-colors shadow-sm">
                                                    <Phone size={14} strokeWidth={2.5}/>
                                                </a>
                                            </div>
                                        )}
                                        {emp.blood_type && (
                                            <div className="pt-2 border-t border-red-100/50">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Tipo de Sangre</p>
                                                <p className="text-[13px] font-black text-red-600">{emp.blood_type}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* --- CONTENIDO PRINCIPAL (DERECHA) --- */}
                        <div className="lg:col-span-8">
                            <div className="bg-white/40 backdrop-blur-2xl rounded-[2.5rem] border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.03)] p-5 md:p-8 min-h-[600px] overflow-hidden relative">
                                
                                {/* PESTAÑA 1: HISTORIAL */}
                                {currentTab === 'history' && (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                                        <div className="flex justify-between items-center mb-6">
                                            <h3 className="font-black text-slate-800 uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                <Clock size={18} className="text-[#007AFF]"/> Historial Operativo
                                            </h3>
                                            <div className="px-3 py-1 bg-white/70 text-slate-500 rounded-full text-[9px] font-black uppercase tracking-widest border border-white shadow-sm">
                                                {timeline.length} Eventos
                                            </div>
                                        </div>

                                        <div className="relative border-l-[3px] border-slate-200/70 ml-4 md:ml-6 space-y-8 pb-4">
                                            {timeline.length > 0 ? timeline.map((ev, idx) => {
                                                const isHiring = ev.type === 'HIRING';
                                                let evTheme = { label: ev.type, bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' };
                                                
                                                if (isHiring) {
                                                    evTheme = { label: 'Contratación Inicial', bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' };
                                                } else if (EVENT_TYPES[ev.type]) {
                                                    const rawType = EVENT_TYPES[ev.type];
                                                    evTheme.label = rawType.label;
                                                    if (ev.type.includes('TRANSFER')) evTheme = { ...evTheme, bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' };
                                                    if (ev.type.includes('PROMOTION')) evTheme = { ...evTheme, bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' };
                                                    if (ev.type.includes('SALARY')) evTheme = { ...evTheme, bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200' };
                                                    if (ev.type.includes('TERMINATION')) evTheme = { ...evTheme, bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' };
                                                }

                                                return (
                                                    <div key={ev.id || `evt-${idx}`} className="relative pl-8 group">
                                                        <div className={`absolute -left-[10px] top-1.5 w-4 h-4 rounded-full bg-white border-[4px] shadow-sm group-hover:scale-125 transition-transform duration-300 z-10 ${isHiring ? 'border-emerald-500' : 'border-[#007AFF]'}`}></div>
                                                        
                                                        <div className={`bg-white/60 hover:bg-white/90 rounded-3xl p-5 border border-white/80 transition-all duration-300 shadow-[0_4px_15px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_25px_rgba(0,0,0,0.04)] ${ev.metadata?.status === 'CANCELLED' || ev.metadata?.status === 'SUPERSEDED' ? 'opacity-50' : ''}`}>
                                                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-3">
                                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border shadow-sm ${evTheme.bg} ${evTheme.text} ${evTheme.border}`}>
                                                                    {evTheme.label}
                                                                </span>
                                                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-100/50 px-2 py-1 rounded-md">
                                                                    {formatDate(ev.date)}
                                                                </span>
                                                            </div>
                                                            
                                                            <p className="text-[13px] text-slate-700 leading-relaxed font-semibold mb-1">
                                                                {ev.note}
                                                            </p>

                                                            {ev.metadata?.permissionDates && ev.metadata.permissionDates.length > 0 && (
                                                                <div className="mt-3 flex flex-wrap gap-1.5">
                                                                    <span className="text-[9px] font-black uppercase text-slate-400 w-full mb-0.5">Días de Ausencia Autorizada:</span>
                                                                    {ev.metadata.permissionDates.map((d, i) => (
                                                                        <span key={i} className="px-2 py-1 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg text-[10px] font-black tracking-widest">{formatDate(d)}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            
                                                            {ev.metadata?.old_value && ev.metadata?.new_value && (
                                                                 <p className="text-[11px] font-medium text-slate-500 mt-2 bg-slate-50 p-2 rounded-lg border border-slate-100 flex gap-2 items-center">
                                                                     <span className="font-bold line-through opacity-70">{ev.metadata.old_value}</span> <ArrowRightLeft size={10}/> <span className="font-bold text-[#007AFF]">{ev.metadata.new_value}</span>
                                                                 </p>
                                                            )}
                                                            
                                                            {!ev.isSystem && typeof openModal === 'function' && (
                                                                <div className="pt-4 mt-3 border-t border-slate-200/60 flex justify-between items-center">
                                                                    {ev.metadata?.status === 'CANCELLED' ? (
                                                                        <span className="px-2 py-1 bg-red-100 text-red-500 rounded-full text-[9px] font-black uppercase tracking-widest">
                                                                            CANCELADO
                                                                        </span>
                                                                    ) : ev.metadata?.status === 'SUPERSEDED' ? (
                                                                        <span className="px-2 py-1 bg-slate-200 text-slate-500 rounded-full text-[9px] font-black uppercase tracking-widest">
                                                                            EDITADO
                                                                        </span>
                                                                    ) : ev.documentId ? (
                                                                        <button className="flex items-center gap-1.5 text-[#007AFF] bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-black text-[9px] uppercase tracking-widest transition-colors shadow-sm">
                                                                            <FileText size={12} strokeWidth={2.5}/> Ver Respaldo Legal
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => openModal('uploadDocument', {}, ev.id)}
                                                                            disabled={!canEdit}
                                                                            className="flex items-center gap-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 px-3 py-1.5 rounded-lg font-black text-[9px] uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                                        >
                                                                            <Paperclip size={12} strokeWidth={2.5}/> Adjuntar Soporte
                                                                        </button>
                                                                    )}
                                                                    {isAdmin && ev.metadata?.status !== 'CANCELLED' && ev.metadata?.status !== 'SUPERSEDED' && (
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
                                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-500 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                                                                            <Edit size={11} strokeWidth={2.5}/> Editar
                                                                        </button>
                                                                    )}
                                                                    {isAdmin && ev.metadata?.status !== 'CANCELLED' && ev.metadata?.status !== 'SUPERSEDED' && (
                                                                        <button
                                                                            onClick={() => { setCancelingEventId(ev.id); setShowCancelModal(true); }}
                                                                            disabled={!canEdit}
                                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                                                                            <Ban size={11} strokeWidth={2.5}/> Cancelar
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {isHiring && (
                                                                <div className="pt-3 mt-1 flex items-center gap-1.5 text-emerald-500 opacity-70">
                                                                    <Briefcase size={12} strokeWidth={2.5}/> 
                                                                    <span className="text-[9px] font-black uppercase tracking-widest">Hito de Inicio Operativo</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            }) : (
                                                <div className="flex flex-col items-center justify-center py-20 opacity-50 px-4">
                                                    <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-slate-200">
                                                        <Clock size={28} className="text-slate-400" strokeWidth={2}/>
                                                    </div>
                                                    <p className="font-black uppercase tracking-widest text-[11px] text-slate-600">Historial en Blanco</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                
                                {/* PESTAÑA 2: DOCUMENTOS */}
                                {currentTab === 'documents' && (
                                    <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                         <div className="flex justify-between items-center mb-6">
                                            <h3 className="font-black text-slate-800 uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                <FileText size={18} className="text-[#007AFF]"/> Expediente Digital
                                            </h3>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {emp.documents?.map(doc => (
                                                <div key={doc.id} className="p-4 bg-white/60 hover:bg-white/90 rounded-[1.5rem] border border-white/80 flex items-center justify-between group cursor-pointer shadow-sm hover:shadow-[0_8px_20px_rgba(0,0,0,0.04)] hover:-translate-y-0.5 transition-all duration-300">
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="p-3 bg-[#007AFF]/10 rounded-xl text-[#007AFF] shadow-inner group-hover:scale-110 transition-transform"><FileText size={20} strokeWidth={2.5}/></div>
                                                        <div className="min-w-0 pr-2">
                                                            <p className="text-[12px] font-black text-slate-700 truncate">{doc.name}</p>
                                                            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">{doc.type || 'DOCUMENTO'}</p>
                                                        </div>
                                                    </div>
                                                    <button className="w-8 h-8 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 text-[#007AFF] bg-blue-50 rounded-full transition-all duration-300 shadow-sm border border-blue-100"><Download size={14} strokeWidth={2.5}/></button>
                                                </div>
                                            ))}
                                            {(!emp.documents || emp.documents.length === 0) && (
                                                <div className="col-span-full flex flex-col items-center justify-center py-20 opacity-50 px-4">
                                                    <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-slate-200"><FileText size={28} className="text-slate-400" strokeWidth={2}/></div>
                                                    <p className="font-black uppercase tracking-widest text-[11px] text-slate-600">Expediente Vacío</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* PESTAÑA 3: AUSENCIAS (Permisos + Incapacidades) */}
                                {currentTab === 'permissions' && (() => {
                                    const todayStr = new Date().toISOString().split('T')[0];
                                    return (
                                    <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-5">

                                        {/* ── Cabecera ── */}
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <h3 className="font-black text-slate-800 uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                <Stethoscope size={18} className="text-amber-500"/> Ausencias
                                                <span className="text-[11px] font-bold text-slate-400 normal-case tracking-normal">Permisos e Incapacidades</span>
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                {ausenciasSelectedDay && (
                                                    <button onClick={() => setAusenciasSelectedDay(null)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-500 text-[11px] font-black hover:bg-red-100 transition-all active:scale-95">
                                                        <X size={10} strokeWidth={3}/> {ausenciasSelectedDay}
                                                    </button>
                                                )}
                                                <div className={`flex items-center gap-1.5 rounded-full border transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden ${ausenciasSearchOpen ? 'bg-white border-slate-200 px-2.5 py-1 w-40' : 'bg-white/60 border-slate-200/60 w-8 h-8 justify-center'}`}>
                                                    <button type="button"
                                                        onClick={() => { setAusenciasSearchOpen(v => !v); if (ausenciasSearchOpen) setAusenciasSearch(''); }}
                                                        className="flex-shrink-0 text-slate-500 hover:text-slate-700 transition-colors">
                                                        {ausenciasSearchOpen ? <X size={11} strokeWidth={2.5}/> : <Search size={12} strokeWidth={2.5}/>}
                                                    </button>
                                                    {ausenciasSearchOpen && (
                                                        <input autoFocus type="text" value={ausenciasSearch}
                                                            onChange={e => setAusenciasSearch(e.target.value)}
                                                            placeholder="Buscar..."
                                                            className="flex-1 min-w-0 text-[11px] font-medium text-slate-700 placeholder-slate-300 outline-none bg-transparent" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── Calendario ── */}
                                        <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[1.5rem] p-4 shadow-sm overflow-visible">
                                            {/* Navegación de mes */}
                                            <div className="flex items-center justify-between mb-3">
                                                <button onClick={() => { setAusenciasCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)); setAusenciasSelectedDay(null); }}
                                                    className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-blue-50 transition-all active:scale-90">
                                                    <ChevronLeft size={14} strokeWidth={2.5}/>
                                                </button>
                                                <span className="text-[13px] font-black text-slate-700 capitalize">
                                                    {ausenciasCalMonth.toLocaleDateString('es', { month: 'long', year: 'numeric' })}
                                                </span>
                                                <button onClick={() => { setAusenciasCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)); setAusenciasSelectedDay(null); }}
                                                    className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-blue-50 transition-all active:scale-90">
                                                    <ChevronRight size={14} strokeWidth={2.5}/>
                                                </button>
                                            </div>
                                            {/* Encabezados días */}
                                            <div className="grid grid-cols-7 mb-1">
                                                {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d => (
                                                    <div key={d} className="text-center text-[9px] font-black text-slate-300 uppercase py-1">{d}</div>
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
                                                        cellBg = 'bg-[#007AFF]';
                                                    } else if (isInsurance && hasPermit) {
                                                        cellBg = 'bg-gradient-to-br from-amber-100 to-violet-100 border border-violet-200';
                                                    } else if (isInsurance) {
                                                        cellBg = 'bg-violet-100 border border-violet-300';
                                                    } else if (hasPermit && hasDisab) {
                                                        cellBg = 'bg-gradient-to-br from-amber-100 to-red-100 border border-amber-200';
                                                    } else if (hasPermit) {
                                                        cellBg = 'bg-amber-100 border border-amber-200';
                                                    } else if (hasDisab) {
                                                        cellBg = 'bg-red-100 border border-red-200';
                                                    } else {
                                                        cellBg = 'hover:bg-blue-50/60';
                                                    }

                                                    return (
                                                        <div key={ds}
                                                            className={`relative group/cal flex flex-col items-center justify-center rounded-lg transition-all duration-200 ${hasEvents ? 'cursor-pointer hover:scale-110 hover:z-20 hover:shadow-md' : 'cursor-default'} ${cellBg}`}
                                                            onClick={() => hasEvents && setAusenciasSelectedDay(prev => prev === ds ? null : ds)}>
                                                            <span className={`text-[12px] font-bold leading-none select-none ${isSelected || isToday ? 'text-white' : hasEvents ? 'text-slate-700' : 'text-slate-400'}`}>
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
                                                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">{ds}</p>
                                                                    {tooltipLines.map((item, li) => (
                                                                        <div key={li} className={li > 0 ? 'mt-2 pt-2 border-t border-slate-700' : ''}>
                                                                            <div className="flex items-center justify-between gap-3">
                                                                                <span className="text-[11px] font-black">{item.label}</span>
                                                                                {item.hoursStr && <span className="text-[10px] font-bold text-amber-300 whitespace-nowrap">{item.hoursStr}</span>}
                                                                            </div>
                                                                            {item.note && <p className="text-[10px] text-slate-300 mt-0.5 leading-snug whitespace-normal">{item.note}</p>}
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
                                                    <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-200 flex-shrink-0"/>
                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Permiso</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-3 h-3 rounded-sm bg-red-100 border border-red-200 flex-shrink-0"/>
                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Incapacidad</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-3 h-3 rounded-sm bg-violet-100 border border-violet-300 flex-shrink-0"/>
                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Día 4+ Seguro</span>
                                                </div>
                                                {ausenciasSelectedDay && (
                                                    <div className="flex items-center gap-1.5 ml-auto">
                                                        <span className="w-3 h-3 rounded-sm bg-emerald-500 flex-shrink-0"/>
                                                        <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Seleccionado</span>
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
                                                        ? { bg: 'bg-red-50/60',    border: 'border-red-200/60',    text: 'text-red-700',    badge: 'bg-red-100 text-red-700 border-red-200',       leftBorder: 'border-red-300',    Icon: Stethoscope, label: 'Incapacidad',
                                                            hover: 'hover:bg-red-50 hover:border-red-300 hover:shadow-[0_8px_24px_rgba(239,68,68,0.12)]' }
                                                        : hasHours
                                                        ? { bg: 'bg-orange-50/60', border: 'border-orange-200/60', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700 border-orange-200', leftBorder: 'border-orange-300', Icon: Clock,       label: 'Permiso por Horas',
                                                            hover: 'hover:bg-orange-50 hover:border-orange-300 hover:shadow-[0_8px_24px_rgba(249,115,22,0.12)]' }
                                                        : { bg: 'bg-amber-50/60',  border: 'border-amber-200/60',  text: 'text-amber-700',  badge: 'bg-amber-100 text-amber-700 border-amber-200',  leftBorder: 'border-amber-300',  Icon: FileText,    label: 'Permiso',
                                                            hover: 'hover:bg-amber-50 hover:border-amber-300 hover:shadow-[0_8px_24px_rgba(245,158,11,0.12)]' };

                                                    return (
                                                        <div key={ev.id || idx} className={`group/card ${cfg.bg} border ${cfg.border} rounded-[1.5rem] p-4 flex flex-col gap-3 ${cfg.hover} hover:-translate-y-0.5 transition-all duration-300 shadow-sm cursor-default`}>
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="flex items-center gap-2.5">
                                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.badge} border group-hover/card:scale-110 transition-transform duration-300`}>
                                                                        <cfg.Icon size={15} strokeWidth={2}/>
                                                                    </div>
                                                                    <div>
                                                                        <span className={`text-[10px] font-black uppercase tracking-widest ${cfg.text}`}>{cfg.label}</span>
                                                                        <p className="text-[10px] text-slate-400 font-bold">
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
                                                                <p className={`text-[12px] font-medium text-slate-600 border-l-[3px] pl-3 py-0.5 ${cfg.leftBorder}`}>
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
                                                <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3 border border-slate-200">
                                                    <Stethoscope size={24} className="text-slate-400" strokeWidth={1.5}/>
                                                </div>
                                                <p className="font-black uppercase tracking-widest text-[11px] text-slate-500">
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
                                        
                                        {isAdmin && (
                                            <div>
                                                <div className="flex justify-between items-center mb-5">
                                                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                        <Wallet size={18} className="text-emerald-500"/> Información Salarial
                                                    </h3>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="p-5 bg-gradient-to-br from-emerald-50 to-white rounded-[1.5rem] border border-emerald-100 shadow-sm">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600/70 mb-1">Salario Base Contractual</p>
                                                        <p className="text-2xl font-black text-emerald-700 tracking-tight">${emp.salary || emp.base_salary || '0.00'}</p>
                                                    </div>
                                                    <div className="p-5 bg-white/60 rounded-[1.5rem] border border-white/80 shadow-sm flex flex-col justify-center">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Depósito de Planilla</p>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[14px] font-bold text-slate-700">{emp.bank_name || 'No configurado'}</span>
                                                            <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[11px] font-black tracking-wider border border-slate-200">CTA: {emp.account_number || '---'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <div className="flex justify-between items-center mb-5 pt-4 border-t border-slate-200/50">
                                                <h3 className="font-black text-slate-800 uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                    <CalendarDays size={18} className="text-[#007AFF]"/> Turnos de la Semana
                                                </h3>
                                            </div>
                                            
                                            <div className="bg-white/50 border border-white/80 rounded-[2rem] overflow-hidden shadow-sm">
                                                <div className="grid grid-cols-1 divide-y divide-slate-100/50">
                                                    {scheduleData.map((dia, idx) => {
                                                        const isToday = dia.day === todayName; 

                                                        return (
                                                            <div key={idx} className={`relative p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-colors ${dia.active ? 'hover:bg-white/80' : 'opacity-50 grayscale bg-slate-50/50'} ${isToday ? 'bg-blue-50/50 ring-1 ring-[#007AFF]/20 shadow-[inset_0_0_20px_rgba(0,122,255,0.05)]' : ''}`}>
                                                                
                                                                {isToday && (
                                                                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#007AFF] shadow-[0_0_10px_rgba(0,122,255,0.4)]"></div>
                                                                )}

                                                                <div className="flex items-center gap-3 w-32 shrink-0 relative">
                                                                    <div className={`w-2.5 h-2.5 rounded-full ${dia.active ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-slate-300'}`}></div>
                                                                    <span className={`text-[12px] font-black uppercase tracking-widest ${dia.active ? 'text-slate-700' : 'text-slate-400'}`}>{dia.day}</span>
                                                                    {isToday && (
                                                                        <span className="ml-2 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-[#007AFF] text-white shadow-sm animate-pulse">Hoy</span>
                                                                    )}
                                                                </div>
                                                                
                                                                {dia.active ? (
                                                                    <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4 w-full">
                                                                        <div>
                                                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Entrada</p>
                                                                            <p className="text-[13px] font-bold text-slate-800 bg-white px-3 py-1.5 rounded-xl shadow-sm border border-slate-100 w-max">{dia.start}</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Salida</p>
                                                                            <p className="text-[13px] font-bold text-slate-800 bg-white px-3 py-1.5 rounded-xl shadow-sm border border-slate-100 w-max">{dia.end}</p>
                                                                        </div>
                                                                        <div className="col-span-2 md:col-span-1">
                                                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Almuerzo / Receso</p>
                                                                            <p className="text-[11px] font-bold text-orange-600 flex items-center gap-1.5 bg-orange-50 px-3 py-1.5 rounded-xl border border-orange-100 w-max">
                                                                                <Coffee size={12} strokeWidth={3}/> {dia.break}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex-1">
                                                                        <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest bg-slate-200/50 px-3 py-1.5 rounded-xl">Día Libre / Descanso</span>
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

                                        {/* Botón nueva solicitud */}
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-black text-slate-800 uppercase tracking-tight text-[16px] flex items-center gap-2">
                                                <ClipboardList size={18} className="text-[#007AFF]"/> Mis Solicitudes
                                            </h3>
                                            <button
                                                onClick={() => setShowReqForm(v => !v)}
                                                disabled={!canEdit}
                                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-[#007AFF] to-[#005CE6] text-white rounded-full font-black text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Plus size={13} strokeWidth={3}/> Nueva Solicitud
                                            </button>
                                        </div>

                                        {/* Formulario */}
                                        {showReqForm && (
                                            <div className="rounded-[1.75rem] border border-[#007AFF]/20 bg-white/80 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,122,255,0.06)] p-5 space-y-4 animate-in slide-in-from-top-3 duration-300">
                                                <div>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Tipo</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {[
                                                            { key: 'VACATION',    icon: Palmtree },
                                                            { key: 'PERMIT',      icon: FileText },
                                                            { key: 'SHIFT_CHANGE',icon: RefreshCw },
                                                            { key: 'OVERTIME',    icon: Coffee },
                                                            { key: 'ADVANCE',     icon: DollarSign },
                                                            { key: 'CERTIFICATE', icon: FileCheck },
                                                        ].map(({ key, icon: Icon }) => {
                                                            const conf = REQUEST_TYPES[key];
                                                            return (
                                                                <button
                                                                    key={key}
                                                                    type="button"
                                                                    onClick={() => { setReqFormType(key); setReqPayload({}); }}
                                                                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-bold transition-all ${
                                                                        reqFormType === key
                                                                            ? `${conf.color} ${conf.border} shadow-sm`
                                                                            : 'border-slate-200 text-slate-500 hover:border-slate-300 bg-white'
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
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                                                        {reqFormType === 'VACATION' ? 'Período de Vacaciones' :
                                                         reqFormType === 'PERMIT'   ? 'Días de Permiso' :
                                                         'Fecha'}
                                                    </p>
                                                    {reqFormType === 'VACATION' ? (
                                                        <RangeDatePicker
                                                            startDate={reqPayload.startDate || ''}
                                                            endDate={reqPayload.endDate || ''}
                                                            onRangeChange={(s, e) => setReqPayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                                                            holidays={holidays}
                                                            defaultDays={15}
                                                            label="vacaciones"
                                                        />
                                                    ) : (
                                                        <LiquidDatePicker
                                                            value={reqPayload.date || ''}
                                                            onChange={(v) => setReqPayload(prev => ({ ...prev, date: v }))}
                                                            placeholder="Seleccionar fecha"
                                                            holidays={holidays}
                                                        />
                                                    )}
                                                </div>

                                                <div>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Motivo / Descripción <span className="text-red-400">*</span></p>
                                                    <textarea
                                                        value={reqFormNote}
                                                        onChange={e => setReqFormNote(e.target.value)}
                                                        rows={3}
                                                        placeholder="Describe tu solicitud..."
                                                        className="w-full px-4 py-3 rounded-[1.25rem] border border-slate-200 bg-white text-[13px] text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF]/50 resize-none transition-all"
                                                    />
                                                </div>

                                                <div className="flex gap-2 justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setShowReqForm(false); setReqFormNote(''); setReqPayload({}); }}
                                                        className="px-4 py-2 rounded-xl border border-slate-200 text-slate-500 text-[12px] font-medium hover:bg-slate-50 transition-all"
                                                    >
                                                        Cancelar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={!canEdit || !reqFormNote.trim() || isCreatingReq}
                                                        onClick={async () => {
                                                            const eid = activeEmployee?.id || user?.id;
                                                            setIsCreatingReq(true);
                                                            const result = await createRequest(eid, reqFormType, reqPayload, reqFormNote.trim());
                                                            setIsCreatingReq(false);
                                                            if (result) {
                                                                useToastStore.getState().showToast('Enviada', `Solicitud de ${REQUEST_TYPES[reqFormType]?.label} registrada.`, 'success');
                                                                setReqFormNote('');
                                                                setReqPayload({});
                                                                setShowReqForm(false);
                                                                loadEmpRequests();
                                                            } else {
                                                                useToastStore.getState().showToast('Error', 'No se pudo crear la solicitud.', 'error');
                                                            }
                                                        }}
                                                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#007AFF] hover:bg-[#0066DD] text-white text-[12px] font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                                                    >
                                                        {isCreatingReq ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.5} />}
                                                        Enviar
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Lista */}
                                        {isLoadingEmpReqs ? (
                                            <div className="flex justify-center py-10 text-slate-400 gap-2">
                                                <Loader2 size={18} className="animate-spin" />
                                                <span className="text-[12px]">Cargando…</span>
                                            </div>
                                        ) : empRequests.length === 0 ? (
                                            <div className="flex flex-col items-center py-12 gap-2 text-slate-400">
                                                <ClipboardList size={36} strokeWidth={1.2} />
                                                <p className="text-[13px] font-semibold">Sin solicitudes registradas</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {empRequests.map(req => {
                                                    const typeConf = REQUEST_TYPES[req.type]  || { label: req.type,   color: 'bg-slate-100 text-slate-600', border: 'border-slate-200' };
                                                    const statConf = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
                                                    const TypeIcon = { VACATION: Palmtree, PERMIT: FileText, SHIFT_CHANGE: RefreshCw, OVERTIME: Coffee, ADVANCE: DollarSign, CERTIFICATE: FileCheck }[req.type] || FileText;
                                                    return (
                                                        <div key={req.id} className={`flex items-start gap-4 p-4 rounded-[1.5rem] border bg-white/60 backdrop-blur-md ${typeConf.border}`}>
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
                                                                {req.note && <p className="text-[12px] text-slate-600 line-clamp-2">{req.note}</p>}
                                                                {req.approver_note && <p className="text-[11px] text-slate-400 mt-1 italic">Nota: {req.approver_note}</p>}
                                                                <p className="text-[10px] text-slate-400 mt-1">{new Date(req.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                                            </div>
                                                            {req.status === 'PENDING' && (
                                                                <button
                                                                    onClick={async () => {
                                                                        await cancelRequest(req.id);
                                                                        loadEmpRequests();
                                                                    }}
                                                                    className="flex-shrink-0 p-2 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                                                                    title="Cancelar solicitud"
                                                                >
                                                                    <X size={14} strokeWidth={2} />
                                                                </button>
                                                            )}
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

                    {showExceptionModal && (
                        <ShiftExceptionModal
                            employee={emp}
                            onClose={() => setShowExceptionModal(false)}
                        />
                    )}

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

        {cancelModalRender && createPortal(
            <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                <div
                    className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${showCancelModal ? 'opacity-100' : 'opacity-0'}`}
                    onClick={!isCancelling ? () => { setShowCancelModal(false); setCancelReason(''); setCancelingEventId(null); } : undefined}
                />
                <div className={`relative w-full max-w-sm bg-white/95 backdrop-blur-2xl border border-white/80 rounded-[2rem] overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.2)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ${showCancelModal ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'}`}>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 blur-[50px] rounded-full pointer-events-none w-40 h-40 opacity-20 bg-red-500"></div>
                    <div className="p-6 sm:p-8 flex flex-col items-center relative z-10">
                        <div className="w-14 h-14 rounded-[1.2rem] flex items-center justify-center mb-5 border bg-white/60 border-white/80 shadow-sm text-red-500">
                            {isCancelling ? <Loader2 size={28} strokeWidth={2.5} className="animate-spin"/> : <AlertTriangle size={28} strokeWidth={2.5}/>}
                        </div>
                        <h3 className="text-[18px] font-black uppercase tracking-tight mb-2 text-slate-800 text-center">
                            {isCancelling ? 'Procesando...' : 'Cancelar Acción de RRHH'}
                        </h3>
                        <p className={`text-[13px] font-medium text-slate-500 text-center mb-5 transition-opacity duration-300 ${isCancelling ? 'opacity-60' : 'opacity-100'}`}>
                            {isCancelling ? 'Por favor, no cierres esta ventana.' : 'Esta acción quedará registrada como cancelada. No se puede deshacer.'}
                        </p>
                        {!isCancelling && (
                            <>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 self-start">Motivo de cancelación *</label>
                                <textarea
                                    value={cancelReason}
                                    onChange={e => setCancelReason(e.target.value)}
                                    placeholder="Explica el motivo de la cancelación..."
                                    rows={3}
                                    className="w-full bg-white/60 border border-white/80 rounded-2xl p-3 text-[13px] text-slate-700 outline-none focus:ring-2 focus:ring-red-200 resize-none"
                                />
                            </>
                        )}
                    </div>
                    <div className="p-4 sm:p-5 backdrop-blur-md border-t bg-slate-50/50 border-slate-100 flex gap-3 relative z-10">
                        <button
                            onClick={() => { setShowCancelModal(false); setCancelReason(''); setCancelingEventId(null); }}
                            disabled={isCancelling}
                            className={`py-3 px-4 rounded-xl font-black text-[11px] uppercase tracking-widest border flex-1 transition-all ${isCancelling ? 'hidden' : 'text-slate-600 bg-white border-slate-200 hover:bg-slate-50 hover:-translate-y-0.5 shadow-sm'}`}>
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
                            className="py-3 px-4 rounded-xl font-black text-[11px] uppercase tracking-widest text-white flex-1 transition-all shadow-sm border-transparent bg-red-500 hover:bg-red-600 hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0">
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