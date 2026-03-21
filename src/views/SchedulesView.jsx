import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import {
    CalendarDays, ChevronLeft, ArrowRight, Building2, BookOpen,
    HeartPulse, ChevronRight, Search, X, Sparkles, Save, Loader2, ArrowLeft
} from 'lucide-react';

import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import GlassViewLayout from '../components/GlassViewLayout';
import TabShifts from './schedule-tabs/TabShifts';
import LiquidSelect from '../components/common/LiquidSelect';

// 🚀 HELPERS
import { getLocalMonday, formatDateLocal, DAY_NAMES, calculateEmployeeWeeklyHoursLocal, timeToMins, parseTimeFlexible, formatHourAMPM } from '../utils/scheduleHelpers';

// 🚀 COMPONENTES EXTRAÍDOS
import InlineDayEditor from './schedule-tabs/components/InlineDayEditor';
import ScheduleChart from './schedule-tabs/components/ScheduleChart';
import SalyCopilot from './schedule-tabs/components/SalyCopilot';
import ScheduleCalendar from './schedule-tabs/components/ScheduleCalendar';

const SchedulesView = ({ openModal, setView }) => {
    const { employees, shifts, branches, fetchWeekRosters, publishWeekRosters } = useStaff();
    const [isPublishing, setIsPublishing] = useState(false);

    const [viewMode, setViewMode] = useState('calendar');
    const [filterBranch, setFilterBranch] = useState('');
    
    const [shiftTab, setShiftTab] = useState('ACTIVE');
    const [shiftSearch, setShiftSearch] = useState('');
    
    const [statusFilter, setStatusFilter] = useState('ACTIVE');
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState(getLocalMonday());
    const [weeklyRosters, setWeeklyRosters] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);

    const [editingCell, setEditingCell] = useState(null);
    const searchInputRef = useRef(null);

    const [chartView, setChartView] = useState('DAYS');
    const [salesStats, setSalesStats] = useState({ generalHours: [], days: [], specificHours: {}, maxAvgDays: 0, maxAvgGeneralHours: 0 });
    const [isLoadingSales, setIsLoadingSales] = useState(false);

    const [salyDynamicAlerts, setSalyDynamicAlerts] = useState([]);

    useEffect(() => {
        if (branches && branches.length > 0 && !filterBranch) {
            const popular = branches.find(b => b.name.toLowerCase().includes('popular'));
            if (popular) setFilterBranch(String(popular.id));
            else setFilterBranch(String(branches[0].id));
        }
    }, [branches, filterBranch]);

    const isDefaultWeek = useMemo(() => startDate === getLocalMonday(), [startDate]);
    const isPastWeek = useMemo(() => startDate < getLocalMonday(), [startDate]);
    const isBranchSelected = filterBranch !== '';

    const handleResetFilters = useCallback(() => {
        setStartDate(getLocalMonday());
        setSearchTerm('');
    }, []);

    const changeWeek = useCallback((daysToAdd) => {
        setStartDate(prev => {
            const [y, m, d] = prev.split('-').map(Number);
            const nextDate = new Date(y, m - 1, d + daysToAdd);
            return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
        });
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (isSearchExpanded) { 
                    setIsSearchExpanded(false); 
                    setSearchTerm(''); 
                    setShiftSearch(''); 
                }
                if (editingCell) setEditingCell(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSearchExpanded, editingCell]);

    useEffect(() => {
        if (window.innerWidth >= 1024) {
            setTimeout(() => {
                if (viewMode === 'calendar') {
                    window.dispatchEvent(new CustomEvent('set-sidebar', { detail: false }));
                } else {
                    window.dispatchEvent(new CustomEvent('set-sidebar', { detail: true }));
                }
            }, 50);
        }
    }, [viewMode]);
    
    useEffect(() => {
        let isMounted = true;
        const loadRosters = (isSilent = false) => {
            if (viewMode === 'shifts' || !filterBranch) return;
            
            if (!isSilent) {
                setIsLoading(true);
                setWeeklyRosters({}); 
            }
            
            fetchWeekRosters(startDate).then(data => {
                if (isMounted) {
                    setWeeklyRosters(data || {});
                    if (!isSilent) setIsLoading(false);
                }
            });
        };
        
        loadRosters(false);
        const handleRefresh = () => loadRosters(true);
        window.addEventListener('force-history-refresh', handleRefresh);
        return () => { isMounted = false; window.removeEventListener('force-history-refresh', handleRefresh); };
    }, [startDate, fetchWeekRosters, viewMode, filterBranch]);

    const calendarDates = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
        const [y, m, d] = startDate.split('-').map(Number);
        const cur = new Date(y, m - 1, d + i);
        return `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    }), [startDate]);

    useEffect(() => {
        if (!filterBranch || viewMode === 'shifts') return;
        const fetchSales = async () => {
            setIsLoadingSales(true);
            try {
                const standardDaysBack = 90; 
                const today = new Date();
                today.setDate(today.getDate() - standardDaysBack);
                const dateStr = today.toISOString().split('T')[0];

                const { data: rawSalesData, error } = await supabase
                    .from('branch_hourly_sales')
                    .select('*')
                    .eq('branch_id', filterBranch)
                    .gte('sale_date', dateStr);

                if (error) throw error;

                let openH = 7; let closeH = 18; 
                const currentBranch = branches.find(b => String(b.id) === String(filterBranch));
                
                if (currentBranch) {
                    const sch = currentBranch.weeklyHours || currentBranch.weekly_hours || currentBranch.settings?.schedule;
                    if (sch && typeof sch === 'object') {
                        let minOpen = 1440; let maxClose = 0;
                        Object.values(sch).forEach(d => {
                            if (d && d.open && d.close && !d.isClosed && !d.isOff) {
                                const oMins = parseTimeFlexible(d.open);
                                const cMins = parseTimeFlexible(d.close);
                                if (oMins < minOpen) minOpen = oMins;
                                if (cMins > maxClose) maxClose = cMins;
                            }
                        });
                        if (minOpen < 1440) {
                            openH = Math.floor(minOpen / 60); 
                        }
                        if (maxClose > 0) {
                            closeH = Math.ceil(maxClose / 60) - 1;
                        }
                    }
                }

                if (closeH <= openH) closeH = openH + 11; 

                const daysMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 0: 0 };
                const hourlyMap = {};
                const specificHourlyMap = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 0: {} };
                const uniqueDates = new Set();
                const uniqueDatesByDay = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set(), 6: new Set(), 0: new Set() };
                
                const validHistoricalData = (rawSalesData || []).filter(row => {
                    const hour = Number(row.sale_hour);
                    return hour >= openH && hour <= closeH;
                });

                validHistoricalData.forEach(row => {
                    const h = Number(row.sale_hour);
                    const dStr = row.sale_date;
                    const dNum = new Date(dStr + 'T00:00:00').getDay();
                    const count = Number(row.transaction_count || 0);

                    daysMap[dNum] += count;
                    if (!hourlyMap[h]) hourlyMap[h] = 0;
                    hourlyMap[h] += count;
                    if (!specificHourlyMap[dNum][h]) specificHourlyMap[dNum][h] = 0;
                    specificHourlyMap[dNum][h] += count;

                    uniqueDates.add(dStr);
                    uniqueDatesByDay[dNum].add(dStr);
                });

                let maxHistoricalAvgDay = 0;
                [0,1,2,3,4,5,6].forEach(d => {
                    const count = uniqueDatesByDay[d].size || 1;
                    const avg = daysMap[d] / count;
                    if (avg > maxHistoricalAvgDay) maxHistoricalAvgDay = avg;
                });

                let maxHistoricalAvgHourGeneral = 0;
                const totalDays = uniqueDates.size || 1;
                for (let h = openH; h <= closeH; h++) {
                    const avg = (hourlyMap[h] || 0) / totalDays;
                    if (avg > maxHistoricalAvgHourGeneral) maxHistoricalAvgHourGeneral = avg;
                }

                let maxSpecificAvgHour = 0;
                [0,1,2,3,4,5,6].forEach(d => {
                    const dCount = uniqueDatesByDay[d].size || 1;
                    for (let h = openH; h <= closeH; h++) {
                        const avg = (specificHourlyMap[d][h] || 0) / dCount;
                        if (avg > maxSpecificAvgHour) maxSpecificAvgHour = avg;
                    }
                });

                const absoluteStandardDaily = Math.max(maxHistoricalAvgDay, 1);
                const absoluteStandardHourlyGeneral = Math.max(maxHistoricalAvgHourGeneral, 1);
                const absoluteStandardHourlySpecific = Math.max(maxSpecificAvgHour, 1);

                const finalDays = [1, 2, 3, 4, 5, 6, 0].map(d => {
                    const dCount = uniqueDatesByDay[d].size || 1; 
                    const avg = dCount > 0 ? Math.round((daysMap[d] || 0) / dCount) : 0;
                    return { day: d, avg, label: DAY_NAMES[d] };
                });

                const finalGeneralHours = [];
                for (let h = openH; h <= closeH; h++) {
                    const avg = totalDays > 0 ? Math.round((hourlyMap[h] || 0) / totalDays) : 0;
                    finalGeneralHours.push({ hour: h, avg, label: formatHourAMPM(h) });
                }

                const finalSpecificHours = {};
                [1, 2, 3, 4, 5, 6, 0].forEach(d => {
                    finalSpecificHours[d] = [];
                    const dCount = uniqueDatesByDay[d].size || 1;
                    for (let h = openH; h <= closeH; h++) {
                        const avg = dCount > 0 ? Math.round((specificHourlyMap[d][h] || 0) / dCount) : 0;
                        finalSpecificHours[d].push({ hour: h, avg, label: formatHourAMPM(h) });
                    }
                });

                const applyColorsHistorical = (arr, standard) => {
                    const maxInCurrentSet = Math.max(...arr.map(o => o.avg), 1);
                    return arr.map(item => {
                        const colorIntensity = standard > 0 ? item.avg / standard : 0;
                        
                        if (colorIntensity >= 0.85) item.color = '#FF2D55'; 
                        else if (colorIntensity >= 0.60) item.color = '#FF9500'; 
                        else if (colorIntensity >= 0.20) item.color = '#007AFF'; 
                        else item.color = '#94A3B8'; 
                        
                        const heightIntensity = maxInCurrentSet > 0 ? item.avg / maxInCurrentSet : 0;
                        item.height = heightIntensity > 0 ? `${Math.max(heightIntensity * 100, 15)}%` : '0%';
                        return item;
                    });
                };

                setSalesStats({
                    days: applyColorsHistorical(finalDays, absoluteStandardDaily),
                    generalHours: applyColorsHistorical(finalGeneralHours, absoluteStandardHourlyGeneral),
                    specificHours: {
                        1: applyColorsHistorical(finalSpecificHours[1], absoluteStandardHourlySpecific),
                        2: applyColorsHistorical(finalSpecificHours[2], absoluteStandardHourlySpecific),
                        3: applyColorsHistorical(finalSpecificHours[3], absoluteStandardHourlySpecific),
                        4: applyColorsHistorical(finalSpecificHours[4], absoluteStandardHourlySpecific),
                        5: applyColorsHistorical(finalSpecificHours[5], absoluteStandardHourlySpecific),
                        6: applyColorsHistorical(finalSpecificHours[6], absoluteStandardHourlySpecific),
                        0: applyColorsHistorical(finalSpecificHours[0], absoluteStandardHourlySpecific),
                    }
                });

            } catch (err) {
                console.error("Error cargando ventas WFM:", err);
            } finally {
                setIsLoadingSales(false);
            }
        };
        fetchSales();
    }, [filterBranch, viewMode, branches]); 

    const employeesInView = useMemo(() => {
        const roleWeight = (role) => {
            const r = (role || '').toUpperCase();
            if (r.includes('GERENTE') || (r.includes('JEFE') && !r.includes('SUB'))) return 1;
            if (r.includes('SUBJEFE')) return 2;
            if (r.includes('REGENTE')) return 3;
            if (r.includes('DEPENDIENTE')) return 4;
            return 5;
        };

        return employees
            .filter(e => {
                const matchesBranch = String(e.branchId || e.branch_id) === String(filterBranch);
                if (!matchesBranch) return false;
                if (!searchTerm) return true;
                return e.name.toLowerCase().includes(searchTerm.toLowerCase()) || (e.role && e.role.toLowerCase().includes(searchTerm.toLowerCase()));
            })
            .sort((a, b) => {
                const weightA = roleWeight(a.role);
                const weightB = roleWeight(b.role);
                if (weightA !== weightB) return weightA - weightB;
                return a.name.localeCompare(b.name);
            });
    }, [employees, filterBranch, searchTerm]);

    const aiCopilotAlerts = useMemo(() => {
        const alerts = [];
        if (!filterBranch) return [];

        let totalAssignedHours = 0;

        employeesInView.forEach(emp => {
            // 🚨 CORRECCIÓN: Usar estrictamente weeklyRosters y si está vacío, se queda vacío.
            let rawSchedule = weeklyRosters[emp.id] || {}; 
            let sch = (typeof rawSchedule === 'string') ? JSON.parse(rawSchedule || '{}') : rawSchedule;
            const hours = calculateEmployeeWeeklyHoursLocal(sch, shifts, emp.history, calendarDates);
            totalAssignedHours += hours;

            if (hours > 44) alerts.push({ type: 'danger', emp: emp.name, msg: `¡Cuidado! Necesita un respiro (Exceso de ${hours}h).` });

            let consecutiveDays = 0;
            [1, 2, 3, 4, 5, 6, 0].forEach(dId => {
                const day = sch[dId];
                if (day && !day.isOff && (day.shiftId || day.customStart)) {
                    consecutiveDays++;
                    const sStart = timeToMins(day.customStart || shifts.find(s => s.id == day.shiftId)?.start);
                    const sEnd = timeToMins(day.customEnd || shifts.find(s => s.id == day.shiftId)?.end);
                    let duration = (sEnd < sStart ? sEnd + 1440 : sEnd) - sStart;
                    if (duration >= 420 && !day.hasLunch) {
                        alerts.push({ type: 'warning', emp: emp.name, msg: `Alerta de fatiga: Turno mayor a 7h sin almuerzo.` });
                    }
                } else consecutiveDays = 0;
            });

            if (consecutiveDays >= 7) alerts.push({ type: 'danger', emp: emp.name, msg: `¡Riesgo de burnout! Sin días libres en la semana.` });
        });

        if (employeesInView.length > 0 && totalAssignedHours < (employeesInView.length * 40 * 0.8)) {
            alerts.push({ type: 'info', msg: `Signos vitales bajos: Faltan horas asignadas en la sucursal.` });
        }

        return alerts;
    }, [weeklyRosters, employeesInView, shifts, calendarDates, filterBranch]);

    const handleSaveCell = useCallback(async (empId, dayId, newCellData) => {
        let scheduleToSave = null;

        setWeeklyRosters(prev => {
            const currentRoster = prev[empId] || {};
            const schedule = (typeof currentRoster === 'string') ? JSON.parse(currentRoster || '{}') : { ...currentRoster };
            schedule[dayId] = newCellData;
            
            scheduleToSave = schedule; 
            return { ...prev, [empId]: schedule };
        });

        try {
            const { error } = await supabase
                .from('employee_rosters') 
                .upsert({
                    employee_id: empId,
                    week_start_date: startDate, 
                    schedule_data: scheduleToSave, 
                    status: 'DRAFT'
                }, { onConflict: 'employee_id, week_start_date' }); 

            if (error) {
                console.error("Error guardando borrador en Supabase:", error);
            }
        } catch (error) {
            console.error("Error de red guardando borrador:", error);
        }
    }, [startDate]);

    const handleEditCell = useCallback((empId, dayId, dateStr, currentData, rect) => {
        setEditingCell({ empId, dayId, dateStr, currentData, rect });
    }, []);

    const handlePublishWeek = async () => {
        if (!confirm(`¿Publicar y notificar los horarios de ${formatDateLocal(startDate)}?`)) return;
        setIsPublishing(true);
        try {
            await publishWeekRosters(startDate, filterBranch);
            window.dispatchEvent(new CustomEvent('force-history-refresh'));
        } catch (error) {
            console.error(error);
        } finally {
            setIsPublishing(false);
        }
    };

    const goToPersonal = () => {
        if (setView) {
            setView('DashboardView');
        } else {
            const personalBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Personal'));
            if (personalBtn) personalBtn.click();
        }
    };

    const renderHeaderTitle = () => {
        if (viewMode === 'shifts') {
            return (
                <div className="flex items-center gap-3 md:gap-4 w-full">
                    <button
                        onClick={() => setViewMode('calendar')}
                        className="relative group/back w-10 h-10 md:w-11 md:h-11 flex items-center justify-center rounded-full shrink-0 active:scale-95 transition-all duration-300 border border-slate-200/60 shadow-[0_2px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_6px_20px_rgba(0,122,255,0.2)] hover:-translate-y-0.5 z-50 bg-white/70 backdrop-blur-xl"
                        title="Volver a Calendario"
                    >
                        <div className="absolute inset-0 bg-gradient-to-tr from-[#007AFF]/20 to-cyan-400/20 rounded-full opacity-0 group-hover/back:opacity-100 transition-opacity duration-300"></div>
                        <ArrowLeft size={18} strokeWidth={2.5} className="text-slate-500 group-hover/back:text-[#007AFF] transition-colors relative z-10" />
                    </button>

                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-[1rem] md:rounded-[1.25rem] bg-gradient-to-br from-[#007AFF] to-[#005CE6] text-white flex items-center justify-center shadow-[0_8px_20px_rgba(0,122,255,0.3)] shrink-0 border border-white/20">
                        <BookOpen size={20} className="md:w-6 md:h-6" strokeWidth={1.5} />
                    </div>

                    <div className="flex flex-col items-start gap-0.5 relative transition-all">
                        <div className="flex items-center gap-3">
                            <span className="text-[20px] md:text-[22px] font-black text-slate-800 leading-none tracking-tight">Catálogo de Turnos</span>
                        </div>
                        <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            Configuración Multi-Sucursal
                        </span>
                    </div>
                </div>
            );
        }
        return "Horarios WFM";
    };

    const renderFiltersContent = () => {
        const formatWeekRange = (dateStr) => {
            if (!dateStr) return '';
            const [y, m, d] = dateStr.split('-').map(Number);
            const start = new Date(y, m - 1, d);
            const end = new Date(y, m - 1, d + 6);
            const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
            const d1 = String(start.getDate()).padStart(2, '0');
            const m1 = months[start.getMonth()];
            const y1 = String(start.getFullYear()).slice(-2);
            const d2 = String(end.getDate()).padStart(2, '0');
            const m2 = months[end.getMonth()];
            const y2 = String(end.getFullYear()).slice(-2);

            if (y1 !== y2) return `${d1} ${m1} '${y1} - ${d2} ${m2} '${y2}`;
            if (m1 !== m2) return `${d1} ${m1} - ${d2} ${m2} '${y2}`;
            return `${d1} - ${d2} ${m1} '${y2}`;
        };

        const activeSearchValue = viewMode === 'calendar' ? searchTerm : shiftSearch;
        const setActiveSearchValue = (val) => viewMode === 'calendar' ? setSearchTerm(val) : setShiftSearch(val);

        const handleClearSearch = () => {
            if (viewMode === 'calendar') setSearchTerm("");
            else setShiftSearch("");
        };

        const handleCloseSearch = () => {
            setIsSearchExpanded(false);
            handleClearSearch();
        };

        return (
            <div className="relative flex items-center overflow-visible">
                <div className={`flex items-center bg-white/20 backdrop-blur-2xl backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_25px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu overflow-hidden w-max max-w-full`}>
                    {isSearchExpanded ? (
                        <div className="flex items-center w-full h-full px-4 md:px-5 gap-3 animate-in fade-in slide-in-from-right-4 duration-500">
                            <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                            <input ref={searchInputRef} type="text" placeholder={viewMode === 'calendar' ? "Buscar colaborador o cargo..." : "Buscar turnos por nombre..."} className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0" value={activeSearchValue} onChange={(e) => setActiveSearchValue(e.target.value)} />
                            {activeSearchValue && <button onClick={handleClearSearch} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:scale-110 hover:-translate-y-0.5 active:scale-95 transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>}
                            <button onClick={handleCloseSearch} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white/60 backdrop-blur-md hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2 border border-white/50" title="Cerrar Búsqueda"><ChevronRight size={18} strokeWidth={2.5} /></button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between w-full h-full pl-2 pr-2 md:pr-3 animate-in fade-in slide-in-from-left-4 duration-500">
                            <div className="flex items-center min-w-0 gap-1 md:gap-2 h-full">
                                <div className="flex items-center bg-white/40 rounded-full p-0.5 border border-white/60 shadow-[inset_0_1px_4px_rgba(0,0,0,0.05)] relative shrink-0 h-[calc(100%-8px)]">
                                    <button onClick={() => setViewMode('calendar')} className={`w-10 md:w-11 h-full rounded-full flex items-center justify-center transition-all ${viewMode === 'calendar' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.08)] scale-[1.02]' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'}`} title="Vista Calendario"><CalendarDays size={16} strokeWidth={2.5} /></button>
                                    <div className="w-px h-5 bg-white/60 mx-0.5"></div>
                                    <button onClick={() => setViewMode('shifts')} className={`w-10 md:w-11 h-full rounded-full flex items-center justify-center transition-all ${viewMode === 'shifts' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.08)] scale-[1.02]' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'}`} title="Catálogo de Turnos"><BookOpen size={16} strokeWidth={2.5} /></button>
                                </div>
                                <div className="w-px h-6 md:h-8 bg-white/40 mx-1 md:mx-2 hidden md:block shrink-0"></div>
                                
                                {viewMode === 'calendar' && (
                                    <div className="w-max overflow-visible group/branch hover:-translate-y-0.5 transition-transform duration-300 h-full flex items-center shrink-0">
                                        <LiquidSelect value={filterBranch} onChange={setFilterBranch} options={branches.map(b => ({ value: String(b.id), label: b.name }))} compact clearable={false} icon={Building2} />
                                    </div>
                                )}

                                {viewMode === 'calendar' && (
                                    <div className="flex items-center gap-1 md:gap-2 h-full py-0.5 shrink-0">
                                        <div className="w-px h-6 md:h-8 bg-white/40 mx-1 md:mx-2 shrink-0"></div>
                                        <div className={`group/week flex items-center bg-white/60 backdrop-blur-md rounded-full border shadow-sm p-1 hover:shadow-md shrink-0 overflow-visible transition-all duration-500 cursor-default h-full ${!isDefaultWeek ? 'border-amber-200 bg-amber-50/30' : 'border-white/80'}`}>
                                            <div className="w-0 opacity-0 overflow-hidden group-hover/week:w-8 group-hover/week:opacity-100 group-hover/week:ml-1 transition-all duration-500"><button onClick={() => changeWeek(-7)} className="w-7 h-7 rounded-full flex items-center justify-center text-[#007AFF] hover:bg-white active:scale-90 transition-transform shadow-sm"><ChevronLeft size={16} strokeWidth={3} /></button></div>
                                            <div className="flex flex-col justify-center items-center px-4 whitespace-nowrap h-full">
                                                <span className={`text-[7px] font-black uppercase tracking-[0.2em] leading-none mb-1 ${!isDefaultWeek ? 'text-amber-600' : 'text-slate-400'}`}>{!isDefaultWeek ? 'Semana Filtrada' : 'Semana actual'}</span>
                                                <span className={`text-[11px] md:text-[12px] font-black uppercase tracking-tight leading-none ${!isDefaultWeek ? 'text-amber-600' : 'text-[#007AFF]'}`}>{formatWeekRange(startDate)}</span>
                                            </div>
                                            {!isDefaultWeek && <button onClick={handleResetFilters} title="Resetear fecha" className="w-5 h-5 rounded-full bg-red-50 border border-red-100 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all mr-1 animate-in zoom-in active:scale-90"><X size={10} strokeWidth={4} /></button>}
                                            <div className="w-0 opacity-0 overflow-hidden group-hover/week:w-8 group-hover/week:opacity-100 group-hover/week:mr-1 transition-all duration-500"><button onClick={() => changeWeek(7)} className="w-7 h-7 rounded-full flex items-center justify-center text-[#007AFF] hover:bg-white active:scale-90 transition-transform shadow-sm"><ArrowRight size={16} strokeWidth={3} /></button></div>
                                        </div>
                                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (openModal) openModal("aiSchedulerPreview", { branchId: filterBranch, startDate }); }} disabled={!isBranchSelected || employeesInView.length === 0 || isPastWeek} className={`relative group/saly w-9 h-9 flex items-center justify-center rounded-full shrink-0 transition-all duration-500 border-0 shadow-[0_0_15px_rgba(52,211,153,0.3)] hover:shadow-[0_0_25px_rgba(52,211,153,0.6)] ${(!isBranchSelected || employeesInView.length === 0 || isPastWeek) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:-translate-y-0.5 active:scale-95 cursor-pointer'}`}>
                                            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-400 via-cyan-500 to-indigo-500 rounded-full opacity-20 group-hover/saly:opacity-100 transition-all duration-500 group-hover/saly:animate-spin [animation-duration:4s]"></div>
                                            <div className="absolute inset-[1px] bg-white/90 backdrop-blur-sm rounded-full border border-white/50"></div>
                                            <HeartPulse size={18} strokeWidth={2.5} className={`text-cyan-500 group-hover/saly:text-indigo-500 relative z-10 transition-colors duration-300 ${(!isBranchSelected || employeesInView.length === 0 || isPastWeek) ? '' : 'animate-pulse'}`} />
                                        </button>
                                        <button onClick={handlePublishWeek} disabled={isPublishing || employeesInView.length === 0 || isPastWeek} className={`h-9 px-4 md:px-5 bg-gradient-to-br from-[#007AFF] to-[#005CE6] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_10px_rgba(0,122,255,0.3)] border border-[#007AFF]/50 transition-all hover:shadow-[0_6px_15px_rgba(0,122,255,0.4)] hover:scale-105 active:scale-95 gap-2 ${(employeesInView.length === 0 || isPastWeek) ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}>
                                            {isPublishing ? <Loader2 size={16} strokeWidth={3} className="animate-spin" /> : <Save size={16} strokeWidth={3} />}
                                            <span className="text-[10px] md:text-[11px] font-black uppercase tracking-widest hidden md:inline-block">{isPublishing ? '...' : 'Publicar'}</span>
                                        </button>
                                    </div>
                                )}

                                {viewMode === 'shifts' && (
                                    <div className="flex items-center gap-1 md:gap-2 h-full py-0.5 shrink-0">
                                        <div className="w-px h-6 md:h-8 bg-white/40 mx-1 md:mx-2 hidden md:block shrink-0"></div>
                                        <div className="flex items-center bg-white/50 rounded-full p-0.5 border border-white/60 shadow-[inset_0_1px_4px_rgba(0,0,0,0.05)] h-full shrink-0">
                                            <button onClick={() => setShiftTab('ACTIVE')} className={`px-4 md:px-5 h-9 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-300 ${shiftTab === 'ACTIVE' ? 'bg-white text-slate-800 border border-white shadow-md scale-[1.02]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 border-transparent hover:-translate-y-0.5 hover:shadow-md'}`}>Activos</button>
                                            <button onClick={() => setShiftTab('ARCHIVED')} className={`px-4 md:px-5 h-9 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-300 ${shiftTab === 'ARCHIVED' ? 'bg-white text-slate-800 border border-white shadow-md scale-[1.02]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 border-transparent hover:-translate-y-0.5 hover:shadow-md'}`}>Archivo</button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center transition-all duration-500 ease-in-out origin-right max-w-[100px] opacity-100 scale-100 ml-2 pl-3 md:pl-4 border-l border-white/30">
                                <button onClick={() => { setIsSearchExpanded(true); setTimeout(() => searchInputRef.current?.focus(), 100); }} className="relative w-10 h-10 md:w-11 md:h-11 bg-white/80 border border-white text-[#007AFF] rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,0,0,0.05)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.2)] hover:bg-white hover:-translate-y-0.5 active:scale-95 transform-gpu" title="Buscar">
                                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                                    {activeSearchValue && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    let currentChartData = [];
    let chartTitle = 'Mapa Operativo (Últimos 90 Días)';
    if (chartView === 'DAYS') {
        currentChartData = salesStats.days || [];
    } else if (chartView === 'HOURS') {
        currentChartData = salesStats.generalHours || [];
        chartTitle = 'Afluencia General (Horas)';
    } else {
        currentChartData = salesStats.specificHours?.[chartView] || [];
        chartTitle = `Afluencia por Hora - ${DAY_NAMES[chartView]}`;
    }

   return (
        <GlassViewLayout 
            icon={viewMode === 'shifts' ? null : CalendarDays} 
            title={renderHeaderTitle()} 
            filtersContent={renderFiltersContent()} 
            transparentBody={viewMode === 'shifts'}
            fixedScrollMode={viewMode === 'shifts'}
        >
            {viewMode === 'shifts' ? (
                <div className="w-full h-full animate-in fade-in duration-700 relative">
                    <TabShifts
                        branches={branches}
                        filterBranch={filterBranch}
                        shiftTab={shiftTab}
                        shiftSearch={shiftSearch}
                    />
                </div>
            ) : (
                <div className="w-full flex-1 flex flex-col p-2 md:p-4 lg:px-6 animate-in fade-in duration-700 mx-auto h-full overflow-hidden">
                    {employeesInView.length === 0 ? (
                        <div className="w-full flex-1 flex flex-col items-center justify-center min-h-[65vh] relative z-10">
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-cyan-400/20 rounded-full blur-[80px] pointer-events-none"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-emerald-400/10 rounded-full blur-[80px] pointer-events-none translate-x-16"></div>

                            <div className="relative w-28 h-28 mb-8 flex items-center justify-center">
                                <div className="absolute inset-0 bg-gradient-to-tr from-emerald-400 via-cyan-500 to-indigo-500 rounded-full animate-[spin_4s_linear_infinite] opacity-20 blur-md"></div>
                                <div className="absolute inset-2 bg-gradient-to-tr from-emerald-50 to-cyan-50 rounded-full shadow-inner border border-white/80 flex items-center justify-center z-10 overflow-hidden">
                                    <div className="absolute inset-0 bg-white/50 backdrop-blur-md rounded-full"></div>
                                    <HeartPulse size={44} strokeWidth={1.5} className="text-cyan-500 relative z-20 animate-pulse" />
                                </div>
                                <Sparkles size={24} className="absolute -top-1 -right-1 text-emerald-400 animate-bounce z-30" style={{ animationDuration: '2s' }} />
                            </div>

                            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-50 border border-cyan-100 text-cyan-600 text-[10px] font-black uppercase tracking-widest mb-4 shadow-sm">
                                <Sparkles size={12} /> Hola, soy Saly
                            </div>

                            <h2 className="text-[24px] md:text-[28px] font-black text-slate-800 tracking-tight mb-4 leading-tight text-center">
                                ¡La sucursal está en ayunas!
                            </h2>

                            <p className="text-[14px] md:text-[15px] font-medium text-slate-500 leading-relaxed mb-10 max-w-md text-center">
                                Para analizar la afluencia y recetar una planificación óptima, necesito saber quiénes trabajan aquí.
                            </p>

                            <button
                                onClick={goToPersonal}
                                className="inline-flex items-center gap-3 px-8 py-3.5 bg-gradient-to-r from-emerald-400 to-cyan-500 text-white rounded-full text-[12px] font-black uppercase tracking-widest shadow-[0_8px_20px_rgba(45,212,191,0.3)] hover:shadow-[0_12px_25px_rgba(45,212,191,0.5)] hover:-translate-y-1 active:scale-95 transition-all"
                            >
                                Ir al módulo de Personal <ArrowRight size={16} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-5 pb-10 h-full overflow-y-auto hide-scrollbar relative">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 shrink-0 z-20">
                                <ScheduleChart 
                                    chartTitle={chartTitle}
                                    chartView={chartView}
                                    setChartView={setChartView}
                                    isLoadingSales={isLoadingSales}
                                    currentChartData={currentChartData}
                                    filterBranch={filterBranch}
                                    branches={branches}
                                    openModal={openModal}
                                />
                                <SalyCopilot aiCopilotAlerts={[...aiCopilotAlerts, ...salyDynamicAlerts]} />
                            </div>

                            <ScheduleCalendar 
                                isLoading={isLoading}
                                calendarDates={calendarDates}
                                employeesInView={employeesInView}
                                weeklyRosters={weeklyRosters}
                                shifts={shifts}
                                handleEditCell={handleEditCell}
                                salesStats={salesStats}
                                onSalyAlertsUpdate={setSalyDynamicAlerts}
                                isReadOnly={isPastWeek} 
                            />
                        </div>
                    )}
                </div>
            )}

            {editingCell && (
                <InlineDayEditor
                    employee={employeesInView.find(e => e.id === editingCell.empId)}
                    dateStr={editingCell.dateStr}
                    dayId={editingCell.dayId}
                    currentData={editingCell.currentData}
                    shifts={shifts}
                    filterBranch={filterBranch}
                    anchorRect={editingCell.rect}
                    onClose={() => setEditingCell(null)}
                    onSave={(dayId, newData) => handleSaveCell(editingCell.empId, dayId, newData)}
                />
            )}
        </GlassViewLayout>
    );
};

export default memo(SchedulesView);