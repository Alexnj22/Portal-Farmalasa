import React, { useState, useMemo, useEffect, useCallback, memo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    CalendarDays, ChevronLeft, ArrowRight, Building2, BookOpen,
    X, Save, Loader2,
    Star, Trash2, Plus, Globe, MapPin, RefreshCw, ChevronRight, CheckCircle
} from 'lucide-react';

import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import GlassViewLayout from '../components/GlassViewLayout';
import TabShifts from './schedule-tabs/TabShifts';
import LiquidSelect from '../components/common/LiquidSelect';
import ViewTabBar from '../components/common/ViewTabBar';

import { getLocalMonday, formatDateLocal, DAY_NAMES, calculateEmployeeWeeklyHoursLocal, timeToMins, formatHourAMPM } from '../utils/scheduleHelpers';

import InlineDayEditor from './schedule-tabs/components/InlineDayEditor';
import ScheduleChart from './schedule-tabs/components/ScheduleChart';
import ScheduleCalendar from './schedule-tabs/components/ScheduleCalendar';
import ConfirmModal from '../components/common/ConfirmModal';

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const SCHED_TABS = [
    { key: 'calendar', label: 'Horarios', icon: CalendarDays },
    { key: 'shifts',   label: 'Catálogo', icon: BookOpen     },
    { key: 'holidays', label: 'Feriados', icon: Star         },
];

const formatWeekRange = (dateStr) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end   = new Date(y, m - 1, d + 6);
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const d1 = String(start.getDate()).padStart(2,'0'), m1 = months[start.getMonth()], y1 = String(start.getFullYear()).slice(-2);
    const d2 = String(end.getDate()).padStart(2,'0'),   m2 = months[end.getMonth()],   y2 = String(end.getFullYear()).slice(-2);
    if (y1 !== y2) return `${d1} ${m1} '${y1} - ${d2} ${m2} '${y2}`;
    if (m1 !== m2) return `${d1} ${m1} - ${d2} ${m2} '${y2}`;
    return `${d1} - ${d2} ${m1} '${y2}`;
};

// ── HOLIDAYS PANEL ─────────────────────────────────────────────────────────────
const HolidaysPanel = ({
    holidays, holidayYear, setHolidayYear, currentYear,
    showForm, setShowForm,
    hName, setHName, hDate, setHDate, hType, setHType,
    hMuni, setHMuni, hRecurring, setHRecurring,
    hSaving, hDeleting, canEdit, onSave, onDelete,
    searchTerm = '',
}) => {
    const yearHolidays = (holidays || []).filter(h => {
        const yearMatch = h.holiday_date?.startsWith(String(holidayYear));
        const nameMatch = !searchTerm || (h.name || '').toLowerCase().includes(searchTerm);
        return yearMatch && nameMatch;
    });
    const byMonth = MONTHS_ES.map((month, idx) => ({
        month, idx,
        items: yearHolidays.filter(h => parseInt(h.holiday_date?.split('-')[1], 10) === idx + 1),
    })).filter(m => m.items.length > 0);

    return (
        <div className="p-4 md:p-6 space-y-6 animate-view-enter">
            {/* Year toggle + Add button */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1 bg-white/60 backdrop-blur-md border border-white/70 rounded-[1.5rem] p-1 shadow-sm">
                    {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                        <button key={y} onClick={() => setHolidayYear(y)}
                            className={`px-4 py-1.5 rounded-[1.2rem] text-[11px] font-black transition-all ${holidayYear === y ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-amber-600 hover:bg-white/50'}`}>
                            {y}
                        </button>
                    ))}
                </div>
                {canEdit && (
                    <button onClick={() => setShowForm(v => !v)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-[1.2rem] text-[11px] font-black transition-all border ${showForm ? 'bg-slate-100 border-slate-200 text-slate-600' : 'bg-amber-500 hover:bg-amber-600 border-amber-500 text-white shadow-[0_4px_12px_rgba(234,179,8,0.3)] hover:shadow-[0_6px_18px_rgba(234,179,8,0.4)] hover:-translate-y-0.5'}`}>
                        {showForm ? <X size={13} strokeWidth={2.5} /> : <Plus size={13} strokeWidth={2.5} />}
                        {showForm ? 'Cancelar' : 'Agregar feriado'}
                    </button>
                )}
            </div>

            {/* Add form */}
            {showForm && canEdit && (
                <div className="bg-white/70 backdrop-blur-xl border border-white/80 rounded-[1.5rem] p-5 shadow-sm space-y-4 animate-in slide-in-from-top-2 duration-200">
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Nuevo Feriado</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Nombre</label>
                            <input value={hName} onChange={e => setHName(e.target.value)} placeholder="Ej: Día del Trabajo"
                                className="w-full bg-white border border-slate-200 rounded-[0.85rem] px-3 py-2.5 text-[13px] font-bold text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all" />
                        </div>
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Fecha</label>
                            <input type="date" value={hDate} onChange={e => setHDate(e.target.value)}
                                className="w-full bg-white border border-slate-200 rounded-[0.85rem] px-3 py-2.5 text-[13px] font-bold text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5 bg-slate-100 rounded-full p-1 border border-slate-200">
                            <button onClick={() => setHType('NATIONAL')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black transition-all ${hType === 'NATIONAL' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-amber-600'}`}>
                                <Globe size={11} strokeWidth={2} /> Nacional
                            </button>
                            <button onClick={() => setHType('MUNICIPAL')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black transition-all ${hType === 'MUNICIPAL' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-blue-600'}`}>
                                <MapPin size={11} strokeWidth={2} /> Municipal
                            </button>
                        </div>
                        {hType === 'MUNICIPAL' && (
                            <input value={hMuni} onChange={e => setHMuni(e.target.value)} placeholder="Municipio"
                                className="flex-1 min-w-[140px] bg-white border border-slate-200 rounded-full px-3 py-2 text-[12px] font-bold text-slate-800 outline-none focus:border-blue-400 transition-all" />
                        )}
                        <button onClick={() => setHRecurring(v => !v)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[10px] font-black border transition-all ${hRecurring ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-600'}`}>
                            <RefreshCw size={11} strokeWidth={2} /> Recurrente
                        </button>
                    </div>
                    <button onClick={onSave} disabled={hSaving || !hDate || !hName.trim()}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-black uppercase tracking-widest rounded-[1rem] shadow-[0_4px_12px_rgba(234,179,8,0.3)] transition-all hover:-translate-y-0.5 active:scale-[0.97]">
                        {hSaving ? <Loader2 size={13} strokeWidth={3} className="animate-spin" /> : <Save size={13} strokeWidth={2.5} />}
                        {hSaving ? 'Guardando...' : 'Guardar feriado'}
                    </button>
                </div>
            )}

            {/* Holiday list */}
            {byMonth.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <div className="p-5 bg-white/50 backdrop-blur-xl border border-white/60 rounded-[2rem] shadow-sm">
                        <Star size={32} className="text-amber-200" strokeWidth={1.5} />
                    </div>
                    <p className="text-[13px] font-bold text-slate-400">
                        {searchTerm ? `Sin resultados para "${searchTerm}"` : `No hay feriados registrados para ${holidayYear}`}
                    </p>
                </div>
            ) : (
                <div className="space-y-8">
                    {byMonth.map(({ month, items }) => (
                        <div key={month}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-2 h-7 bg-gradient-to-b from-amber-400 to-orange-400 rounded-full shrink-0" />
                                    <span className="text-[16px] font-black text-slate-700 tracking-tight">{month}</span>
                                </div>
                                <div className="h-px flex-1 bg-gradient-to-r from-amber-100 to-transparent" />
                                <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full shrink-0">
                                    {items.length} {items.length === 1 ? 'feriado' : 'feriados'}
                                </span>
                            </div>
                            <div className="space-y-2.5">
                                {items.sort((a,b) => a.holiday_date.localeCompare(b.holiday_date)).map(h => {
                                    const d = new Date(h.holiday_date + 'T12:00:00Z');
                                    const dayNum  = d.getUTCDate();
                                    const dayName = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getUTCDay()];
                                    const isNat   = h.type === 'NATIONAL';
                                    return (
                                        <div key={h.id}
                                            className="group relative flex items-center overflow-hidden
                                                bg-white/70 backdrop-blur-md border border-white/80 rounded-[1.5rem]
                                                shadow-[0_2px_12px_rgba(0,0,0,0.04)]
                                                hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5
                                                transition-all duration-300">
                                            {/* Color stripe */}
                                            <div className={`w-1.5 self-stretch shrink-0 rounded-l-[1.5rem] ${isNat ? 'bg-gradient-to-b from-amber-400 to-orange-400' : 'bg-gradient-to-b from-blue-400 to-indigo-400'}`} />
                                            <div className="flex items-center gap-3 px-4 py-3.5 flex-1 min-w-0">
                                                {/* Date badge */}
                                                <div className={`w-11 h-11 rounded-[0.85rem] flex flex-col items-center justify-center flex-shrink-0 ${isNat ? 'bg-amber-50 border border-amber-100' : 'bg-blue-50 border border-blue-100'}`}>
                                                    <span className={`text-[8px] font-black uppercase tracking-widest leading-none ${isNat ? 'text-amber-400' : 'text-blue-400'}`}>{dayName}</span>
                                                    <span className={`text-[17px] font-black leading-tight ${isNat ? 'text-amber-700' : 'text-blue-700'}`}>{dayNum}</span>
                                                </div>
                                                {/* Info */}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] font-black text-slate-800 truncate">{h.name}</p>
                                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                        {isNat ? (
                                                            <span className="flex items-center gap-1 text-[9px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                                                <Globe size={8} strokeWidth={2} /> Nacional
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center gap-1 text-[9px] font-black text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                                                                <MapPin size={8} strokeWidth={2} /> Municipal{h.municipality ? ` · ${h.municipality}` : ''}
                                                            </span>
                                                        )}
                                                        {h.is_recurring && (
                                                            <span className="flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                                                                <RefreshCw size={8} strokeWidth={2} /> Recurrente
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {/* Delete */}
                                                {canEdit && (
                                                    <button onClick={() => onDelete(h.id)} disabled={hDeleting === h.id}
                                                        className="opacity-0 group-hover:opacity-100 w-8 h-8 rounded-[0.65rem] flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0 disabled:opacity-50">
                                                        {hDeleting === h.id ? <Loader2 size={14} strokeWidth={2.5} className="animate-spin text-red-400" /> : <Trash2 size={14} strokeWidth={2} />}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ── SCHEDULES VIEW ─────────────────────────────────────────────────────────────
const SchedulesView = ({ openModal, setView }) => {
    const { employees, shifts, branches, holidays, fetchWeekRosters, publishWeekRosters, fetchBoot, addHoliday, deleteHoliday } = useStaff();
    const { hasPermission, getScope } = useAuth();
    const canEdit = hasPermission('schedules', 'can_edit');
    const showToast = useToastStore(s => s.showToast);
    const [isPublishing, setIsPublishing] = useState(false);

    useEffect(() => {
        if (shifts.length === 0) fetchBoot?.();
    }, []);

    const [publishState, setPublishState] = useState({
        isOpen: false, isDestructive: false,
        title: '', message: '', confirmText: '', bulkUpdates: null,
    });

    const [viewMode, setViewMode] = useState('calendar');
    const viewOrderMap = { calendar: 0, shifts: 1, holidays: 2 };
    const viewDirRef = useRef(0);
    const goToView = useCallback((next) => {
        viewDirRef.current = (viewOrderMap[next] ?? 1) >= (viewOrderMap[viewMode] ?? 0) ? 1 : -1;
        setViewMode(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode]);

    const [filterBranch, setFilterBranch] = useState('');
    const [rawSearch, setRawSearch] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const t = setTimeout(() => setSearchTerm(rawSearch.trim().toLowerCase()), 250);
        return () => clearTimeout(t);
    }, [rawSearch]);

    // ── Feriados state ──────────────────────────────────────────────────────────
    const currentYear = new Date().getFullYear();
    const [holidayYear, setHolidayYear]   = useState(currentYear);
    const [showHolidayForm, setShowHolidayForm] = useState(false);
    const [hName, setHName]               = useState('');
    const [hDate, setHDate]               = useState('');
    const [hType, setHType]               = useState('NATIONAL');
    const [hMuni, setHMuni]               = useState('');
    const [hRecurring, setHRecurring]     = useState(false);
    const [hSaving, setHSaving]           = useState(false);
    const [hDeleting, setHDeleting]       = useState(null);

    const [startDate, setStartDate]       = useState(getLocalMonday());
    const [weeklyRosters, setWeeklyRosters] = useState({});
    const [publishedIds, setPublishedIds] = useState(new Set());
    const [isLoading, setIsLoading]       = useState(true);
    const [editingCell, setEditingCell]   = useState(null);

    const [chartView, setChartView]       = useState('DAYS');
    const [salesStats, setSalesStats]     = useState({ generalHours: [], days: [], specificHours: {} });
    const [isLoadingSales, setIsLoadingSales] = useState(false);

    useEffect(() => {
        if (branches && branches.length > 0 && !filterBranch) {
            const popular = branches.find(b => b.name.toLowerCase().includes('popular'));
            setFilterBranch(popular ? String(popular.id) : String(branches[0].id));
        }
    }, [branches, filterBranch]);

    const isDefaultWeek = useMemo(() => startDate === getLocalMonday(), [startDate]);
    const isPastWeek    = useMemo(() => startDate < getLocalMonday(), [startDate]);

    const handleResetFilters = useCallback(() => setStartDate(getLocalMonday()), []);

    const changeWeek = useCallback((daysToAdd) => {
        setStartDate(prev => {
            const [y, m, d] = prev.split('-').map(Number);
            const next = new Date(y, m - 1, d + daysToAdd);
            return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
        });
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (editingCell) setEditingCell(null);
                if (publishState.isOpen) setPublishState(prev => ({ ...prev, isOpen: false }));
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editingCell, publishState.isOpen]);

    useEffect(() => {
        let isMounted = true;
        const loadRosters = (isSilent = false) => {
            if (viewMode === 'shifts' || !filterBranch) return;
            if (!isSilent) { setIsLoading(true); setWeeklyRosters({}); }
            fetchWeekRosters(startDate).then(result => {
                if (isMounted) {
                    setWeeklyRosters(result?.rosters || {});
                    setPublishedIds(result?.publishedIds || new Set());
                    if (!isSilent) setIsLoading(false);
                }
            });
        };
        loadRosters(false);
        const handleRefresh = () => loadRosters(true);
        window.addEventListener('force-history-refresh', handleRefresh);
        window.addEventListener('employee-event-updated', handleRefresh);
        return () => {
            isMounted = false;
            window.removeEventListener('force-history-refresh', handleRefresh);
            window.removeEventListener('employee-event-updated', handleRefresh);
        };
    }, [startDate, fetchWeekRosters, viewMode, filterBranch]);

    const calendarDates = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
        const [y, m, d] = startDate.split('-').map(Number);
        const cur = new Date(y, m - 1, d + i);
        return `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
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
                    let sch = currentBranch.weekly_hours || currentBranch.settings?.schedule;
                    if (typeof sch === 'string') { try { sch = JSON.parse(sch); } catch(e) { sch = null; } }
                    if (sch && typeof sch === 'object') {
                        let minOpen = 1440; let maxClose = 0;
                        Object.values(sch).forEach(d => {
                            if (d && d.isOpen !== false && !d.isClosed && !d.isOff) {
                                const cleanStart = String(d.start || d.open || '').replace(/[^0-9:]/g, '').trim();
                                const cleanEnd   = String(d.end   || d.close || '').replace(/[^0-9:]/g, '').trim();
                                if (cleanStart && cleanEnd) {
                                    const oMins = timeToMins(cleanStart);
                                    let cMins   = timeToMins(cleanEnd);
                                    if (cMins < oMins) cMins += 1440;
                                    if (oMins < minOpen)  minOpen  = oMins;
                                    if (cMins > maxClose) maxClose = cMins;
                                }
                            }
                        });
                        if (minOpen  < 1440) openH  = Math.floor(minOpen / 60);
                        if (maxClose > 0)    closeH = Math.ceil(maxClose / 60) - 1;
                    }
                }

                if (closeH <= openH) closeH = openH + 11;

                const daysMap          = { 1:0,2:0,3:0,4:0,5:0,6:0,0:0 };
                const hourlyMap        = {};
                const specificHourlyMap = { 1:{},2:{},3:{},4:{},5:{},6:{},0:{} };
                const uniqueDatesByDay  = { 1:new Set(),2:new Set(),3:new Set(),4:new Set(),5:new Set(),6:new Set(),0:new Set() };
                const uniqueDates       = new Set();

                const validData = (rawSalesData || []).filter(row => {
                    const hour = Number(row.sale_hour);
                    return hour >= openH && hour <= closeH;
                });

                validData.forEach(row => {
                    const h    = Number(row.sale_hour);
                    const dStr = row.sale_date;
                    const dNum = new Date(dStr + 'T00:00:00').getDay();
                    const count= Number(row.transaction_count || 0);
                    daysMap[dNum] += count;
                    if (!hourlyMap[h]) hourlyMap[h] = 0;
                    hourlyMap[h] += count;
                    if (!specificHourlyMap[dNum][h]) specificHourlyMap[dNum][h] = 0;
                    specificHourlyMap[dNum][h] += count;
                    uniqueDates.add(dStr);
                    uniqueDatesByDay[dNum].add(dStr);
                });

                const finalDays = [1,2,3,4,5,6,0].map(d => {
                    const dc  = uniqueDatesByDay[d].size || 1;
                    const hrs = [];
                    for (let h = openH; h <= closeH; h++) hrs.push(Math.round((specificHourlyMap[d][h] || 0) / dc));
                    hrs.sort((a,b) => a-b);
                    const p75 = hrs[Math.floor(hrs.length * 0.75)] || 0;
                    return { day: d, avg: p75, label: DAY_NAMES[d] };
                });

                const totalDays = uniqueDates.size || 1;
                const finalGeneralHours = [];
                for (let h = openH; h <= closeH; h++) {
                    finalGeneralHours.push({ hour: h, avg: Math.round((hourlyMap[h] || 0) / totalDays), label: formatHourAMPM(h) });
                }

                const finalSpecificHours = {};
                [1,2,3,4,5,6,0].forEach(d => {
                    finalSpecificHours[d] = [];
                    const dCount = uniqueDatesByDay[d].size || 1;
                    for (let h = openH; h <= closeH; h++) {
                        finalSpecificHours[d].push({ hour: h, avg: Math.round((specificHourlyMap[d][h] || 0) / dCount), label: formatHourAMPM(h) });
                    }
                });

                const applyColors = (arr) => {
                    const max = Math.max(...arr.map(o => o.avg), 1);
                    return arr.map(item => {
                        const txPerHr = item.avg;
                        let color = '#64748b';
                        if      (txPerHr > 18) color = '#FF2D55';
                        else if (txPerHr > 12) color = '#F79009';
                        else if (txPerHr >  4) color = '#0052CC';
                        const hi = item.avg / max;
                        item.height = hi > 0 ? `${Math.max(hi * 100, 15)}%` : '0%';
                        item.color  = color;
                        return item;
                    });
                };

                setSalesStats({
                    days: applyColors(finalDays),
                    generalHours: applyColors(finalGeneralHours),
                    specificHours: {
                        1: applyColors(finalSpecificHours[1]),
                        2: applyColors(finalSpecificHours[2]),
                        3: applyColors(finalSpecificHours[3]),
                        4: applyColors(finalSpecificHours[4]),
                        5: applyColors(finalSpecificHours[5]),
                        6: applyColors(finalSpecificHours[6]),
                        0: applyColors(finalSpecificHours[0]),
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
            if (r.includes('SUBJEFE'))    return 2;
            if (r.includes('REGENTE'))    return 3;
            if (r.includes('DEPENDIENTE')) return 4;
            return 5;
        };
        return employees
            .filter(e => String(e.branchId || e.branch_id) === String(filterBranch) && (e.status || '').toUpperCase() !== 'INACTIVO')
            .sort((a, b) => {
                const wA = roleWeight(a.role), wB = roleWeight(b.role);
                if (wA !== wB) return wA - wB;
                return (a.name || 'Sin Nombre').localeCompare(b.name || 'Sin Nombre');
            });
    }, [employees, filterBranch]);

    const filteredEmployees = useMemo(() => {
        if (!searchTerm) return employeesInView;
        return employeesInView.filter(e => (e.name || '').toLowerCase().includes(searchTerm));
    }, [employeesInView, searchTerm]);

    const weekIsPublished = useMemo(() => {
        if (employeesInView.length === 0) return false;
        return employeesInView.some(e => publishedIds.has(String(e.id)));
    }, [employeesInView, publishedIds]);

    const handleSaveCell = useCallback(async (empId, dayId, newCellData) => {
        setWeeklyRosters(prev => {
            const cur = prev[empId] || {};
            const sch = (typeof cur === 'string') ? JSON.parse(cur || '{}') : { ...cur };
            sch[dayId] = newCellData;
            return { ...prev, [empId]: sch };
        });
        const latest = weeklyRosters[empId] || {};
        const toSave = (typeof latest === 'string') ? JSON.parse(latest || '{}') : { ...latest };
        toSave[dayId] = newCellData;
        try {
            const { error } = await supabase.from('employee_rosters').upsert({
                employee_id: empId, week_start_date: startDate,
                schedule_data: toSave, status: 'DRAFT',
            }, { onConflict: 'employee_id, week_start_date' });
            if (error) console.error("Error guardando borrador:", error);
        } catch (err) {
            console.error("Error de red guardando borrador:", err);
        }
    }, [startDate, weeklyRosters]);

    const handleEditCell = useCallback((empId, dayId, dateStr, currentData, rect) => {
        setEditingCell({ empId, dayId, dateStr, currentData, rect });
    }, []);

    const triggerPublishAudit = () => {
        let incompleteCount = 0, excessCount = 0;
        const bulkUpdates = employeesInView.map(emp => {
            const raw = weeklyRosters[emp.id] || {};
            const sch = (typeof raw === 'string') ? JSON.parse(raw || '{}') : raw;
            const hours = calculateEmployeeWeeklyHoursLocal(sch, shifts, emp.history, calendarDates);
            let daysOff = 0;
            calendarDates.forEach(date => {
                const dId   = new Date(date + 'T00:00:00').getDay();
                const dayData = sch[dId] || {};
                const shift = shifts.find(s => String(s.id) === String(dayData.shiftId));
                const hasShift = !dayData.isOff &&
                    (dayData.customStart || shift?.start_time?.substring(0,5) || shift?.start) &&
                    (dayData.customEnd   || shift?.end_time?.substring(0,5)   || shift?.end);
                if (!hasShift) daysOff++;
            });
            if (hours > 44 || daysOff === 0) excessCount++;
            else if (hours < 44 || daysOff > 1) incompleteCount++;
            return { id: emp.id, weekly_schedule: sch };
        });

        if (incompleteCount > 0 || excessCount > 0) {
            const msgs = [];
            if (incompleteCount > 0) msgs.push(`${incompleteCount} colaborador(es) con horarios incompletos.`);
            if (excessCount > 0)     msgs.push(`${excessCount} colaborador(es) con exceso de horas.`);
            setPublishState({
                isOpen: true, isDestructive: true,
                title: "⚠️ Planificación No Óptima",
                message: `Se detectaron deficiencias:\n${msgs.join('\n')}\n\n¿Deseas publicar de todas formas?`,
                confirmText: "Publicar con Errores", bulkUpdates,
            });
        } else {
            setPublishState({
                isOpen: true, isDestructive: false,
                title: "✅ Planificación Perfecta",
                message: `Todos los empleados están en verde. ¿Deseas publicar los horarios de la semana del ${formatDateLocal(startDate)}?`,
                confirmText: "Publicar Horarios", bulkUpdates,
            });
        }
    };

    const executePublish = async () => {
        setIsPublishing(true);
        try {
            const rosterInserts = publishState.bulkUpdates.map(item => ({
                employee_id: item.id, week_start_date: startDate,
                schedule_data: item.weekly_schedule, status: 'DRAFT',
                updated_at: new Date().toISOString(),
            }));
            const { error: bulkError } = await supabase.from('employee_rosters')
                .upsert(rosterInserts, { onConflict: 'employee_id,week_start_date' });
            if (bulkError) throw bulkError;
            if (typeof publishWeekRosters === 'function') await publishWeekRosters(startDate, filterBranch);
            setPublishedIds(prev => {
                const next = new Set(prev);
                publishState.bulkUpdates.forEach(item => next.add(String(item.id)));
                return next;
            });
            showToast('Horarios publicados', `Semana del ${formatDateLocal(startDate)} publicada correctamente.`, 'success');
            window.dispatchEvent(new CustomEvent('force-history-refresh'));
            setPublishState({ isOpen: false, isDestructive: false, title: '', message: '', confirmText: '', bulkUpdates: null });
        } catch (error) {
            console.error("Error publicando horarios:", error);
            showToast('Error al publicar', 'Hubo un error de conexión. Intenta de nuevo.', 'error');
        } finally {
            setIsPublishing(false);
        }
    };

    const goToPersonal = () => {
        if (setView) setView('DashboardView');
        else {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Personal'));
            if (btn) btn.click();
        }
    };

    const validBranches = branches.filter(b => {
        const n = (b.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return !n.includes('bodega') && !n.includes('administracion') && !n.includes('externos');
    });

    const searchPlaceholder =
        viewMode === 'calendar' ? 'Buscar colaborador...' :
        viewMode === 'shifts'   ? 'Buscar turno...' :
                                  'Buscar feriado...';

    const filtersContent = (
        <ViewTabBar
            tabs={SCHED_TABS}
            activeTab={viewMode}
            onTabChange={goToView}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={searchPlaceholder}
        />
    );

    let currentChartData = [];
    let chartTitle = 'Tx promedio · últimos 3 meses';
    if (chartView === 'DAYS') {
        currentChartData = salesStats.days || [];
    } else if (chartView === 'HOURS') {
        currentChartData = salesStats.generalHours || [];
        chartTitle = 'Tx por hora · general';
    } else {
        currentChartData = salesStats.specificHours?.[chartView] || [];
        chartTitle = `Tx por hora · ${DAY_NAMES[chartView]}`;
    }

    return (
        <GlassViewLayout
            icon={CalendarDays}
            title="Horarios"
            filtersContent={filtersContent}
            transparentBody={viewMode === 'shifts' || viewMode === 'holidays'}
            fixedScrollMode={viewMode === 'shifts'}
        >
            <AnimatePresence mode="wait" initial={false}>
            {viewMode === 'shifts' ? (
                <motion.div key="shifts"
                    initial={{ opacity: 0, x: viewDirRef.current * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: viewDirRef.current * -40 }}
                    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    className="w-full h-full relative">
                    <TabShifts branches={branches} searchTerm={searchTerm} />
                </motion.div>
            ) : viewMode === 'holidays' ? (
                <motion.div key="holidays"
                    initial={{ opacity: 0, x: viewDirRef.current * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: viewDirRef.current * -40 }}
                    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    className="w-full h-full">
                    <HolidaysPanel
                        holidays={holidays}
                        holidayYear={holidayYear} setHolidayYear={setHolidayYear}
                        currentYear={currentYear}
                        showForm={showHolidayForm} setShowForm={setShowHolidayForm}
                        hName={hName} setHName={setHName}
                        hDate={hDate} setHDate={setHDate}
                        hType={hType} setHType={setHType}
                        hMuni={hMuni} setHMuni={setHMuni}
                        hRecurring={hRecurring} setHRecurring={setHRecurring}
                        hSaving={hSaving} hDeleting={hDeleting}
                        canEdit={canEdit}
                        searchTerm={searchTerm}
                        onSave={async () => {
                            if (!hDate || !hName.trim()) return;
                            setHSaving(true);
                            try {
                                await addHoliday({ holiday_date: hDate, name: hName.trim(), type: hType, municipality: hMuni.trim() || null, is_recurring: hRecurring });
                                showToast('Feriado agregado', `${hName} guardado correctamente.`, 'success');
                                setHName(''); setHDate(''); setHType('NATIONAL'); setHMuni(''); setHRecurring(false);
                                setShowHolidayForm(false);
                            } catch(e) { showToast('Error', e.message, 'error'); }
                            finally { setHSaving(false); }
                        }}
                        onDelete={async (id) => {
                            setHDeleting(id);
                            try {
                                await deleteHoliday(id);
                                showToast('Feriado eliminado', '', 'success');
                            } catch(e) { showToast('Error', e.message, 'error'); }
                            finally { setHDeleting(null); }
                        }}
                    />
                </motion.div>
            ) : (
                <motion.div key="calendar"
                    initial={{ opacity: 0, x: viewDirRef.current * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: viewDirRef.current * -40 }}
                    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    className="w-full flex-1 flex flex-col p-2 md:p-4 lg:px-6 mx-auto h-full overflow-hidden">

                    {/* Unified chart card — controls integrated inside */}
                    <div className="pb-3 shrink-0">
                        <ScheduleChart
                            chartView={chartView} setChartView={setChartView}
                            isLoadingSales={isLoadingSales}
                            currentChartData={currentChartData}
                            filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                            validBranches={validBranches}
                            startDate={startDate} changeWeek={changeWeek} isDefaultWeek={isDefaultWeek}
                            handleResetFilters={handleResetFilters}
                            canPublish={canEdit && getScope('schedules') !== 'BRANCH'}
                            weekIsPublished={weekIsPublished} isPublishing={isPublishing}
                            isPastWeek={isPastWeek} hasEmployees={employeesInView.length > 0}
                            onPublish={triggerPublishAudit}
                            openModal={openModal}
                        />
                    </div>

                    {employeesInView.length === 0 ? (
                        <div className="flex flex-col items-center justify-center min-h-[55vh] gap-5">
                            <div className="p-6 bg-white/50 backdrop-blur-xl border border-white/60 rounded-[2rem] shadow-sm">
                                <CalendarDays size={36} className="text-[#0052CC]/30" strokeWidth={1.5} />
                            </div>
                            <div className="text-center">
                                <p className="text-[16px] font-black text-slate-600 mb-1">Sin colaboradores</p>
                                <p className="text-[13px] font-medium text-slate-400">No hay colaboradores activos en esta sucursal.</p>
                            </div>
                            <button onClick={goToPersonal}
                                className="inline-flex items-center gap-2 px-6 py-3 bg-[#0052CC] text-white rounded-full text-[11px] font-black uppercase tracking-widest shadow-[0_4px_12px_rgba(0,82,204,0.3)] hover:shadow-[0_8px_20px_rgba(0,82,204,0.4)] hover:-translate-y-0.5 active:scale-[0.97] transition-all">
                                Ir al módulo de Personal <ArrowRight size={14} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col pb-10 flex-1 min-h-0 overflow-y-auto hide-scrollbar relative">
                            <ScheduleCalendar
                                isLoading={isLoading}
                                calendarDates={calendarDates}
                                employeesInView={filteredEmployees}
                                weeklyRosters={weeklyRosters}
                                shifts={shifts}
                                handleEditCell={handleEditCell}
                                salesStats={salesStats}
                                onSalyAlertsUpdate={() => {}}
                                isReadOnly={isPastWeek || !hasPermission('schedules', 'can_edit')}
                            />
                        </div>
                    )}
                </motion.div>
            )}
            </AnimatePresence>

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

            <ConfirmModal
                isOpen={publishState.isOpen}
                onClose={() => setPublishState(prev => ({ ...prev, isOpen: false }))}
                onConfirm={executePublish}
                title={publishState.title}
                message={<span className="whitespace-pre-line text-[13px]">{publishState.message}</span>}
                confirmText={publishState.confirmText}
                cancelText="Cancelar"
                isDestructive={publishState.isDestructive}
                isProcessing={isPublishing}
                theme="light"
            />
        </GlassViewLayout>
    );
};

export default memo(SchedulesView);
