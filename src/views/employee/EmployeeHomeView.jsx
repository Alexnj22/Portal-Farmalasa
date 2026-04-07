import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CalendarDays, ClipboardList, Bell, Plus, ChevronLeft, ChevronRight,
    Coffee, Loader2, Palmtree, Sparkles, Clock, Timer, Flame, Sun, Moon
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

    return (
        <div className="px-4 lg:px-6 pt-4 pb-6">
        <div className="max-w-5xl mx-auto space-y-4">

            {/* ══ SECCIÓN 1: BIENVENIDA ══ */}
            <div className="relative overflow-hidden rounded-[2rem] p-6 lg:p-8 shadow-[0_8px_30px_rgba(0,122,255,0.3)]"
                style={{ background: 'linear-gradient(135deg,#007AFF 0%,#0055CC 55%,#3b0fa8 100%)' }}>
                <div className="absolute top-0 right-0 w-56 h-56 bg-white/10 rounded-full -translate-y-20 translate-x-20 blur-2xl" />
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full translate-y-16 -translate-x-10 blur-xl" />
                <div className="relative z-10">
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 lg:w-16 lg:h-16 rounded-full overflow-hidden border-2 border-white/40 shadow-md flex-shrink-0">
                                {emp?.photo || emp?.photo_url
                                    ? <img src={emp.photo || emp.photo_url} className="w-full h-full object-cover" alt="" />
                                    : <div className="w-full h-full bg-white/20 flex items-center justify-center text-white font-black text-xl">{user?.name?.charAt(0)}</div>
                                }
                            </div>
                            <div>
                                <div className="flex items-center gap-1.5 mb-0.5">
                                    <GreetIcon size={12} className="text-white/70" />
                                    <p className="text-white/70 text-[11px] font-bold uppercase tracking-widest">{greeting}</p>
                                </div>
                                <h2 className="text-white text-[22px] lg:text-[26px] font-black leading-tight">{user?.name?.split(' ')[0]}</h2>
                                <p className="text-white/60 text-[11px] mt-0.5">{emp?.role || 'Empleado'} · {branch?.name || '—'}</p>
                            </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                            <p className="text-white text-[22px] lg:text-[26px] font-black leading-none">{timeLabel}</p>
                            {emp?.code && <p className="text-white/50 text-[10px] mt-1 font-bold uppercase tracking-widest">CÓD: {emp.code}</p>}
                        </div>
                    </div>

                    <p className="text-white/50 text-[11px] font-bold mb-4 capitalize">{todayLabel}</p>

                    {activeEvent === undefined ? (
                        <div className="h-12 bg-white/10 rounded-2xl animate-pulse" />
                    ) : activeEvent ? (
                        <div className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl font-black text-[11px] uppercase tracking-widest ${
                            activeEvent.type === 'VACATION'   ? 'bg-amber-400/30 text-amber-100 border border-amber-300/30' :
                            activeEvent.type === 'DISABILITY' ? 'bg-red-400/30 text-red-100 border border-red-300/30' :
                            'bg-purple-400/30 text-purple-100 border border-purple-300/30'
                        }`}>
                            <Sparkles size={13} />
                            {EVENT_BADGES[activeEvent.type]?.badge || activeEvent.type}
                            {(() => {
                                const meta = typeof activeEvent.metadata === 'object' && activeEvent.metadata ? activeEvent.metadata : {};
                                const end  = meta.endDate || activeEvent.date;
                                return end ? <span className="opacity-70 font-bold">hasta {new Date(end + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}</span> : null;
                            })()}
                        </div>
                    ) : todayShift ? (
                        <div className="flex items-center gap-4 bg-white/10 border border-white/20 rounded-2xl px-4 py-3">
                            <div>
                                <p className="text-white/60 text-[9px] font-black uppercase tracking-widest mb-0.5">Entrada</p>
                                <p className="text-white text-[20px] font-black leading-none">{formatTime12h(todayShift.start)}</p>
                            </div>
                            <div className="flex-1 h-px bg-white/20 relative">
                                <Coffee size={12} className="text-orange-300 absolute left-1/2 -top-2 -translate-x-1/2" />
                            </div>
                            <div className="text-right">
                                <p className="text-white/60 text-[9px] font-black uppercase tracking-widest mb-0.5">Salida</p>
                                <p className="text-white text-[20px] font-black leading-none">{formatTime12h(todayShift.end)}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-2xl px-4 py-3">
                            <Palmtree size={18} strokeWidth={1.5} className="text-white/60" />
                            <p className="text-white/80 text-[14px] font-bold">Día libre o descanso</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ══ SECCIÓN 2: MÉTRICAS ══ */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

                {/* Mañana */}
                <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                        <CalendarDays size={10} className="text-emerald-500" /> Mañana
                    </p>
                    {tomorrowShift ? (
                        <>
                            <p className="text-[22px] font-black text-slate-800 leading-none">{formatTime12h(tomorrowShift.start)}</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">→ {formatTime12h(tomorrowShift.end)}</p>
                        </>
                    ) : (
                        <div className="flex items-center gap-1.5 text-slate-400 mt-2">
                            <Palmtree size={16} strokeWidth={1.5} />
                            <p className="text-[12px] font-bold">Día libre</p>
                        </div>
                    )}
                </div>

                {/* Solicitudes */}
                <div onClick={() => navigate('/requests')}
                    className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)] cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all active:scale-[0.98]">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                        <ClipboardList size={10} className="text-purple-500" /> Solicitudes
                    </p>
                    {pendingCount === null
                        ? <Loader2 size={16} className="text-slate-300 animate-spin" />
                        : <>
                            <p className="text-[34px] font-black text-slate-800 leading-none">{pendingCount}</p>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">pendientes</p>
                        </>
                    }
                </div>

                {/* Tardanzas */}
                <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                        <Timer size={10} className="text-orange-500" /> Tardanzas
                    </p>
                    {tardanzas === null
                        ? <Loader2 size={16} className="text-slate-300 animate-spin" />
                        : <>
                            <p className={`text-[34px] font-black leading-none ${tardanzas.count > 3 ? 'text-red-600' : 'text-slate-800'}`}>{tardanzas.count}</p>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                                {tardanzas.minutes > 0 ? `${tardanzas.minutes} min · este mes` : 'este mes'}
                            </p>
                        </>
                    }
                </div>

                {/* Avisos */}
                <div onClick={() => navigate('/announcements')}
                    className={`backdrop-blur-xl rounded-[2rem] p-4 cursor-pointer hover:-translate-y-0.5 transition-all active:scale-[0.98] ${
                        hasUrgent
                            ? 'bg-red-50/80 border-2 border-red-400/60 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]'
                            : 'bg-white/60 border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.04)]'
                    }`}>
                    <p className={`text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1 ${hasUrgent ? 'text-red-500' : 'text-slate-400'}`}>
                        {hasUrgent ? <Flame size={10} /> : <Bell size={10} className="text-red-500" />} Avisos
                    </p>
                    <p className={`text-[34px] font-black leading-none ${hasUrgent ? 'text-red-600' : 'text-slate-800'}`}>{unreadAnnouncements.length}</p>
                    <p className={`text-[10px] font-medium mt-0.5 ${hasUrgent ? 'text-red-400' : 'text-slate-400'}`}>
                        {hasUrgent ? '¡URGENTE!' : 'sin leer'}
                    </p>
                </div>

            </div>

            {/* ══ SECCIÓN 3: HORARIO SEMANAL ══ */}
            <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-50 rounded-xl">
                            <CalendarDays size={14} className="text-[#007AFF]" strokeWidth={2.5} />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Horario Semanal</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setWeekOffset(v => v - 1)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90">
                            <ChevronLeft size={16} strokeWidth={2.5} />
                        </button>
                        <div className="text-center min-w-[120px]">
                            <p className="text-[12px] font-black text-slate-700">{weekLabel}</p>
                            {isCurrentWeek && <p className="text-[9px] font-black text-[#007AFF] uppercase tracking-widest">Semana actual</p>}
                        </div>
                        <button onClick={() => setWeekOffset(v => v + 1)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90">
                            <ChevronRight size={16} strokeWidth={2.5} />
                        </button>
                    </div>
                </div>

                {isLoadingWeek ? (
                    <div className="flex justify-center py-8 text-slate-400 gap-2">
                        <Loader2 size={18} className="animate-spin" />
                        <span className="text-[12px]">Cargando…</span>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            {days.map(d => (
                                <div key={d.id} className={`flex items-center gap-3 p-3 rounded-[1.5rem] border transition-all ${
                                    d.isToday ? 'bg-[#007AFF]/5 border-[#007AFF]/25' : 'bg-white/40 border-white/60'
                                }`}>
                                    <div className={`w-11 h-11 rounded-[0.875rem] flex flex-col items-center justify-center flex-shrink-0 ${
                                        d.isToday ? 'bg-[#007AFF] text-white' : 'bg-slate-100 text-slate-600'
                                    }`}>
                                        <span className="text-[7px] font-black uppercase tracking-widest leading-none opacity-70">{d.short}</span>
                                        <span className="text-[15px] font-black leading-tight">{d.date.getDate()}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        {d.event ? (
                                            <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${EVENT_BADGES[d.event.type]?.color || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                {EVENT_BADGES[d.event.type]?.label || d.event.type}
                                            </span>
                                        ) : d.shift ? (
                                            <div className="flex items-center gap-3">
                                                <div>
                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Entrada</p>
                                                    <p className="text-[14px] font-black text-slate-800">{formatTime12h(d.shift.start)}</p>
                                                </div>
                                                <Coffee size={11} className="text-orange-400 flex-shrink-0" />
                                                <div>
                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Salida</p>
                                                    <p className="text-[14px] font-black text-slate-800">{formatTime12h(d.shift.end)}</p>
                                                </div>
                                                {d.crossesMidnight && (
                                                    <span className="text-[8px] font-black text-indigo-500 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-md">+1d</span>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1.5 text-slate-400">
                                                <Palmtree size={13} strokeWidth={1.5} />
                                                <span className="text-[12px] font-bold">Día libre</span>
                                            </div>
                                        )}
                                    </div>
                                    {d.isToday && (
                                        <span className="flex-shrink-0 text-[8px] font-black uppercase tracking-widest bg-[#007AFF] text-white px-2 py-0.5 rounded-full">Hoy</span>
                                    )}
                                </div>
                            ))}
                        </div>
                        {totalWeekHours > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                    <Clock size={10} /> Total semana
                                </p>
                                <p className="text-[13px] font-black text-slate-700">{totalWeekHours.toFixed(1)} horas</p>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ══ SECCIÓN 4: PRÓXIMOS EVENTOS ══ */}
            {upcomingEvents.length > 0 && (
                <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-1.5">
                        <Sparkles size={12} className="text-amber-500" /> Próximos Eventos
                    </p>
                    <div className="space-y-2.5">
                        {upcomingEvents.map(ev => {
                            const meta  = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                            const start = meta.startDate || ev.date;
                            const end   = meta.endDate   || null;
                            const conf  = EVENT_BADGES[ev.type];
                            return (
                                <div key={ev.id} className="flex items-center gap-3">
                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${conf?.color || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                        {conf?.label || ev.type}
                                    </span>
                                    <span className="text-[12px] text-slate-600 font-medium">
                                        {new Date(start + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        {end && end !== start && ` — ${new Date(end + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}`}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {upcomingEvents.some(ev => ev.type === 'VACATION') && (
                        <p className="text-[10px] text-slate-400 mt-3 italic">* Las vacaciones previstas están sujetas a cambio.</p>
                    )}
                </div>
            )}

            {/* Nueva Solicitud */}
            <button onClick={() => navigate('/requests')}
                className="w-full flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-[#007AFF] to-[#0055CC] text-white rounded-[1.75rem] font-black text-[13px] shadow-[0_4px_20px_rgba(0,122,255,0.3)] hover:shadow-[0_6px_25px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 transition-all active:scale-[0.98]"
            >
                <Plus size={16} strokeWidth={3} /> Nueva Solicitud
            </button>

        </div>
        </div>
    );
};

export default EmployeeHomeView;
