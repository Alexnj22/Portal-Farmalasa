import React, { useState, useMemo, useEffect } from 'react';
import {
    Palmtree, Plus, Check, X, User, Calendar, AlertCircle,
    ChevronLeft, ChevronRight, Loader2, CheckCircle2, Clock, Ban, Edit2
} from 'lucide-react';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import GlassViewLayout from '../components/GlassViewLayout';
import ConfirmModal from '../components/common/ConfirmModal';
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
                <div className="flex mb-2 ml-[130px]">
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
                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 w-[130px] text-right pr-3 shrink-0">
                                            {branchName}
                                        </span>
                                        <div className="flex-1 h-px bg-slate-100" />
                                    </div>
                                )}
                                <div className="flex items-center gap-2 group/row">
                                    <div className="w-[130px] shrink-0 truncate text-[11px] font-bold text-slate-600 text-right pr-3 group-hover/row:text-[#007AFF] transition-colors">
                                        {emp?.name || 'Empleado'}
                                    </div>
                                    <div className="flex-1 h-7 bg-white/50 border border-slate-100 rounded-xl relative overflow-hidden">
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
                                                    title={`${emp?.name} • ${fmtShort(p.start_date)} → ${fmtShort(p.end_date)} • ${p.days}d • ${meta.label}`}
                                                    className={`absolute top-1 bottom-1 rounded-lg ${meta.bar} opacity-75 hover:opacity-100 transition-opacity cursor-default`}
                                                    style={{ left: `${pct(p.start_date)}%`, width: `${widthPct(p.start_date, p.end_date)}%` }}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-4 ml-[130px]">
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
    const [cancelConfirm, setCancelConfirm] = useState({ open: false, planId: null });

    // Inline edit state
    const [editingPlan, setEditingPlan] = useState(null); // { id, start_date, end_date, notes }
    const [isSavingEdit, setIsSavingEdit] = useState(false);

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
                    disabled: true,
                };
            }
            if (!e.hire_date) {
                return {
                    value: String(e.id),
                    label: e.name,
                    sublabel: '⚠ Sin fecha de ingreso — Actualizar datos',
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

    const handleCancelPlan = async () => {
        if (!cancelConfirm.planId) return;
        await updateVacationPlanStatus(cancelConfirm.planId, 'CANCELLED');
        setCancelConfirm({ open: false, planId: null });
        useToastStore.getState().showToast('Cancelado', 'Plan cancelado.', 'success');
    };

    const handleSaveEdit = async () => {
        if (!editingPlan) return;
        setIsSavingEdit(true);
        const days = editingPlan.start_date && editingPlan.end_date
            ? daysBetween(editingPlan.start_date, editingPlan.end_date)
            : 0;
        const ok = await updateVacationPlan(editingPlan.id, {
            start_date: editingPlan.start_date,
            end_date:   editingPlan.end_date,
            days,
            notes:      editingPlan.notes,
        });
        setIsSavingEdit(false);
        if (ok) {
            useToastStore.getState().showToast('Guardado', 'Plan actualizado.', 'success');
            setEditingPlan(null);
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo actualizar.', 'error');
        }
    };

    // Sort filtered plans by branch → role → start_date
    const filtered = useMemo(() => {
        return vacationPlans
            .filter(p => statusFilter === 'ALL' || p.status === statusFilter)
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
    }, [vacationPlans, statusFilter]);

    const filtersContent = (
        <div className="flex flex-wrap items-center gap-2">
            {/* Selector año */}
            <div className="flex items-center bg-white/50 backdrop-blur-md border border-white/70 rounded-[1.5rem] overflow-hidden shadow-sm">
                <button onClick={() => setYear(y => y - 1)} className="px-3 py-2 hover:bg-white/50 text-slate-500 hover:text-slate-800 transition-colors">
                    <ChevronLeft size={14} strokeWidth={2.5} />
                </button>
                <span className="text-[12px] font-black text-slate-700 px-1 min-w-[44px] text-center">{year}</span>
                <button onClick={() => setYear(y => y + 1)} disabled={year >= currentYear + 1} className="px-3 py-2 hover:bg-white/50 text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-30">
                    <ChevronRight size={14} strokeWidth={2.5} />
                </button>
            </div>

            {/* Sucursal */}
            <div className="min-w-[180px]">
                <LiquidSelect
                    value={branchFilter}
                    onChange={val => setBranchFilter(val)}
                    options={branchOptions}
                    placeholder="Todas las sucursales"
                    clearable={false}
                />
            </div>

            {/* Estado */}
            <div className="flex items-center bg-white/50 backdrop-blur-md border border-white/70 rounded-[1.5rem] p-1 gap-1 shadow-sm">
                {[['ALL', 'Todos'], ['PLANNED', 'Planificados'], ['CONFIRMED', 'Confirmados'], ['TAKEN', 'Tomados']].map(([key, lbl]) => (
                    <button key={key} onClick={() => setStatusFilter(key)}
                        className={`px-3 py-1.5 rounded-[1.1rem] text-[10px] font-black uppercase tracking-widest transition-all duration-200 ${statusFilter === key ? 'bg-[#007AFF] text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'}`}>
                        {lbl}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <>
            <ConfirmModal
                isOpen={cancelConfirm.open}
                onClose={() => setCancelConfirm({ open: false, planId: null })}
                onConfirm={handleCancelPlan}
                title="¿Cancelar este plan?"
                message="El plan quedará marcado como Cancelado. Esta acción no se puede deshacer."
                confirmText="Sí, Cancelar"
                isDestructive
            />

            <GlassViewLayout icon={Palmtree} title="Plan Anual de Vacaciones" filtersContent={filtersContent} transparentBody={true} fixedScrollMode={true}>
                <div className="flex flex-col lg:flex-row items-start gap-6 px-2 md:px-0 w-full h-full lg:h-[calc(100vh-230px)]">

                    {/* ── Panel izquierdo: Formulario ── */}
                    <div className="w-full lg:w-[400px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8">
                        <div className="bg-white/40 backdrop-blur-[30px] border border-white/80 rounded-[2.5rem] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.10),inset_0_2px_15px_rgba(255,255,255,0.7)] transition-all duration-500">
                            <div className="flex items-center gap-2.5 mb-6">
                                <div className="w-8 h-8 rounded-lg bg-[#007AFF] flex items-center justify-center shadow-sm shrink-0">
                                    <Plus size={16} className="text-white" strokeWidth={2.5} />
                                </div>
                                <h3 className="font-black text-slate-800 text-[15px] uppercase tracking-tight">Nueva Asignación</h3>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-5">
                                {/* Empleado */}
                                <div>
                                    <InputLabel>Empleado</InputLabel>
                                    <LiquidSelect
                                        value={empId}
                                        onChange={val => setEmpId(val)}
                                        options={groupedOptions}
                                        placeholder="Seleccionar empleado…"
                                    />
                                </div>

                                {/* Eligibility banner */}
                                {selectedEmployee && <EligibilityBanner info={eligibilityInfo} />}

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
                                    <div className="flex items-center gap-2 px-4 py-2.5 bg-[#007AFF]/8 border border-[#007AFF]/15 rounded-2xl">
                                        <Calendar size={13} className="text-[#007AFF]" strokeWidth={2.5} />
                                        <span className="text-[12px] font-black text-[#007AFF]">{computedDays} días calendario</span>
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

                                <button
                                    type="submit"
                                    disabled={!canEdit || isSubmitting || !empId || !startDate || !endDate}
                                    className="w-full h-[48px] bg-[#007AFF] hover:bg-[#0066CC] disabled:bg-slate-300 text-white rounded-[1.25rem] font-black text-[11px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:shadow-none"
                                >
                                    {isSubmitting
                                        ? <><Loader2 size={16} className="animate-spin" /> Guardando…</>
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
                                                {['Empleado', 'Sucursal', 'Período', 'Días', 'Estado', 'Acciones'].map(h => (
                                                    <th key={h} className="text-left text-[9px] font-black uppercase tracking-widest text-slate-400 pb-3 pr-4">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {filtered.map(p => {
                                                const isEditing = editingPlan?.id === p.id;
                                                return (
                                                    <React.Fragment key={p.id}>
                                                        <tr className="group/row hover:bg-white/40 transition-colors">
                                                            <td className="py-3 pr-4">
                                                                <p className="font-bold text-slate-700 group-hover/row:text-[#007AFF] transition-colors">{p.employee?.name || '—'}</p>
                                                            </td>
                                                            <td className="py-3 pr-4 text-slate-500 font-medium">{p.branch?.name || '—'}</td>
                                                            <td className="py-3 pr-4 text-slate-600 font-medium whitespace-nowrap">
                                                                {fmtShort(p.start_date)} → {fmtShort(p.end_date)}
                                                            </td>
                                                            <td className="py-3 pr-4 font-black text-slate-700">{p.days}</td>
                                                            <td className="py-3 pr-4"><StatusBadge status={p.status} /></td>
                                                            <td className="py-3">
                                                                <div className="flex items-center gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                                    {p.status === 'PLANNED' && (
                                                                        <>
                                                                            <button
                                                                                onClick={() => setEditingPlan({ id: p.id, start_date: p.start_date, end_date: p.end_date, notes: p.notes || '' })}
                                                                                disabled={!canEdit}
                                                                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-widest hover:bg-slate-500 hover:text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                            >
                                                                                <Edit2 size={10} strokeWidth={2.5} /> Editar
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleConfirmPlan(p.id)}
                                                                                disabled={!canEdit}
                                                                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                            >
                                                                                <Check size={10} strokeWidth={3} /> Confirmar
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                    {(p.status === 'PLANNED' || p.status === 'CONFIRMED') && (
                                                                        <button
                                                                            onClick={() => setCancelConfirm({ open: true, planId: p.id })}
                                                                            disabled={!canEdit}
                                                                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[9px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                        >
                                                                            <X size={10} strokeWidth={3} /> Cancelar
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>

                                                        {/* Inline edit row */}
                                                        {isEditing && (
                                                            <tr className="bg-blue-50/60">
                                                                <td colSpan={6} className="py-4 px-3">
                                                                    <div className="flex flex-wrap items-end gap-4">
                                                                        <div className="flex-1 min-w-[220px]">
                                                                            <InputLabel>Nuevo período</InputLabel>
                                                                            <RangeDatePicker
                                                                                startDate={editingPlan.start_date}
                                                                                endDate={editingPlan.end_date}
                                                                                onRangeChange={(s, e) =>
                                                                                    setEditingPlan(prev => ({ ...prev, start_date: s || prev.start_date, end_date: e || prev.end_date }))
                                                                                }
                                                                                holidays={holidays || []}
                                                                                defaultDays={15}
                                                                                label="Cambiar fechas"
                                                                            />
                                                                        </div>
                                                                        <div className="flex-1 min-w-[180px]">
                                                                            <InputLabel>Notas</InputLabel>
                                                                            <textarea
                                                                                value={editingPlan.notes}
                                                                                onChange={e => setEditingPlan(prev => ({ ...prev, notes: e.target.value }))}
                                                                                rows={2}
                                                                                placeholder="Observaciones…"
                                                                                className={`${glassInput} resize-none leading-relaxed text-[11px]`}
                                                                            />
                                                                        </div>
                                                                        <div className="flex items-center gap-2 pb-0.5">
                                                                            <button
                                                                                onClick={handleSaveEdit}
                                                                                disabled={!canEdit || isSavingEdit}
                                                                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#007AFF] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#0066CC] transition-all active:scale-95 disabled:opacity-60"
                                                                            >
                                                                                {isSavingEdit ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} strokeWidth={3} />}
                                                                                Guardar
                                                                            </button>
                                                                            <button
                                                                                onClick={() => setEditingPlan(null)}
                                                                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all active:scale-95"
                                                                            >
                                                                                <X size={11} strokeWidth={3} /> Cancelar
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
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
