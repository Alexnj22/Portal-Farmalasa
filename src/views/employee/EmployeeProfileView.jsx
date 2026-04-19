import React, { useState, useEffect, useMemo } from 'react';
import {
    User, Phone, HeartPulse, Briefcase, KeyRound,
    Clock, Edit3, Calendar, ArrowRightLeft, Sparkles, Palmtree,
    MapPin, CreditCard, Coffee, Zap, Award, TrendingUp, SlidersHorizontal, ChevronDown, ChevronUp, X, Search, Stethoscope, FileText
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { EVENT_TYPES } from '../../data/constants';
import GlassViewLayout from '../../components/GlassViewLayout';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import { formatTime12h } from '../../utils/helpers';

const formatDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

const EVENT_THEMES = {
    VACATION:    { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', dot: 'border-emerald-500',  glow: 'hover:shadow-[0_8px_24px_rgba(16,185,129,0.12)]' },
    PERMIT:      { bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200',   dot: 'border-amber-500',    glow: 'hover:shadow-[0_8px_24px_rgba(245,158,11,0.12)]'  },
    DISABILITY:  { bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200',     dot: 'border-red-500',      glow: 'hover:shadow-[0_8px_24px_rgba(239,68,68,0.12)]'   },
    SHIFT_CHANGE:{ bg: 'bg-cyan-50',     text: 'text-cyan-700',    border: 'border-cyan-200',    dot: 'border-cyan-500',     glow: 'hover:shadow-[0_8px_24px_rgba(6,182,212,0.12)]'   },
    SALARY:      { bg: 'bg-indigo-50',   text: 'text-indigo-700',  border: 'border-indigo-200',  dot: 'border-indigo-500',   glow: 'hover:shadow-[0_8px_24px_rgba(99,102,241,0.12)]'  },
    TRANSFER:    { bg: 'bg-blue-50',     text: 'text-blue-700',    border: 'border-blue-200',    dot: 'border-blue-500',     glow: 'hover:shadow-[0_8px_24px_rgba(59,130,246,0.12)]'  },
    HIRING:      { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', dot: 'border-emerald-500',  glow: 'hover:shadow-[0_8px_24px_rgba(16,185,129,0.12)]' },
};
const DEFAULT_THEME = { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'border-[#007AFF]', glow: 'hover:shadow-[0_8px_24px_rgba(0,122,255,0.10)]' };

const WEEK_DAYS = [
    { id: 1, short: 'Lu' }, { id: 2, short: 'Ma' }, { id: 3, short: 'Mi' },
    { id: 4, short: 'Ju' }, { id: 5, short: 'Vi' }, { id: 6, short: 'Sá' },
    { id: 0, short: 'Do' },
];

const SectionCard = ({ children, className = '' }) => (
    <div className={`bg-white/60 backdrop-blur-2xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.07)] hover:-translate-y-0.5 transition-all duration-300 ${className}`}>
        {children}
    </div>
);

const SectionLabel = ({ icon: Icon, label, color = 'text-slate-400' }) => (
    <p className={`text-[10px] font-black uppercase tracking-widest ${color} flex items-center gap-1.5 mb-3`}>
        <Icon size={10} /> {label}
    </p>
);

const Field = ({ label, value, icon: Icon }) => (
    <div className="p-3.5 rounded-2xl bg-white/60 backdrop-blur-sm border border-white/80 hover:bg-white/85 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-all duration-200 cursor-default">
        <div className="flex items-center gap-1.5 mb-0.5">
            {Icon && <Icon size={9} className="text-slate-400 flex-shrink-0" />}
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em]">{label}</p>
        </div>
        <p className="text-[13px] font-bold text-slate-700 truncate">{value || 'No registrado'}</p>
    </div>
);

const EmployeeProfileView = ({ openModal }) => {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const branches  = useStaffStore(s => s.branches);
    const shifts    = useStaffStore(s => s.shifts);

    const emp    = employees.find(e => String(e.id) === String(user?.id)) || user;
    const branch = branches.find(b => String(b.id) === String(emp?.branchId || emp?.branch_id));

    const [events, setEvents]           = useState([]);
    const [evLoading, setEvLoading]     = useState(true);
    const [activeCount, setActiveCount] = useState(0);
    const [myVacPlans, setMyVacPlans]   = useState([]);
    const [timelineLimit, setTimelineLimit]           = useState(8);
    const [showTimelineFilter, setShowTimelineFilter] = useState(false);
    const [filterFrom, setFilterFrom]                 = useState('');
    const [filterTo, setFilterTo]                     = useState('');
    const [filterType, setFilterType]                 = useState('');
    const [searchQuery, setSearchQuery]               = useState('');
    const [searchOpen, setSearchOpen]                 = useState(false);

    useEffect(() => {
        if (!user?.id) return;
        const load = async () => {
            setEvLoading(true);
            const [{ data: evData }, { count }] = await Promise.all([
                supabase.from('employee_events').select('id, type, date, note, metadata').eq('employee_id', user.id).order('date', { ascending: false }),
                supabase.from('approval_requests').select('id', { count: 'exact', head: true }).eq('employee_id', user.id).eq('status', 'PENDING'),
            ]);
            setEvents(evData || []);
            setActiveCount(count || 0);
            setEvLoading(false);
        };
        load();
    }, [user?.id]);

    useEffect(() => {
        if (!user?.id) return;
        supabase.from('vacation_plans').select('id, year, start_date, end_date, days, status').eq('employee_id', user.id).neq('status', 'CANCELLED').order('start_date', { ascending: false }).then(({ data }) => setMyVacPlans(data || []));
    }, [user?.id]);


    const tenure = useMemo(() => {
        const hd = emp?.hire_date || emp?.hireDate;
        if (!hd) return '—';
        const h = new Date(hd + 'T12:00:00'), now = new Date();
        let y = now.getFullYear() - h.getFullYear();
        let m = now.getMonth() - h.getMonth();
        if (m < 0) { y--; m += 12; }
        if (y === 0 && m === 0) return 'Nuevo';
        return `${y > 0 ? `${y} año${y > 1 ? 's' : ''} ` : ''}${m > 0 ? `${m} mes${m > 1 ? 'es' : ''}` : ''}`.trim();
    }, [emp?.hire_date, emp?.hireDate]);

    const timeline = useMemo(() => {
        const hd = emp?.hire_date || emp?.hireDate;
        const synthetic = hd ? [{ id: 'hiring-event', type: 'HIRING', date: hd, isSystem: true, note: `Inicio de labores. Sucursal: ${branch?.name || 'N/A'}`, metadata: {} }] : [];
        return [...events, ...synthetic].sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [events, emp?.hire_date, emp?.hireDate, branch]);

    const weeklySchedule = useMemo(() => {
        if (!emp?.weeklySchedule) return [];
        const now = new Date(); now.setHours(0,0,0,0);
        const day = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
        return WEEK_DAYS.map(d => {
            const raw = emp.weeklySchedule[d.id] ?? emp.weeklySchedule[String(d.id)];
            const shiftId = typeof raw === 'object' ? raw?.shiftId : raw;
            const shift = shiftId && shiftId !== 'LIBRE' ? shifts.find(s => String(s.id) === String(shiftId)) : null;
            const offset = d.id === 0 ? 6 : d.id - 1;
            const date = new Date(monday);
            date.setDate(monday.getDate() + offset);
            return { ...d, shift, date };
        });
    }, [emp?.weeklySchedule, shifts]);

    const availableTypes = useMemo(() =>
        [...new Set(timeline.map(ev => ev.type))].filter(Boolean)
    , [timeline]);

    // Devuelve el evento (VACATION/DISABILITY/PERMIT) activo en una fecha dada
    const getEventForDate = useMemo(() => (dateStr) => {
        return events.find(ev => {
            if (!['VACATION', 'DISABILITY', 'PERMIT'].includes(ev.type)) return false;
            const meta = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
            const s = meta.startDate || ev.date;
            const e = meta.endDate   || ev.date;
            return dateStr >= s && dateStr <= e;
        }) || null;
    }, [events]);

    const visibleTimeline = useMemo(() => {
        let list = timeline;
        if (filterFrom) list = list.filter(ev => ev.date >= filterFrom);
        if (filterTo)   list = list.filter(ev => ev.date <= filterTo);
        if (filterType) list = list.filter(ev => ev.type === filterType);
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            list = list.filter(ev =>
                (ev.note || '').toLowerCase().includes(q) ||
                (EVENT_TYPES[ev.type]?.label || ev.type || '').toLowerCase().includes(q)
            );
        }
        const hasFilter = filterFrom || filterTo || filterType || searchQuery.trim();
        if (!hasFilter && timelineLimit !== null) list = list.slice(0, timelineLimit);
        return list;
    }, [timeline, filterFrom, filterTo, filterType, searchQuery, timelineLimit]);

    const nextVacation = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return myVacPlans.find(vp => vp.end_date >= today && (vp.status === 'PLANNED' || vp.status === 'CONFIRMED')) || null;
    }, [myVacPlans]);

    const birthdayCountdown = useMemo(() => {
        if (!emp?.birth_date) return null;
        const today = new Date(); today.setHours(0,0,0,0);
        const bd = new Date(emp.birth_date + 'T12:00:00');
        let next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
        if (next < today) next.setFullYear(today.getFullYear() + 1);
        const diff = Math.round((next - today) / (1000 * 60 * 60 * 24));
        if (diff === 0) return '¡Hoy! 🎉';
        if (diff === 1) return 'Mañana';
        if (diff <= 30) return `en ${diff} días`;
        return null;
    }, [emp?.birth_date]);

    if (!emp) return (
        <GlassViewLayout icon={User} title="Mi Perfil">
            <div className="pt-4 md:pt-6 px-4 md:px-6 pb-10 flex flex-col lg:flex-row gap-5 items-start animate-in fade-in duration-300">
                <div className="w-full lg:w-[400px] shrink-0 space-y-4">
                    <div className="animate-pulse bg-slate-200/80 rounded-[2.5rem] h-80" />
                    <div className="grid grid-cols-2 gap-3">
                        <div className="animate-pulse bg-slate-200/80 rounded-2xl h-11" />
                        <div className="animate-pulse bg-slate-200/80 rounded-2xl h-11" />
                    </div>
                    <div className="animate-pulse bg-slate-200/80 rounded-[2rem] h-44" />
                </div>
                <div className="flex-1 min-w-0 space-y-4">
                    <div className="animate-pulse bg-slate-200/80 rounded-[2rem] h-24" />
                    <div className="animate-pulse bg-slate-200/80 rounded-[2rem] h-32" />
                    <div className="animate-pulse bg-slate-200/80 rounded-[2rem] h-72" />
                </div>
            </div>
        </GlassViewLayout>
    );

    const VAC_STATUS = {
        PLANNED:   { label: 'Planificado', bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200'    },
        CONFIRMED: { label: 'Confirmado',  bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
        TAKEN:     { label: 'Completado',  bg: 'bg-slate-100',  text: 'text-slate-500',   border: 'border-slate-200'   },
    };

    const headerLeft = (
        <div className="flex items-center gap-3.5">
            <div className="relative shrink-0">
                <div className="w-10 h-10 md:w-11 md:h-11 rounded-full overflow-hidden border-2 border-white/60 shadow-md">
                    {emp.photo || emp.photo_url
                        ? <img src={emp.photo || emp.photo_url} className="w-full h-full object-cover" alt="" />
                        : <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white">
                            <User size={18} strokeWidth={1.8} />
                          </div>
                    }
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full border-2 border-white shadow-sm" />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mi Perfil</p>
                <h2 className="font-black text-[20px] md:text-[24px] text-slate-900 tracking-tight leading-tight truncate">{emp.name}</h2>
                <p className="text-[10px] font-bold text-slate-400 truncate">
                    {emp.role || 'Empleado'}{branch ? ` · ${branch.name}` : ''}
                </p>
            </div>
        </div>
    );

    const filtersContent = (
        <div className="flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 gap-2">
            {/* Info chips */}
            {emp.phone && (
                <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-white/50 border border-white/70 rounded-2xl">
                    <Phone size={11} className="text-slate-400 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">{emp.phone}</span>
                </div>
            )}
            {emp.dui && (
                <div className="hidden lg:flex items-center gap-2 px-3 py-2 bg-white/50 border border-white/70 rounded-2xl">
                    <CreditCard size={11} className="text-slate-400 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">{emp.dui}</span>
                </div>
            )}
            {(emp.phone || emp.dui) && <div className="hidden md:block w-px h-6 bg-slate-200/60 mx-0.5 shrink-0" />}
            {/* Edit button */}
            <button
                onClick={() => openModal('editContact', emp)}
                className="flex items-center gap-2 px-3 md:px-4 h-10 rounded-full bg-[#007AFF] text-white text-[11px] font-black uppercase tracking-widest shadow-[0_3px_8px_rgba(0,122,255,0.4)] hover:bg-[#0066DD] hover:-translate-y-0.5 transition-all duration-200 active:scale-95 whitespace-nowrap"
            >
                <Edit3 size={13} strokeWidth={2.5} />
                <span className="hidden sm:inline">Editar</span>
            </button>
            {/* Password button */}
            <button
                onClick={() => openModal('changeOwnPassword', {})}
                className="w-10 h-10 rounded-full bg-amber-50/80 backdrop-blur-sm border border-amber-200/80 text-amber-600 flex items-center justify-center hover:bg-amber-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 active:scale-95 shrink-0"
                title="Cambiar contraseña"
            >
                <KeyRound size={15} strokeWidth={2} />
            </button>
        </div>
    );

    return (
        <GlassViewLayout headerLeft={headerLeft} filtersContent={filtersContent}>
            <div className="pt-4 md:pt-6 px-4 md:px-6 pb-10 flex flex-col lg:flex-row gap-5 items-start">

                {/* ── COLUMNA IZQUIERDA — todas las cards informativas ── */}
                <div className="w-full lg:w-[400px] shrink-0 space-y-4">

                    {/* Stats 2-col */}
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Antigüedad',  value: tenure,           icon: Award, color: 'text-blue-600',  bg: 'bg-blue-50/80'  },
                            { label: 'Pendientes',  value: activeCount ?? 0, icon: Zap,   color: 'text-amber-600', bg: 'bg-amber-50/80' },
                        ].map(({ label, value, icon: Icon, color, bg }) => (
                            <div key={label} className={`${bg} backdrop-blur-sm border border-white/80 rounded-2xl p-4 flex flex-col items-center text-center hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all duration-200 cursor-default`}>
                                <Icon size={16} className={`${color} mb-1.5`} strokeWidth={2} />
                                <p className="text-[15px] font-black text-slate-700 leading-tight">{value}</p>
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Quick info 2×2 */}
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Fecha de Ingreso',    value: emp.hire_date  ? formatDate(emp.hire_date)  : '—', icon: Calendar,  color: 'text-blue-600',   bg: 'bg-blue-50/80'   },
                            { label: 'Fecha de Nacimiento', value: emp.birth_date ? formatDate(emp.birth_date) : '—', icon: Sparkles,  color: 'text-pink-500',   bg: 'bg-pink-50/80',  extra: birthdayCountdown },
                            { label: 'Tipo de Contrato',    value: emp.contract_type || '—',                           icon: Briefcase, color: 'text-indigo-600', bg: 'bg-indigo-50/80' },
                            { label: 'Horas Semanales',     value: emp.weekly_hours ? `${emp.weekly_hours}h` : '—',   icon: Clock,     color: 'text-amber-600',  bg: 'bg-amber-50/80'  },
                        ].map(({ label, value, icon: Icon, color, bg, extra }) => (
                            <div key={label} className={`${bg} backdrop-blur-sm border border-white/80 rounded-2xl p-4 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all duration-200 cursor-default`}>
                                <Icon size={14} className={`${color} mb-2`} strokeWidth={2} />
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
                                <p className="text-[13px] font-black text-slate-700 leading-tight">{value}</p>
                                {extra && <p className="text-[10px] font-bold text-pink-500 mt-0.5">{extra}</p>}
                            </div>
                        ))}
                    </div>

                    {/* Próximas vacaciones */}
                    {nextVacation && (
                        <div className="flex items-center gap-2.5 bg-emerald-50/80 border border-emerald-200/70 rounded-2xl px-4 py-3">
                            <Palmtree size={14} className="text-emerald-600 shrink-0" strokeWidth={1.8} />
                            <div className="min-w-0">
                                <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Próximas vacaciones</p>
                                <p className="text-[12px] font-black text-emerald-800 truncate">
                                    {new Date(nextVacation.start_date + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    {nextVacation.status === 'CONFIRMED' && <span className="ml-1.5 text-emerald-500 font-bold">· Confirmadas</span>}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Contacto & Documentos */}
                    <SectionCard>
                        <SectionLabel icon={Phone} label="Contacto & Documentos" />
                        <div className="space-y-2">
                            <Field label="Celular"         value={emp.phone}  icon={Phone} />
                            <Field label="Documento (DUI)" value={emp.dui}    icon={CreditCard} />
                            <Field label="Sucursal"        value={branch?.name} icon={MapPin} />
                        </div>
                    </SectionCard>

                    {/* Emergencia */}
                    {(emp.emergency_contact_name || emp.emergency_contact_phone || emp.blood_type) && (
                        <div className="bg-red-50/70 backdrop-blur-2xl border border-red-100/70 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(239,68,68,0.05)] hover:shadow-[0_8px_32px_rgba(239,68,68,0.10)] hover:-translate-y-0.5 transition-all duration-300">
                            <SectionLabel icon={HeartPulse} label="Contacto de Emergencia" color="text-red-500" />
                            <div className="space-y-2">
                                <Field label="Avisar a"            value={emp.emergency_contact_name}  icon={User} />
                                <Field label="Teléfono emergencia" value={emp.emergency_contact_phone} icon={Phone} />
                                {emp.blood_type && <Field label="Tipo de sangre" value={emp.blood_type} icon={HeartPulse} />}
                            </div>
                        </div>
                    )}

                    {/* Plan de vacaciones */}
                    {myVacPlans.length > 0 && (
                        <SectionCard>
                            <SectionLabel icon={Palmtree} label="Plan de Vacaciones" color="text-emerald-500" />
                            <div className="space-y-2">
                                {myVacPlans.map(vp => {
                                    const s = VAC_STATUS[vp.status] || VAC_STATUS.PLANNED;
                                    const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
                                    const isUpcoming = vp.end_date >= new Date().toISOString().split('T')[0];
                                    return (
                                        <div key={vp.id} className={`flex items-center gap-3 p-3 border rounded-2xl hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-all duration-200 ${isUpcoming ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white/60 border-white/80'}`}>
                                            <div className={`p-2 rounded-xl flex-shrink-0 ${isUpcoming ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                                                <Palmtree size={13} className={isUpcoming ? 'text-emerald-600' : 'text-slate-400'} strokeWidth={1.8} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[12px] font-black text-slate-700 truncate">{fmt(vp.start_date)} → {fmt(vp.end_date)}</p>
                                                <p className="text-[10px] text-slate-400 font-medium">{vp.days} días · {vp.year}</p>
                                            </div>
                                            <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-md border flex-shrink-0 ${s.bg} ${s.text} ${s.border}`}>{s.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </SectionCard>
                    )}
                </div>

                {/* ── COLUMNA DERECHA — horario e historial ── */}
                <div className="flex-1 min-w-0 space-y-4">

                    {/* Horario habitual */}
                    {weeklySchedule.length > 0 && (
                        <SectionCard>
                            <SectionLabel icon={Clock} label="Mi Horario Habitual" color="text-slate-400" />
                            <div className="grid grid-cols-7 gap-1.5">
                                {weeklySchedule.map(d => {
                                    const todayStr = new Date().toDateString();
                                    const isToday  = d.date?.toDateString() === todayStr;
                                    const dateStr  = d.date?.toISOString().split('T')[0];
                                    const ev       = dateStr ? getEventForDate(dateStr) : null;
                                    const evCfg    = ev ? {
                                        VACATION:   { label: 'Vac', Icon: Palmtree,    bg: 'bg-emerald-500', light: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
                                        DISABILITY: { label: 'Incapacidad', Icon: Stethoscope, bg: 'bg-red-500',     light: 'bg-red-50 border-red-200',         text: 'text-red-700'     },
                                        PERMIT:     { label: 'Per', Icon: FileText,    bg: 'bg-amber-500',   light: 'bg-amber-50 border-amber-200',     text: 'text-amber-700'   },
                                    }[ev.type] : null;
                                    return (
                                        <div key={d.id} className={`flex flex-col items-center rounded-2xl p-2 transition-all duration-200 ${
                                            isToday   ? 'bg-slate-800 shadow-md'
                                            : evCfg   ? `${evCfg.light} border`
                                            : d.shift ? 'bg-white/70 border border-white/80'
                                                      : 'bg-slate-50/80 border border-slate-100'
                                        }`}>
                                            <p className={`text-[8px] font-black uppercase tracking-widest ${isToday ? 'text-white/50' : evCfg ? evCfg.text : 'text-slate-400'}`}>{d.short}</p>
                                            <p className={`text-[15px] font-black leading-none mb-1 ${isToday ? 'text-white' : evCfg ? evCfg.text : 'text-slate-600'}`}>{d.date?.getDate()}</p>
                                            {evCfg ? (
                                                <>
                                                    <evCfg.Icon size={10} className={evCfg.text} strokeWidth={2} />
                                                    <p className={`text-[8px] font-black mt-1 text-center leading-tight ${evCfg.text}`}>{evCfg.label}</p>
                                                </>
                                            ) : d.shift ? (
                                                <>
                                                    <Coffee size={10} className={isToday ? 'text-orange-300' : 'text-orange-400'} strokeWidth={2} />
                                                    <p className={`text-[9px] font-black mt-1 text-center leading-tight ${isToday ? 'text-white' : 'text-slate-700'}`}>
                                                        {formatTime12h(d.shift.start).replace(' AM','a').replace(' PM','p').replace(' am','a').replace(' pm','p')}
                                                    </p>
                                                    <p className={`text-[8px] font-medium text-center leading-tight ${isToday ? 'text-white/50' : 'text-slate-400'}`}>
                                                        {formatTime12h(d.shift.end).replace(' AM','a').replace(' PM','p').replace(' am','a').replace(' pm','p')}
                                                    </p>
                                                </>
                                            ) : (
                                                <p className="text-[8px] font-bold text-slate-300 mt-1">Libre</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </SectionCard>
                    )}

                    {/* Historial de eventos */}
                    <SectionCard>
                        <div className="flex items-center justify-between mb-3">
                            <SectionLabel icon={Clock} label="Historial de Eventos" />
                            <div className="flex items-center gap-2 -mt-3">
                                <span className="text-[10px] font-black text-slate-500 bg-slate-100/80 border border-slate-200/60 px-2.5 py-1 rounded-full">
                                    {visibleTimeline.length}/{timeline.length}
                                </span>
                                {/* Buscador expandible */}
                                <div className={`flex items-center gap-1.5 rounded-full border transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden ${searchOpen ? 'bg-white border-slate-200 px-2.5 py-1 w-40' : 'bg-white/60 border-slate-200/60 w-7 h-7 justify-center'}`}>
                                    <button
                                        type="button"
                                        onClick={() => { setSearchOpen(v => !v); if (searchOpen) setSearchQuery(''); }}
                                        className="flex-shrink-0 text-slate-500 hover:text-slate-700 transition-colors"
                                    >
                                        {searchOpen
                                            ? <X size={10} strokeWidth={2.5} />
                                            : <Search size={11} strokeWidth={2.5} />
                                        }
                                    </button>
                                    {searchOpen && (
                                        <input
                                            autoFocus
                                            type="text"
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            placeholder="Buscar…"
                                            className="flex-1 min-w-0 text-[10px] font-medium text-slate-700 placeholder-slate-300 outline-none bg-transparent"
                                        />
                                    )}
                                </div>
                                <button
                                    onClick={() => setShowTimelineFilter(v => !v)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-200 hover:-translate-y-0.5 active:scale-95 ${showTimelineFilter ? 'bg-slate-800 text-white border-slate-800' : 'bg-white/60 text-slate-500 border-slate-200/60 hover:border-slate-300'}`}
                                >
                                    <SlidersHorizontal size={10} strokeWidth={2.5} />
                                    Filtrar
                                    {showTimelineFilter ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                </button>
                            </div>
                        </div>

                        {/* Filter panel */}
                        {showTimelineFilter && (
                            <div className="mb-4 p-3 bg-slate-50/80 rounded-2xl border border-slate-100 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                                {/* Date range */}
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                                        <LiquidDatePicker value={filterFrom} onChange={setFilterFrom} />
                                    </div>
                                    <span className="text-slate-300 text-[12px] font-bold shrink-0">→</span>
                                    <div className="flex-1 bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                                        <LiquidDatePicker value={filterTo} onChange={setFilterTo} />
                                    </div>
                                    {(filterFrom || filterTo || filterType) && (
                                        <button
                                            onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterType(''); setTimelineLimit(8); }}
                                            className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 flex items-center justify-center shrink-0 transition-all active:scale-95"
                                            title="Limpiar filtros"
                                        >
                                            <X size={13} strokeWidth={2.5} />
                                        </button>
                                    )}
                                </div>
                                {/* Type pills */}
                                {availableTypes.length > 1 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        <button
                                            onClick={() => setFilterType('')}
                                            className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all active:scale-95 ${!filterType ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                                        >
                                            Todos
                                        </button>
                                        {availableTypes.map(type => {
                                            const label = type === 'HIRING' ? 'Contratación' : (EVENT_TYPES[type]?.label || type);
                                            const theme = EVENT_THEMES[type];
                                            return (
                                                <button
                                                    key={type}
                                                    onClick={() => setFilterType(filterType === type ? '' : type)}
                                                    className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all active:scale-95 ${filterType === type ? `${theme?.bg || 'bg-slate-100'} ${theme?.text || 'text-slate-700'} ${theme?.border || 'border-slate-300'}` : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {evLoading ? (
                            <div className="space-y-3 animate-in fade-in duration-300">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="flex gap-3 pl-7 relative">
                                        <div className="absolute -left-[10px] top-2 w-4 h-4 rounded-full animate-pulse bg-slate-300/60" />
                                        <div className="flex-1 animate-pulse bg-slate-200/80 rounded-2xl h-16" />
                                    </div>
                                ))}
                            </div>
                        ) : timeline.length === 0 ? (
                            <div className="flex flex-col items-center py-12 gap-3 text-slate-400">
                                <Clock size={36} strokeWidth={1} />
                                <p className="text-[13px] font-bold text-slate-500">Sin eventos registrados</p>
                            </div>
                        ) : (
                            <>
                            <div className="relative border-l-[2px] border-slate-200/70 ml-3 space-y-3 pb-2">
                                {visibleTimeline.map((ev, idx) => {
                                    const theme = EVENT_THEMES[ev.type] || DEFAULT_THEME;
                                    const label = ev.type === 'HIRING' ? 'Contratación Inicial' : (EVENT_TYPES[ev.type]?.label || ev.type);
                                    const meta        = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                                    const isCancelled = meta.status === 'CANCELLED';
                                    const isEdited    = meta.status === 'SUPERSEDED';
                                    return (
                                        <div key={ev.id || `ev-${idx}`} className="relative pl-7 group/ev">
                                            <div className={`absolute -left-[9px] top-2.5 w-[14px] h-[14px] rounded-full bg-white border-2 shadow-sm group-hover/ev:scale-125 transition-transform duration-300 z-10 ${theme.dot}`} />
                                            <div className={`bg-white/60 backdrop-blur-xl rounded-2xl p-4 border border-white/80 transition-all duration-300 shadow-sm hover:-translate-y-0.5 ${theme.glow} ${isCancelled || isEdited ? 'opacity-50' : ''}`}>
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${theme.bg} ${theme.text} ${theme.border}`}>{label}</span>
                                                    <span className="text-[10px] font-bold text-slate-400">{formatDate(ev.date)}</span>
                                                </div>
                                                <p className="text-[12px] text-slate-600 leading-relaxed font-medium">{ev.note || 'Evento registrado.'}</p>
                                                {meta.endDate && (
                                                    <p className="text-[11px] text-slate-400 font-medium mt-1.5 flex items-center gap-1">
                                                        <Calendar size={10} /> Hasta: {formatDate(meta.endDate)}
                                                    </p>
                                                )}
                                                {meta.permissionDates?.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {meta.permissionDates.map((d, i) => (
                                                            <span key={i} className="px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded-lg text-[10px] font-black">{formatDate(d)}</span>
                                                        ))}
                                                    </div>
                                                )}
                                                {meta.old_value && meta.new_value && (
                                                    <p className="text-[11px] font-medium text-slate-500 mt-2 bg-white/70 p-2 rounded-lg border border-slate-100/80 flex gap-2 items-center">
                                                        <span className="font-bold line-through opacity-70">{meta.old_value}</span>
                                                        <ArrowRightLeft size={10} />
                                                        <span className="font-bold text-[#007AFF]">{meta.new_value}</span>
                                                    </p>
                                                )}
                                                {(isCancelled || isEdited) && (
                                                    <span className={`mt-2 inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${isCancelled ? 'bg-red-100 text-red-500' : 'bg-slate-200 text-slate-500'}`}>
                                                        {isCancelled ? 'Cancelado' : 'Editado'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Ver todo / Mostrar menos — solo cuando no hay filtros activos */}
                            {!filterFrom && !filterTo && !filterType && (
                                timelineLimit !== null && timeline.length > timelineLimit ? (
                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                        <button
                                            onClick={() => setTimelineLimit(null)}
                                            className="w-full py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-100 hover:-translate-y-0.5 transition-all active:scale-95"
                                        >
                                            Ver todo ({timeline.length})
                                        </button>
                                    </div>
                                ) : timelineLimit === null ? (
                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                        <button
                                            onClick={() => { setTimelineLimit(8); setShowTimelineFilter(false); }}
                                            className="w-full py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-100 hover:-translate-y-0.5 transition-all active:scale-95"
                                        >
                                            Mostrar menos
                                        </button>
                                    </div>
                                ) : null
                            )}
                            </>
                        )}
                    </SectionCard>
                </div>
            </div>
        </GlassViewLayout>
    );
};

export default EmployeeProfileView;
