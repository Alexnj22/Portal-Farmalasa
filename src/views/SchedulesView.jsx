import React, { useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, memo } from 'react';
import { 
    CalendarDays, Clock, LayoutGrid, ChevronLeft, ArrowRight, 
    Palmtree, Edit3, Building2, BookOpen, AlertTriangle, 
    HeartPulse, FileText, ChevronRight, CircleUserRound, Search, X, Filter
} from 'lucide-react';

import { useStaffStore as useStaff } from '../store/staffStore';
import GlassViewLayout from '../components/GlassViewLayout';

// --------------------------------------------------------
// HELPERS LOCALES
// --------------------------------------------------------
const getLocalMonday = (dateStr) => {
    let y, m, day;
    if (!dateStr) {
        const today = new Date();
        y = today.getFullYear(); m = today.getMonth(); day = today.getDate();
    } else {
        const parts = dateStr.split('-');
        y = Number(parts[0]); m = Number(parts[1]) - 1; day = Number(parts[2]);
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
        ev.date <= dateStr && (!ev.metadata?.endDate || ev.metadata.endDate >= dateStr)
    );
    if (!event) return null;
    return { label: event.type, type: event.type };
};

const calculateEmployeeWeeklyHoursLocal = (schedule, shifts, history, calendarDates) => {
    if (!schedule || !shifts) return 0;
    let totalMins = 0;
    [1, 2, 3, 4, 5, 6, 0].forEach((dayId, idx) => {
        const dateStr = calendarDates[idx];
        if (getDayConflictLocal(dateStr, history)) return;
        const dayConf = schedule[dayId];
        if (dayConf?.shiftId) {
            const shift = shifts.find(s => String(s.id) === String(dayConf.shiftId));
            if (shift?.start && shift?.end) {
                const [h1, m1] = shift.start.split(':').map(Number);
                const [h2, m2] = shift.end.split(':').map(Number);
                let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
                if (mins < 0) mins += 1440; 
                if (dayConf.lunchTime) mins -= 60;
                if (dayConf.lactationTime) mins -= 60;
                totalMins += mins;
            }
        }
    });
    return Number((totalMins / 60).toFixed(1));
};

// ============================================================================
// 🚀 VISTA PRINCIPAL
// ============================================================================
const SchedulesView = ({ openModal }) => {
    const { employees, shifts, branches, fetchWeekRosters } = useStaff();
    
    // ESTADOS DE UI
    const [viewMode, setViewMode] = useState('list'); 
    const [filterBranch, setFilterBranch] = useState('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState(getLocalMonday());
    const [weeklyRosters, setWeeklyRosters] = useState({});
    const [isLoading, setIsLoading] = useState(true);

    // ESTADOS CAMALEÓNICOS DE LA PILL
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const [isFilterPickerOpen, setIsFilterPickerOpen] = useState(false);
    const searchInputRef = useRef(null);

    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);
        fetchWeekRosters(startDate).then(data => { 
            if (isMounted) {
                setWeeklyRosters(data || {}); 
                setIsLoading(false);
            }
        });
        return () => { isMounted = false; };
    }, [startDate, fetchWeekRosters]);

    const changeWeek = (days) => {
        const [y, m, d] = startDate.split('-').map(Number);
        const newDate = new Date(y, m - 1, d + days);
        setStartDate(getLocalMonday(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`));
    };

    const calendarDates = useMemo(() => Array.from({length: 7}).map((_, i) => { 
        const [y, m, d] = startDate.split('-').map(Number);
        const cur = new Date(y, m - 1, d + i);
        return `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    }), [startDate]);

    const employeesInView = useMemo(() => {
        return employees
            .filter(e => {
                const bName = branches.find(b => String(b.id) === String(e.branchId || e.branch_id))?.name || '';
                const matchesBranchFilter = filterBranch === 'ALL' || String(e.branchId || e.branch_id) === String(filterBranch);
                const matchesSearch = e.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                     (e.role && e.role.toLowerCase().includes(searchTerm.toLowerCase())) ||
                                     (bName.toLowerCase().includes(searchTerm.toLowerCase()));
                return matchesBranchFilter && matchesSearch;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [employees, filterBranch, searchTerm, branches]);

    // ============================================================================
    // 🎨 RENDER FILTERS (LA PILL CAMALEÓNICA SEGÚN ROLES VIEW)
    // ============================================================================
    const renderFiltersContent = () => (
        <div className={`flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}>
            
            {/* 🔍 ESTADO: BUSCADOR EXPANDIDO (Oculta todo lo demás) */}
            {isSearchExpanded ? (
                <div className="flex items-center w-full h-full px-4 md:px-5 gap-3 animate-in fade-in slide-in-from-right-4 duration-500">
                    <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                    <input 
                        ref={searchInputRef}
                        type="text" 
                        placeholder="Buscar por nombre, sucursal o cargo..." 
                        className="flex-1 bg-transparent border-none outline-none text-[14px] md:text-[15px] font-bold text-slate-700 w-[300px] sm:w-[500px] placeholder:text-slate-400 focus:ring-0" 
                        value={searchTerm} 
                        onChange={(e) => setSearchTerm(e.target.value)} 
                    />
                    {searchTerm && <button onClick={() => setSearchTerm("")} className="p-1 text-slate-400 hover:text-red-500 transition-all"><X size={16} strokeWidth={2.5} /></button>}
                    <button onClick={() => { setIsSearchExpanded(false); setSearchTerm(""); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2"><ChevronRight size={18} strokeWidth={2.5} /></button>
                </div>
            ) : (
                /* 🟢 ESTADO: NAVEGACIÓN NORMAL */
                <div className="flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right px-1 gap-2 md:gap-3 animate-in fade-in slide-in-from-left-4">
                    
                    {/* SELECTOR SUCURSAL (Estilo Roles) */}
                    <div className="flex items-center min-w-0">
                        <div className={`flex items-center transition-all duration-700 ${isFilterPickerOpen ? "max-w-0 opacity-0 pointer-events-none pr-0" : "max-w-[400px] opacity-100 pr-2"}`}>
                            <button onClick={() => setIsFilterPickerOpen(true)} className="px-5 h-10 md:h-11 rounded-full bg-white/70 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.02),inset_0_2px_5px_rgba(255,255,255,0.8)] flex items-center gap-3 hover:bg-white hover:shadow-md hover:-translate-y-0.5 transition-all group active:scale-95">
                                <Building2 size={16} className="text-[#007AFF] group-hover:scale-110 transition-transform" strokeWidth={2.5}/>
                                <span className="text-[11px] md:text-[12px] font-black text-slate-700 uppercase tracking-widest">{branches.find(b => String(b.id) === String(filterBranch))?.name || "Todas"}</span>
                            </button>
                        </div>

                        <div className={`flex items-center transition-all duration-700 gap-2 ${isFilterPickerOpen ? "max-w-[1000px] opacity-100 ml-1" : "max-w-0 opacity-0 pointer-events-none"}`}>
                            <button onClick={() => {setFilterBranch('ALL'); setIsFilterPickerOpen(false);}} className={`h-9 px-5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${filterBranch === 'ALL' ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-md' : 'bg-white/80 text-slate-500 border-white hover:bg-white hover:text-slate-800 hover:-translate-y-0.5'}`}>Todas</button>
                            {branches.map(b => (
                                <button key={b.id} onClick={() => {setFilterBranch(b.id); setIsFilterPickerOpen(false);}} className={`h-9 px-5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${String(filterBranch) === String(b.id) ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-md' : 'bg-white/80 text-slate-500 border-white hover:bg-white hover:text-slate-800 hover:-translate-y-0.5'}`}>{b.name}</button>
                            ))}
                            <button onClick={() => setIsFilterPickerOpen(false)} className="w-9 h-9 rounded-full bg-white text-red-500 flex items-center justify-center shadow-sm border border-red-100 hover:bg-red-500 hover:text-white transition-all"><X size={16} strokeWidth={3}/></button>
                        </div>
                    </div>

                    <div className={`w-px h-6 bg-slate-300/40 mx-1 transition-all duration-500 ${isFilterPickerOpen ? 'opacity-0 scale-0' : 'opacity-100 scale-100'}`}></div>

                    {/* 📅 SELECTOR SEMANA COMPACTO (Hover-First) */}
                    <div className={`group/week flex items-center bg-white/60 backdrop-blur-md rounded-full border border-white/80 shadow-sm p-1 transition-all duration-500 ${isFilterPickerOpen ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[300px] opacity-100 hover:shadow-md'}`}>
                        <div className="w-0 overflow-hidden group-hover/week:w-8 group-hover/week:ml-1 transition-all duration-500 ease-out">
                            <button onClick={() => changeWeek(-7)} className="w-7 h-7 rounded-full flex items-center justify-center text-[#007AFF] hover:bg-white shadow-sm transition-colors active:scale-90"><ChevronLeft size={18} strokeWidth={3}/></button>
                        </div>
                        <div className="flex flex-col items-center px-4 py-1 min-w-[130px]">
                            <span className="text-[7px] font-black uppercase tracking-[0.2em] text-slate-400 leading-none mb-1">Semana</span>
                            <span className="text-[11px] font-black text-[#007AFF] uppercase tracking-tighter">{formatDateLocal(startDate)}</span>
                        </div>
                        <div className="w-0 overflow-hidden group-hover/week:w-8 group-hover/week:mr-1 transition-all duration-500 ease-out">
                            <button onClick={() => changeWeek(7)} className="w-7 h-7 rounded-full flex items-center justify-center text-[#007AFF] hover:bg-white shadow-sm transition-colors active:scale-90"><ArrowRight size={18} strokeWidth={3}/></button>
                        </div>
                    </div>

                    {/* 📑 TABS LISTA/CALENDARIO (Estilo image_9b7167) */}
                    <div className={`relative flex items-center bg-slate-100/40 backdrop-blur-md p-1 rounded-full border border-white shadow-inner transition-all duration-700 ${isFilterPickerOpen ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[400px] opacity-100'}`}>
                        <button onClick={() => setViewMode('list')} className={`relative z-10 px-5 h-9 rounded-full font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 ${viewMode === 'list' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.08)] scale-105 border border-white/50' : 'text-slate-500 hover:text-slate-700'}`}>
                            <LayoutGrid size={14} strokeWidth={2.5}/> Lista
                        </button>
                        <button onClick={() => setViewMode('calendar')} className={`relative z-10 px-5 h-9 rounded-full font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 ${viewMode === 'calendar' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.08)] scale-105 border border-white/50' : 'text-slate-500 hover:text-slate-700'}`}>
                            <CalendarDays size={14} strokeWidth={2.5}/> Calendario
                        </button>
                    </div>

                    {/* 🔍 ACCIONES FINALES (Buscador & Turnos) */}
                    <div className={`flex items-center gap-3 transition-all duration-700 ${isFilterPickerOpen ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[400px] opacity-100'}`}>
                        <button onClick={() => { setIsSearchExpanded(true); setTimeout(() => searchInputRef.current?.focus(), 100); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white border border-white hover:border-[#007AFF]/30 text-[#007AFF] flex items-center justify-center shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all active:scale-95"><Search size={18} strokeWidth={3}/></button>
                        <button onClick={() => openModal && openModal("manageShifts")} className="h-10 md:h-11 px-5 bg-[#007AFF] text-white rounded-full flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] hover:scale-105 active:scale-95 transition-all font-black text-[10px] md:text-[11px] uppercase tracking-widest border-0 whitespace-nowrap"><BookOpen size={16} strokeWidth={2.5}/> Turnos</button>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <GlassViewLayout icon={CalendarDays} title="Gestión de Turnos" filtersContent={renderFiltersContent()} transparentBody={viewMode === 'list'}>
            <div className="w-full flex-1 flex flex-col p-4 animate-in fade-in duration-700">
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 px-2 animate-pulse">
                        {[1,2,3,4,5,6].map(i => <div key={i} className="bg-white/40 border border-white/60 p-8 rounded-[2.8rem] h-[320px] shadow-sm"></div>)}
                    </div>
                ) : (
                    viewMode === 'list' ? (
                        /* VISTA LISTA BENTO DEFINITIVA */
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 animate-in slide-in-from-bottom-6 duration-700">
                            {employeesInView.map(emp => {
                                const schedule = weeklyRosters[emp.id] || emp.weeklySchedule || {};
                                const hours = calculateEmployeeWeeklyHoursLocal(schedule, shifts, emp.history, calendarDates);
                                const bName = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id))?.name || 'S/A';

                                return (
                                    <div key={emp.id} className={`p-8 rounded-[2.8rem] border transition-all duration-500 flex flex-col group relative bg-white/40 backdrop-blur-2xl ${hours > 44 ? 'border-red-200 shadow-red-100/20' : 'border-white/80'} hover:-translate-y-2 hover:shadow-[0_30px_60px_rgba(0,0,0,0.08)]`}>
                                        {hours > 44 && (
                                            <div className="absolute -top-3 right-8 px-4 py-1.5 rounded-full border border-red-200 text-[10px] font-black uppercase flex items-center gap-2 shadow-lg backdrop-blur-xl bg-red-100 text-red-700">
                                                <AlertTriangle size={12} strokeWidth={3}/> Exceso
                                            </div>
                                        )}
                                        <div className="flex justify-between items-start mb-8">
                                            <div className="flex gap-5">
                                                <div className="h-16 w-16 rounded-2xl bg-white border border-slate-100 shadow-[0_4px_12px_rgba(0,0,0,0.05)] overflow-hidden shrink-0 flex items-center justify-center transform group-hover:scale-110 transition-transform duration-500">
                                                    {emp.photo ? <img src={emp.photo} className="w-full h-full object-cover" alt={emp.name} /> : <CircleUserRound size={32} className="text-slate-200" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className="font-black text-slate-800 text-[19px] leading-tight truncate group-hover:text-[#007AFF] transition-colors">{emp.name}</h4>
                                                    <div className="flex items-center gap-2 mt-1.5">
                                                        <span className="bg-white/80 text-[#007AFF] px-3 py-1 rounded-full text-[10px] font-black uppercase border border-blue-50 tracking-widest shadow-sm flex items-center gap-2">
                                                            <Building2 size={12} strokeWidth={3}/> {bName}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button onClick={() => openModal("planSchedule", { employee: emp, schedule, weekStartDate: startDate })} className="w-11 h-11 bg-white border border-slate-100 text-[#007AFF] rounded-full hover:bg-[#007AFF] hover:text-white shadow-sm flex items-center justify-center transition-all hover:scale-110 active:scale-90"><Edit3 size={18} strokeWidth={2.5}/></button>
                                        </div>
                                        <div className="bg-white/60 rounded-[2.2rem] p-7 border border-white shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)] flex flex-col gap-6">
                                            <div className="flex justify-between items-end mb-2.5">
                                                <p className="text-[11px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2"><Clock size={14} className="text-[#007AFF]"/> Carga Semanal</p>
                                                <p className={`text-[24px] font-black tracking-tight ${hours > 44 ? 'text-red-500' : 'text-slate-800'}`}>{hours}h <span className="text-[12px] text-slate-300">/ 44h</span></p>
                                            </div>
                                            <div className="grid grid-cols-7 gap-1.5">
                                                {[1,2,3,4,5,6,0].map((dId, idx) => {
                                                    const works = schedule[dId]?.shiftId;
                                                    return (
                                                        <div key={dId} className={`aspect-square rounded-xl flex items-center justify-center text-[11px] font-black border transition-all ${works ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-md -translate-y-1' : 'bg-slate-50 border-slate-100 text-slate-300'}`}>
                                                            {{1:'L',2:'M',3:'M',4:'J',5:'V',6:'S',0:'D'}[dId]}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        /* VISTA CALENDARIO CRISTAL - TABLA COMPACTA */
                        <div className="bg-white/40 backdrop-blur-3xl rounded-[2.8rem] shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-white/80 overflow-hidden animate-in zoom-in-95 duration-500">
                             <div className="overflow-x-auto hide-scrollbar">
                                <table className="w-full text-left border-collapse min-w-[1400px]">
                                    <thead>
                                        <tr className="bg-slate-50/20">
                                            <th className="p-6 bg-white/95 backdrop-blur-xl sticky left-0 z-30 text-[11px] font-black uppercase text-slate-400 tracking-widest shadow-[8px_0_20px_rgba(0,0,0,0.04)] w-[300px]">Colaborador / Cargo</th>
                                            {calendarDates.map(date => (
                                                <th key={date} className="p-6 border-l border-slate-200/40 text-center min-w-[180px]">
                                                    <div className="text-[10px] uppercase font-black text-slate-400 mb-1.5 tracking-wider">{new Date(date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long' })}</div>
                                                    <div className="text-[26px] font-black text-slate-800 leading-none">{new Date(date + 'T00:00:00').getDate()}</div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100/50">
                                        {employeesInView.map(emp => {
                                            const sch = weeklyRosters[emp.id] || emp.weeklySchedule || {};
                                            const hs = calculateEmployeeWeeklyHoursLocal(sch, shifts, emp.history, calendarDates);
                                            return (
                                                <tr key={emp.id} className="hover:bg-blue-50/10 group transition-colors">
                                                    <td className="p-6 bg-white/95 backdrop-blur-xl sticky left-0 z-20 align-middle shadow-[8px_0_20px_rgba(0,0,0,0.04)]">
                                                        <div className="flex items-center justify-between gap-4">
                                                            <div className="flex items-center gap-4 min-w-0">
                                                                <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-white shadow-sm flex items-center justify-center">
                                                                    {emp.photo ? <img src={emp.photo} className="w-full h-full object-cover" alt="" /> : <CircleUserRound size={24} className="text-slate-300" />}
                                                                </div>
                                                                <div className="min-w-0 flex flex-col">
                                                                    <p className="font-black text-slate-800 text-[14px] truncate leading-tight mb-1">{emp.name}</p>
                                                                    <span className="text-[9px] font-black text-[#007AFF] uppercase px-2 py-0.5 bg-blue-50 border border-blue-100 rounded-md w-fit truncate max-w-[150px]">{emp.role || 'Colaborador'}</span>
                                                                </div>
                                                            </div>
                                                            <button onClick={() => openModal("planSchedule", { employee: emp, schedule: sch, weekStartDate: startDate })} className="w-9 h-9 rounded-full bg-white text-[#007AFF] border border-slate-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-90 shadow-md"><Edit3 size={16} strokeWidth={2.5}/></button>
                                                        </div>
                                                    </td>
                                                    {calendarDates.map(date => {
                                                        const dId = new Date(date + 'T00:00:00').getDay();
                                                        const conf = getDayConflictLocal(date, emp.history);
                                                        const shift = shifts.find(s => String(s.id) === String(sch[dId]?.shiftId));
                                                        return (
                                                            <td key={date} className="p-4 border-l border-slate-100/50 h-[110px] align-top bg-white/5">
                                                                {conf ? (
                                                                    <div className="h-full rounded-2xl bg-orange-50/50 border border-dashed border-orange-200 flex flex-col items-center justify-center text-orange-600 p-2 transform transition-all hover:scale-105"><Palmtree size={22} className="mb-1"/><span className="text-[8px] font-black uppercase text-center">{conf.label}</span></div>
                                                                ) : shift ? (
                                                                    <div className="p-2.5 rounded-xl border bg-blue-50/80 border-blue-200/50 text-[#007AFF] shadow-sm flex flex-col justify-center gap-1 transition-all hover:scale-[1.04]">
                                                                        <span className="text-[9px] font-black uppercase truncate">{shift.name}</span>
                                                                        <div className="text-[10px] font-bold opacity-80 font-mono tracking-tighter">{shift.start} - {shift.end}</div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="h-full w-full rounded-2xl bg-slate-50/30 border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 opacity-60"><span className="text-[9px] font-black uppercase tracking-widest">Descanso</span></div>
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
                    )
                )}
            </div>
        </GlassViewLayout>
    );
};

export default memo(SchedulesView);