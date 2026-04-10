import React, { useState, useMemo, useEffect } from 'react';
import {
    Palmtree, Plus, Check, X, User, Calendar, AlertCircle,
    ChevronLeft, ChevronRight, Loader2, CheckCircle2, Clock, Ban
} from 'lucide-react';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import GlassViewLayout from '../components/GlassViewLayout';
import ConfirmModal from '../components/common/ConfirmModal';

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

    const rows = useMemo(() => {
        const map = new Map();
        plans.filter(p => p.status !== 'CANCELLED').forEach(p => {
            const key = String(p.employee_id);
            if (!map.has(key)) map.set(key, { emp: p.employee, bars: [] });
            map.get(key).bars.push(p);
        });
        return Array.from(map.values());
    }, [plans]);

    if (rows.length === 0) return (
        <div className="flex flex-col items-center py-10 gap-3 text-slate-400">
            <Palmtree size={36} strokeWidth={1} />
            <p className="text-[13px] font-bold text-slate-500">Sin planes para este año</p>
        </div>
    );

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
                <div className="space-y-2">
                    {rows.map(({ emp, bars }) => (
                        <div key={emp?.id || bars[0]?.employee_id} className="flex items-center gap-2 group/row">
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
                    ))}
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
    const { user } = useAuth();
    const employees              = useStaffStore(s => s.employees);
    const branches               = useStaffStore(s => s.branches);
    const vacationPlans          = useStaffStore(s => s.vacationPlans);
    const isLoadingVacationPlans = useStaffStore(s => s.isLoadingVacationPlans);
    const fetchVacationPlans     = useStaffStore(s => s.fetchVacationPlans);
    const createVacationPlan     = useStaffStore(s => s.createVacationPlan);
    const updateVacationPlanStatus = useStaffStore(s => s.updateVacationPlanStatus);

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

    useEffect(() => {
        fetchVacationPlans(year, branchFilter === 'ALL' ? null : branchFilter);
    }, [year, branchFilter]);

    // Empleados elegibles (≥1 año antigüedad, activos)
    const eligibleEmployees = useMemo(() => {
        const now = new Date();
        return (employees || []).filter(e => {
            if (e.status !== 'ACTIVO' && e.status !== 'ACTIVE') return false;
            if (!e.hire_date) return false;
            return (now - new Date(e.hire_date + 'T12:00:00')) / (1000 * 60 * 60 * 24 * 365.25) >= 1;
        });
    }, [employees]);

    const selectedEmployee = useMemo(() => employees.find(e => String(e.id) === String(empId)), [employees, empId]);

    const eligibilityInfo = useMemo(() => {
        if (!selectedEmployee?.hire_date) return null;
        const hire = new Date(selectedEmployee.hire_date + 'T12:00:00');
        const now  = new Date();
        const yearsWorked = (now - hire) / (1000 * 60 * 60 * 24 * 365.25);
        const isEligible  = yearsWorked >= 1;

        const nextAnniversary = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());
        if (nextAnniversary < now) nextAnniversary.setFullYear(now.getFullYear() + 1);
        const lastAnniversary = new Date(nextAnniversary);
        lastAnniversary.setFullYear(lastAnniversary.getFullYear() - 1);
        const windowEnd = new Date(lastAnniversary);
        windowEnd.setMonth(windowEnd.getMonth() + 3);
        const inWindow = now >= lastAnniversary && now <= windowEnd;

        return { isEligible, yearsWorked: Math.floor(yearsWorked * 10) / 10, nextAnniversary, lastAnniversary, windowEnd, inWindow };
    }, [selectedEmployee]);

    const computedDays = useMemo(() => {
        if (!startDate || !endDate || endDate < startDate) return 0;
        return daysBetween(startDate, endDate);
    }, [startDate, endDate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
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
            if (msg.startsWith('ELIGIBILITY_ERROR:')) {
                useToastStore.getState().showToast('No elegible', msg.replace('ELIGIBILITY_ERROR: ', ''), 'error');
            } else if (msg.startsWith('WINDOW_ERROR:')) {
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

    const filtered = useMemo(() => {
        return vacationPlans.filter(p => statusFilter === 'ALL' || p.status === statusFilter);
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
            <select
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                className="bg-white/50 backdrop-blur-md border border-white/70 rounded-[1.5rem] px-3 py-2 text-[11px] font-bold text-slate-600 outline-none shadow-sm hover:bg-white/70 transition-all"
            >
                <option value="ALL">Todas las sucursales</option>
                {(branches || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>

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
                                    <select value={empId} onChange={e => setEmpId(e.target.value)} className={glassInput}>
                                        <option value="">Seleccionar empleado…</option>
                                        {eligibleEmployees.map(e => (
                                            <option key={e.id} value={e.id}>{e.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-[10px] text-slate-400 font-medium mt-1 ml-1">Solo empleados con ≥ 1 año de antigüedad</p>
                                </div>

                                {/* Eligibility info */}
                                {selectedEmployee && eligibilityInfo && (
                                    <div className={`rounded-2xl p-4 border space-y-1.5 ${eligibilityInfo.inWindow ? 'bg-emerald-50/80 border-emerald-200/60' : 'bg-amber-50/80 border-amber-200/60'}`}>
                                        <p className={`font-black uppercase tracking-widest text-[9px] flex items-center gap-1.5 ${eligibilityInfo.inWindow ? 'text-emerald-700' : 'text-amber-700'}`}>
                                            {eligibilityInfo.inWindow
                                                ? <><CheckCircle2 size={10} strokeWidth={2.5} /> Dentro de ventana válida</>
                                                : <><AlertCircle size={10} strokeWidth={2.5} /> Fuera de ventana óptima</>
                                            }
                                        </p>
                                        <p className={`text-[11px] font-medium ${eligibilityInfo.inWindow ? 'text-emerald-800' : 'text-amber-800'}`}>
                                            Antigüedad: <strong>{eligibilityInfo.yearsWorked} años</strong>
                                        </p>
                                        <p className={`text-[11px] font-medium ${eligibilityInfo.inWindow ? 'text-emerald-800' : 'text-amber-800'}`}>
                                            Último aniversario: <strong>{fmtDate(eligibilityInfo.lastAnniversary.toISOString().split('T')[0])}</strong>
                                        </p>
                                        <p className={`text-[11px] font-medium ${eligibilityInfo.inWindow ? 'text-emerald-800' : 'text-amber-800'}`}>
                                            Ventana válida hasta: <strong>{fmtDate(eligibilityInfo.windowEnd.toISOString().split('T')[0])}</strong>
                                        </p>
                                    </div>
                                )}

                                {/* Fechas */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <InputLabel>Fecha inicio</InputLabel>
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={e => {
                                                setStartDate(e.target.value);
                                                if (!endDate && e.target.value) {
                                                    const d = new Date(e.target.value + 'T12:00:00');
                                                    d.setDate(d.getDate() + 14);
                                                    setEndDate(d.toISOString().split('T')[0]);
                                                }
                                            }}
                                            className={glassInput}
                                        />
                                    </div>
                                    <div>
                                        <InputLabel>Fecha fin</InputLabel>
                                        <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className={glassInput} />
                                    </div>
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
                                    disabled={isSubmitting || !empId || !startDate || !endDate}
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
                                            {filtered
                                                .slice()
                                                .sort((a, b) => a.start_date.localeCompare(b.start_date))
                                                .map(p => (
                                                    <tr key={p.id} className="group/row hover:bg-white/40 transition-colors">
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
                                                                    <button
                                                                        onClick={() => handleConfirmPlan(p.id)}
                                                                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-white transition-all active:scale-95"
                                                                    >
                                                                        <Check size={10} strokeWidth={3} /> Confirmar
                                                                    </button>
                                                                )}
                                                                {(p.status === 'PLANNED' || p.status === 'CONFIRMED') && (
                                                                    <button
                                                                        onClick={() => setCancelConfirm({ open: true, planId: p.id })}
                                                                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[9px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all active:scale-95"
                                                                    >
                                                                        <X size={10} strokeWidth={3} /> Cancelar
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
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
