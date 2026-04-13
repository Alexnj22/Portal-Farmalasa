import React, { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Coffee, Palmtree } from 'lucide-react';
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

const EVENT_BADGE = {
    VACATION:   { label: 'Vacaciones',  color: 'bg-amber-100 text-amber-700 border-amber-200' },
    DISABILITY: { label: 'Incapacidad', color: 'bg-red-100 text-red-700 border-red-200' },
    PERMIT:     { label: 'Permiso',     color: 'bg-purple-100 text-purple-700 border-purple-200' },
};

const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
};

const toISO = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('T')[0];
};

const EmployeeScheduleView = () => {
    const { user } = useAuth();
    const shifts = useStaffStore(s => s.shifts);
    const employees = useStaffStore(s => s.employees);

    const [weekOffset, setWeekOffset] = useState(0);
    const [scheduleData, setScheduleData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activeEvents, setActiveEvents] = useState([]);

    const emp = employees.find(e => String(e.id) === String(user?.id));

    const weekStart = useMemo(() => {
        const base = getWeekStart(new Date());
        base.setDate(base.getDate() + weekOffset * 7);
        return base;
    }, [weekOffset]);

    const weekStartISO = useMemo(() => toISO(weekStart), [weekStart]);
    const isCurrentWeek = weekOffset === 0;

    // Cargar roster de la semana
    useEffect(() => {
        if (!user?.id) return;

        if (isCurrentWeek && emp?.weeklySchedule) {
            setScheduleData(emp.weeklySchedule);
            return;
        }

        setIsLoading(true);
        setScheduleData(null);
        supabase.from('employee_rosters')
            .select('schedule_data')
            .eq('employee_id', user.id)
            .eq('week_start_date', weekStartISO)
            .maybeSingle()
            .then(({ data }) => {
                setScheduleData(data?.schedule_data || {});
                setIsLoading(false);
            });
    }, [user?.id, weekStartISO, isCurrentWeek, emp?.weeklySchedule]);

    // Cargar eventos activos del empleado en esta semana
    useEffect(() => {
        if (!user?.id) return;
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        supabase.from('employee_events')
            .select('type, date, metadata')
            .eq('employee_id', user.id)
            .in('type', ['VACATION', 'DISABILITY', 'PERMIT'])
            .lte('date', toISO(weekEnd))
            .then(({ data }) => setActiveEvents(data || []));
    }, [user?.id, weekStartISO]);

    const today = useMemo(() => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        return t;
    }, []);

    const days = useMemo(() => {
        return DAYS.map((d, idx) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + idx);
            const dateISO = toISO(date);
            const isToday = date.getTime() === today.getTime();

            const rawShift = scheduleData?.[d.id] ?? scheduleData?.[String(d.id)];
            const shiftId = typeof rawShift === 'object' ? rawShift?.shiftId : rawShift;
            const shift = shiftId && shiftId !== 'LIBRE'
                ? shifts.find(s => String(s.id) === String(shiftId))
                : null;

            const event = activeEvents.find(ev => {
                const meta = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                const start = meta.startDate || ev.date;
                const end = meta.endDate || ev.date;
                return dateISO >= start && dateISO <= end;
            });

            return { ...d, date, dateISO, isToday, shift, event };
        });
    }, [weekStart, scheduleData, shifts, activeEvents, today]);

    const weekLabel = useMemo(() => {
        const end = new Date(weekStart);
        end.setDate(end.getDate() + 6);
        const fmt = (d) => d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
        return `${fmt(weekStart)} — ${fmt(end)}`;
    }, [weekStart]);

    return (
        <div className="px-4 pt-4 pb-6 space-y-4">
            {/* Navegación de semana */}
            <div className="flex items-center justify-between bg-white/70 backdrop-blur-xl border border-white/60 rounded-[1.75rem] px-4 py-3 shadow-sm">
                <button
                    onClick={() => setWeekOffset(v => v - 1)}
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90"
                >
                    <ChevronLeft size={18} strokeWidth={2.5} />
                </button>
                <div className="text-center">
                    <p className="text-[13px] font-black text-slate-800">{weekLabel}</p>
                    {isCurrentWeek && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-[#007AFF]">Semana actual</span>
                    )}
                </div>
                <button
                    onClick={() => setWeekOffset(v => v + 1)}
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90"
                >
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {isLoading ? (
                <div className="space-y-2 animate-in fade-in duration-300">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="rounded-[1.75rem] border border-white/60 bg-white/60 backdrop-blur-md p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-[1rem] animate-pulse bg-slate-200/80 flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <div className="animate-pulse bg-slate-200/80 rounded-full h-3 w-24" />
                                    <div className="animate-pulse bg-slate-200/80 rounded-full h-5 w-32" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="space-y-2">
                    {days.map(d => (
                        <div
                            key={d.id}
                            className={`rounded-[1.75rem] border p-4 transition-all ${
                                d.isToday
                                    ? 'bg-[#007AFF]/5 border-[#007AFF]/30 shadow-[0_0_0_1px_rgba(0,122,255,0.15)]'
                                    : 'bg-white/60 backdrop-blur-md border-white/60'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                {/* Fecha pill */}
                                <div className={`w-12 h-12 rounded-[1rem] flex flex-col items-center justify-center flex-shrink-0 ${
                                    d.isToday ? 'bg-[#007AFF] text-white' : 'bg-slate-100 text-slate-600'
                                }`}>
                                    <span className="text-[8px] font-black uppercase tracking-widest leading-none opacity-70">{d.short}</span>
                                    <span className="text-[16px] font-black leading-tight">{d.date.getDate()}</span>
                                </div>

                                {/* Contenido */}
                                <div className="flex-1 min-w-0">
                                    {d.event ? (
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${EVENT_BADGE[d.event.type]?.color || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                            {EVENT_BADGE[d.event.type]?.label || d.event.type}
                                        </span>
                                    ) : d.shift ? (
                                        <div className="flex items-center gap-3">
                                            <div>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Entrada</p>
                                                <p className="text-[15px] font-black text-slate-800">{formatTime12h(d.shift.start)}</p>
                                            </div>
                                            <Coffee size={12} className="text-orange-400 flex-shrink-0" />
                                            <div>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Salida</p>
                                                <p className="text-[15px] font-black text-slate-800">{formatTime12h(d.shift.end)}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-slate-400">
                                            <Palmtree size={15} strokeWidth={1.5} />
                                            <span className="text-[13px] font-bold">Día libre</span>
                                        </div>
                                    )}
                                </div>

                                {d.isToday && (
                                    <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest bg-[#007AFF] text-white px-2 py-0.5 rounded-full animate-pulse">
                                        Hoy
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default EmployeeScheduleView;
