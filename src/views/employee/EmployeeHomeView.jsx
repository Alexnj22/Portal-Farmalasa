import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ClipboardList, Bell, Plus, ChevronRight, Coffee, Loader2, Palmtree } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { formatTime12h } from '../../utils/helpers';

const EmployeeHomeView = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const shifts = useStaffStore(s => s.shifts);
    const employees = useStaffStore(s => s.employees);
    const announcements = useStaffStore(s => s.announcements);

    const [pendingCount, setPendingCount] = useState(null);

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

    // Avisos no leídos que aplican a este empleado
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

    const dayNames = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };
    const today = new Date();
    const todayLabel = dayNames[today.getDay()];
    const todayDate = today.toLocaleDateString('es-VE', { day: '2-digit', month: 'long' });
    const greetHour = today.getHours();
    const greeting = greetHour < 12 ? 'Buenos días' : greetHour < 19 ? 'Buenas tardes' : 'Buenas noches';

    return (
        <div className="px-4 pt-4 pb-6 space-y-4">
            {/* Bienvenida */}
            <div className="relative overflow-hidden bg-gradient-to-br from-[#007AFF] to-[#0055CC] rounded-[2rem] p-6 shadow-[0_8px_30px_rgba(0,122,255,0.3)]">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
                <div className="absolute bottom-0 left-0 w-20 h-20 bg-white/5 rounded-full translate-y-6 -translate-x-4" />
                <div className="relative z-10 flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/40 shadow-md flex-shrink-0">
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
                        <h2 className="text-white text-[20px] font-black leading-tight">{user?.name?.split(' ')[0]}</h2>
                        <p className="text-white/60 text-[11px] mt-0.5">{todayLabel}, {todayDate}</p>
                    </div>
                </div>
            </div>

            {/* Turno de hoy */}
            <div
                className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-[2rem] p-5 shadow-sm cursor-pointer hover:shadow-md transition-all active:scale-[0.98]"
                onClick={() => navigate('/schedule')}
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-emerald-50 rounded-xl">
                            <CalendarDays size={16} className="text-emerald-600" strokeWidth={2.5} />
                        </div>
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Turno de hoy</p>
                    </div>
                    <ChevronRight size={16} className="text-slate-300" />
                </div>
                {todayShift ? (
                    <div className="flex items-center gap-4">
                        <div>
                            <p className="text-[22px] font-black text-slate-800 leading-none">{formatTime12h(todayShift.start)}</p>
                            <p className="text-[11px] text-slate-400 font-medium">Entrada</p>
                        </div>
                        <div className="flex-1 h-px bg-slate-200 relative">
                            <Coffee size={14} className="text-orange-400 absolute left-1/2 -top-2.5 -translate-x-1/2 bg-white" />
                        </div>
                        <div className="text-right">
                            <p className="text-[22px] font-black text-slate-800 leading-none">{formatTime12h(todayShift.end)}</p>
                            <p className="text-[11px] text-slate-400 font-medium">Salida</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 text-slate-400">
                        <Palmtree size={18} strokeWidth={1.5} />
                        <p className="text-[14px] font-bold">Día libre o descanso</p>
                    </div>
                )}
            </div>

            {/* Grid stats */}
            <div className="grid grid-cols-2 gap-3">
                <div
                    className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-[1.75rem] p-4 shadow-sm cursor-pointer hover:shadow-md transition-all active:scale-[0.98]"
                    onClick={() => navigate('/requests')}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 bg-purple-50 rounded-lg">
                            <ClipboardList size={14} className="text-purple-600" strokeWidth={2.5} />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Solicitudes</p>
                    </div>
                    {pendingCount === null ? (
                        <Loader2 size={18} className="text-slate-300 animate-spin" />
                    ) : (
                        <>
                            <p className="text-[28px] font-black text-slate-800 leading-none">{pendingCount}</p>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">pendientes</p>
                        </>
                    )}
                </div>

                <div
                    className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-[1.75rem] p-4 shadow-sm cursor-pointer hover:shadow-md transition-all active:scale-[0.98]"
                    onClick={() => navigate('/announcements')}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 bg-red-50 rounded-lg">
                            <Bell size={14} className="text-red-500" strokeWidth={2.5} />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Avisos</p>
                    </div>
                    <p className="text-[28px] font-black text-slate-800 leading-none">{unreadCount}</p>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">sin leer</p>
                </div>
            </div>

            {/* Acceso rápido */}
            <button
                onClick={() => navigate('/requests')}
                className="w-full flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-[#007AFF] to-[#0055CC] text-white rounded-[1.75rem] font-black text-[13px] shadow-[0_4px_20px_rgba(0,122,255,0.3)] hover:shadow-[0_6px_25px_rgba(0,122,255,0.4)] transition-all active:scale-[0.98]"
            >
                <Plus size={16} strokeWidth={3} /> Nueva Solicitud
            </button>
        </div>
    );
};

export default EmployeeHomeView;
