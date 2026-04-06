import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ClipboardList, Bell, Plus, ChevronRight, Coffee, Loader2, Palmtree, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { formatTime12h } from '../../utils/helpers';

const EVENT_LABELS = { VACATION: 'Vacaciones', DISABILITY: 'Incapacidad', PERMIT: 'Permiso', BIRTHDAY: 'Cumpleaños' };
const EVENT_COLORS = {
    VACATION:   'bg-amber-100 text-amber-700',
    DISABILITY: 'bg-red-100 text-red-700',
    PERMIT:     'bg-purple-100 text-purple-700',
    BIRTHDAY:   'bg-pink-100 text-pink-700',
};

const EmployeeHomeView = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const shifts = useStaffStore(s => s.shifts);
    const employees = useStaffStore(s => s.employees);
    const announcements = useStaffStore(s => s.announcements);

    const [pendingCount, setPendingCount] = useState(null);
    const [upcomingEvents, setUpcomingEvents] = useState([]);

    const emp = employees.find(e => String(e.id) === String(user?.id));

    // Turno de hoy
    const todayShift = useMemo(() => {
        if (!emp?.weeklySchedule) return null;
        const jsDay = new Date().getDay();
        const shiftId = emp.weeklySchedule[jsDay] ?? emp.weeklySchedule[String(jsDay)];
        if (!shiftId || shiftId === 'LIBRE') return null;
        const sid = typeof shiftId === 'object' ? shiftId.shiftId : shiftId;
        return shifts.find(s => String(s.id) === String(sid)) || null;
    }, [emp, shifts]);

    // Avisos no leídos
    const unreadCount = useMemo(() => {
        if (!user) return 0;
        return (announcements || []).filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            const applies =
                a.targetType === 'GLOBAL' ||
                (a.targetType === 'BRANCH' && (a.targetValue || []).includes(String(user.branchId))) ||
                (a.targetType === 'EMPLOYEE' && (a.targetValue || []).includes(String(user.id)));
            if (!applies) return false;
            return !(a.readBy || []).some(r =>
                String(typeof r === 'object' ? r.employeeId : r) === String(user.id)
            );
        }).length;
    }, [announcements, user]);

    // Solicitudes pendientes
    useEffect(() => {
        if (!user?.id) return;
        supabase.from('approval_requests')
            .select('id', { count: 'exact', head: true })
            .eq('employee_id', user.id)
            .eq('status', 'PENDING')
            .then(({ count }) => setPendingCount(count || 0));
    }, [user?.id]);

    // Próximos eventos
    useEffect(() => {
        if (!user?.id) return;
        const today = new Date().toISOString().split('T')[0];
        supabase.from('employee_events')
            .select('id, type, date, metadata')
            .eq('employee_id', user.id)
            .in('type', ['VACATION', 'DISABILITY', 'PERMIT', 'BIRTHDAY'])
            .gte('date', today)
            .order('date', { ascending: true })
            .limit(3)
            .then(({ data }) => setUpcomingEvents(data || []));
    }, [user?.id]);

    const dayNames = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };
    const today = new Date();
    const todayLabel = dayNames[today.getDay()];
    const todayDate = today.toLocaleDateString('es-VE', { day: '2-digit', month: 'long' });
    const greetHour = today.getHours();
    const greeting = greetHour < 12 ? 'Buenos días' : greetHour < 19 ? 'Buenas tardes' : 'Buenas noches';

    return (
        <div className="px-4 lg:px-6 pt-4 pb-6">
        <div className="max-w-5xl mx-auto space-y-4">

            {/* Bienvenida — full width */}
            <div className="relative overflow-hidden bg-gradient-to-br from-[#007AFF] to-[#0055CC] rounded-[2rem] p-6 lg:p-8 shadow-[0_8px_30px_rgba(0,122,255,0.3)]">
                <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-12 translate-x-12" />
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-8 -translate-x-6" />
                <div className="relative z-10 flex items-center gap-4">
                    <div className="w-14 h-14 lg:w-16 lg:h-16 rounded-full overflow-hidden border-2 border-white/40 shadow-md flex-shrink-0">
                        {user?.photo ? (
                            <img src={user.photo} className="w-full h-full object-cover" alt="" />
                        ) : (
                            <div className="w-full h-full bg-white/20 flex items-center justify-center text-white font-black text-xl">
                                {user?.name?.charAt(0)}
                            </div>
                        )}
                    </div>
                    <div>
                        <p className="text-white/70 text-[11px] font-bold uppercase tracking-widest">{greeting}</p>
                        <h2 className="text-white text-[22px] lg:text-[26px] font-black leading-tight">{user?.name?.split(' ')[0]}</h2>
                        <p className="text-white/60 text-[11px] mt-0.5">{todayLabel}, {todayDate}</p>
                    </div>
                </div>
            </div>

            {/* Grid principal */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Turno de hoy — 2 cols en desktop */}
                <div
                    className="lg:col-span-2 bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] cursor-pointer hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all active:scale-[0.98]"
                    onClick={() => navigate('/schedule')}
                >
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-emerald-50 rounded-xl">
                                <CalendarDays size={16} className="text-emerald-600" strokeWidth={2.5} />
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Turno de hoy</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </div>
                    {todayShift ? (
                        <div className="flex items-center gap-6">
                            <div>
                                <p className="text-[28px] lg:text-[34px] font-black text-slate-800 leading-none">{formatTime12h(todayShift.start)}</p>
                                <p className="text-[11px] text-slate-400 font-medium mt-1">Entrada</p>
                            </div>
                            <div className="flex-1 h-px bg-slate-200 relative">
                                <Coffee size={14} className="text-orange-400 absolute left-1/2 -top-2.5 -translate-x-1/2 bg-white" />
                            </div>
                            <div className="text-right">
                                <p className="text-[28px] lg:text-[34px] font-black text-slate-800 leading-none">{formatTime12h(todayShift.end)}</p>
                                <p className="text-[11px] text-slate-400 font-medium mt-1">Salida</p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-slate-400 py-2">
                            <Palmtree size={20} strokeWidth={1.5} />
                            <p className="text-[15px] font-bold">Día libre o descanso</p>
                        </div>
                    )}
                </div>

                {/* Solicitudes pendientes */}
                <div
                    className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] cursor-pointer hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all active:scale-[0.98]"
                    onClick={() => navigate('/requests')}
                >
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                        <ClipboardList size={12} className="text-purple-500" /> Solicitudes
                    </p>
                    {pendingCount === null ? (
                        <Loader2 size={20} className="text-slate-300 animate-spin" />
                    ) : (
                        <>
                            <p className="text-[40px] font-black text-slate-800 leading-none">{pendingCount}</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-1">pendientes de respuesta</p>
                        </>
                    )}
                </div>

                {/* Avisos sin leer */}
                <div
                    className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] cursor-pointer hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all active:scale-[0.98]"
                    onClick={() => navigate('/announcements')}
                >
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                        <Bell size={12} className="text-red-500" /> Avisos
                    </p>
                    <p className="text-[40px] font-black text-slate-800 leading-none">{unreadCount}</p>
                    <p className="text-[11px] text-slate-400 font-medium mt-1">sin leer</p>
                </div>

                {/* Próximos eventos — 2 cols */}
                <div className="lg:col-span-2 bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-1.5">
                        <Sparkles size={12} className="text-amber-500" /> Próximos Eventos
                    </p>
                    {upcomingEvents.length === 0 ? (
                        <p className="text-[13px] text-slate-400 font-medium">Sin eventos próximos registrados.</p>
                    ) : (
                        <div className="space-y-2">
                            {upcomingEvents.map(ev => (
                                <div key={ev.id} className="flex items-center gap-3">
                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${EVENT_COLORS[ev.type] || 'bg-slate-100 text-slate-600'}`}>
                                        {EVENT_LABELS[ev.type] || ev.type}
                                    </span>
                                    <span className="text-[12px] text-slate-600 font-medium">
                                        {new Date(ev.date + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Botón Nueva Solicitud */}
                <button
                    onClick={() => navigate('/requests')}
                    className="flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-[#007AFF] to-[#0055CC] text-white rounded-[1.75rem] font-black text-[13px] shadow-[0_4px_20px_rgba(0,122,255,0.3)] hover:shadow-[0_6px_25px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 transition-all active:scale-[0.98]"
                >
                    <Plus size={16} strokeWidth={3} /> Nueva Solicitud
                </button>

            </div>
        </div>
        </div>
    );
};

export default EmployeeHomeView;
