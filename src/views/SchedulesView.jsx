import React, { useState, useMemo, useEffect, useCallback, memo, useRef } from 'react';
import Badge from '../components/common/Badge';
import SegmentedControl from '../components/common/SegmentedControl';
import { EmptyState } from '../components/common/StateViews';
import Button from '../components/common/Button';
import { AnimatePresence, motion } from 'framer-motion';
import { tokenMatch, normSearch } from '../utils/searchUtils';
import {
    CalendarDays, ChevronLeft, ArrowRight, Building2, BookOpen,
    X, Save, Loader2,
    Star, Trash2, Plus, Globe, MapPin, RefreshCw, ChevronRight, CheckCircle2
} from 'lucide-react';

import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import GlassViewLayout from '../components/GlassViewLayout';
import TabShifts from './schedule-tabs/TabShifts';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import ViewTabBar from '../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import FilterBar from '../components/common/FilterBar';
import PeriodStepper from '../components/common/PeriodStepper';

import { formatDateLocal, DAY_NAMES, calculateEmployeeWeeklyHoursLocal, timeToMins, formatHourAMPM } from '../utils/scheduleHelpers';
import { getLocalMonday, formatWeekRange } from '../utils/semana';

import InlineDayEditor from './schedule-tabs/components/InlineDayEditor';
import ScheduleChart from './schedule-tabs/components/ScheduleChart';
import ScheduleCalendar from './schedule-tabs/components/ScheduleCalendar';
import ConfirmModal from '../components/common/ConfirmModal';
import {
    fetchScheduleCoverageAtBranch, fetchScheduleCoverageFromBranch,
    fetchBranchHourlySales, deleteScheduleCoverage, upsertScheduleCoverage,
} from '../data/schedules';
import { fetchRostersForWeekByEmployees } from '../data/requests';
import { upsertWeeklyRoster, upsertBulkWeeklyRosters } from '../data/system';
import PortalInput from '../components/common/PortalInput';
import { mensajeAmigable } from '../utils/errorMessages';

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const ALL_SCHED_TABS = [
    { key: 'calendar', label: 'Horarios', icon: CalendarDays },
    { key: 'shifts',   label: 'Catálogo', icon: BookOpen     },
    { key: 'holidays', label: 'Feriados', icon: Star         },
];

// `formatWeekRange` vive en `scheduleHelpers` desde que Solicitudes y Traslados
// estrenaron su propio filtro de semana: una sola definición para las tres.

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
        const nameMatch = !searchTerm || tokenMatch(searchTerm, h.name);
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
                <SegmentedControl
                    size="sm"
                    tone="warning"
                    label="Año"
                    value={holidayYear}
                    onChange={setHolidayYear}
                    options={[currentYear - 1, currentYear, currentYear + 1].map(y => ({ value: y, label: String(y) }))}
                />
                {canEdit && (
                    <Button
                        size="sm"
                        aria-expanded={showForm}
                        variant={showForm ? 'secondary' : undefined}
                        tone={showForm ? null : 'warning'}
                        icon={showForm ? X : Plus}
                        onClick={() => setShowForm(v => !v)}
                    >
                        {showForm ? 'Cancelar' : 'Agregar feriado'}
                    </Button>
                )}
            </div>

            {/* Add form */}
            {showForm && canEdit && (
                <div data-surface="card" className="p-5 space-y-4 animate-in slide-in-from-top-2 duration-[var(--dur-base)]">
                    <p className="text-caption font-black text-warning uppercase tracking-widest">Nuevo Feriado</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest block mb-1">Nombre</label>
                            <PortalInput
                                        aria-label="Nombre del feriado"
                                        value={hName} onChange={e => setHName(e.target.value)}
                                        placeholder="Ej: Día del Trabajo"
                                    />
                        </div>
                        <div>
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest block mb-1">Fecha</label>
                            <LiquidDatePicker value={hDate} onChange={setHDate} />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <SegmentedControl
                            size="sm"
                            tone="warning"
                            label="Tipo de feriado"
                            value={hType}
                            onChange={setHType}
                            options={[
                                { value: 'NATIONAL',  label: 'Nacional',  icon: Globe },
                                { value: 'MUNICIPAL', label: 'Municipal', icon: MapPin },
                            ]}
                        />
                        {hType === 'MUNICIPAL' && (
                            <PortalInput
                                        aria-label="Municipio del feriado" className="flex-1 min-w-[140px]"
                                        value={hMuni} onChange={e => setHMuni(e.target.value)}
                                        placeholder="Municipio"
                                    />
                        )}
                        <Button
                            size="sm"
                            aria-pressed={hRecurring}
                            variant={hRecurring ? undefined : 'secondary'}
                            tone={hRecurring ? 'success' : null}
                            soft
                            icon={RefreshCw}
                            onClick={() => setHRecurring(v => !v)}
                        >
                            Recurrente
                        </Button>
                    </div>
                    <Button tone="warning" disabled={hSaving || !hDate || !hName.trim()} onClick={onSave}>{hSaving ? <Loader2 size={13} strokeWidth={3} className="animate-spin" /> : <Save size={13} strokeWidth={2.5} />}
                        {hSaving ? 'Guardando...' : 'Guardar feriado'}</Button>
                </div>
            )}

            {/* Holiday list */}
            {byMonth.length === 0 ? (
                <EmptyState
                    compact
                    icon={Star}
                    iconClass="text-warning"
                    glowClass="bg-warning/30"
                    title={searchTerm ? 'Sin resultados' : 'Sin feriados'}
                    subtitle={searchTerm
                        ? `No encontramos feriados que coincidan con "${searchTerm}".`
                        : `Todavía no hay feriados registrados para ${holidayYear}.`}
                />
            ) : (
                <div className="space-y-8">
                    {byMonth.map(({ month, items }) => (
                        <div key={month}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-2 h-7 bg-gradient-to-b from-warning to-chart-4 rounded-full shrink-0" />
                                    <span className="text-body-xl font-black text-content-2 tracking-tight">{month}</span>
                                </div>
                                <div className="h-px flex-1 bg-gradient-to-r from-warning/20 to-transparent" />
                                <Badge variant="warning" size="sm" uppercase={false}>{items.length} {items.length === 1 ? 'feriado' : 'feriados'}</Badge>
                            </div>
                            <div className="space-y-2.5">
                                {items.sort((a,b) => a.holiday_date.localeCompare(b.holiday_date)).map(h => {
                                    const d = new Date(h.holiday_date + 'T12:00:00Z');
                                    const dayNum  = d.getUTCDate();
                                    const dayName = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getUTCDay()];
                                    const isNat   = h.type === 'NATIONAL';
                                    // §20.3 · el material y el lift los pone `data-surface="card"`;
                                    // escribir el lift además en la clase los SUMA (DESIGN.md §5).
                                    return (
                                        <div key={h.id} data-surface="card"
                                            className="group relative flex items-center overflow-hidden
                                                transition-all duration-[var(--dur-slow)]">
                                            {/* Color stripe */}
                                            <div className={`w-1.5 self-stretch shrink-0 rounded-l-[1.5rem] ${isNat ? 'bg-gradient-to-b from-warning to-chart-4' : 'bg-gradient-to-b from-chart-1 to-brand'}`} />
                                            <div className="flex items-center gap-3 px-4 py-3.5 flex-1 min-w-0">
                                                {/* Date badge */}
                                                <div className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${isNat ? 'bg-warning/10 border border-warning/30' : 'bg-chart-1/10 border border-chart-1/30'}`}>
                                                    <span className={`text-micro font-black uppercase tracking-widest leading-none ${isNat ? 'text-warning' : 'text-chart-1-text'}`}>{dayName}</span>
                                                    <span className={`text-title-sm font-black leading-tight ${isNat ? 'text-warning-text' : 'text-chart-1-text'}`}>{dayNum}</span>
                                                </div>
                                                {/* Info */}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-body font-black text-content truncate">{h.name}</p>
                                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                        {isNat ? (
                                                            <Badge variant="warning" size="sm" icon={Globe} uppercase={false}>Nacional</Badge>
                                                        ) : (
                                                            <Badge variant="chart-1" size="sm" icon={MapPin} uppercase={false}>Municipal{h.municipality ? ` · ${h.municipality}` : ''}</Badge>
                                                        )}
                                                        {h.is_recurring && (
                                                            <Badge variant="success" size="sm" icon={RefreshCw} uppercase={false}>Recurrente</Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                {/* Delete */}
                                                {canEdit && (
                                                    <Button variant="destructive" size="sm" disabled={hDeleting === h.id} onClick={() => onDelete(h.id)}>{hDeleting === h.id ? <Loader2 size={14} strokeWidth={2.5} className="animate-spin text-danger" /> : <Trash2 size={14} strokeWidth={2} />}</Button>
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
    const employees = useStaff(s => s.employees);
    const shifts = useStaff(s => s.shifts);
    const branches = useStaff(s => s.branches);
    const holidays = useStaff(s => s.holidays);
    const fetchWeekRosters = useStaff(s => s.fetchWeekRosters);
    const publishWeekRosters = useStaff(s => s.publishWeekRosters);
    const fetchBoot = useStaff(s => s.fetchBoot);
    const addHoliday = useStaff(s => s.addHoliday);
    const deleteHoliday = useStaff(s => s.deleteHoliday);
    const { user, hasPermission, getScope } = useAuth();
    const canEdit  = hasPermission('schedules', 'can_edit');
    const SCHED_TABS = ALL_SCHED_TABS.filter(t => hasPermission(`schedules_tab_${t.key}`));
    const showToast = useToastStore(s => s.showToast);
    const [isPublishing, setIsPublishing] = useState(false);

    useEffect(() => {
        if (shifts.length === 0) fetchBoot?.();
    }, [shifts.length, fetchBoot]);

    const [publishState, setPublishState] = useState({
        isOpen: false, isDestructive: false,
        title: '', message: '', confirmText: '', bulkUpdates: null,
    });

    const [viewMode, setViewMode] = usePestanaEnUrl(SCHED_TABS.length ? SCHED_TABS : ALL_SCHED_TABS, 'calendar');
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

    const [coveragesAtBranch, setCoveragesAtBranch]     = useState([]);
    const [coveragesFromBranch, setCoveragesFromBranch] = useState([]);
    const [coverageRosters, setCoverageRosters]         = useState({});
    const [addedCoverageEmpIds, setAddedCoverageEmpIds] = useState(new Set());
    const [isLoadingSales, setIsLoadingSales] = useState(false);

    useEffect(() => {
        // Con alcance de una sola sala, la que arranca es la PROPIA y no «La
        // Popular»: el selector ya no se dibuja, así que este valor es el
        // único que va a existir en toda la sesión.
        if (branches && branches.length > 0 && !filterBranch && getScope('schedules') !== 'ALL' && user?.branchId) {
            setFilterBranch(String(user.branchId));
            return;
        }
        if (branches && branches.length > 0 && !filterBranch) {
            const popular = branches.find(b => b.name.toLowerCase().includes('popular'));
            setFilterBranch(popular ? String(popular.id) : String(branches[0].id));
        }
    }, [branches, filterBranch, getScope, user?.branchId]);

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

    useEffect(() => {
        if (viewMode !== 'calendar' || !filterBranch || !startDate) return;
        let isMounted = true;
        const load = async () => {
            const { data: atBranch } = await fetchScheduleCoverageAtBranch(filterBranch, startDate);
            if (!isMounted) return;
            const entries = atBranch || [];
            setCoveragesAtBranch(entries);
            setAddedCoverageEmpIds(new Set());

            const empIds = [...new Set(entries.map(e => e.employee_id))];
            if (empIds.length > 0) {
                const { data: rosters } = await fetchRostersForWeekByEmployees(startDate, empIds);
                if (!isMounted) return;
                const map = {};
                (rosters || []).forEach(r => { map[r.employee_id] = r.schedule_data; });
                setCoverageRosters(map);
            } else {
                setCoverageRosters({});
            }

            const myEmpIds = employees
                .filter(e => String(e.branchId || e.branch_id) === String(filterBranch) && (e.status || '').toUpperCase() !== 'INACTIVO')
                .map(e => e.id);
            if (myEmpIds.length > 0) {
                const { data: fromBranch } = await fetchScheduleCoverageFromBranch(myEmpIds, startDate);
                if (!isMounted) return;
                setCoveragesFromBranch(fromBranch || []);
            } else {
                setCoveragesFromBranch([]);
            }
        };
        load();
        return () => { isMounted = false; };
    }, [viewMode, filterBranch, startDate, employees]);

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

                const { data: rawSalesData, error } = await fetchBranchHourlySales(filterBranch, dateStr);

                if (error) throw error;

                let openH = 7; let closeH = 18;
                const currentBranch = branches.find(b => String(b.id) === String(filterBranch));

                if (currentBranch) {
                    let sch = currentBranch.weekly_hours || currentBranch.settings?.schedule;
                    if (typeof sch === 'string') { try { sch = JSON.parse(sch); } catch { sch = null; } }
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
                        let color = 'var(--txvol-muerta)';
                        if      (txPerHr > 18) color = 'var(--txvol-critica)';
                        else if (txPerHr > 12) color = 'var(--txvol-pico)';
                        else if (txPerHr >  4) color = 'var(--txvol-normal)';
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
        return employeesInView.filter(e => tokenMatch(searchTerm, e.name));
    }, [employeesInView, searchTerm]);

    const weekIsPublished = useMemo(() => {
        if (employeesInView.length === 0) return false;
        return employeesInView.some(e => publishedIds.has(String(e.id)));
    }, [employeesInView, publishedIds]);

    const handleSaveCell = useCallback(async (empId, dayId, newCellData) => {
        let latestRoster;
        setWeeklyRosters(prev => {
            const cur = prev[empId] || {};
            const sch = (typeof cur === 'string') ? JSON.parse(cur || '{}') : { ...cur };
            sch[dayId] = newCellData;
            latestRoster = sch;
            return { ...prev, [empId]: sch };
        });
        try {
            const { error } = await upsertWeeklyRoster({
                employee_id: empId, week_start_date: startDate,
                schedule_data: latestRoster, status: 'DRAFT',
            });
            if (error) console.error("Error guardando borrador:", error);
        } catch (err) {
            console.error("Error de red guardando borrador:", err);
        }
    }, [startDate]);

    const handleEditCell = useCallback((empId, dayId, dateStr, currentData, rect) => {
        setEditingCell({ empId, dayId, dateStr, currentData, rect });
    }, []);

    const handleAddCoverageEmployee = useCallback((empId) => {
        setAddedCoverageEmpIds(prev => new Set([...prev, empId]));
    }, []);

    const handleRemoveCoverageEmployee = useCallback(async (empId) => {
        setCoveragesAtBranch(prev => prev.filter(e => e.employee_id !== empId));
        setAddedCoverageEmpIds(prev => { const s = new Set(prev); s.delete(empId); return s; });
        await deleteScheduleCoverage(empId, filterBranch, startDate);
        // Una cobertura dice que alguien de otra sala trabaja acá esa semana.
        // Quitarla o ponerla cambia dónde se espera a una persona, y de eso
        // dependen la marcación y el reclamo de después.
        useStaff.getState().appendAuditLog('QUITAR_COBERTURA', String(empId),
            { sucursal_id: Number(filterBranch), semana: startDate });
    }, [filterBranch, startDate]);

    const handleSaveCoverageCell = useCallback(async (empId, homeBranchId, dayOfWeek, scheduleData) => {
        const entry = {
            employee_id: empId,
            coverage_branch_id: Number(filterBranch),
            home_branch_id: homeBranchId ? Number(homeBranchId) : null,
            week_start_date: startDate,
            day_of_week: dayOfWeek,
            schedule_data: scheduleData,
            updated_at: new Date().toISOString(),
        };
        setCoveragesAtBranch(prev => {
            const idx = prev.findIndex(e => e.employee_id === empId && e.day_of_week === dayOfWeek);
            if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], schedule_data: scheduleData }; return next; }
            return [...prev, entry];
        });
        const { error } = await upsertScheduleCoverage(entry);
        if (error) { console.error('Error guardando cobertura:', error); return; }
        useStaff.getState().appendAuditLog('GUARDAR_COBERTURA', String(empId),
            { sucursal_id: Number(filterBranch), semana: startDate, dia: dayOfWeek });
    }, [filterBranch, startDate]);

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
            if (incompleteCount > 0) msgs.push(`${incompleteCount} empleado(es) con horarios incompletos.`);
            if (excessCount > 0)     msgs.push(`${excessCount} empleado(es) con exceso de horas.`);
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
            const { error: bulkError } = await upsertBulkWeeklyRosters(rosterInserts);
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
        const n = normSearch(b.name);
        return !n.includes('bodega') && !n.includes('administracion') && !n.includes('externos');
    });

    const searchPlaceholder =
        viewMode === 'calendar' ? 'Buscar empleado...' :
        viewMode === 'shifts'   ? 'Buscar turno...' :
                                  'Buscar feriado...';

    const filtersContent = (
        <ViewTabBar
            tabs={SCHED_TABS.length ? SCHED_TABS : ALL_SCHED_TABS}
            activeTab={viewMode}
            onTabChange={goToView}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={searchPlaceholder}
        />
    );

    // "Publicar" volvió a la píldora de filtros el 2026-07-30, y esta vez sin el
    // problema que la había echado: entonces se mezclaba con las ranuras y leía
    // como un filtro más; ahora las acciones van tras un divisor y en su propio
    // bloque, que es lo que las distingue.
    const puedePublicar = viewMode === 'calendar' && canEdit && getScope('schedules') === 'ALL';
    const accionesHorarios = puedePublicar ? [{
        key: 'publicar',
        icon: isPublishing ? Loader2 : weekIsPublished ? CheckCircle2 : Save,
        label: isPublishing ? 'Publicando…' : weekIsPublished ? 'Publicado' : 'Publicar',
        // Bajo el pulgar el rótulo es fijo: los tres estados los dicen el ícono
        // (guardar / reloj / ✔) y el color, y "PUBLICANDO…" no entra en la columna.
        rotulo: 'Publicar',
        variant: weekIsPublished ? 'quiet' : 'primary',
        tone: 'success',
        disabled: isPublishing || weekIsPublished || employeesInView.length === 0 || isPastWeek,
        onClick: weekIsPublished ? undefined : triggerPublishAudit,
    }] : [];

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

    // ── Barra de filtros (§17) ────────────────────────────────────────────────
    // Era una píldora escrita a mano, y encima `hidden lg:flex`: bajo 1024px la
    // vista se quedaba SIN selector de sucursal y SIN navegador de semana —
    // desde una tablet no había forma de ver otra semana. `FilterBar` colapsa a
    // hoja inferior en vez de desaparecer, así que el filtro existe siempre.
    //
    // Las flechas de semana también se revelaban al pasar el mouse
    // (`w-0 opacity-0 group-hover/week:w-8`): con dedo o con teclado no había
    // forma de descubrirlas. `PeriodStepper` las muestra siempre.
    const filtrosCuerpo = (
        <FilterBar
            onClear={handleResetFilters}
            activeCount={[!isDefaultWeek].filter(Boolean).length}
            acciones={accionesHorarios}
        >
            {/* Sólo con alcance sobre todas. `validBranches` sale del catálogo
                —todas las farmacias— y no del permiso, así que sin esta guarda
                una sala podía abrir el horario de otra. Cuando no la hay, el
                efecto de arranque de más arriba deja fija la propia. */}
            {getScope('schedules') === 'ALL' && (
                <FilterBar.Section label="sucursal">
                    <FilterBar.Sucursal value={filterBranch} onChange={setFilterBranch}
                        options={validBranches.map(b => ({ value: String(b.id), label: b.name }))} />
                </FilterBar.Section>
            )}

            <FilterBar.Section active={!isDefaultWeek} onClear={handleResetFilters} label="semana">
                <PeriodStepper
                    unit="semana"
                    label={formatWeekRange(startDate)}
                    isCurrent={isDefaultWeek}
                    resetLabel="Semana actual"
                    onPrev={() => changeWeek(-7)}
                    onNext={() => changeWeek(7)}
                    onReset={handleResetFilters}
                />
            </FilterBar.Section>
        </FilterBar>
    );

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
                            } catch(e) { showToast('Error', mensajeAmigable(e), 'error'); }
                            finally { setHSaving(false); }
                        }}
                        onDelete={async (id) => {
                            setHDeleting(id);
                            try {
                                await deleteHoliday(id);
                                showToast('Feriado eliminado', '', 'success');
                            } catch(e) { showToast('Error', mensajeAmigable(e), 'error'); }
                            finally { setHDeleting(null); }
                        }}
                    />
                </motion.div>
            ) : (
                <motion.div key="calendar"
                    initial={{ opacity: 0, x: viewDirRef.current * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: viewDirRef.current * -40 }}
                    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    className="w-full flex-1 flex flex-col p-2 md:p-4 lg:px-6 mx-auto h-full overflow-hidden">

                    {/* Chart (left) + filter pill (right) — same height */}
                    <div className="flex items-stretch gap-3 pb-3 shrink-0">
                        <div className="flex-1 min-w-0">
                            <ScheduleChart
                                chartTitle={chartTitle}
                                chartView={chartView} setChartView={setChartView}
                                isLoadingSales={isLoadingSales}
                                currentChartData={currentChartData}
                                openModal={openModal}
                            />
                        </div>
                        <div className="flex items-center shrink-0">
                            {filtrosCuerpo}
                        </div>
                    </div>

                    {employeesInView.length === 0 ? (
                        <EmptyState
                            icon={CalendarDays}
                            title="Sin empleados"
                            subtitle="No hay empleados activos en esta sucursal."
                            action={
                                <Button icon={ArrowRight} onClick={goToPersonal}>
                                    Ir al módulo de Personal
                                </Button>
                            }
                        />
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
                                coveragesAtBranch={coveragesAtBranch}
                                coveragesFromBranch={coveragesFromBranch}
                                coverageRosters={coverageRosters}
                                addedCoverageEmpIds={addedCoverageEmpIds}
                                allEmployees={employees}
                                branches={branches}
                                currentBranchId={filterBranch}
                                onAddCoverageEmployee={handleAddCoverageEmployee}
                                onRemoveCoverageEmployee={handleRemoveCoverageEmployee}
                                onEditCoverageCell={(emp, dayId, dateStr, currentData, rect, homeBranch) => {
                                    setEditingCell({
                                        empId: emp.id, dayId, dateStr,
                                        currentData: currentData || {},
                                        rect, isCoverage: true,
                                        coverageHomeBranchId: homeBranch?.id,
                                        coverageHomeBranchName: homeBranch?.name || 'su sucursal',
                                    });
                                }}
                            />
                        </div>
                    )}
                </motion.div>
            )}
            </AnimatePresence>

            {editingCell && (
                <InlineDayEditor
                    employee={editingCell.isCoverage
                        ? employees.find(e => e.id === editingCell.empId)
                        : employeesInView.find(e => e.id === editingCell.empId)
                    }
                    dateStr={editingCell.dateStr}
                    dayId={editingCell.dayId}
                    currentData={editingCell.currentData}
                    shifts={shifts}
                    filterBranch={filterBranch}
                    anchorRect={editingCell.rect}
                    onClose={() => setEditingCell(null)}
                    onSave={(dayId, newData) => {
                        if (editingCell.isCoverage) {
                            handleSaveCoverageCell(editingCell.empId, editingCell.coverageHomeBranchId, Number(dayId), newData);
                        } else {
                            handleSaveCell(editingCell.empId, dayId, newData);
                        }
                    }}
                    coverageMeta={editingCell.isCoverage ? { homeBranchName: editingCell.coverageHomeBranchName } : null}
                />
            )}

            <ConfirmModal
                isOpen={publishState.isOpen}
                onClose={() => setPublishState(prev => ({ ...prev, isOpen: false }))}
                onConfirm={executePublish}
                title={publishState.title}
                message={<span className="whitespace-pre-line text-body">{publishState.message}</span>}
                confirmText={publishState.confirmText}
                cancelText="Cancelar"
                isDestructive={publishState.isDestructive}
                isProcessing={isPublishing}
            />
        </GlassViewLayout>
    );
};

export default memo(SchedulesView);
