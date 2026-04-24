import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    Palmtree, Plus, Check, X, User, Calendar, AlertCircle, Search,
    ChevronLeft, ChevronRight, Loader2, CheckCircle2, Clock, Ban, Edit2, Edit3,
    Building2, ListFilter
} from 'lucide-react';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import RangeDatePicker from '../components/common/RangeDatePicker';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate  = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtShort = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—';
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000) + 1;

const STATUS_META = {
    PLANNED:   { label: 'Planificado', bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    bar: 'bg-blue-400'    },
    CONFIRMED: { label: 'Confirmado',  bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'bg-emerald-400' },
    TAKEN:     { label: 'Tomado',      bg: 'bg-slate-100',  text: 'text-slate-500',   border: 'border-slate-200',   bar: 'bg-slate-300'   },
    CANCELLED: { label: 'Cancelado',   bg: 'bg-red-50',     text: 'text-red-500',     border: 'border-red-200',     bar: 'bg-red-300'     },
};

const StatusBadge = ({ status }) => {
    const m = STATUS_META[status] || STATUS_META.PLANNED;
    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${m.bg} ${m.text} ${m.border}`}>
            {m.label}
        </span>
    );
};

const InputLabel = ({ children }) => (
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 ml-1">{children}</p>
);

const glassInput = "w-full px-4 py-3 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.12)] rounded-2xl text-[13px] outline-none font-bold text-slate-700 transition-all duration-300 placeholder-slate-400 placeholder:font-normal";

// ── Eligibility Banner ────────────────────────────────────────────────────────
const EligibilityBanner = ({ info }) => {
    if (!info) return null;
    const { isEligible, isNearEligible, inWindow, yearsWorked, monthsWorked, lastAnniversary, windowEnd, nextAnniversary } = info;

    let cfg;
    if (isEligible && inWindow) {
        cfg = {
            bg: 'bg-emerald-50/80 border-emerald-200/60',
            icon: <CheckCircle2 size={10} strokeWidth={2.5} className="text-emerald-700" />,
            label: 'Dentro de ventana válida',
            labelColor: 'text-emerald-700',
            bodyColor: 'text-emerald-800',
        };
    } else if (isEligible && !inWindow) {
        cfg = {
            bg: 'bg-amber-50/80 border-amber-200/60',
            icon: <AlertCircle size={10} strokeWidth={2.5} className="text-amber-700" />,
            label: 'Fuera de ventana óptima',
            labelColor: 'text-amber-700',
            bodyColor: 'text-amber-800',
        };
    } else if (!isEligible && isNearEligible) {
        cfg = {
            bg: 'bg-orange-50/80 border-orange-200/60',
            icon: <Clock size={10} strokeWidth={2.5} className="text-orange-700" />,
            label: 'Asignación anticipada',
            labelColor: 'text-orange-700',
            bodyColor: 'text-orange-800',
        };
    } else {
        cfg = {
            bg: 'bg-red-50/80 border-red-200/60',
            icon: <Ban size={10} strokeWidth={2.5} className="text-red-700" />,
            label: 'No elegible',
            labelColor: 'text-red-700',
            bodyColor: 'text-red-800',
        };
    }

    return (
        <div className={`rounded-2xl p-4 border space-y-1.5 ${cfg.bg}`}>
            <p className={`font-black uppercase tracking-widest text-[9px] flex items-center gap-1.5 ${cfg.labelColor}`}>
                {cfg.icon} {cfg.label}
            </p>
            {isEligible ? (
                <>
                    <p className={`text-[11px] font-medium ${cfg.bodyColor}`}>
                        Antigüedad: <strong>{yearsWorked} años</strong>
                    </p>
                    <p className={`text-[11px] font-medium ${cfg.bodyColor}`}>
                        Último aniversario: <strong>{fmtDate(lastAnniversary?.toISOString().split('T')[0])}</strong>
                    </p>
                    <p className={`text-[11px] font-medium ${cfg.bodyColor}`}>
                        Ventana válida hasta: <strong>{fmtDate(windowEnd?.toISOString().split('T')[0])}</strong>
                    </p>
                </>
            ) : (
                <>
                    <p className={`text-[11px] font-medium ${cfg.bodyColor}`}>
                        Antigüedad actual: <strong>{monthsWorked} meses</strong>
                    </p>
                    {nextAnniversary && (
                        <p className={`text-[11px] font-medium ${cfg.bodyColor}`}>
                            Próximo aniversario: <strong>{fmtDate(nextAnniversary.toISOString().split('T')[0])}</strong>
                        </p>
                    )}
                    {isNearEligible && (
                        <p className={`text-[10px] font-medium ${cfg.bodyColor} opacity-80`}>
                            Se puede asignar con advertencia de anticipación.
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

// ── Gantt ─────────────────────────────────────────────────────────────────────
const GanttChart = ({ plans, year }) => {
    const months = Array.from({ length: 12 }, (_, i) => ({
        idx:   i,
        label: new Date(year, i, 1).toLocaleDateString('es-VE', { month: 'short' }),
        days:  new Date(year, i + 1, 0).getDate(),
    }));

    const yearStart = new Date(year, 0, 1);
    const yearEnd   = new Date(year, 11, 31);
    const totalMs   = yearEnd - yearStart;

    const pct = (dateStr) => {
        const d = new Date(dateStr + 'T12:00:00');
        return Math.max(0, Math.min(100, ((d - yearStart) / totalMs) * 100));
    };
    const widthPct = (start, end) => {
        const s = new Date(start + 'T12:00:00');
        const e = new Date(end   + 'T12:00:00');
        return Math.max(0.8, ((e - s) / totalMs) * 100);
    };

    // Sort by branch name → role → employee name
    const rows = useMemo(() => {
        const map = new Map();
        plans.filter(p => p.status !== 'CANCELLED').forEach(p => {
            const key = String(p.employee_id);
            if (!map.has(key)) map.set(key, { emp: p.employee, branch: p.branch, bars: [] });
            map.get(key).bars.push(p);
        });
        return Array.from(map.values()).sort((a, b) => {
            const branchA = a.branch?.name || '';
            const branchB = b.branch?.name || '';
            if (branchA !== branchB) return branchA.localeCompare(branchB);
            const roleA = a.emp?.role || a.emp?.position || '';
            const roleB = b.emp?.role || b.emp?.position || '';
            if (roleA !== roleB) return roleA.localeCompare(roleB);
            return (a.emp?.name || '').localeCompare(b.emp?.name || '');
        });
    }, [plans]);

    if (rows.length === 0) return (
        <div className="flex flex-col items-center py-10 gap-3 text-slate-400">
            <Palmtree size={36} strokeWidth={1} />
            <p className="text-[13px] font-bold text-slate-500">Sin planes para este año</p>
        </div>
    );

    let lastBranchName = null;

    return (
        <div className="overflow-x-auto">
            <div className="min-w-[560px]">
                {/* Month headers */}
                <div className="flex mb-2 ml-[160px]">
                    {months.map(m => (
                        <div
                            key={m.idx}
                            className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center border-l border-slate-100/80 first:border-l-0 py-1"
                            style={{ flex: `${m.days} 0 0%` }}
                        >
                            {m.label}
                        </div>
                    ))}
                </div>

                {/* Rows */}
                <div className="space-y-1">
                    {rows.map(({ emp, branch, bars }) => {
                        const branchName = branch?.name || '';
                        const showHeader = branchName !== lastBranchName;
                        lastBranchName = branchName;

                        return (
                            <React.Fragment key={emp?.id || bars[0]?.employee_id}>
                                {showHeader && branchName && (
                                    <div className="flex items-center gap-2 mt-3 mb-1 ml-0 pr-0">
                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 w-[160px] text-right pr-3 shrink-0">
                                            {branchName}
                                        </span>
                                        <div className="flex-1 h-px bg-slate-100" />
                                    </div>
                                )}
                                <div className="flex items-center gap-2 group/row">
                                    <div className="w-[160px] shrink-0 flex items-center gap-2 pr-2">
                                        <div className="w-7 h-7 rounded-full overflow-hidden bg-slate-100 border border-white shadow-sm shrink-0 flex items-center justify-center text-slate-500 font-black text-[11px]">
                                            {(emp?.photo || emp?.photo_url)
                                                ? <img src={emp?.photo || emp?.photo_url} alt={emp?.name} className="w-full h-full object-cover" />
                                                : (emp?.name || '?').charAt(0).toUpperCase()
                                            }
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-700 truncate group-hover/row:text-[#007AFF] transition-colors">{emp?.name || 'Empleado'}</span>
                                    </div>
                                    <div className="flex-1 h-7 bg-white/50 border border-slate-100 rounded-xl relative overflow-visible">
                                        {/* Month grid lines */}
                                        {months.map(m => (
                                            <div
                                                key={m.idx}
                                                className="absolute top-0 bottom-0 border-l border-slate-100/60"
                                                style={{ left: `${pct(`${year}-${String(m.idx + 1).padStart(2, '0')}-01`)}%` }}
                                            />
                                        ))}
                                        {/* Bars */}
                                        {bars.map(p => {
                                            const meta = STATUS_META[p.status] || STATUS_META.PLANNED;
                                            return (
                                                <div
                                                    key={p.id}
                                                    className={`absolute top-1 bottom-1 rounded-lg ${meta.bar} opacity-75 hover:opacity-100 transition-opacity cursor-default group/bar`}
                                                    style={{ left: `${pct(p.start_date)}%`, width: `${widthPct(p.start_date, p.end_date)}%` }}
                                                >
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/bar:flex flex-col items-center z-50 pointer-events-none">
                                                        <div className="bg-slate-900/90 backdrop-blur text-white text-[9px] font-bold rounded-xl px-3 py-2 shadow-xl whitespace-nowrap text-center">
                                                            <span className="block font-black text-[8px] uppercase tracking-widest text-slate-400 mb-0.5">{meta.label}</span>
                                                            <span>{fmtShort(p.start_date)} → {fmtShort(p.end_date)}</span>
                                                            <span className="ml-2 text-slate-400">· {p.days}d</span>
                                                        </div>
                                                        <div className="w-2 h-2 bg-slate-900/90 rotate-45 -mt-1" />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-4 ml-[160px]">
                    {Object.entries(STATUS_META).filter(([k]) => k !== 'CANCELLED').map(([k, m]) => (
                        <div key={k} className="flex items-center gap-1.5">
                            <div className={`w-3 h-3 rounded-sm ${m.bar}`} />
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{m.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ── Vista principal ───────────────────────────────────────────────────────────
const VacationPlanView = () => {
    const { user, rolePerms } = useAuth();
    const canEdit = rolePerms === 'ALL' || !!rolePerms?.['vacation_plan']?.can_edit;
    const employees              = useStaffStore(s => s.employees);
    const branches               = useStaffStore(s => s.branches);
    const holidays               = useStaffStore(s => s.holidays);
    const vacationPlans          = useStaffStore(s => s.vacationPlans);
    const isLoadingVacationPlans = useStaffStore(s => s.isLoadingVacationPlans);
    const fetchVacationPlans     = useStaffStore(s => s.fetchVacationPlans);
    const createVacationPlan     = useStaffStore(s => s.createVacationPlan);
    const updateVacationPlan     = useStaffStore(s => s.updateVacationPlan);
    const updateVacationPlanStatus = useStaffStore(s => s.updateVacationPlanStatus);

    const uniqueBranches = useMemo(() => {
        const seen = new Set();
        return (branches || []).filter(b => {
            if (seen.has(b.id)) return false;
            seen.add(b.id);
            return true;
        });
    }, [branches]);

    const currentYear = new Date().getFullYear();
    const [year, setYear]               = useState(currentYear);
    const [branchFilter, setBranchFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('ALL');

    const [empId, setEmpId]         = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate]     = useState('');
    const [notes, setNotes]         = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const searchInputRef = useRef(null);
    const panelRef = useRef(null);

    // Panel edit state — when set, left panel is in edit mode
    const [editingPlan, setEditingPlan] = useState(null); // { id, employee_id, start_date, end_date, notes, employee_obj }
    const [confirmingEdit, setConfirmingEdit] = useState(false);

    useEffect(() => {
        fetchVacationPlans(year, branchFilter === 'ALL' ? null : branchFilter);
    }, [year, branchFilter]);

    const assignedEmployeeIds = useMemo(() => {
        return new Set(
            vacationPlans
                .filter(vp => vp.year === year && vp.status !== 'CANCELLED')
                .map(vp => String(vp.employee_id))
        );
    }, [vacationPlans, year]);

    const employeeOptions = useMemo(() => {
        const now = new Date();
        let emps = (employees || []).filter(e => e.status === 'ACTIVO' || e.status === 'ACTIVE');
        if (branchFilter !== 'ALL') {
            emps = emps.filter(e => String(e.branch_id || e.branchId) === String(branchFilter));
        }
        return emps.map(e => {
            const branch = uniqueBranches.find(b => String(b.id) === String(e.branch_id || e.branchId));
            if (assignedEmployeeIds.has(String(e.id))) {
                return {
                    value: String(e.id),
                    label: e.name,
                    sublabel: `✓ Vacaciones asignadas ${year} · ${branch?.name || '—'}`,
                    avatar: e.photo || e.photo_url || null,
                    disabled: true,
                };
            }
            if (!e.hire_date) {
                return {
                    value: String(e.id),
                    label: e.name,
                    sublabel: '⚠ Sin fecha de ingreso — Actualizar datos',
                    avatar: e.photo || e.photo_url || null,
                    disabled: true,
                };
            }
            const hire = new Date(e.hire_date + 'T12:00:00');
            const yearsWorked = (now - hire) / (1000 * 60 * 60 * 24 * 365.25);
            const monthsWorked = Math.floor(yearsWorked * 12);
            const isEligible = yearsWorked >= 1;
            return {
                value: String(e.id),
                label: e.name,
                sublabel: isEligible
                    ? `${e.role || e.position || 'Empleado'} · ${branch?.name || '—'}`
                    : `⏳ ${monthsWorked} mes${monthsWorked !== 1 ? 'es' : ''} · Falta ${12 - monthsWorked} mes(es) · ${branch?.name || '—'}`,
                avatar: e.photo || e.photo_url || null,
                disabled: !isEligible,
            };
        });
    }, [employees, uniqueBranches, branchFilter, assignedEmployeeIds]);

    const groupedOptions = useMemo(() => {
        const eligible = employeeOptions
            .filter(o => !o.disabled)
            .sort((a, b) => {
                const empA = employees.find(e => String(e.id) === a.value);
                const empB = employees.find(e => String(e.id) === b.value);
                const brA = uniqueBranches.find(b => String(b.id) === String(empA?.branch_id || empA?.branchId))?.name || '';
                const brB = uniqueBranches.find(b => String(b.id) === String(empB?.branch_id || empB?.branchId))?.name || '';
                if (brA !== brB) return brA.localeCompare(brB);
                return a.label.localeCompare(b.label);
            });
        const notEligible = employeeOptions
            .filter(o => o.disabled)
            .sort((a, b) => a.label.localeCompare(b.label));

        const result = [];
        let currentBranch = null;
        eligible.forEach(opt => {
            const emp = employees.find(e => String(e.id) === opt.value);
            const branch = uniqueBranches.find(b => String(b.id) === String(emp?.branch_id || emp?.branchId));
            const branchName = branch?.name || '—';
            if (branchName !== currentBranch) {
                currentBranch = branchName;
                result.push({ value: `__sep_${branchName}`, label: branchName, isSeparator: true, disabled: true });
            }
            result.push(opt);
        });
        if (notEligible.length > 0) {
            result.push({ value: '__sep_not_eligible', label: 'Sin elegibilidad', isSeparator: true, disabled: true });
            result.push(...notEligible);
        }
        return result;
    }, [employeeOptions, employees, uniqueBranches]);

    const branchOptions = useMemo(() => [
        { value: 'ALL', label: 'Todas las sucursales' },
        ...uniqueBranches.map(b => ({ value: String(b.id), label: b.name })),
    ], [uniqueBranches]);

    const selectedEmployee = useMemo(() => employees.find(e => String(e.id) === String(empId)), [employees, empId]);

    const eligibilityInfo = useMemo(() => {
        if (!selectedEmployee?.hire_date) return null;
        const hire = new Date(selectedEmployee.hire_date + 'T12:00:00');
        const now  = new Date();
        const msWorked    = now - hire;
        const yearsWorked = msWorked / (1000 * 60 * 60 * 24 * 365.25);
        const monthsWorked = Math.floor(msWorked / (1000 * 60 * 60 * 24 * 30.44));
        const isEligible   = yearsWorked >= 1;
        const isNearEligible = !isEligible && monthsWorked >= 9;

        const nextAnniversary = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());
        if (nextAnniversary < now) nextAnniversary.setFullYear(now.getFullYear() + 1);
        const lastAnniversary = new Date(nextAnniversary);
        lastAnniversary.setFullYear(lastAnniversary.getFullYear() - 1);
        const windowEnd = new Date(lastAnniversary);
        windowEnd.setMonth(windowEnd.getMonth() + 3);
        const inWindow = isEligible && now >= lastAnniversary && now <= windowEnd;

        return {
            isEligible,
            isNearEligible,
            yearsWorked: Math.floor(yearsWorked * 10) / 10,
            monthsWorked,
            nextAnniversary,
            lastAnniversary,
            windowEnd,
            inWindow,
        };
    }, [selectedEmployee]);

    const computedDays = useMemo(() => {
        if (!startDate || !endDate || endDate < startDate) return 0;
        return daysBetween(startDate, endDate);
    }, [startDate, endDate]);

    const handleRangeChange = (start, end) => {
        setStartDate(start || '');
        setEndDate(end || '');
    };

    const handleStartEdit = (plan) => {
        setEditingPlan(plan);
        setEmpId(String(plan.employee_id));
        setStartDate(plan.start_date);
        setEndDate(plan.end_date);
        setNotes(plan.notes || '');
        setConfirmingEdit(false);
        // Only scroll on mobile (panel is always visible on desktop)
        if (window.innerWidth < 1024) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleCancelEdit = () => {
        setEditingPlan(null);
        setConfirmingEdit(false);
        setEmpId(''); setStartDate(''); setEndDate(''); setNotes('');
    };

    const handleSubmit = async (ev) => {
        ev.preventDefault();
        if (!empId || !startDate || !endDate) {
            useToastStore.getState().showToast('Error', 'Completa empleado y fechas.', 'error');
            return;
        }
        if (endDate < startDate) {
            useToastStore.getState().showToast('Error', 'La fecha de fin debe ser posterior al inicio.', 'error');
            return;
        }

        // Edit mode — require confirmation step first
        if (editingPlan) {
            if (!confirmingEdit) { setConfirmingEdit(true); return; }
            setIsSubmitting(true);
            setConfirmingEdit(false);
            const ok = await updateVacationPlan(editingPlan.id, {
                start_date: startDate,
                end_date:   endDate,
                days:       computedDays,
                notes:      notes.trim() || null,
            });
            setIsSubmitting(false);
            if (ok) {
                useToastStore.getState().showToast('Guardado', 'Plan actualizado.', 'success');
                handleCancelEdit();
            } else {
                useToastStore.getState().showToast('Error', 'No se pudo actualizar.', 'error');
            }
            return;
        }

        // Create mode
        setIsSubmitting(true);
        try {
            const emp = employees.find(e => String(e.id) === String(empId));
            await createVacationPlan({
                year,
                employee_id: empId,
                branch_id:   emp?.branch_id || emp?.branchId,
                start_date:  startDate,
                end_date:    endDate,
                days:        computedDays,
                notes:       notes.trim() || null,
                created_by:  user?.id,
            });
            useToastStore.getState().showToast('Listo', 'Vacaciones asignadas correctamente.', 'success');
            setEmpId(''); setStartDate(''); setEndDate(''); setNotes('');
        } catch (err) {
            const msg = err.message || '';
            if (msg.startsWith('WINDOW_ERROR:')) {
                useToastStore.getState().showToast('Fuera de ventana', msg.replace('WINDOW_ERROR: ', ''), 'warning');
            } else if (msg.startsWith('OVERLAP_ERROR:')) {
                useToastStore.getState().showToast('Solapamiento', msg.replace('OVERLAP_ERROR: ', ''), 'error');
            } else {
                useToastStore.getState().showToast('Error', msg || 'No se pudo guardar.', 'error');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConfirmPlan = async (planId) => {
        await updateVacationPlanStatus(planId, 'CONFIRMED');
        useToastStore.getState().showToast('Confirmado', 'Vacaciones confirmadas.', 'success');
    };

    // Sort filtered plans by branch → role → start_date
    const filtered = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return vacationPlans
            .filter(p => statusFilter === 'ALL' || p.status === statusFilter)
            .filter(p => !q || (p.employee?.name || '').toLowerCase().includes(q) || (p.branch?.name || '').toLowerCase().includes(q))
            .slice()
            .sort((a, b) => {
                const brA = a.branch?.name || '';
                const brB = b.branch?.name || '';
                if (brA !== brB) return brA.localeCompare(brB);
                const roA = a.employee?.role || a.employee?.position || '';
                const roB = b.employee?.role || b.employee?.position || '';
                if (roA !== roB) return roA.localeCompare(roB);
                return a.start_date.localeCompare(b.start_date);
            });
    }, [vacationPlans, statusFilter, searchTerm]);

    const filtersContent = (
        <div className="flex items-center bg-white/20 backdrop-blur-2xl backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_25px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu overflow-hidden w-max max-w-full">

            {/* Search mode */}
            <div className={`flex items-center gap-2 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isSearchMode ? 'max-w-[800px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'}`}>
                <div className="flex items-center bg-white/60 backdrop-blur-md rounded-full px-4 h-10 gap-2 min-w-[260px] border border-white/80 shadow-sm">
                    <Search size={14} className="text-slate-400 shrink-0" strokeWidth={2.5} />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Buscar empleado o sucursal…"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="bg-transparent outline-none text-[12px] font-semibold text-slate-700 placeholder-slate-400 w-full"
                    />
                    {searchTerm && (
                        <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={13} strokeWidth={2.5} />
                        </button>
                    )}
                </div>
                <button
                    onClick={() => { setIsSearchMode(false); setSearchTerm(''); }}
                    className="px-4 h-10 rounded-full bg-white/60 backdrop-blur-md text-slate-500 hover:text-slate-800 hover:bg-white text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border border-white/60 hover:shadow-sm active:scale-95">
                    Cancelar
                </button>
            </div>

            {/* Normal mode */}
            <div className={`flex items-center gap-1 md:gap-2 h-full transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[1200px] opacity-100'}`}>

                {/* Year selector */}
                <div className="flex items-center bg-white/50 backdrop-blur-md rounded-full border border-white/80 shadow-[inset_0_1px_6px_rgba(255,255,255,0.6),0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08),inset_0_1px_6px_rgba(255,255,255,0.8)] hover:bg-white/70 h-[calc(100%-8px)] shrink-0 transition-all duration-300 p-0.5">
                    <button onClick={() => setYear(y => y - 1)} className="w-8 h-full rounded-full flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-white hover:shadow-sm transition-all duration-200 active:scale-90">
                        <ChevronLeft size={14} strokeWidth={2.5} />
                    </button>
                    <span className="text-[12px] font-black text-slate-700 px-2 min-w-[46px] text-center select-none">{year}</span>
                    <button onClick={() => setYear(y => y + 1)} disabled={year >= currentYear + 1} className="w-8 h-full rounded-full flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-white hover:shadow-sm transition-all duration-200 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed">
                        <ChevronRight size={14} strokeWidth={2.5} />
                    </button>
                </div>

                <div className="w-px h-6 bg-white/50 mx-1 shrink-0" />

                {/* Branch filter */}
                <div className="w-[190px] overflow-visible hover:-translate-y-0.5 transition-transform duration-300 h-full flex items-center shrink-0">
                    <LiquidSelect
                        value={branchFilter}
                        onChange={val => setBranchFilter(val)}
                        options={branchOptions}
                        placeholder="Todas las sucursales"
                        compact
                        clearable={false}
                        icon={Building2}
                    />
                </div>

                <div className="w-px h-6 bg-white/50 mx-1 shrink-0" />

                {/* Status filter */}
                <div className="w-[170px] overflow-visible hover:-translate-y-0.5 transition-transform duration-300 h-full flex items-center shrink-0">
                    <LiquidSelect
                        value={statusFilter}
                        onChange={val => setStatusFilter(val || 'ALL')}
                        options={[
                            { value: 'ALL',       label: 'Todos los estados' },
                            { value: 'PLANNED',   label: 'Planificados'      },
                            { value: 'CONFIRMED', label: 'Confirmados'       },
                            { value: 'TAKEN',     label: 'Tomados'           },
                        ]}
                        compact
                        clearable={false}
                        icon={ListFilter}
                    />
                </div>

                <div className="w-px h-6 bg-white/50 mx-1 shrink-0" />

                {/* Search button — blue pill standard */}
                <button
                    onClick={() => { setIsSearchMode(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                    className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu"
                    title="Buscar">
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {searchTerm && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
    );

    return (
        <>

            <GlassViewLayout icon={Palmtree} title="Plan Anual de Vacaciones" filtersContent={filtersContent} transparentBody={true} fixedScrollMode={true}>
                <div className="flex flex-col lg:flex-row items-start gap-6 px-2 md:px-0 w-full h-full lg:h-[calc(100vh-230px)]">

                    {/* ── Panel izquierdo: Formulario (crear / editar) ── */}
                    <div ref={panelRef} className="w-full lg:w-[400px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8">
                        <div className={`backdrop-blur-[30px] rounded-[2.5rem] p-6 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] relative ${
                            editingPlan
                                ? 'bg-white/60 border border-amber-300/80 shadow-[0_12px_40px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,0.7)]'
                                : 'bg-white/40 border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.10),inset_0_2px_15px_rgba(255,255,255,0.7)]'
                        }`}>
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-sm shrink-0 transition-colors duration-500 ${editingPlan ? 'bg-amber-500' : 'bg-[#007AFF]'}`}>
                                        {editingPlan
                                            ? <Edit3 size={16} className="text-white" strokeWidth={2.5} />
                                            : <Plus size={16} className="text-white" strokeWidth={2.5} />
                                        }
                                    </div>
                                    <h3 className="font-black text-slate-800 text-[15px] uppercase tracking-tight">
                                        {editingPlan ? 'Editar Asignación' : 'Nueva Asignación'}
                                    </h3>
                                </div>
                                {editingPlan && (
                                    <button
                                        onClick={handleCancelEdit}
                                        className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-50 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-xl transition-all duration-300 border border-red-200 shadow-sm active:scale-95 group"
                                    >
                                        <X size={12} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-300" /> Cancelar
                                    </button>
                                )}
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-5">
                                {/* Empleado */}
                                <div>
                                    <InputLabel>Empleado</InputLabel>
                                    <LiquidSelect
                                        value={empId}
                                        onChange={val => { if (!editingPlan) setEmpId(val); }}
                                        options={editingPlan
                                            ? [{ value: String(editingPlan.employee_id), label: editingPlan.employee?.name || '—', avatar: editingPlan.employee?.photo || null }]
                                            : groupedOptions
                                        }
                                        placeholder="Seleccionar empleado…"
                                        disabled={!!editingPlan}
                                    />
                                </div>

                                {/* Eligibility banner — only on create */}
                                {!editingPlan && selectedEmployee && <EligibilityBanner info={eligibilityInfo} />}

                                {/* RangeDatePicker */}
                                <div>
                                    <InputLabel>Período de vacaciones</InputLabel>
                                    <RangeDatePicker
                                        startDate={startDate}
                                        endDate={endDate}
                                        onRangeChange={handleRangeChange}
                                        holidays={holidays || []}
                                        defaultDays={15}
                                        label="Seleccionar fechas"
                                    />
                                </div>

                                {/* Días calculados */}
                                {computedDays > 0 && (
                                    <div className={`flex items-center gap-2 px-4 py-2.5 border rounded-2xl transition-colors duration-500 ${editingPlan ? 'bg-amber-500/8 border-amber-500/15' : 'bg-[#007AFF]/8 border-[#007AFF]/15'}`}>
                                        <Calendar size={13} className={editingPlan ? 'text-amber-600' : 'text-[#007AFF]'} strokeWidth={2.5} />
                                        <span className={`text-[12px] font-black ${editingPlan ? 'text-amber-700' : 'text-[#007AFF]'}`}>{computedDays} días calendario</span>
                                    </div>
                                )}

                                {/* Notas */}
                                <div>
                                    <InputLabel>Notas (opcional)</InputLabel>
                                    <textarea
                                        value={notes}
                                        onChange={e => setNotes(e.target.value)}
                                        placeholder="Observaciones adicionales…"
                                        rows={2}
                                        className={`${glassInput} resize-none leading-relaxed`}
                                    />
                                </div>

                                {/* Confirmación inline al guardar edición */}
                                {confirmingEdit && (
                                    <div className="flex items-center gap-3 px-4 py-3 bg-amber-50/80 border border-amber-200/60 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-200">
                                        <AlertCircle size={14} className="text-amber-600 shrink-0" strokeWidth={2.5} />
                                        <span className="text-[11px] font-black text-amber-800 flex-1">¿Confirmar cambios?</span>
                                        <button type="button" onClick={() => setConfirmingEdit(false)} className="text-[10px] font-black text-slate-500 hover:text-slate-700 uppercase tracking-widest px-2 py-1 rounded-lg hover:bg-white/60 transition-all">No</button>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={!canEdit || isSubmitting || !empId || !startDate || !endDate}
                                    className={`w-full h-[48px] disabled:bg-slate-300 text-white rounded-[1.25rem] font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all duration-500 active:scale-[0.98] disabled:shadow-none ${
                                        confirmingEdit
                                            ? 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_4px_12px_rgba(34,197,94,0.3)]'
                                            : editingPlan
                                                ? 'bg-amber-500 hover:bg-amber-600 shadow-[0_4px_12px_rgba(245,158,11,0.3)]'
                                                : 'bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_4px_12px_rgba(0,122,255,0.3)]'
                                    }`}
                                >
                                    {isSubmitting
                                        ? <><Loader2 size={16} className="animate-spin" /> Guardando…</>
                                        : confirmingEdit
                                            ? <><Check size={15} strokeWidth={3} /> Sí, guardar cambios</>
                                            : editingPlan
                                                ? <><Edit3 size={15} strokeWidth={2} /> Guardar Cambios</>
                                                : <><Palmtree size={15} strokeWidth={2} /> Asignar Vacaciones</>
                                    }
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* ── Panel derecho: Gantt + Tabla ── */}
                    <div className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 space-y-5">

                        {/* Gantt */}
                        <div className="bg-white/40 backdrop-blur-[30px] border border-white/80 rounded-[2.5rem] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.08)] transition-all duration-500">
                            <div className="flex items-center justify-between mb-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                    <Calendar size={10} /> Línea de tiempo {year}
                                </p>
                                {isLoadingVacationPlans && <Loader2 size={14} className="animate-spin text-slate-400" />}
                            </div>
                            <GanttChart plans={filtered} year={year} />
                        </div>

                        {/* Tabla */}
                        <div className="bg-white/40 backdrop-blur-[30px] border border-white/80 rounded-[2.5rem] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.08)] transition-all duration-500">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-5">
                                <User size={10} /> Detalle de asignaciones
                            </p>

                            {filtered.length === 0 ? (
                                <div className="flex flex-col items-center py-12 gap-3 text-slate-400">
                                    <Palmtree size={36} strokeWidth={1} />
                                    <p className="text-[13px] font-bold text-slate-500">Sin asignaciones en este período</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[600px] text-[12px]">
                                        <thead>
                                            <tr className="border-b border-slate-100">
                                                {['Empleado', 'Sucursal', 'Período', 'Días', 'Comentario', 'Estado', ''].map(h => (
                                                    <th key={h} className="text-left text-[9px] font-black uppercase tracking-widest text-slate-400 pb-3 pr-4">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {filtered.map(p => {
                                                const isEditing = editingPlan?.id === p.id;
                                                return (
                                                    <React.Fragment key={p.id}>
                                                        <tr className={`group/row hover:bg-white/40 transition-colors ${isEditing ? 'bg-amber-50/60' : ''}`}>
                                                            <td className="py-3 pr-4">
                                                                <div className="flex items-center gap-2.5 flex-wrap">
                                                                    <div className="w-7 h-7 rounded-full overflow-hidden bg-slate-100 border border-white shadow-sm shrink-0 flex items-center justify-center text-slate-500 font-black text-[11px]">
                                                                        {p.employee?.photo
                                                                            ? <img src={p.employee.photo} alt={p.employee.name} className="w-full h-full object-cover" />
                                                                            : (p.employee?.name || '?').charAt(0).toUpperCase()
                                                                        }
                                                                    </div>
                                                                    <p className="font-bold text-slate-700 group-hover/row:text-[#007AFF] transition-colors">{p.employee?.name || '—'}</p>
                                                                    {p.metadata?.original_start_date && (
                                                                        <span className="group/badge relative inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest bg-amber-50 text-amber-700 border border-amber-200 cursor-default">
                                                                            <Edit2 size={7} strokeWidth={3} /> Editado
                                                                            <span className="absolute bottom-full left-0 mb-1.5 hidden group-hover/badge:flex flex-col gap-0.5 bg-slate-900/90 backdrop-blur text-white text-[9px] font-bold rounded-xl px-3 py-2 shadow-xl whitespace-nowrap z-50 pointer-events-none">
                                                                                <span className="text-slate-400 font-black uppercase tracking-widest text-[7px] mb-0.5">Fecha original</span>
                                                                                <span>{fmtShort(p.metadata.original_start_date)} → {fmtShort(p.metadata.original_end_date)} · {p.metadata.original_days}d</span>
                                                                                <span className="text-slate-400 font-black uppercase tracking-widest text-[7px] mt-1 mb-0.5">Fecha actual</span>
                                                                                <span>{fmtShort(p.start_date)} → {fmtShort(p.end_date)} · {p.days}d</span>
                                                                            </span>
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-3 pr-4 text-slate-500 font-medium">{p.branch?.name || '—'}</td>
                                                            <td className="py-3 pr-4 text-slate-600 font-medium whitespace-nowrap">{fmtShort(p.start_date)} → {fmtShort(p.end_date)}</td>
                                                            <td className="py-3 pr-4 font-black text-slate-700">{p.days}</td>
                                                            <td className="py-3 pr-4 max-w-[160px]">
                                                                {p.notes
                                                                    ? <p className="text-[11px] text-slate-500 font-medium leading-snug line-clamp-2">{p.notes}</p>
                                                                    : <span className="text-[10px] text-slate-300">—</span>
                                                                }
                                                            </td>
                                                            <td className="py-3 pr-4"><StatusBadge status={p.status} /></td>
                                                            <td className="py-3">
                                                                <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity duration-200">
                                                                    {(p.status === 'PLANNED' || p.status === 'CONFIRMED') && (
                                                                        <button
                                                                            title="Editar"
                                                                            onClick={() => handleStartEdit({ id: p.id, employee_id: p.employee_id, start_date: p.start_date, end_date: p.end_date, notes: p.notes || '', employee: p.employee })}
                                                                            disabled={!canEdit}
                                                                            className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isEditing ? 'bg-amber-100 border-amber-300 text-amber-600 hover:bg-amber-500 hover:text-white hover:border-amber-500' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-500 hover:text-white hover:border-slate-500'}`}
                                                                        >
                                                                            <Edit2 size={11} strokeWidth={2.5} />
                                                                        </button>
                                                                    )}
                                                                    {p.status === 'PLANNED' && (
                                                                        <button
                                                                            title="Confirmar"
                                                                            onClick={() => handleConfirmPlan(p.id)}
                                                                            disabled={!canEdit}
                                                                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-500 hover:text-white hover:border-emerald-500 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                        >
                                                                            <Check size={11} strokeWidth={3} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>

                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </GlassViewLayout>
        </>
    );
};

export default VacationPlanView;
