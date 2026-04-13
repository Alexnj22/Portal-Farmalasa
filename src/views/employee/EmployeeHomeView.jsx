import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CalendarDays, ClipboardList, Bell, Plus, ChevronLeft, ChevronRight,
    Coffee, Loader2, Palmtree, Sparkles, Clock, Timer, Flame, Sun, Moon, Home
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { formatTime12h } from '../../utils/helpers';

const DAYS = [
    { id: 1, name: 'Lunes',     short: 'LUN' },
    { id: 2, name: 'Martes',    short: 'MAR' },
    { id: 3, name: 'Miércoles', short: 'MIE' },
    { id: 4, name: 'Jueves',    short: 'JUE' },
    { id: 5, name: 'Viernes',   short: 'VIE' },
    { id: 6, name: 'Sábado',    short: 'SAB' },
    { id: 0, name: 'Domingo',   short: 'DOM' },
];

const EVENT_BADGES = {
    VACATION:   { label: 'Vacaciones',  badge: 'EN VACACIONES', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    DISABILITY: { label: 'Incapacidad', badge: 'INCAPACITADO',  color: 'bg-red-100 text-red-700 border-red-200' },
    PERMIT:     { label: 'Permiso',     badge: 'CON PERMISO',   color: 'bg-purple-100 text-purple-700 border-purple-200' },
    BIRTHDAY:   { label: 'Cumpleaños',  badge: 'CUMPLEAÑOS',    color: 'bg-pink-100 text-pink-700 border-pink-200' },
};

const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    d.setHours(0, 0, 0, 0);
    return d;
};

const toISO = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('T')[0];
};

const calcShiftHours = (shift) => {
    if (!shift) return 0;
    const [sh, sm] = shift.start.split(':').map(Number);
    const [eh, em] = shift.end.split(':').map(Number);
    let s = sh * 60 + sm, e = eh * 60 + em;
    if (e <= s) e += 24 * 60;
    return (e - s) / 60;
};

const EmployeeHomeView = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const shifts        = useStaffStore(s => s.shifts);
    const employees     = useStaffStore(s => s.employees);
    const announcements = useStaffStore(s => s.announcements);
    const branches      = useStaffStore(s => s.branches);

    const [currentTime, setCurrentTime]       = useState(new Date());
    const [pendingCount, setPendingCount]     = useState(null);
    const [tardanzas, setTardanzas]           = useState(null);
    const [activeEvent, setActiveEvent]       = useState(undefined); // undefined=loading, null=none
    const [upcomingEvents, setUpcomingEvents] = useState([]);
    const [weekOffset, setWeekOffset]         = useState(0);
    const [scheduleData, setScheduleData]     = useState(null);
    const [weekEvents, setWeekEvents]         = useState([]);
    const [myVacationPlans, setMyVacationPlans] = useState([]);
    const [isLoadingWeek, setIsLoadingWeek]   = useState(false);

    const emp    = employees.find(e => String(e.id) === String(user?.id));
    const branch = branches.find(b => String(b.id) === String(emp?.branchId));

    // Reloj
    useEffect(() => {
        const t = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(t);
    }, []);

    // Solicitudes pendientes
    useEffect(() => {
        if (!user?.id) return;
        supabase.from('approval_requests')
            .select('id', { count: 'exact', head: true })
            .eq('employee_id', user.id).eq('status', 'PENDING')
            .then(({ count }) => setPendingCount(count || 0));
    }, [user?.id]);

    // Tardanzas del mes
    useEffect(() => {
        if (!user?.id) return;
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        supabase.from('attendance')
            .select('id, late_minutes')
            .eq('employee_id', user.id).eq('late', true)
            .gte('date', firstDay).lte('date', lastDay)
            .then(({ data }) => {
                const d = data || [];
                setTardanzas({ count: d.length, minutes: d.reduce((a, r) => a + (r.late_minutes || 0), 0) });
            });
    }, [user?.id]);

    // Evento activo hoy
    useEffect(() => {
        if (!user?.id) return;
        const today = new Date().toISOString().split('T')[0];
        supabase.from('employee_events')
            .select('id, type, date, metadata')
            .eq('employee_id', user.id)
            .in('type', ['VACATION', 'DISABILITY', 'PERMIT'])
            .then(({ data }) => {
                const active = (data || []).find(ev => {
                    const meta  = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                    const start = meta.startDate || ev.date;
                    const end   = meta.endDate   || ev.date;
                    return today >= start && today <= end;
                });
                setActiveEvent(active || null);
            });
    }, [user?.id]);

    // Próximos eventos
    useEffect(() => {
        if (!user?.id) return;
        const today = new Date().toISOString().split('T')[0];
        supabase.from('employee_events')
            .select('id, type, date, metadata')
            .eq('employee_id', user.id)
            .in('type', ['VACATION', 'DISABILITY', 'PERMIT', 'BIRTHDAY'])
            .gte('date', today).order('date', { ascending: true }).limit(5)
            .then(({ data }) => setUpcomingEvents(data || []));
    }, [user?.id]);

    // Mis vacaciones (plan anual)
    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from('vacation_plans')
            .select('id, year, start_date, end_date, days, status')
            .eq('employee_id', user.id)
            .neq('status', 'CANCELLED')
            .order('start_date', { ascending: true })
            .then(({ data }) => setMyVacationPlans(data || []));
    }, [user?.id]);

    // Horario semanal
    const weekStart = useMemo(() => {
        const base = getWeekStart(new Date());
        base.setDate(base.getDate() + weekOffset * 7);
        return base;
    }, [weekOffset]);

    const weekStartISO  = useMemo(() => toISO(weekStart), [weekStart]);
    const isCurrentWeek = weekOffset === 0;

    useEffect(() => {
        if (!user?.id) return;
        if (isCurrentWeek && emp?.weeklySchedule) {
            setScheduleData(emp.weeklySchedule);
            return;
        }
        setIsLoadingWeek(true);
        setScheduleData(null);
        supabase.from('employee_rosters')
            .select('schedule_data')
            .eq('employee_id', user.id).eq('week_start_date', weekStartISO)
            .maybeSingle()
            .then(({ data }) => { setScheduleData(data?.schedule_data || {}); setIsLoadingWeek(false); });
    }, [user?.id, weekStartISO, isCurrentWeek, emp?.weeklySchedule]);

    // Eventos de la semana
    useEffect(() => {
        if (!user?.id) return;
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        supabase.from('employee_events')
            .select('type, date, metadata')
            .eq('employee_id', user.id)
            .in('type', ['VACATION', 'DISABILITY', 'PERMIT'])
            .lte('date', toISO(weekEnd))
            .then(({ data }) => setWeekEvents(data || []));
    }, [user?.id, weekStartISO]);

    const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }, []);

    const days = useMemo(() => DAYS.map((d, idx) => {
        const date    = new Date(weekStart);
        date.setDate(weekStart.getDate() + idx);
        const dateISO = toISO(date);
        const isToday = date.getTime() === today.getTime();
        const rawShift = scheduleData?.[d.id] ?? scheduleData?.[String(d.id)];
        const shiftId  = typeof rawShift === 'object' ? rawShift?.shiftId : rawShift;
        const shift    = shiftId && shiftId !== 'LIBRE' ? shifts.find(s => String(s.id) === String(shiftId)) : null;
        const event    = weekEvents.find(ev => {
            const meta = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
            const s = meta.startDate || ev.date, e = meta.endDate || ev.date;
            return dateISO >= s && dateISO <= e;
        });
        const crossesMidnight = shift && (() => {
            const [sh, sm] = shift.start.split(':').map(Number);
            const [eh, em] = shift.end.split(':').map(Number);
            return (eh * 60 + em) <= (sh * 60 + sm);
        })();
        return { ...d, date, dateISO, isToday, shift, event, crossesMidnight };
    }), [weekStart, scheduleData, shifts, weekEvents, today]);

    const totalWeekHours = useMemo(() =>
        days.reduce((acc, d) => acc + (d.event ? 0 : calcShiftHours(d.shift)), 0)
    , [days]);

    // Turno de hoy
    const todayShift = useMemo(() => {
        if (!emp?.weeklySchedule) return null;
        const jsDay = new Date().getDay();
        const raw   = emp.weeklySchedule[jsDay] ?? emp.weeklySchedule[String(jsDay)];
        const sid   = typeof raw === 'object' ? raw?.shiftId : raw;
        if (!sid || sid === 'LIBRE') return null;
        return shifts.find(s => String(s.id) === String(sid)) || null;
    }, [emp, shifts]);

    // Turno de mañana
    const tomorrowShift = useMemo(() => {
        if (!emp?.weeklySchedule) return null;
        const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
        const raw = emp.weeklySchedule[tmr.getDay()] ?? emp.weeklySchedule[String(tmr.getDay())];
        const sid = typeof raw === 'object' ? raw?.shiftId : raw;
        if (!sid || sid === 'LIBRE') return null;
        return shifts.find(s => String(s.id) === String(sid)) || null;
    }, [emp, shifts]);

    // Avisos sin leer
    const unreadAnnouncements = useMemo(() => {
        if (!user) return [];
        return (announcements || []).filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            const applies = a.targetType === 'GLOBAL' ||
                (a.targetType === 'BRANCH'   && (a.targetValue || []).includes(String(user.branchId))) ||
                (a.targetType === 'EMPLOYEE' && (a.targetValue || []).includes(String(user.id)));
            if (!applies) return false;
            return !(a.readBy || []).some(r => String(typeof r === 'object' ? r.employeeId : r) === String(user.id));
        });
    }, [announcements, user]);

    const hasUrgent = unreadAnnouncements.some(a => a.priority === 'URGENT');

    // Labels
    const h         = currentTime.getHours();
    const greeting  = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const GreetIcon = h < 12 ? Sun : h < 19 ? Sparkles : Moon;
    const MONTHS    = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const D_NAMES   = { 0:'Domingo',1:'Lunes',2:'Martes',3:'Miércoles',4:'Jueves',5:'Viernes',6:'Sábado' };
    const todayLabel = `${D_NAMES[currentTime.getDay()]}, ${String(currentTime.getDate()).padStart(2,'0')} de ${MONTHS[currentTime.getMonth()]} de ${currentTime.getFullYear()}`;
    const timeLabel  = currentTime.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });

    const weekLabel = useMemo(() => {
        const end = new Date(weekStart); end.setDate(end.getDate() + 6);
        const fmt = d => d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
        return `${fmt(weekStart)} — ${fmt(end)}`;
    }, [weekStart]);

    const VAC_STATUS = {
        PLANNED:   { label: 'Planificado', color: 'bg-blue-100 text-blue-700 border-blue-200' },
        CONFIRMED: { label: 'Confirmado',  color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        TAKEN:     { label: 'Completado',  color: 'bg-slate-100 text-slate-500 border-slate-200' },
    };

    const EVT_DOT = {
        VACATION:   'bg-amber-400',
        DISABILITY: 'bg-red-400',
        PERMIT:     'bg-purple-400',
        BIRTHDAY:   'bg-pink-400',
    };

    return (
        <div className="px-4 lg:px-6 pt-4 pb-6">
        <div className="max-w-5xl mx-auto space-y-4">

            {/* ══ SECCIÓN 1: HEADER ══ */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-white/60 backdrop-blur-xl border border-white/80 rounded-2xl shadow-sm">
                        <Home size={16} className="text-[#007AFF]" />
                    </div>
                    <h1 className="text-[18px] font-black text-slate-800">Inicio</h1>
                </div>
                <button onClick={() => navigate('/requests')}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#007AFF] to-[#0055CC] text-white rounded-full font-black text-[11px] uppercase tracking-widest shadow-[0_4px_16px_rgba(0,122,255,0.35)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.45)] hover:-translate-y-0.5 transition-all duration-300 active:scale-95">
                    <Plus size={13} strokeWidth={3} /> Nueva Solicitud
                </button>
            </div>

            {/* ══ SECCIÓN 2: HERO ══ */}
            <div className="relative overflow-hidden rounded-[2rem] px-5 py-4 shadow-[0_8px_30px_rgba(0,122,255,0.3)]"
                style={{ background: 'linear-gradient(135deg,#007AFF 0%,#0055CC 55%,#3b0fa8 100%)' }}>
                <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -translate-y-16 translate-x-16 blur-2xl" />
                <div className="relative z-10 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-white/40 shadow-md flex-shrink-0">
                        {emp?.photo || emp?.photo_url
                            ? <img src={emp.photo || emp.photo_url} className="w-full h-full object-cover" alt="" />
                            : <div className="w-full h-full bg-white/20 flex items-center justify-center text-white font-black text-base">{user?.name?.charAt(0)}</div>
                        }
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <GreetIcon size={11} className="text-white/60 flex-shrink-0" />
                            <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest">{greeting},</p>
                            <p className="text-white text-[15px] font-black leading-none truncate">{user?.name?.split(' ')[0]}</p>
                        </div>
                        <p className="text-white/50 text-[10px] mt-0.5 truncate">
                            {emp?.role || 'Empleado'} · {branch?.name || '—'}{emp?.code ? ` · ${emp.code}` : ''}
                        </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <p className="text-white text-[18px] font-black leading-none">{timeLabel}</p>
                        <p className="text-white/40 text-[9px] mt-0.5 capitalize">{todayLabel}</p>
                    </div>
                </div>

                {/* Estado hoy */}
                <div className="relative z-10 mt-3">
                    {activeEvent === undefined ? (
                        <div className="h-10 bg-white/10 rounded-2xl animate-pulse" />
                    ) : activeEvent ? (
                        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-[11px] uppercase tracking-widest ${
                            activeEvent.type === 'VACATION'   ? 'bg-amber-400/30 text-amber-100 border border-amber-300/30' :
                            activeEvent.type === 'DISABILITY' ? 'bg-red-400/30 text-red-100 border border-red-300/30' :
                            'bg-purple-400/30 text-purple-100 border border-purple-300/30'
                        }`}>
                            <Sparkles size={12} />
                            {EVENT_BADGES[activeEvent.type]?.badge || activeEvent.type}
                            {(() => {
                                const meta = typeof activeEvent.metadata === 'object' && activeEvent.metadata ? activeEvent.metadata : {};
                                const end  = meta.endDate || activeEvent.date;
                                return end ? <span className="opacity-70 font-bold">hasta {new Date(end + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}</span> : null;
                            })()}
                        </div>
                    ) : todayShift ? (
                        <div className="flex items-center gap-4 bg-white/10 border border-white/20 rounded-2xl px-4 py-2.5">
                            <div>
                                <p className="text-white/50 text-[8px] font-black uppercase tracking-widest">Entrada</p>
                                <p className="text-white text-[17px] font-black leading-none">{formatTime12h(todayShift.start)}</p>
                            </div>
                            <div className="flex-1 h-px bg-white/20 relative">
                                <Coffee size={11} className="text-orange-300 absolute left-1/2 -top-[5px] -translate-x-1/2" />
                            </div>
                            <div className="text-right">
                                <p className="text-white/50 text-[8px] font-black uppercase tracking-widest">Salida</p>
                                <p className="text-white text-[17px] font-black leading-none">{formatTime12h(todayShift.end)}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-2xl px-4 py-2.5">
                            <Palmtree size={16} strokeWidth={1.5} className="text-white/60" />
                            <p className="text-white/80 text-[13px] font-bold">Día libre o descanso</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ══ SECCIÓN 3: GRID MÉTRICAS + VACACIONES ══ */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">

                {/* Card Mañana */}
                <div className="group/card bg-white/60 backdrop-blur-xl border border-white/80 rounded-[1.75rem] p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-white/80 hover:-translate-y-1.5 hover:shadow-[0_20px_40px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                        <CalendarDays size={10} className="text-emerald-500" /> Mañana
                    </p>
                    {tomorrowShift ? (
                        <>
                            <p className="text-[28px] font-black text-slate-800 leading-none group-hover/card:text-[#007AFF] transition-colors duration-300">{formatTime12h(tomorrowShift.start)}</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">→ {formatTime12h(tomorrowShift.end)}</p>
                        </>
                    ) : (
                        <div className="flex items-center gap-1.5 text-slate-400 mt-1.5">
                            <Palmtree size={15} strokeWidth={1.5} />
                            <p className="text-[12px] font-bold">Día libre</p>
                        </div>
                    )}
                </div>

                {/* Card Solicitudes */}
                <div onClick={() => navigate('/requests')}
                    className="group/card bg-white/60 backdrop-blur-xl border border-white/80 rounded-[1.75rem] p-3.5 cursor-pointer shadow-[0_4px_20px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-white/80 hover:-translate-y-1.5 hover:shadow-[0_20px_40px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                        <ClipboardList size={10} className="text-purple-500" /> Solicitudes
                    </p>
                    {pendingCount === null
                        ? <Loader2 size={16} className="text-slate-300 animate-spin" />
                        : <>
                            <p className="text-[28px] font-black text-slate-800 leading-none group-hover/card:text-purple-600 transition-colors duration-300">{pendingCount}</p>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">pendientes</p>
                        </>
                    }
                </div>

                {/* Card Tardanzas */}
                <div className="group/card bg-white/60 backdrop-blur-xl border border-white/80 rounded-[1.75rem] p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-white/80 hover:-translate-y-1.5 hover:shadow-[0_20px_40px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                        <Timer size={10} className="text-orange-500" /> Tardanzas
                    </p>
                    {tardanzas === null
                        ? <Loader2 size={16} className="text-slate-300 animate-spin" />
                        : <>
                            <p className={`text-[28px] font-black leading-none transition-colors duration-300 ${tardanzas.count > 3 ? 'text-red-600' : 'text-slate-800 group-hover/card:text-orange-500'}`}>{tardanzas.count}</p>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                                {tardanzas.minutes > 0 ? `${tardanzas.minutes} min · este mes` : 'este mes'}
                            </p>
                        </>
                    }
                </div>

                {/* Card Avisos */}
                <div onClick={() => navigate('/announcements')}
                    className={`group/card backdrop-blur-xl rounded-[1.75rem] p-3.5 cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] hover:-translate-y-1.5 ${
                        hasUrgent
                            ? 'bg-red-50/80 border-2 border-red-400/60 shadow-[0_4px_20px_rgba(239,68,68,0.12),inset_0_1px_0_rgba(255,255,255,0.8)] hover:shadow-[0_20px_40px_rgba(239,68,68,0.15),inset_0_1px_0_rgba(255,255,255,0.9)]'
                            : 'bg-white/60 border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-white/80 hover:shadow-[0_20px_40px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.9)]'
                    }`}>
                    <p className={`text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1 ${hasUrgent ? 'text-red-500' : 'text-slate-400'}`}>
                        {hasUrgent ? <Flame size={10} /> : <Bell size={10} className="text-red-500" />} Avisos
                    </p>
                    <p className={`text-[28px] font-black leading-none ${hasUrgent ? 'text-red-600' : 'text-slate-800 group-hover/card:text-red-500 transition-colors duration-300'}`}>{unreadAnnouncements.length}</p>
                    <p className={`text-[10px] font-medium mt-0.5 ${hasUrgent ? 'text-red-400' : 'text-slate-400'}`}>
                        {hasUrgent ? '¡URGENTE!' : 'sin leer'}
                    </p>
                </div>

                {/* Card Vacaciones — solo si hay planes, full width en mobile/tablet, 2 cols en desktop */}
                {myVacationPlans.length > 0 && (
                    <div className="col-span-2 md:col-span-3 lg:col-span-2 bg-gradient-to-br from-emerald-50/80 to-white/80 backdrop-blur-xl border border-emerald-200/60 rounded-[2rem] p-4 shadow-[0_4px_20px_rgba(16,185,129,0.08),inset_0_1px_0_rgba(255,255,255,0.8)] hover:-translate-y-1.5 hover:shadow-[0_20px_40px_rgba(16,185,129,0.15),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]">
                        <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-1.5">
                            <Palmtree size={10} /> Mis Vacaciones
                        </p>
                        <div className="flex gap-3 overflow-x-auto pb-1">
                            {myVacationPlans.map(vp => {
                                const s    = VAC_STATUS[vp.status] || VAC_STATUS.PLANNED;
                                const fmt  = d => new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
                                const daysLeft = Math.ceil((new Date(vp.start_date + 'T12:00:00') - new Date()) / 86400000);
                                const isConfirmed = vp.status === 'CONFIRMED';
                                return (
                                    <div key={vp.id} className={`flex-shrink-0 p-3 rounded-2xl border min-w-[160px] transition-all duration-300 ${
                                        isConfirmed
                                            ? 'bg-emerald-50 border-emerald-300/60 shadow-[0_0_16px_rgba(16,185,129,0.18)]'
                                            : 'bg-white/70 border-white/80'
                                    }`}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${s.color}`}>
                                                {s.label}
                                            </span>
                                            {daysLeft > 0 && daysLeft <= 90 && (
                                                <span className="text-[9px] font-black text-slate-400">en {daysLeft}d</span>
                                            )}
                                        </div>
                                        <p className="text-[12px] font-black text-slate-700">{fmt(vp.start_date)} → {fmt(vp.end_date)}</p>
                                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">{vp.days} días · {vp.year}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

            </div>

            {/* ══ SECCIÓN 4: HORARIO SEMANAL (full width) ══ */}
            <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)]">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-50 rounded-xl">
                            <CalendarDays size={13} className="text-[#007AFF]" strokeWidth={2.5} />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Horario Semanal</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button onClick={() => setWeekOffset(v => v - 1)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90">
                            <ChevronLeft size={14} strokeWidth={2.5} />
                        </button>
                        <div className="text-center min-w-[110px]">
                            <p className="text-[11px] font-black text-slate-700">{weekLabel}</p>
                            {isCurrentWeek && <p className="text-[8px] font-black text-[#007AFF] uppercase tracking-widest">Semana actual</p>}
                        </div>
                        <button onClick={() => setWeekOffset(v => v + 1)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90">
                            <ChevronRight size={14} strokeWidth={2.5} />
                        </button>
                    </div>
                </div>

                {isLoadingWeek ? (
                    <div className="flex justify-center py-6 text-slate-400 gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-[11px]">Cargando…</span>
                    </div>
                ) : (
                    <>
                        <div key={weekLabel} className="space-y-1.5 animate-in fade-in slide-in-from-right-2 duration-300">
                            {days.map(d => {
                                const isPast = !d.isToday && d.date < today;
                                return (
                                    <div key={d.id} className={`relative flex items-center gap-2.5 p-2.5 rounded-[1.25rem] border transition-all duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden
                                        hover:scale-[1.01] hover:-translate-y-0.5
                                        ${d.isToday
                                            ? 'bg-[#007AFF]/5 border-[#007AFF]/25 ring-2 ring-[#007AFF]/30 ring-offset-2 ring-offset-transparent'
                                            : 'bg-white/40 border-white/60 hover:bg-white/70'
                                        }
                                        ${isPast ? 'opacity-40 grayscale' : ''}
                                    `}>
                                        {d.isToday && (
                                            <div className="absolute inset-0 bg-[#007AFF]/5 animate-pulse rounded-[1.25rem] pointer-events-none" />
                                        )}
                                        <div className={`relative z-10 w-9 h-9 rounded-[0.75rem] flex flex-col items-center justify-center flex-shrink-0 ${
                                            d.isToday ? 'bg-[#007AFF] text-white' : 'bg-slate-100 text-slate-600'
                                        }`}>
                                            <span className="text-[6px] font-black uppercase tracking-widest leading-none opacity-70">{d.short}</span>
                                            <span className="text-[13px] font-black leading-tight">{d.date.getDate()}</span>
                                        </div>
                                        <div className="relative z-10 flex-1 min-w-0">
                                            {d.event ? (
                                                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border ${EVENT_BADGES[d.event.type]?.color || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                    {EVENT_BADGES[d.event.type]?.label || d.event.type}
                                                </span>
                                            ) : d.shift ? (
                                                <div className="flex items-center gap-2">
                                                    <div>
                                                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Entrada</p>
                                                        <p className="text-[13px] font-black text-slate-800">{formatTime12h(d.shift.start)}</p>
                                                    </div>
                                                    <Coffee size={10} className="text-orange-400 flex-shrink-0" />
                                                    <div>
                                                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Salida</p>
                                                        <p className="text-[13px] font-black text-slate-800">{formatTime12h(d.shift.end)}</p>
                                                    </div>
                                                    {d.crossesMidnight && (
                                                        <span className="text-[7px] font-black text-indigo-500 bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded-md">+1d</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 text-slate-400">
                                                    <Palmtree size={11} strokeWidth={1.5} />
                                                    <span className="text-[11px] font-bold">Día libre</span>
                                                </div>
                                            )}
                                        </div>
                                        {d.isToday && (
                                            <span className="relative z-10 flex-shrink-0 text-[7px] font-black uppercase tracking-widest bg-[#007AFF] text-white px-1.5 py-0.5 rounded-full">Hoy</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {totalWeekHours > 0 && (
                            <div className="mt-3">
                                <div className="flex items-center justify-between mb-1">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                        <Clock size={9} /> Progreso semana
                                    </p>
                                    <p className="text-[11px] font-black text-slate-600">{totalWeekHours.toFixed(1)} / 44h</p>
                                </div>
                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-[#007AFF] to-[#0055CC] rounded-full transition-all duration-500"
                                        style={{ width: `${Math.min((totalWeekHours / 44) * 100, 100)}%` }} />
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ══ SECCIÓN 5: PRÓXIMOS EVENTOS ══ */}
            {upcomingEvents.length > 0 && (
                <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                        <Sparkles size={11} className="text-amber-500" /> Próximos Eventos
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {upcomingEvents.map(ev => {
                            const meta  = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                            const start = meta.startDate || ev.date;
                            const conf  = EVENT_BADGES[ev.type];
                            return (
                                <div key={ev.id} className="flex items-center gap-1.5 bg-white/70 border border-white/80 rounded-full px-3 py-1.5 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${EVT_DOT[ev.type] || 'bg-slate-400'}`} />
                                    <span className="text-[10px] font-black text-slate-600">{conf?.label || ev.type}</span>
                                    <span className="text-[10px] text-slate-400">
                                        {new Date(start + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

        </div>
        </div>
    );
};

export default EmployeeHomeView;
