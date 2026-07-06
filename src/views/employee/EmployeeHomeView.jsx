import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CalendarDays, ClipboardList, Bell, Plus, ChevronLeft, ChevronRight,
    Coffee, Loader2, Palmtree, Sparkles, Clock, Timer, Flame, Sun, Moon, Home, Utensils, Baby, X, Cake
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { formatTime12h } from '../../utils/helpers';
import LiquidWeekPicker from '../../components/common/LiquidWeekPicker';
import GlassViewLayout from '../../components/GlassViewLayout';
import { announcementAppliesToUser } from '../../utils/announcementAudience';

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
    const roles = useStaffStore(s => s.roles || []);
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
    const [branchSchedule, setBranchSchedule] = useState([]);

    const emp    = employees.find(e => String(e.id) === String(user?.id));
    const branch = branches.find(b => String(b.id) === String(emp?.branchId));

    const tk = {
        card:             'bg-white/60 backdrop-blur-xl border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)]',
        cardHover:        'hover:bg-white/80 hover:shadow-[0_20px_40px_rgba(0,0,0,0.10)]',
        textStrong:       'text-slate-800',
        textMid:          'text-slate-600',
        textMuted:        'text-slate-400',
        divider:          'border-slate-100',
        pill:             'bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)]',
        shiftPill:        'bg-white/50 border-white/70',
        ctaBtn:           'bg-white/70 border-white/80 text-slate-700 hover:bg-white/90',
        dayHeaderDefault: 'bg-slate-50 text-slate-600',
        dayHeaderToday:   'bg-slate-800 text-white',
        dayHeaderNext:    'bg-slate-100 text-slate-500',
        dayBody:          'bg-white/40',
        empRowSelf:       'bg-slate-100/80 border-slate-200',
        empRow:           'bg-white/60',
        navBtn:           'hover:bg-slate-100 text-slate-500',
        navLabel:         'text-slate-500',
        iconBg:           'bg-slate-100',
        progressTrack:    'bg-slate-100',
        progressBar:      'bg-slate-700',
    };

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

    // Horario de compañeros de sucursal
    useEffect(() => {
        if (!user?.branchId || !weekStartISO) return;
        const branchEmpIds = employees
            .filter(e =>
                String(e.branch_id || e.branchId) === String(user?.branchId) &&
                e.status === 'ACTIVO'
            )
            .map(e => e.id);
        if (branchEmpIds.length === 0) return;
        supabase
            .from('employee_rosters')
            .select('employee_id, schedule_data')
            .eq('week_start_date', weekStartISO)
            .in('employee_id', branchEmpIds)
            .then(({ data }) => setBranchSchedule(data || []));
    }, [weekStartISO, user?.branchId, employees]);

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

    // 8 días: Lun–Dom + próximo Lunes
    const calendarDays = useMemo(() => {
        const nextMon = new Date(weekStart);
        nextMon.setDate(weekStart.getDate() + 7);
        const nextMonISO = toISO(nextMon);
        const isToday    = nextMon.getTime() === today.getTime();
        const dayDef     = DAYS[0]; // { id:1, name:'Lunes', short:'LUN' }
        const rawShift   = scheduleData?.[dayDef.id] ?? scheduleData?.[String(dayDef.id)];
        const shiftId    = typeof rawShift === 'object' ? rawShift?.shiftId : rawShift;
        const shift      = shiftId && shiftId !== 'LIBRE' ? shifts.find(s => String(s.id) === String(shiftId)) : null;
        const event      = weekEvents.find(ev => {
            const meta = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
            const s = meta.startDate || ev.date, e = meta.endDate || ev.date;
            return nextMonISO >= s && nextMonISO <= e;
        });
        const extraDay = { ...dayDef, date: nextMon, dateISO: nextMonISO, isToday, shift, event, crossesMidnight: false, isNextWeek: true };
        return [...days, extraDay];
    }, [days, weekStart, today, scheduleData, shifts, weekEvents]);

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
            if (!announcementAppliesToUser(a, user, roles)) return false;
            return !(a.readBy || []).some(r => String(typeof r === 'object' ? r.employeeId : r) === String(user.id));
        });
    }, [announcements, user, roles]);

    const hasUrgent = unreadAnnouncements.some(a => a.priority === 'URGENT');

    // ¿Hoy es el cumpleaños de quien inició sesión? — personaliza el saludo del
    // header y muestra un banner festivo, para que se sienta que la empresa
    // está pendiente de la fecha.
    const empBirthDate = emp?.birth_date;
    const myBirthday = useMemo(() => {
        if (!empBirthDate) return null;
        const bDate = new Date(empBirthDate + 'T12:00:00');
        const today = new Date();
        if (bDate.getMonth() !== today.getMonth() || bDate.getDate() !== today.getDate()) return null;
        return { turningAge: today.getFullYear() - bDate.getFullYear() };
    }, [empBirthDate]);

    // Labels
    const h         = currentTime.getHours();
    const greeting  = myBirthday ? '¡Feliz cumpleaños' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const GreetIcon = myBirthday ? Cake : h < 12 ? Sun : h < 19 ? Sparkles : Moon;
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
        <GlassViewLayout
            transparentBody={true}
            headerLeft={
                <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className={`relative w-10 h-10 md:w-11 md:h-11 rounded-full overflow-hidden border-2 shadow-md flex-shrink-0 ${myBirthday ? 'border-pink-300' : 'border-white/60'}`}>
                        {emp?.photo || emp?.photo_url
                            ? <img src={emp.photo || emp.photo_url} className="w-full h-full object-cover" alt="" />
                            : <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white font-black text-base">{user?.name?.charAt(0)}</div>
                        }
                        {myBirthday && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-pink-500 border-2 border-white shadow-sm flex items-center justify-center animate-bounce">
                                <span className="text-[8px] leading-none">🎂</span>
                            </span>
                        )}
                    </div>
                    {/* Nombre + cargo */}
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <GreetIcon size={11} className={`${myBirthday ? 'text-pink-500' : tk.textMuted} flex-shrink-0`} />
                            <span className={`text-[11px] font-bold uppercase tracking-wider ${myBirthday ? 'text-pink-500' : tk.textMuted}`}>{greeting},</span>
                            <span className={`text-[16px] md:text-[18px] font-black leading-none truncate ${tk.textStrong}`}>{user?.name?.split(' ')[0]}{myBirthday ? '! 🎉' : ''}</span>
                        </div>
                        <p className={`text-[11px] mt-0.5 truncate ${tk.textMuted}`}>{emp?.role || 'Empleado'} · {branch?.name || '—'}</p>
                    </div>
                </div>
            }
            filtersContent={
                <div className={`relative flex items-center border transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 w-max max-w-full overflow-hidden gap-2 md:gap-3 ${tk.pill}`}>
                    {/* Hora + fecha */}
                    <div className="hidden sm:flex flex-col items-end shrink-0">
                        <span className={`text-[15px] font-black leading-none ${tk.textStrong}`}>{timeLabel}</span>
                        <span className={`text-[9px] font-bold mt-0.5 capitalize tracking-wider ${tk.textMuted}`}>{todayLabel}</span>
                    </div>
                    {/* Turno hoy */}
                    {activeEvent === undefined ? null : activeEvent ? (
                        <div className={`hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl font-black text-[10px] uppercase tracking-widest border ${
                            activeEvent.type === 'VACATION'   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            activeEvent.type === 'DISABILITY' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-purple-50 text-purple-700 border-purple-200'
                        }`}>
                            <Sparkles size={10} />
                            {EVENT_BADGES[activeEvent.type]?.badge || activeEvent.type}
                        </div>
                    ) : todayShift ? (
                        <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-2xl border ${tk.shiftPill}`}>
                            <div className="text-center">
                                <p className={`text-[8px] font-black uppercase tracking-widest ${tk.textMuted}`}>Entrada</p>
                                <p className={`text-[13px] font-black leading-none ${tk.textStrong}`}>{formatTime12h(todayShift.start)}</p>
                            </div>
                            <Coffee size={10} className="text-orange-400 flex-shrink-0" />
                            <div className="text-center">
                                <p className={`text-[8px] font-black uppercase tracking-widest ${tk.textMuted}`}>Salida</p>
                                <p className={`text-[13px] font-black leading-none ${tk.textStrong}`}>{formatTime12h(todayShift.end)}</p>
                            </div>
                        </div>
                    ) : (
                        <div className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border ${tk.shiftPill}`}>
                            <Palmtree size={13} strokeWidth={1.5} className={tk.textMuted} />
                            <p className={`text-[11px] font-bold ${tk.textMid}`}>Día libre</p>
                        </div>
                    )}
                    <div className="w-px h-6 shrink-0 hidden sm:block bg-white/40" />
                    {/* Botón */}
                    <button onClick={() => navigate('/my-requests')}
                        className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full font-black text-[10px] md:text-[11px] uppercase tracking-widest shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-300 active:scale-[0.97] shrink-0 border ${tk.ctaBtn}`}>
                        <Plus size={13} strokeWidth={3} /> Nueva Solicitud
                    </button>
                </div>
            }
        >
        <div className="space-y-4 pb-6">
            {employees.length === 0 ? (
                <div className="space-y-4 animate-in fade-in duration-300">
                    {/* Metric cards skeleton */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className={`skeleton rounded-[1.75rem] h-24 ${i === 4 ? 'col-span-2 lg:col-span-1' : ''}`} />
                        ))}
                    </div>
                    {/* Events pills skeleton */}
                    <div className="flex gap-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="skeleton rounded-full h-7 w-28" />
                        ))}
                    </div>
                    {/* Schedule skeleton */}
                    <div className={`rounded-[2rem] p-4 space-y-3 border ${tk.card}`}>
                        <div className="flex items-center justify-between mb-2">
                            <div className="skeleton rounded-full h-4 w-32" />
                            <div className="skeleton rounded-full h-4 w-24" />
                        </div>
                        {Array.from({ length: 2 }).map((_, ri) => (
                            <div key={ri} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {Array.from({ length: 4 }).map((_, ci) => (
                                    <div key={ci} className="skeleton rounded-2xl h-32" />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (<>

            {/* ══ SECCIÓN 3: VERTICAL ══ */}
            <div className="space-y-4">

                {/* 0. Banner de cumpleaños — personal, para que se sienta que la empresa está pendiente */}
                {myBirthday && (
                    <div className="relative overflow-hidden rounded-[2rem] p-5 border border-pink-200/60 bg-gradient-to-br from-pink-50 via-white to-amber-50 shadow-[0_8px_30px_rgba(236,72,153,0.12)] animate-in fade-in zoom-in-95 duration-700">
                        <div className="absolute inset-0 pointer-events-none opacity-70">
                            <span className="absolute top-3 left-10 text-[14px] animate-bounce">🎉</span>
                            <span className="absolute top-6 right-16 text-[12px] animate-bounce [animation-delay:150ms]">✨</span>
                            <span className="absolute bottom-3 left-1/3 text-[13px] animate-bounce [animation-delay:300ms]">🎊</span>
                        </div>
                        <div className="relative z-10 flex items-center gap-3.5">
                            <div className="w-12 h-12 rounded-2xl bg-white/90 border border-pink-200 flex items-center justify-center shadow-sm shrink-0">
                                <Cake size={22} className="text-pink-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[15px] font-black text-slate-800 truncate">
                                    ¡Feliz cumpleaños, {user?.name?.split(' ')[0]}! 🎂 Hoy cumples {myBirthday.turningAge} años.
                                </p>
                                <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                                    Todo el equipo de Farmacias La Popular y La Salud te desea un día increíble. ¡Que lo disfrutes!
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* 1. Métricas + Vacaciones en una fila */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">

                    {/* Mañana */}
                    <div className={`group/card rounded-[1.75rem] p-4 hover:-translate-y-1.5 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] border ${tk.card} ${tk.cardHover}`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1 ${tk.textMuted}`}>
                            <CalendarDays size={10} className="text-emerald-500" /> Mañana
                        </p>
                        {tomorrowShift ? (
                            <>
                                <p className={`text-[22px] font-black leading-none transition-colors duration-300 ${tk.textStrong}`}>{formatTime12h(tomorrowShift.start)}</p>
                                <p className={`text-[10px] font-medium mt-0.5 ${tk.textMuted}`}>→ {formatTime12h(tomorrowShift.end)}</p>
                            </>
                        ) : (
                            <div className={`flex items-center gap-1.5 mt-1.5 ${tk.textMuted}`}>
                                <Palmtree size={14} strokeWidth={1.5} />
                                <p className="text-[11px] font-bold">Libre</p>
                            </div>
                        )}
                    </div>

                    {/* Solicitudes */}
                    <div onClick={() => navigate('/my-requests')}
                        className={`group/card rounded-[1.75rem] p-4 cursor-pointer hover:-translate-y-1.5 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] border ${tk.card} ${tk.cardHover}`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1 ${tk.textMuted}`}>
                            <ClipboardList size={10} className="text-purple-500" /> Solicitudes
                        </p>
                        {pendingCount === null
                            ? <Loader2 size={14} className={`${tk.textMuted} animate-spin`} />
                            : <>
                                <p className={`text-[28px] font-black leading-none group-hover/card:text-purple-400 transition-colors duration-300 ${tk.textStrong}`}>{pendingCount}</p>
                                <p className={`text-[10px] font-medium mt-0.5 ${tk.textMuted}`}>pendientes</p>
                            </>
                        }
                    </div>

                    {/* Tardanzas */}
                    <div className={`group/card rounded-[1.75rem] p-4 hover:-translate-y-1.5 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] border ${tk.card} ${tk.cardHover}`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1 ${tk.textMuted}`}>
                            <Timer size={10} className="text-orange-500" /> Tardanzas
                        </p>
                        {tardanzas === null
                            ? <Loader2 size={14} className={`${tk.textMuted} animate-spin`} />
                            : <>
                                <p className={`text-[28px] font-black leading-none transition-colors duration-300 ${tardanzas.count > 3 ? 'text-red-400' : `${tk.textStrong} group-hover/card:text-orange-400`}`}>{tardanzas.count}</p>
                                <p className={`text-[10px] font-medium mt-0.5 ${tk.textMuted}`}>
                                    {tardanzas.minutes > 0 ? `${tardanzas.minutes}m` : 'este mes'}
                                </p>
                            </>
                        }
                    </div>

                    {/* Avisos */}
                    <div onClick={() => navigate('/my-announcements')}
                        className={`group/card rounded-[1.75rem] p-4 cursor-pointer hover:-translate-y-1.5 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] border ${
                            hasUrgent
                                ? 'bg-red-500/10 border-red-400/40 shadow-[0_4px_20px_rgba(239,68,68,0.15)] hover:shadow-[0_20px_40px_rgba(239,68,68,0.22)]'
                                : `${tk.card} ${tk.cardHover}`
                        }`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1 ${hasUrgent ? 'text-red-400' : tk.textMuted}`}>
                            {hasUrgent ? <Flame size={10} /> : <Bell size={10} className="text-red-400" />} Avisos
                        </p>
                        <p className={`text-[28px] font-black leading-none ${hasUrgent ? 'text-red-400' : `${tk.textStrong} group-hover/card:text-red-400 transition-colors duration-300`}`}>{unreadAnnouncements.length}</p>
                        <p className={`text-[10px] font-medium mt-0.5 ${hasUrgent ? 'text-red-400' : tk.textMuted}`}>
                            {hasUrgent ? '¡URGENTE!' : 'sin leer'}
                        </p>
                    </div>

                    {/* Vacaciones */}
                    <div className={`col-span-2 lg:col-span-1 rounded-[1.75rem] p-4 backdrop-blur-xl border hover:-translate-y-1.5 transition-all duration-300 ${
                        myVacationPlans.length > 0
                            ? 'bg-gradient-to-br from-emerald-50/80 to-white/80 border-emerald-200/60 shadow-[0_4px_20px_rgba(16,185,129,0.08)] hover:shadow-[0_20px_40px_rgba(16,185,129,0.15)]'
                            : `${tk.card} ${tk.cardHover}`
                    }`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest mb-3 flex items-center gap-1.5 ${tk.textMuted}`}>
                            <Palmtree size={9} className="text-emerald-500" /> Mis Vacaciones
                        </p>
                        {myVacationPlans.length === 0 ? (
                            <div className="flex items-center gap-2">
                                <Palmtree size={16} strokeWidth={1} className={`${tk.textMuted} opacity-50 flex-shrink-0`} />
                                <div>
                                    <p className={`text-[11px] font-black ${tk.textMuted}`}>Pendiente</p>
                                    <p className={`text-[9px] font-medium ${tk.textMuted} opacity-60`}>RRHH asignará</p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {myVacationPlans.map(vp => {
                                    const s = VAC_STATUS[vp.status] || VAC_STATUS.PLANNED;
                                    const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
                                    const daysLeft = Math.ceil((new Date(vp.start_date + 'T12:00:00') - new Date()) / 86400000);
                                    return (
                                        <div key={vp.id} className={`p-2 rounded-xl border transition-all ${
                                            vp.status === 'CONFIRMED'
                                                ? 'border-emerald-200/70 bg-emerald-50/50'
                                                : 'border-white/80 bg-white/40'
                                        }`}>
                                            <div className="flex items-center justify-between mb-0.5">
                                                <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${s.color}`}>{s.label}</span>
                                                {daysLeft > 0 && daysLeft <= 90 && <span className={`text-[8px] font-black ${tk.textMuted}`}>en {daysLeft}d</span>}
                                            </div>
                                            <p className={`text-[10px] font-black ${tk.textStrong}`}>{fmt(vp.start_date)} → {fmt(vp.end_date)}</p>
                                            <p className={`text-[9px] ${tk.textMuted}`}>{vp.days}d · {vp.year}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                </div>

                {/* 3. Próximos eventos pills */}
                {upcomingEvents.length > 0 && (
                    <div className={`rounded-[2rem] px-4 py-3 border ${tk.card}`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1.5 ${tk.textMuted}`}>
                            <Sparkles size={9} className="text-amber-500" /> Próximos Eventos
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {upcomingEvents.map(ev => {
                                const meta  = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                                const start = meta.startDate || ev.date;
                                const conf  = EVENT_BADGES[ev.type];
                                return (
                                    <div key={ev.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-bold hover:-translate-y-0.5 hover:shadow-sm transition-all duration-200 border ${tk.shiftPill} ${tk.textMid}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${EVT_DOT[ev.type] || 'bg-slate-400'}`} />
                                        {conf?.label || ev.type} · {new Date(start + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 4. Horario de sucursal — full width */}
                <div className={`rounded-[2rem] p-5 border ${tk.card}`}>

                    {/* Header nav semana */}
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-xl ${tk.iconBg}`}>
                                <CalendarDays size={13} className={tk.textMid} strokeWidth={2.5} />
                            </div>
                            <p className={`text-[10px] font-black uppercase tracking-widest ${tk.textMuted}`}>Horario de Sucursal</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button onClick={() => setWeekOffset(v => v - 1)} className={`p-1.5 rounded-xl transition-all active:scale-[0.97] ${tk.navBtn}`}>
                                <ChevronLeft size={15} strokeWidth={2.5} />
                            </button>
                            <LiquidWeekPicker
                                selectedWeekStart={weekStart}
                                onChange={(monday) => {
                                    const curMonday = getWeekStart(new Date());
                                    const diff = Math.round((monday - curMonday) / (7 * 24 * 60 * 60 * 1000));
                                    setWeekOffset(diff);
                                }}
                            >
                                <span className={`text-[11px] font-black min-w-[100px] text-center px-2 py-1 rounded-xl transition-all ${tk.textStrong} ${tk.navBtn}`}>
                                    {weekLabel}
                                </span>
                            </LiquidWeekPicker>
                            <button onClick={() => setWeekOffset(v => v + 1)} className={`p-1.5 rounded-xl transition-all active:scale-[0.97] ${tk.navBtn}`}>
                                <ChevronRight size={15} strokeWidth={2.5} />
                            </button>
                            {weekOffset !== 0 && (
                                <button
                                    onClick={() => setWeekOffset(0)}
                                    className="p-1.5 rounded-xl border transition-all active:scale-[0.97] animate-in fade-in zoom-in-95 duration-200 bg-red-50 text-red-500 border-red-200 hover:bg-red-100"
                                    title="Volver a esta semana"
                                >
                                    <X size={13} strokeWidth={2.5} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 2 filas de 4 días */}
                    {isLoadingWeek ? (
                        <div className={`flex justify-center py-8 gap-2 ${tk.textMuted}`}>
                            <Loader2 size={16} className="animate-spin" />
                            <span className="text-[11px]">Cargando…</span>
                        </div>
                    ) : (
                        <div key={weekLabel} className="space-y-3 animate-in fade-in slide-in-from-right-2 duration-300">
                            {[calendarDays.slice(0, 4), calendarDays.slice(4, 8)].map((row, ri) => (
                                <div key={ri} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {row.map(d => {
                                        const isPast = !d.isToday && d.date < today;
                                        const branchEmpsForDay = employees
                                            .filter(e =>
                                                String(e.branch_id || e.branchId) === String(user?.branchId) &&
                                                e.status === 'ACTIVO'
                                            )
                                            .map(e => {
                                                const roster    = branchSchedule.find(r => String(r.employee_id) === String(e.id));
                                                const schedData = roster?.schedule_data || (String(e.id) === String(user?.id) ? scheduleData : null) || e.weeklySchedule || {};
                                                const raw          = schedData?.[d.id] ?? schedData?.[String(d.id)];
                                                const shiftId      = typeof raw === 'object' ? raw?.shiftId : raw;
                                                const shift        = shiftId && shiftId !== 'LIBRE' ? shifts.find(s => String(s.id) === String(shiftId)) : null;
                                                const lunchTime    = typeof raw === 'object' ? raw?.lunchTime : null;
                                                const lactationTime = typeof raw === 'object' ? raw?.lactationTime : null;
                                                return { e, shift, lunchTime, lactationTime };
                                            })
                                            .sort((a, b) => {
                                                if (String(a.e.id) === String(user?.id)) return -1;
                                                if (String(b.e.id) === String(user?.id)) return 1;
                                                return (a.e.name || '').localeCompare(b.e.name || '');
                                            });

                                        return (
                                            <div key={d.id} className={`flex flex-col rounded-2xl border overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${
                                                d.isToday
                                                    ? 'border-slate-300 shadow-[0_0_0_2px_rgba(0,0,0,0.08)]'
                                                    : 'border-white/60'
                                            } ${isPast ? 'opacity-40 grayscale' : ''}`}>

                                                {/* Header del día */}
                                                <div className={`px-2 py-3 text-center flex-shrink-0 ${d.isToday ? tk.dayHeaderToday : d.isNextWeek ? tk.dayHeaderNext : tk.dayHeaderDefault}`}>
                                                    <p className="text-[9px] font-black uppercase tracking-widest opacity-70">{d.short}</p>
                                                    <p className="text-[22px] font-black leading-tight">{d.date.getDate()}</p>
                                                    {d.isToday && <p className="text-[8px] font-black uppercase tracking-widest opacity-80">Hoy</p>}
                                                    {d.isNextWeek && <p className="text-[7px] font-black uppercase tracking-widest opacity-60">Próx.</p>}
                                                </div>

                                                {/* Lista empleados */}
                                                <div className={`flex-1 p-2 space-y-1.5 ${tk.dayBody}`}>
                                                    {branchEmpsForDay.length === 0 ? (
                                                        <p className={`text-[10px] text-center py-3 ${tk.textMuted} opacity-50`}>—</p>
                                                    ) : branchEmpsForDay.map(({ e: em, shift, lunchTime, lactationTime }) => (
                                                        <div key={em.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all border ${
                                                            String(em.id) === String(user?.id) ? tk.empRowSelf : `${tk.empRow} border-transparent`
                                                        }`}>
                                                            <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 border border-white/60">
                                                                {em.photo || em.photo_url
                                                                    ? <img src={em.photo || em.photo_url} className="w-full h-full object-cover" alt="" />
                                                                    : <div className="w-full h-full flex items-center justify-center text-[9px] font-black bg-slate-200 text-slate-500">{em.name?.charAt(0)}</div>
                                                                }
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-1">
                                                                    <p className={`text-[10px] font-black truncate leading-tight ${String(em.id) === String(user?.id) ? tk.textStrong : tk.textMid}`}>
                                                                        {String(em.id) === String(user?.id) ? 'Tú' : em.name?.split(' ')[0]}
                                                                    </p>
                                                                    {lunchTime && <Utensils size={8} className="text-orange-400 flex-shrink-0" strokeWidth={2.5} title={`Almuerzo ${lunchTime}`} />}
                                                                    {lactationTime && <Baby size={8} className="text-pink-400 flex-shrink-0" strokeWidth={2.5} title={`Lactancia ${lactationTime}`} />}
                                                                </div>
                                                                {String(em.id) === String(user?.id) && d.event ? (() => {
                                                                    const evCfg = {
                                                                        VACATION:   { label: 'Vacaciones', cls: 'text-emerald-600' },
                                                                        DISABILITY: { label: 'Incapacidad', cls: 'text-red-400'   },
                                                                        PERMIT:     { label: 'Permiso',     cls: 'text-amber-400' },
                                                                    }[d.event.type] || { label: d.event.type, cls: tk.textMuted };
                                                                    return <p className={`text-[9px] font-black truncate leading-tight ${evCfg.cls}`}>{evCfg.label}</p>;
                                                                })() : (
                                                                    <p className={`text-[9px] font-medium truncate leading-tight ${tk.textMuted}`}>
                                                                        {shift ? `${formatTime12h(shift.start)}→${formatTime12h(shift.end)}` : 'Sin definir'}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Progress bar horas propias */}
                    {totalWeekHours > 0 && (
                        <div className={`mt-4 pt-3 border-t ${tk.divider}`}>
                            <div className="flex items-center justify-between mb-1.5">
                                <p className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${tk.textMuted}`}>
                                    <Clock size={9} /> Tus horas esta semana
                                </p>
                                <p className={`text-[10px] font-black ${tk.textStrong}`}>{totalWeekHours.toFixed(1)}/44h</p>
                            </div>
                            <div className={`h-1.5 rounded-full overflow-hidden ${tk.progressTrack}`}>
                                <div className={`h-full rounded-full transition-all duration-700 ${tk.progressBar}`}
                                    style={{ width: `${Math.min(100, (totalWeekHours / 44) * 100)}%` }} />
                            </div>
                        </div>
                    )}
                </div>

            </div>

            </>)}
        </div>
        </GlassViewLayout>
    );
};

export default EmployeeHomeView;
