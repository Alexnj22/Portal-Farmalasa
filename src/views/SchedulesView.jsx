import React, { useState, useMemo, useEffect } from 'react';
import { 
    CalendarDays, Clock, LayoutList, LayoutGrid, 
    ChevronLeft, ArrowRight, Palmtree, Baby,
    Edit3, Building2, User, BookOpen, AlertTriangle, Info,
    HeartPulse, Utensils, ShieldAlert, FileText
} from 'lucide-react';

import { useStaffStore as useStaff } from '../store/staffStore';
import BranchChips from '../components/common/BranchChips';

// --------------------------------------------------------
// HELPERS LOCALES 
// --------------------------------------------------------

const getLocalMonday = (dateStr) => {
    let y, m, day;
    if (!dateStr) {
        const today = new Date();
        y = today.getFullYear();
        m = today.getMonth();
        day = today.getDate();
    } else {
        const parts = dateStr.split('-');
        y = Number(parts[0]);
        m = Number(parts[1]) - 1;
        day = Number(parts[2]);
    }
    const d = new Date(y, m, day);
    const dayOfWeek = d.getDay();
    const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    d.setDate(diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDateLocal = (dateStr) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
};

const formatTime12hLocal = (timeString) => {
    if (!timeString) return '';
    const [hourStr, minStr] = timeString.split(':');
    let hour = parseInt(hourStr, 10);
    const ampm = hour >= 12 ? 'P.M.' : 'A.M.';
    hour = hour % 12 || 12;
    return `${hour}:${minStr} ${ampm}`;
};

const minsToTime12h = (totalMins) => {
    let mins = totalMins % 1440; 
    let h = Math.floor(mins / 60);
    let m = mins % 60;
    const ampm = h >= 12 ? 'P.M.' : 'A.M.';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
};

const getDayConflictLocal = (dateStr, history) => {
    const event = (history || []).find(ev => 
        ['VACATION', 'DISABILITY', 'PERMISSION'].includes(ev.type) &&
        ev.date <= dateStr &&
        (!ev.metadata?.endDate || ev.metadata.endDate >= dateStr)
    );
    if (!event) return null;
    const labels = { VACATION: 'VACACIONES', DISABILITY: 'INCAPACIDAD', PERMISSION: 'PERMISO' };
    const icons = { VACATION: Palmtree, DISABILITY: HeartPulse, PERMISSION: FileText };
    const colors = { VACATION: 'orange', DISABILITY: 'red', PERMISSION: 'blue' };
    return { label: labels[event.type], icon: icons[event.type], color: colors[event.type], type: event.type };
};

const calculateEmployeeWeeklyHoursLocal = (schedule, shifts, history, calendarDates) => {
    if (!schedule || !shifts) return 0;
    let totalMins = 0;
    
    [1, 2, 3, 4, 5, 6, 0].forEach((dayId, idx) => {
        const dateStr = calendarDates[idx];
        if (getDayConflictLocal(dateStr, history)) return;

        const dayConf = schedule[dayId];
        if (dayConf && dayConf.shiftId) {
            const shift = shifts.find(s => String(s.id) === String(dayConf.shiftId));
            if (shift && shift.start && shift.end) {
                const [h1, m1] = shift.start.split(':').map(Number);
                const [h2, m2] = shift.end.split(':').map(Number);
                let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
                if (mins < 0) mins += 24 * 60; 
                if (dayConf.lunchTime) mins -= 60; 
                if (dayConf.lactationTime) mins -= 60; 
                totalMins += mins;
            }
        }
    });
    return Number((totalMins / 60).toFixed(1));
};

const getDaySegmentsLocal = (shift, conf) => {
    if (!shift || !shift.start || !shift.end) return [];
    const timeToMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const startMins = timeToMins(shift.start);
    let endMins = timeToMins(shift.end);
    if (endMins <= startMins) endMins += 1440; 
    let events = [];
    if (conf.lunchTime) { const lStart = timeToMins(conf.lunchTime); events.push({ type: 'lunch', label: 'Almuerzo', start: lStart, end: lStart + 60 }); }
    if (conf.lactationTime) { const lacStart = timeToMins(conf.lactationTime); events.push({ type: 'lactation', label: 'Lactancia', start: lacStart, end: lacStart + 60 }); }
    events.sort((a, b) => a.start - b.start);
    const segments = [];
    let currentMins = startMins;
    events.forEach(ev => {
        if (currentMins < ev.start) segments.push({ type: 'work', label: shift.name, start: currentMins, end: ev.start });
        segments.push(ev);
        currentMins = ev.end;
    });
    if (currentMins < endMins) segments.push({ type: 'work', label: shift.name, start: currentMins, end: endMins });
    const lastWorkIdx = segments.reduce((last, seg, idx) => seg.type === 'work' ? idx : last, -1);
    if (lastWorkIdx !== -1) segments[lastWorkIdx].isLastWork = true;
    return segments;
};

const getDailyHoursLocal = (dayConf, shifts) => {
    if (!dayConf || !dayConf.shiftId) return 0;
    const shift = shifts.find(s => String(s.id) === String(dayConf.shiftId));
    if (!shift || !shift.start || !shift.end) return 0;
    const [h1, m1] = shift.start.split(':').map(Number);
    const [h2, m2] = shift.end.split(':').map(Number);
    let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (mins < 0) mins += 24 * 60;
    if (dayConf.lunchTime) mins -= 60;
    if (dayConf.lactationTime) mins -= 60;
    return Number((mins / 60).toFixed(1));
};

const SchedulesView = ({ openModal }) => {
    const { employees, shifts, branches, fetchWeekRosters } = useStaff();
    const [viewMode, setViewMode] = useState('list'); 
    const [filterBranch, setFilterBranch] = useState('ALL');
    const [startDate, setStartDate] = useState(getLocalMonday());
    const [weeklyRosters, setWeeklyRosters] = useState({});

    useEffect(() => {
        let isMounted = true;
        fetchWeekRosters(startDate).then(data => { if (isMounted) setWeeklyRosters(data || {}); });
        return () => { isMounted = false; };
    }, [startDate, fetchWeekRosters]);

    const changeWeek = (days) => {
        const [y, m, d] = startDate.split('-').map(Number);
        const newDate = new Date(y, m - 1, d + days);
        setStartDate(getLocalMonday(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`));
    };

    const calendarDates = Array.from({length: 7}).map((_, i) => { 
        const [y, m, d] = startDate.split('-').map(Number);
        const cur = new Date(y, m - 1, d + i);
        return `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    });

    const employeesInView = useMemo(() => {
        let filtered = employees.filter(e => filterBranch === 'ALL' || (e.branchId || e.branch_id) === parseInt(filterBranch));
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
    }, [employees, filterBranch]);

    const getEffectiveSchedule = (emp) => {
        if (weeklyRosters[emp.id]) return weeklyRosters[emp.id];
        return emp.weeklySchedule || {};
    };

    const getEmployeeStatus = (emp, totalHs) => {
        const today = new Date().toISOString().split('T')[0];
        const activeEvent = (emp.history || []).find(ev => 
            ['VACATION', 'DISABILITY'].includes(ev.type) && 
            ev.date <= today && 
            (!ev.metadata?.endDate || ev.metadata.endDate >= today)
        );
        if (activeEvent) {
            const isVacation = activeEvent.type === 'VACATION';
            return {
                level: 'critical',
                message: isVacation ? 'Vacaciones' : 'Incapacidad',
                cardStyles: isVacation ? 'border-orange-400 bg-orange-50/40' : 'border-red-400 bg-red-50/40',
                badgeStyles: isVacation ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700',
                icon: isVacation ? Palmtree : HeartPulse
            };
        }
        if (totalHs > 44) return { level: 'warning', message: 'Horas Extra', cardStyles: 'border-red-400', badgeStyles: 'bg-red-100 text-red-700', icon: AlertTriangle };
        return { level: 'ok', message: 'Al día', cardStyles: 'border-white/80 shadow-sm', badgeStyles: 'hidden', icon: null };
    };

    return (
        <div className="p-4 md:p-8 font-sans animate-in fade-in duration-500 max-w-[1600px] mx-auto">
            <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-[1rem] bg-[#007AFF] text-white flex items-center justify-center shadow-[0_8px_20px_rgba(0,122,255,0.3)]">
                        <CalendarDays size={24} strokeWidth={1.5} />
                    </div>
                    <div>
                        <h1 className="text-[26px] font-black text-slate-800 tracking-tight leading-none">Planificador de Turnos</h1>
                        <p className="text-slate-500 text-[13px] font-bold mt-1">Asigna horarios, días libres y ausencias.</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => openModal && openModal("manageShifts")} className="h-11 px-5 rounded-[1rem] bg-white text-[#007AFF] font-bold text-[11px] uppercase tracking-widest shadow-sm border border-[#007AFF]/20 hover:bg-[#007AFF]/5 flex items-center gap-2"><BookOpen size={16} /> Catálogo de Turnos</button>
                    <div className="relative flex items-center bg-black/[0.04] p-1.5 rounded-[1.2rem] border border-black/[0.05]">
                        <div className="absolute top-1.5 bottom-1.5 w-[120px] bg-white rounded-xl shadow-sm border border-slate-100 transition-transform duration-500" style={{ transform: viewMode === 'list' ? 'translateX(0)' : 'translateX(100%)' }}></div>
                        <button onClick={() => setViewMode('list')} className={`relative z-10 w-[120px] py-2.5 rounded-xl font-bold text-[11px] uppercase transition-colors ${viewMode === 'list' ? 'text-[#007AFF]' : 'text-slate-500'}`}>Lista</button>
                        <button onClick={() => setViewMode('calendar')} className={`relative z-10 w-[120px] py-2.5 rounded-xl font-bold text-[11px] uppercase transition-colors ${viewMode === 'calendar' ? 'text-[#007AFF]' : 'text-slate-500'}`}>Calendario</button>
                    </div>
                </div>
            </header>

            <div className="mb-6"><BranchChips branches={branches} selectedBranch={filterBranch} onSelect={setFilterBranch} /></div>

            {viewMode === 'calendar' ? (
                <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden flex flex-col">
                    <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-white/50 relative">
                        <div className="flex items-center gap-2.5 pl-3"><CalendarDays size={18} className="text-[#007AFF]" /><h3 className="text-[13px] font-black text-slate-800 uppercase tracking-widest">Horario Semanal</h3></div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => changeWeek(-7)} className="p-1.5 text-slate-400 hover:text-[#007AFF]"><ChevronLeft size={18}/></button>
                            <div className="flex flex-col items-center min-w-[190px]"><span className="text-[8px] font-black uppercase text-slate-400 mb-0.5">Semana Seleccionada</span><span className="font-black text-[#007AFF] uppercase text-[11px]">{formatDateLocal(startDate)} AL {formatDateLocal(calendarDates[6])}</span></div>
                            <button onClick={() => changeWeek(7)} className="p-1.5 text-slate-400 hover:text-[#007AFF]"><ArrowRight size={18}/></button>
                        </div>
                    </div>
                    <div className="overflow-x-auto pb-4">
                        <table className="w-full text-left border-collapse min-w-[1300px]">
                            <thead>
                                <tr>
                                    <th className="p-3 border-b border-slate-200 bg-white sticky left-0 z-20 text-[9px] font-black uppercase text-slate-400 tracking-widest shadow-[4px_0_12px_rgba(0,0,0,0.03)]">Colaborador</th>
                                    {calendarDates.map(date => (<th key={date} className="p-3 border-b border-l border-slate-100 bg-slate-50/50 text-center min-w-[160px]"><div className="text-[9px] uppercase font-black text-slate-400 mb-0.5">{new Date(date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long' })}</div><div className="text-xl font-black text-slate-800">{new Date(date + 'T00:00:00').getDate()}</div></th>))}
                                </tr>
                            </thead>
                            <tbody>
                                {employeesInView.map(emp => {
                                    const effectiveSchedule = getEffectiveSchedule(emp);
                                    const totalHours = calculateEmployeeWeeklyHoursLocal(effectiveSchedule, shifts, emp.history, calendarDates);
                                    return (
                                        <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors group">
                                            <td className="p-4 border-b border-slate-100 bg-white sticky left-0 z-10 group-hover:bg-slate-50 transition-colors shadow-[4px_0_12px_rgba(0,0,0,0.03)]">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-slate-100 border border-white shadow-sm flex items-center justify-center overflow-hidden flex-shrink-0 text-slate-400 font-bold">{emp.photo ? <img src={emp.photo} className="w-full h-full object-cover" /> : emp.name.charAt(0)}</div>
                                                        <div className="min-w-0 pr-2"><p className="font-bold text-slate-800 text-[12px] truncate">{emp.name}</p><div className={`inline-flex px-2 py-0.5 border rounded-md text-[8px] font-black tracking-widest shadow-sm ${totalHours > 44 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>{totalHours}H ASIGNADAS</div></div>
                                                    </div>
                                                    <button onClick={() => openModal && openModal("planSchedule", { employee: emp, schedule: effectiveSchedule, weekStartDate: startDate })} className="w-8 h-8 rounded-xl bg-[#007AFF]/10 text-[#007AFF] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-[#007AFF] hover:text-white"><Edit3 size={14}/></button>
                                                </div>
                                            </td>
                                            {calendarDates.map(date => {
                                                const jsDay = new Date(date + 'T00:00:00').getDay();
                                                const dbDay = jsDay === 0 ? 0 : jsDay; 
                                                const conflict = getDayConflictLocal(date, emp.history);
                                                const confForDay = effectiveSchedule[dbDay] || {};
                                                const shift = confForDay.shiftId ? shifts.find(s => String(s.id) === String(confForDay.shiftId)) : null;
                                                const timeSegments = shift ? getDaySegmentsLocal(shift, confForDay) : [];
                                                const dailyHrs = getDailyHoursLocal(confForDay, shifts);

                                                return (
                                                    <td key={date} className="p-2.5 border-l border-b border-slate-100 h-24 align-top bg-white">
                                                        {conflict ? (
                                                            <div className={`flex flex-col items-center justify-center h-full rounded-xl bg-${conflict.color}-50 border border-dashed border-${conflict.color}-200 p-2 text-${conflict.color}-600`}>
                                                                <conflict.icon size={20} className="mb-1" />
                                                                <span className="text-[9px] font-black uppercase text-center">{conflict.label}</span>
                                                            </div>
                                                        ) : shift ? (
                                                            <div className="flex flex-col h-full gap-1.5">
                                                                {timeSegments.map((seg, idx) => (
                                                                    <div key={idx} className={`p-2 rounded-xl border font-black uppercase tracking-wider flex flex-col gap-1 shadow-sm ${seg.type === 'work' ? 'bg-[#007AFF]/5 text-[#007AFF] border-[#007AFF]/15' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                                                                        <div className="flex justify-between items-center"><span className="text-[9px] truncate">{seg.label}</span>{seg.isLastWork && <span className="bg-[#007AFF] text-white px-1 py-0.5 rounded text-[8px]">{dailyHrs}h Total</span>}</div>
                                                                        <div className="flex items-center gap-1 text-[8.5px] opacity-80 font-mono tracking-tighter"><Clock size={10}/> {minsToTime12h(seg.start)} - {minsToTime12h(seg.end)}</div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="h-full w-full rounded-xl bg-slate-50 border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 gap-1.5 opacity-70 p-3"><Palmtree size={16}/><span className="text-[9px] font-black uppercase">Descanso</span></div>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {employeesInView.map(emp => {
                        const effectiveSchedule = getEffectiveSchedule(emp);
                        const totalHs = calculateEmployeeWeeklyHoursLocal(effectiveSchedule, shifts, emp.history, calendarDates);
                        const status = getEmployeeStatus(emp, totalHs);
                        const branchName = branches.find(b => b.id === (emp.branchId || emp.branch_id))?.name || 'Sin Asignar';
                        return (
                            <div key={emp.id} className={`bg-white/60 backdrop-blur-xl p-6 rounded-[2rem] border hover:-translate-y-1 transition-all duration-300 flex flex-col group relative ${status.cardStyles}`}>
                                {status.level !== 'ok' && (<div className="absolute -top-3 right-6 flex items-center gap-2 z-10"><div className={`px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase flex items-center gap-1.5 shadow-sm backdrop-blur-md ${status.badgeStyles}`}>{status.icon && <status.icon size={12} strokeWidth={2.5} />}{status.message}</div></div>)}
                                <div className="flex justify-between items-start mb-5 pt-1"><div className="flex gap-4 items-center"><div className="h-12 w-12 rounded-[1rem] bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center font-bold text-slate-400 overflow-hidden">{emp.photo ? <img src={emp.photo} className="w-full h-full object-cover" /> : <User size={20} />}</div><div><h4 className="font-bold text-slate-800 text-[15px] leading-none mb-1 group-hover:text-[#007AFF]">{emp.name}</h4><div className="flex items-center gap-1.5 mt-1.5 bg-[#007AFF]/10 text-[#007AFF] px-2 py-0.5 rounded-md text-[8px] font-black uppercase border border-[#007AFF]/20"><Building2 size={10} /> {branchName}</div></div></div><button onClick={() => openModal && openModal("planSchedule", { employee: emp, schedule: effectiveSchedule, weekStartDate: startDate })} className="w-9 h-9 bg-[#007AFF]/5 text-[#007AFF] rounded-xl hover:bg-[#007AFF] hover:text-white flex items-center justify-center shadow-sm"><Edit3 size={16}/></button></div>
                                <div className="flex-1 bg-white/40 rounded-[1.2rem] p-4 border border-slate-100"><div className="flex justify-between items-end mb-3"><p className="text-[9px] text-slate-500 font-black uppercase">Carga Semanal</p><p className={`text-[18px] font-black tracking-tighter ${totalHs > 44 ? 'text-red-500' : 'text-slate-800'}`}>{totalHs}h <span className="text-[10px] font-bold text-slate-400">/ 44h</span></p></div><div className="w-full h-1.5 bg-slate-200/50 rounded-full overflow-hidden mb-4"><div className={`h-full rounded-full transition-all duration-1000 ${totalHs > 44 ? 'bg-red-500' : 'bg-[#007AFF]'}`} style={{ width: `${Math.min((totalHs / 44) * 100, 100)}%` }}></div></div><div className="flex justify-between gap-1">{[1,2,3,4,5,6,0].map((dayId, idx) => { const conflict = getDayConflictLocal(calendarDates[idx], emp.history); const isWork = effectiveSchedule[dayId]?.shiftId && !conflict; return (<div key={dayId} className={`flex-1 aspect-square rounded-lg flex items-center justify-center text-[9px] font-black transition-all ${isWork ? 'bg-[#007AFF] text-white shadow-sm' : conflict ? `bg-${conflict.color}-100 text-${conflict.color}-600` : 'bg-white border border-slate-200 text-slate-300'}`}>{{1:'L',2:'M',3:'M',4:'J',5:'V',6:'S',0:'D'}[dayId]}</div>); })}</div></div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SchedulesView;