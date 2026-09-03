import React, { useState, useMemo, useEffect, useRef } from 'react';
import AvatarConEstado from '../components/common/AvatarConEstado';
import Notice from '../components/common/Notice';
import PromptModal from '../components/common/PromptModal';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { EmptyState } from '../components/common/StateViews';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import useMediaQuery from '../hooks/useMediaQuery';
import {
    Palmtree, Plus, Check, X, User, Calendar, AlertCircle, Search,
    ChevronLeft, ChevronRight, Loader2, CheckCircle2, Clock, Ban, Pencil,
    Building2, ListFilter, Trash2, Sparkles, ShieldCheck, ArrowRight,
    MessageSquare, RefreshCw
} from 'lucide-react';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import PeriodStepper from '../components/common/PeriodStepper';
import RangeDatePicker from '../components/common/RangeDatePicker';
import TimePicker12 from '../components/common/TimePicker12';
import { smartFilter } from '../utils/searchUtils';
import PortalTextarea from '../components/common/PortalTextarea';
import { shortEmployeeName } from '../utils/nameUtils';
import { soloPersonalEnPlanilla } from '../utils/tipoDeFicha';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate  = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtShort = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' }) : '—';
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000) + 1;

/* ── Un extremo con hora NO es un día de vacación ──────────────────────────
 *
 * `daysBetween` cuenta el rango entero. Del 5 al 21 de septiembre son 17, y el
 * saldo del año son 15 — o sea que asentar unas vacaciones que empiezan el
 * sábado al mediodía y terminan el 21 a las 8 pasaba el tope por dos días que
 * la persona SÍ trabaja.
 *
 * La regla no es una fórmula aparte: si el día de inicio tiene hora, esa
 * mañana se trabajó y ese día no cuenta; lo mismo el de fin. Con las dos horas
 * puestas, el 5→21 da los 15 que corresponden. Sin horas nada cambia, que es
 * lo que son todas las filas de antes.
 */
const diasDeVacacion = (inicio, fin, horaInicio, horaFin) => {
    if (!inicio || !fin || fin < inicio) return 0;
    const enteros = daysBetween(inicio, fin) - (horaInicio ? 1 : 0) - (horaFin ? 1 : 0);
    return Math.max(0, enteros);
};

/* «12:00» → «12:00 md». La hora sola no dice si el día se trabajó antes o
 * después, así que en la lista viaja pegada a su fecha. */
const fmtHora = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const suf = h === 12 && m === 0 ? 'md' : h === 0 && m === 0 ? 'mn' : h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${suf}`;
};

const STATUS_META = {
    DRAFT:            { label: 'Borrador',      bg: 'bg-surface-card-hover',   text: 'text-content-3',   border: 'border-divider',   bar: 'bg-content-3', variante: 'neutral'   },
    PRE_APPROVED:     { label: 'Pre-aprobado',  bg: 'bg-chart-1/10',    text: 'text-chart-1-text',    border: 'border-chart-1/30',    bar: 'bg-chart-1', variante: 'chart-1'    },
    CHANGE_REQUESTED: { label: 'Cambio sol.',   bg: 'bg-warning/10',   text: 'text-warning-text',   border: 'border-warning/30',   bar: 'bg-warning', variante: 'warning'   },
    APPROVED:         { label: 'Aprobado',      bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30', bar: 'bg-success', variante: 'success' },
    PLANNED:          { label: 'Planificado',   bg: 'bg-chart-1/10',    text: 'text-chart-1-text',    border: 'border-chart-1/30',    bar: 'bg-chart-1', variante: 'chart-1'    },
    CONFIRMED:        { label: 'Confirmado',    bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30', bar: 'bg-success', variante: 'success' },
    TAKEN:            { label: 'Tomado',        bg: 'bg-surface-card-hover',  text: 'text-content-3',   border: 'border-divider',   bar: 'bg-content-3', variante: 'neutral'   },
    CANCELLED:        { label: 'Cancelado',     bg: 'bg-danger/10',     text: 'text-danger',     border: 'border-danger/30',     bar: 'bg-danger/60', variante: 'danger'     },
};

const HEADER_STATUS_META = {
    DRAFT:        { label: 'Borrador',     color: 'text-content-3',   bg: 'bg-surface-card-hover', variante: 'neutral'   },
    PRE_APPROVED: { label: 'Pre-aprobado', color: 'text-chart-1-text',    bg: 'bg-chart-1/10', variante: 'chart-1'     },
    FINALIZED:    { label: 'Finalizado',   color: 'text-success-text', bg: 'bg-success/10', variante: 'success'  },
};

// `STATUS_META` guardaba `bg`/`text`/`border` —la paleta SOFT de `Badge`
// escrita a mano, una fila por estado— además de `bar`, que sí se usa aparte
// para la barra del Gantt. Ahora el chip sale del canónico y la tabla solo
// aporta el NOMBRE de la variante. (2026-07-28, D3.5)
// El orden importa: `DataTable` mapea celda→columna POR POSICIÓN, y de acá sale
// además qué muestra la ficha en el teléfono. Con esta lista la inferencia da
// identidad = Empleado, ancla = Estado, contexto = Sucursal · Período, y manda a
// la hoja los tres que no entran (Días, Saldo, Comentario).
// ── Ocho columnas en una columna de 608px ────────────────────────────────────
//
// Esta tabla NO vive a lo ancho de la vista: vive en el panel derecho, al lado
// del formulario de 400px. Medido el 2026-08-09: el marco le da **620px a 1440 y
// 460 a 1280** para **939px de columnas**, y lo que quedaba fuera era la columna
// de acciones — los botones de cada asignación, inalcanzables.
//
// `hideBelow` no alcanzaba y conviene decir por qué: es una consulta de
// VIEWPORT, y acá el que aprieta es el CONTENEDOR. Ni siquiera a 1536 el panel
// llega a 939px (queda en ~752), así que ninguna combinación de peldaños lo
// arregla. Lo que sobra son columnas para el espacio que esta tabla tiene, no
// para la pantalla que la muestra.
//
// Salen las tres de contexto y se quedan las cinco que son la fila: de quién,
// cuándo, cuánto, en qué estado y qué se puede hacer. La sucursal, el saldo y el
// comentario siguen en el expediente del empleado.
const COLS_ASIGNACIONES = [
    { key: 'empleado',   label: 'Empleado',   align: 'left' },
    { key: 'sucursal',   label: 'Sucursal',   align: 'left', hideBelow: '2xl' },
    { key: 'periodo',    label: 'Período',    align: 'left' },
    { key: 'dias',       label: 'Días',       align: 'left', hideBelow: '2xl' },
    { key: 'saldo',      label: 'Saldo',      align: 'left', hideBelow: '2xl' },
    { key: 'comentario', label: 'Comentario', align: 'left', hideBelow: '2xl' },
    { key: 'estado',     label: 'Estado',     align: 'left' },
    { key: 'acciones',   label: '',           align: 'right' },
];

const StatusBadge = ({ status }) => {
    const m = STATUS_META[status] || STATUS_META.PLANNED;
    return <Badge variant={m.variante} size="sm">{m.label}</Badge>;
};

const InputLabel = ({ children }) => (
    <p className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 ml-1">{children}</p>
);


// ── Eligibility Banner ────────────────────────────────────────────────────────
const EligibilityBanner = ({ info }) => {
    if (!info) return null;
    const { isEligible, isNearEligible, inWindow, yearsWorked, monthsWorked, lastAnniversary, windowEnd, nextAnniversary } = info;

    let cfg;
    if (isEligible && inWindow) {
        cfg = {
            bg: 'bg-success/10 border-success/30',
            icon: <CheckCircle2 size={10} strokeWidth={2.5} className="text-success-text" />,
            label: 'Dentro de ventana válida',
            labelColor: 'text-success-text',
            bodyColor: 'text-success-text',
        };
    } else if (isEligible && !inWindow) {
        cfg = {
            bg: 'bg-warning/10 border-warning/30',
            icon: <AlertCircle size={10} strokeWidth={2.5} className="text-warning-text" />,
            label: 'Fuera de ventana óptima',
            labelColor: 'text-warning-text',
            bodyColor: 'text-warning-text',
        };
    } else if (!isEligible && isNearEligible) {
        cfg = {
            bg: 'bg-chart-4/10 border-chart-4/30',
            icon: <Clock size={10} strokeWidth={2.5} className="text-chart-4-text" />,
            label: 'Asignación anticipada',
            labelColor: 'text-chart-4-text',
            bodyColor: 'text-chart-4-text',
        };
    } else {
        cfg = {
            bg: 'bg-danger/10 border-danger/30',
            icon: <Ban size={10} strokeWidth={2.5} className="text-danger-text" />,
            label: 'No elegible',
            labelColor: 'text-danger-text',
            bodyColor: 'text-danger-text',
        };
    }

    return (
        <div className={`rounded-2xl p-4 border space-y-1.5 ${cfg.bg}`}>
            <p className={`font-black uppercase tracking-widest text-micro flex items-center gap-1.5 ${cfg.labelColor}`}>
                {cfg.icon} {cfg.label}
            </p>
            {isEligible ? (
                <>
                    <p className={`text-label font-medium ${cfg.bodyColor}`}>
                        Antigüedad: <strong>{yearsWorked} años</strong>
                    </p>
                    <p className={`text-label font-medium ${cfg.bodyColor}`}>
                        Último aniversario: <strong>{fmtDate(lastAnniversary?.toISOString().split('T')[0])}</strong>
                    </p>
                    <p className={`text-label font-medium ${cfg.bodyColor}`}>
                        Ventana válida hasta: <strong>{fmtDate(windowEnd?.toISOString().split('T')[0])}</strong>
                    </p>
                </>
            ) : (
                <>
                    <p className={`text-label font-medium ${cfg.bodyColor}`}>
                        Antigüedad actual: <strong>{monthsWorked} meses</strong>
                    </p>
                    {nextAnniversary && (
                        <p className={`text-label font-medium ${cfg.bodyColor}`}>
                            Próximo aniversario: <strong>{fmtDate(nextAnniversary.toISOString().split('T')[0])}</strong>
                        </p>
                    )}
                    {isNearEligible && (
                        <p className={`text-caption font-medium ${cfg.bodyColor} opacity-80`}>
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
        label: new Date(year, i, 1).toLocaleDateString('es-SV', { month: 'short' }),
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
        const sorted = Array.from(map.values()).sort((a, b) => {
            const branchA = a.branch?.name || '';
            const branchB = b.branch?.name || '';
            if (branchA !== branchB) return branchA.localeCompare(branchB);
            const roleA = a.emp?.role || a.emp?.position || '';
            const roleB = b.emp?.role || b.emp?.position || '';
            if (roleA !== roleB) return roleA.localeCompare(roleB);
            return (a.emp?.name || '').localeCompare(b.emp?.name || '');
        });

        // showHeader por índice contra el elemento anterior (sorted ya agrupa
        // por sucursal) — sin variable mutable capturada en el .map(), que
        // rompe bajo memoización por-fila del React Compiler.
        return sorted.map((row, i) => {
            const branchName     = row.branch?.name || '';
            const prevBranchName = i > 0 ? (sorted[i - 1].branch?.name || '') : null;
            return { ...row, showHeader: branchName !== prevBranchName };
        });
    }, [plans]);

    if (rows.length === 0) return (
        <EmptyState compact icon={Palmtree} title="Sin planes para este año" />
    );

    return (
        <div id="gantt-vacaciones-scroll" className="overflow-x-auto">
            <div className="min-w-[560px]">
                {/* Month headers */}
                <div className="flex mb-2 ml-[160px]">
                    {months.map(m => (
                        <div
                            key={m.idx}
                            className="text-micro font-black text-content-2 uppercase tracking-widest text-center border-l border-divider first:border-l-0 py-1"
                            style={{ flex: `${m.days} 0 0%` }}
                        >
                            {m.label}
                        </div>
                    ))}
                </div>

                {/* Rows */}
                <div className="space-y-1">
                    {rows.map(({ emp, branch, bars, showHeader }) => {
                        const branchName = branch?.name || '';

                        return (
                            <React.Fragment key={emp?.id || bars[0]?.employee_id}>
                                {showHeader && branchName && (
                                    <div className="flex items-center gap-2 mt-3 mb-1 ml-0 pr-0">
                                        <span className="text-micro font-black uppercase tracking-[0.2em] text-content-3 w-[160px] text-right pr-3 shrink-0">
                                            {branchName}
                                        </span>
                                        <div className="flex-1 h-px bg-divider" />
                                    </div>
                                )}
                                <div className="flex items-center gap-2 group/row">
                                    <div className="w-[160px] shrink-0 flex items-center gap-2 pr-2">
                                        <div className="w-7 h-7 rounded-full overflow-hidden bg-surface-card-hover border border-surface-card shadow-sm shrink-0 flex items-center justify-center text-content-3 font-black text-label">
                                            <AvatarConEstado emp={emp} px={36} radio="rounded-full" marco="" />
                                        </div>
                                        <span className="text-label font-bold text-content-2 truncate group-hover/row:text-brand-text transition-colors" title={emp?.name}>{shortEmployeeName(emp)}</span>
                                    </div>
                                    <div className="flex-1 h-7 bg-surface-card border border-divider rounded-xl relative overflow-visible">
                                        {/* Month grid lines */}
                                        {months.map(m => (
                                            <div
                                                key={m.idx}
                                                className="absolute top-0 bottom-0 border-l border-divider"
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
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/bar:flex flex-col items-center z-sidebar pointer-events-none">
                                                        <div data-surface="tooltip" className="text-micro font-bold px-3 py-2 whitespace-nowrap text-center">
                                                            <span className="block font-black text-micro uppercase tracking-widest text-content-tooltip-2 mb-0.5">{meta.label}</span>
                                                            <span>{fmtShort(p.start_date)} → {fmtShort(p.end_date)}</span>
                                                            <span className="ml-2 text-content-tooltip-2">· {p.days}d</span>
                                                        </div>
                                                        <div className="w-2 h-2 rotate-45 -mt-1" style={{ background: 'var(--tooltip-bg)' }} />
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
                            <span className="text-micro font-bold text-content-2 uppercase tracking-widest">{m.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ── Vista principal ───────────────────────────────────────────────────────────
const VacationPlanView = () => {
    const { user, hasPermission, getScope } = useAuth();
    const canEdit = hasPermission('vacation_plan', 'can_edit');
    const employees                  = useStaffStore(s => s.employees);
    const branches                   = useStaffStore(s => s.branches);
    const holidays                   = useStaffStore(s => s.holidays);
    const vacationPlans              = useStaffStore(s => s.vacationPlans);
    const isLoadingVacationPlans     = useStaffStore(s => s.isLoadingVacationPlans);
    const vacationHeaders            = useStaffStore(s => s.vacationHeaders);
    const isGeneratingPlan           = useStaffStore(s => s.isGeneratingPlan);
    const vacationChangeRequests     = useStaffStore(s => s.vacationChangeRequests);
    const fetchVacationPlans         = useStaffStore(s => s.fetchVacationPlans);
    const fetchVacationHeaders       = useStaffStore(s => s.fetchVacationHeaders);
    const createVacationPlan         = useStaffStore(s => s.createVacationPlan);
    const updateVacationPlan         = useStaffStore(s => s.updateVacationPlan);
    const updateVacationPlanStatus   = useStaffStore(s => s.updateVacationPlanStatus);
    const deleteVacationPlan         = useStaffStore(s => s.deleteVacationPlan);
    const generateAIPlan             = useStaffStore(s => s.generateAIPlan);
    const preApprovePlan             = useStaffStore(s => s.preApprovePlan);
    const fetchVacationChangeRequests = useStaffStore(s => s.fetchVacationChangeRequests);
    const processChangeRequest       = useStaffStore(s => s.processChangeRequest);

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
    const [branchFilter, setBranchFilter] = useState(
        getScope('vacation_plan') !== 'ALL' ? String(user?.branchId || '') : 'ALL'
    );
    const [statusFilter, setStatusFilter] = useState('ALL');

    const [empId, setEmpId]         = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate]     = useState('');
    // Vacías = día completo, que es lo que fueron todas hasta hoy.
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime]     = useState('');
    const [notes, setNotes]         = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const panelRef = useRef(null);
    // El MISMO corte que usa `DataTable` para decidir el modo ficha. Se repite
    // el literal a propósito y no se exporta: si algún día cambia, el gate
    // visual lo delata antes de que nadie lo note, y una constante compartida
    // ataría la vista al detalle interno del canónico.
    const enFichas = useMediaQuery('(max-width: 1023.98px)');

    // Panel edit state — when set, left panel is in edit mode
    const [editingPlan, setEditingPlan] = useState(null); // { id, employee_id, start_date, end_date, notes, employee_obj }
    const [confirmingEdit, setConfirmingEdit] = useState(false);
    const [processingRequestId, setProcessingRequestId] = useState(null);
    /* La solicitud de cambio que se está rechazando, mientras se escribe por qué.
     *
     * Hasta el 2026-08-18 «Rechazar» resolvía de una y NO guardaba motivo en
     * ningún campo: el empleado veía su cambio rechazado y no había forma de
     * saber por qué, ni en la tarjeta ni en la base. Pedido del usuario: un
     * rechazo se explica siempre. */
    const [rechazandoCambio, setRechazandoCambio] = useState(null);

    // Active header for current year
    const activeHeader = useMemo(
        () => vacationHeaders.find(h => h.year === year) || null,
        [vacationHeaders, year]
    );

    useEffect(() => {
        fetchVacationHeaders();
    }, [fetchVacationHeaders]);

    useEffect(() => {
        fetchVacationPlans(year, branchFilter === 'ALL' ? null : branchFilter);
        fetchVacationChangeRequests(year);
    }, [year, branchFilter, fetchVacationPlans, fetchVacationChangeRequests]);

    const assignedEmployeeIds = useMemo(() => {
        return new Set(
            vacationPlans
                .filter(vp => vp.year === year && vp.status !== 'CANCELLED')
                .map(vp => String(vp.employee_id))
        );
    }, [vacationPlans, year]);

    const employeeOptions = useMemo(() => {
        const now = new Date();
        // `soloPersonalEnPlanilla` primero: el plan anual de vacaciones es un
        // documento con peso legal (Art. 177 CT) y hasta el 2026-08-26 listaba
        // a «QA Testing» y al «Contador Externo» como personal con derecho a
        // vacaciones, porque acá se leía `employees` en crudo. Ver
        // `utils/tipoDeFicha.js`.
        let emps = soloPersonalEnPlanilla(employees).filter(e => e.status === 'ACTIVO' || e.status === 'ACTIVE');
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
    }, [employees, uniqueBranches, branchFilter, assignedEmployeeIds, year]);

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

    const computedDays = useMemo(
        () => diasDeVacacion(startDate, endDate, startTime, endTime),
        [startDate, endDate, startTime, endTime],
    );

    const handleRangeChange = (start, end) => {
        setStartDate(start || '');
        setEndDate(end || '');
    };

    const handleStartEdit = (plan) => {
        setEditingPlan(plan);
        setEmpId(String(plan.employee_id));
        setStartDate(plan.start_date);
        setEndDate(plan.end_date);
        setStartTime(plan.start_time ? plan.start_time.slice(0, 5) : '');
        setEndTime(plan.end_time ? plan.end_time.slice(0, 5) : '');
        setNotes(plan.notes || '');
        setConfirmingEdit(false);
        // Only scroll on mobile (panel is always visible on desktop)
        if (window.innerWidth < 1024) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleCancelEdit = () => {
        setEditingPlan(null);
        setConfirmingEdit(false);
        setEmpId(''); setStartDate(''); setEndDate(''); setStartTime(''); setEndTime(''); setNotes('');
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
                start_time: startTime || null,
                end_time:   endTime   || null,
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
                start_time:  startTime || null,
                end_time:    endTime   || null,
                days:        computedDays,
                notes:       notes.trim() || null,
                created_by:  user?.id,
            });
            useToastStore.getState().showToast('Listo', 'Vacaciones asignadas correctamente.', 'success');
            setEmpId(''); setStartDate(''); setEndDate(''); setStartTime(''); setEndTime(''); setNotes('');
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

    const handleCancelPlan = async (planId) => {
        const ok = await deleteVacationPlan(planId);
        if (ok) useToastStore.getState().showToast('Cancelado', 'Plan de vacaciones cancelado.', 'success');
        else    useToastStore.getState().showToast('Error', 'No se pudo cancelar el plan.', 'error');
    };

    const handleGenerateAI = async () => {
        const result = await generateAIPlan(year);
        if (result.success) {
            useToastStore.getState().showToast('Plan generado', `${result.count} vacaciones propuestas por el portal.`, 'success');
        } else {
            useToastStore.getState().showToast('Error', result.error || 'No se pudo generar el plan.', 'error');
        }
    };

    const handlePreApprove = async () => {
        if (!activeHeader) return;
        const ok = await preApprovePlan(activeHeader.id, year);
        if (ok) useToastStore.getState().showToast('Pre-aprobado', 'El plan es ahora visible para los empleados.', 'success');
        else    useToastStore.getState().showToast('Error', 'No se pudo pre-aprobar el plan.', 'error');
    };

    const handleProcessRequest = async (req, action, motivo = '') => {
        setProcessingRequestId(req.id);
        const meta = req.metadata || {};
        const ok = await processChangeRequest(
            req.id,
            action,
            meta.vacation_plan_id,
            action === 'APPROVED' ? meta.requested_start : null,
            action === 'APPROVED' ? meta.requested_end : null,
            motivo,
            user?.id ?? null,
        );
        setProcessingRequestId(null);
        setRechazandoCambio(null);
        if (ok) {
            useToastStore.getState().showToast(
                action === 'APPROVED' ? 'Cambio aprobado' : 'Cambio rechazado',
                action === 'APPROVED' ? 'Vacaciones actualizadas.' : 'Se mantienen las fechas originales.',
                action === 'APPROVED' ? 'success' : 'warning'
            );
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo procesar la solicitud.', 'error');
        }
    };

    // Vacation balance: only count confirmed/approved/taken — not pending or cancelled
    const usedDaysByEmpId = useMemo(() => {
        const map = new Map();
        vacationPlans
            .filter(p => p.year === year && ['APPROVED', 'CONFIRMED', 'TAKEN'].includes(p.status))
            .forEach(p => {
                const eid = String(p.employee_id);
                map.set(eid, (map.get(eid) || 0) + (p.days || 0));
            });
        return map;
    }, [vacationPlans, year]);

    const vacStatusFiltered = useMemo(() =>
        vacationPlans.filter(p => statusFilter === 'ALL' || p.status === statusFilter),
    [vacationPlans, statusFilter]);

    const { results: filtered, isFuzzy: isVacSearchFuzzy } = useMemo(() => {
        const sortFn = (a, b) => {
            const brA = a.branch?.name || '';
            const brB = b.branch?.name || '';
            if (brA !== brB) return brA.localeCompare(brB);
            const roA = a.employee?.role || a.employee?.position || '';
            const roB = b.employee?.role || b.employee?.position || '';
            if (roA !== roB) return roA.localeCompare(roB);
            return a.start_date.localeCompare(b.start_date);
        };
        if (!searchTerm.trim()) return { results: vacStatusFiltered.slice().sort(sortFn), isFuzzy: false };
        const { results, isFuzzy } = smartFilter(searchTerm, vacStatusFiltered, p => [p.employee?.name, p.branch?.name]);
        return { results: results.slice().sort(sortFn), isFuzzy };
    }, [vacStatusFiltered, searchTerm]);

    // ── Header: solo el buscador (§16.9) ─────────────────────────────────────
    // Esta vista REIMPLEMENTABA el buscador toggleable entero —su propio
    // `useSearchToggle`, su ref, su `inert`, sus dos mitades colapsables y el
    // punto rojo de "hay búsqueda activa"—. Todo eso ya lo da `ViewTabBar`
    // con el contrato de §24. Al migrarlo el ref quedó huérfano, que es la
    // prueba de que era duplicado y no personalización.
    const filtersContent = (
        <ViewTabBar
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            placeholder="Buscar empleado o sucursal…"
        />
    );

    // ── Cuerpo: la barra de filtros (§17) ────────────────────────────────────
    // Año, sucursal y estado RECORTAN el plan; estaban en el header solo porque
    // ahí estaba el contenedor. El orden es el de §17: ámbito (sucursal),
    // tiempo (año), estado.
    const filtrosCuerpo = (
        <FilterBar
            // El valor "sin filtrar" de esta vista es la cadena 'ALL', no ''.
            // Con `!!branchFilter` la ranura se habría marcado como filtrada
            // SIEMPRE — el mismo error que ya se cometió en StaffManagementView.
            onClear={() => { setYear(currentYear); setBranchFilter('ALL'); setStatusFilter('ALL'); }}
            activeCount={[year !== currentYear, branchFilter !== 'ALL', statusFilter !== 'ALL'].filter(Boolean).length}
        >
            {getScope('vacation_plan') === 'ALL' && (
                <FilterBar.Section active={branchFilter !== 'ALL'} onClear={() => setBranchFilter('ALL')} label="sucursal">
                    <FilterBar.Sucursal value={branchFilter}
                        onChange={val => setBranchFilter(val || 'ALL')} options={branchOptions} />
                </FilterBar.Section>
            )}

            <FilterBar.Section active={year !== currentYear} onClear={() => setYear(currentYear)} label="año">
                <PeriodStepper
                    unit="año"
                    label={String(year)}
                    isCurrent={year === currentYear}
                    resetLabel="Año actual"
                    onPrev={() => setYear(y => y - 1)}
                    onNext={() => setYear(y => y + 1)}
                    onReset={() => setYear(currentYear)}
                    nextDisabled={year >= currentYear + 1}
                />
            </FilterBar.Section>

            <FilterBar.Section active={statusFilter !== 'ALL'} onClear={() => setStatusFilter('ALL')} label="estado">
                <div className="w-[180px]">
                    <LiquidSelect
                        value={statusFilter}
                        onChange={val => setStatusFilter(val || 'ALL')}
                        options={[
                            { value: 'ALL',              label: 'Todos los estados' },
                            { value: 'DRAFT',            label: 'Borrador'          },
                            { value: 'PRE_APPROVED',     label: 'Pre-aprobado'      },
                            { value: 'CHANGE_REQUESTED', label: 'Cambio sol.'       },
                            { value: 'APPROVED',         label: 'Aprobado'          },
                            { value: 'TAKEN',            label: 'Tomado'            },
                        ]}
                        compact clearable={false} icon={ListFilter} bare
                    />
                </div>
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <>

            <GlassViewLayout icon={Palmtree} title="Plan anual de vacaciones" filtersContent={filtersContent} transparentBody={true} fixedScrollMode={true}>
                {/* Barra de filtros: cuerpo, a la derecha (§17) */}
                <div className="flex justify-end px-2 md:px-0 pb-4">{filtrosCuerpo}</div>
                <div className="flex flex-col lg:flex-row items-start gap-6 px-2 md:px-0 w-full h-full lg:h-[calc(100vh-230px)]">

                    {/* ── Panel izquierdo: Formulario (crear / editar) ── */}
                    {/* 320px entre `lg` y `2xl`, 400 de ahí para arriba.
                        La tabla del panel derecho recibía **460px a 1280** para
                        599 de columnas, y lo que quedaba fuera eran sus botones.
                        El formulario es el que puede ceder: sus campos son de
                        ancho completo y a 320 siguen entrando. */}
                    <div ref={panelRef} className="w-full lg:w-[320px] 2xl:w-[400px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8">
                        <div data-surface="card" data-tono={editingPlan ? 'warning' : undefined}
                    className="p-6 transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] relative">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-sm shrink-0 transition-colors duration-[var(--dur-lento)] ${editingPlan ? 'bg-warning' : 'bg-brand'}`}>
                                        {editingPlan
                                            ? <Pencil size={16} className="text-white" strokeWidth={2.5} />
                                            : <Plus size={16} className="text-white" strokeWidth={2.5} />
                                        }
                                    </div>
                                    <h3 className="font-black text-content text-subtitle uppercase tracking-tight">
                                        {editingPlan ? 'Editar Asignación' : 'Nueva Asignación'}
                                    </h3>
                                </div>
                                {editingPlan && (
                                    <Button variant="secondary" icon={X} onClick={handleCancelEdit}>Cancelar</Button>
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

                                {/* Vacation balance — only on create when eligible */}
                                {!editingPlan && selectedEmployee && eligibilityInfo?.isEligible && (() => {
                                    const used = usedDaysByEmpId.get(String(selectedEmployee.id)) || 0;
                                    const remaining = 15 - used;
                                    return (
                                        <div className={`flex items-center justify-between px-4 py-2.5 rounded-2xl border text-label font-bold ${remaining >= 0 ? 'bg-brand/5 border-brand/15 text-brand-text' : 'bg-danger/10 border-danger/30 text-danger-text'}`}>
                                            <span className="font-black uppercase tracking-widest text-micro">Saldo vacacional {year}</span>
                                            <span className="font-black text-body-lg">{Math.max(0, remaining)}<span className="text-micro font-bold ml-0.5">/ 15 días</span></span>
                                        </div>
                                    );
                                })()}

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

                                {/* ── La hora, cuando no es un día entero ──────────────────
                                    Vacías = día completo, que es el caso normal. Se ofrecen
                                    igual y no detrás de un interruptor porque el interruptor
                                    sería un control más para el caso raro y uno menos para
                                    entender el caso normal: dos campos vacíos ya dicen «todo
                                    el día». */}
                                {startDate && endDate && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <InputLabel>Empieza a las (opcional)</InputLabel>
                                            <div className="rounded-2xl bg-surface-card">
                                                <TimePicker12
                                                    value={startTime}
                                                    defaultMeridiem="PM"
                                                    onChange={setStartTime}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <InputLabel>Se reincorpora a las (opcional)</InputLabel>
                                            <div className="rounded-2xl bg-surface-card">
                                                <TimePicker12
                                                    value={endTime}
                                                    defaultMeridiem="AM"
                                                    onChange={setEndTime}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Días calculados */}
                                {computedDays > 0 && (
                                    <div className={`flex items-center gap-2 px-4 py-2.5 border rounded-2xl transition-colors duration-[var(--dur-lento)] ${editingPlan ? 'bg-warning/10 border-warning/20' : 'bg-brand/8 border-brand/15'}`}>
                                        <Calendar size={13} className={editingPlan ? 'text-warning' : 'text-brand-text'} strokeWidth={2.5} />
                                        <span className={`text-body-sm font-black ${editingPlan ? 'text-warning-text' : 'text-brand-text'}`}>
                                            {computedDays} días calendario
                                            {(startTime || endTime) && (
                                                <span className="font-bold opacity-70">
                                                    {' '}· {[startTime && 'el primer día', endTime && 'el último'].filter(Boolean).join(' y ')} se trabaja
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                )}

                                {/* Notas */}
                                <div>
                                    <InputLabel>Notas (opcional)</InputLabel>
                                    <PortalTextarea
                                        value={notes}
                                        onChange={e => setNotes(e.target.value)}
                                        placeholder="Observaciones adicionales…"
                                        rows={2}
                                    />
                                </div>

                                {/* Confirmación inline al guardar edición */}
                                {confirmingEdit && (
                                    <div className="flex items-center gap-3 px-4 py-3 bg-warning/10 border border-warning/30 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-[var(--dur-base)]">
                                        <AlertCircle size={14} className="text-warning shrink-0" strokeWidth={2.5} />
                                        <span className="text-label font-black text-warning-text flex-1">¿Confirmar cambios?</span>
                                        <Button variant="secondary" onClick={() => setConfirmingEdit(false)}>No</Button>
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    size="lg"
                                    className="w-full"
                                    loading={isSubmitting}
                                    disabled={!canEdit || !empId || !startDate || !endDate}
                                    tone={confirmingEdit ? 'success' : editingPlan ? 'warning' : null}
                                    icon={confirmingEdit ? Check : editingPlan ? Pencil : Palmtree}
                                >
                                    {isSubmitting
                                        ? 'Guardando…'
                                        : confirmingEdit
                                            ? 'Sí, guardar cambios'
                                            : editingPlan
                                                ? 'Guardar Cambios'
                                                : 'Asignar Vacaciones'}
                                </Button>
                            </form>
                        </div>
                    </div>

                    {/* ── Panel derecho: Header + Gantt + Tabla + Solicitudes ── */}
                    {/* `w-full` y no sólo `flex-1 min-w-0`: en el teléfono el
                        contenedor es `flex-col` + `items-start`, y ahí un hijo
                        se dimensiona por su CONTENIDO, no por el ancho
                        disponible — `flex-1` reparte el eje principal, que en
                        columna es el alto. Las tablas de adentro piden 600px de
                        mínimo, así que esta columna medía 915px en una pantalla
                        de 390 y el recorte del layout se comía la mitad de cada
                        fila (13 elementos, medidos). El panel de la izquierda no
                        lo sufría porque ya declaraba `w-full`. */}
                    <div className="w-full flex-1 min-w-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 space-y-5">

                        {/* Plan header status card */}
                        <div data-surface="card" className="p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-purple flex items-center justify-center shadow-sm">
                                        <Palmtree size={16} className="text-white" strokeWidth={2} />
                                    </div>
                                    <div>
                                        <p className="text-body font-black text-content">Plan de vacaciones {year}</p>
                                        {activeHeader ? (
                                            <Badge variant={HEADER_STATUS_META[activeHeader.status]?.variante || 'neutral'} size="sm">
                                                {HEADER_STATUS_META[activeHeader.status]?.label || activeHeader.status}
                                                {activeHeader.ai_generated && ' · IA'}
                                            </Badge>
                                        ) : (
                                            <span className="text-micro font-black uppercase tracking-widest text-content-2">Sin plan generado</span>
                                        )}
                                    </div>
                                </div>
                                {canEdit && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {/* Generate / Regenerate with AI */}
                                        {(!activeHeader || activeHeader.status === 'DRAFT') && (
                                            <Button disabled={isGeneratingPlan} onClick={handleGenerateAI}>{isGeneratingPlan
                                                    ? <><Loader2 size={12} className="animate-spin" /> Generando…</>
                                                    : <><Sparkles size={12} strokeWidth={2.5} /> {activeHeader ? 'Rehacer propuesta' : 'Generar propuesta'}</>
                                                }</Button>
                                        )}
                                        {/* Pre-approve */}
                                        {activeHeader?.status === 'DRAFT' && vacationPlans.filter(vp => vp.status === 'DRAFT').length > 0 && (
                                            <Button tone="chart-1" icon={ShieldCheck} onClick={handlePreApprove}>Pre-aprobar plan</Button>
                                        )}
                                        {activeHeader?.status === 'PRE_APPROVED' && (
                                            <Badge variant="chart-1" icon={CheckCircle2} uppercase={false}>Visible para empleados</Badge>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Gantt */}
                        <div data-surface="card" className="p-6 transition-all duration-[var(--dur-lento)]">
                            <div className="flex items-center justify-between mb-5">
                                <p className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5">
                                    <Calendar size={10} /> Línea de tiempo {year}
                                </p>
                                {isLoadingVacationPlans && <Loader2 size={14} className="animate-spin text-content-3" />}
                            </div>
                            <GanttChart plans={filtered} year={year} />
                        </div>

                        {/* Tabla — en el teléfono, SIN vidrio propio.
                            `DataTable` en modo ficha ya pinta una tarjeta
                            canónica por asignación, y dos capas del mismo
                            material se suman: en Liquid claro 0.16 + 0.16 ≈
                            0.30, o sea que la ficha se ve gris sobre el blanco
                            de la sección y parece deshabilitada. Es el mismo
                            defecto que §20 encontró en el tablero, sólo que acá
                            las dos capas son canónicas. */}
                        <div data-surface={enFichas ? undefined : 'card'}
                            className={`transition-all duration-[var(--dur-lento)] ${enFichas ? 'px-1' : 'p-6'}`}>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 mb-5">
                                <User size={10} /> Detalle de asignaciones
                            </p>

                            {/* El esqueleto lo dibuja el MISMO `DataTable` que la
                                lista, con las mismas `COLS_ASIGNACIONES`. La tabla a
                                mano que había acá repetía los siete encabezados en
                                texto plano —«Empleado», «Sucursal», …— y había que
                                acordarse de tocarlos cada vez que cambiaba una columna.
                                Y en el teléfono dibujaba una tabla justo donde la lista
                                real cae a fichas, o sea que la carga y el resultado no
                                se parecían. */}
                            {isLoadingVacationPlans ? (
                                <DataTable columns={COLS_ASIGNACIONES} minWidth="420px"
                                    movil={{ acciones: true }} loading skeletonRows={5} />
                            ) : filtered.length === 0 ? (
                                <EmptyState compact icon={Palmtree} title="Sin asignaciones en este período" />
                            ) : (
                                <>
                                {isVacSearchFuzzy && searchTerm && (
                                    <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
                                )}
                                {/* `DataTable` y no una tabla a mano: en el teléfono cada
                                    asignación se vuelve ficha sola. `acciones: true` porque
                                    acá los tres botones abren un modal o disparan una
                                    mutación de verdad —no despliegan una fila hermana—, y
                                    esconderlos dejaba la vista sin función en el teléfono. */}
                                <DataTable columns={COLS_ASIGNACIONES} minWidth="420px"
                                    movil={{ acciones: true }}>
                                            {filtered.map(p => {
                                                const isEditing = editingPlan?.id === p.id;
                                                const usedDays  = usedDaysByEmpId.get(String(p.employee_id)) || 0;
                                                const remaining = 15 - usedDays;
                                                return (
                                                        <DataRow key={p.id} className={`group/row ${isEditing ? 'bg-warning/10' : ''}`}>
                                                            <DataCell>
                                                                <div className="flex items-center gap-2.5 flex-wrap">
                                                                    <div className="w-7 h-7 rounded-full overflow-hidden bg-surface-card-hover border border-surface-card shadow-sm shrink-0 flex items-center justify-center text-content-3 font-black text-label">
                                                                        <AvatarConEstado emp={p.employee} px={28} radio="rounded-full" marco="" />
                                                                    </div>
                                                                    <p className="font-bold text-content-2 group-hover/row:text-brand-text transition-colors">{p.employee ? shortEmployeeName(p.employee) : '—'}</p>
                                                                    {p.metadata?.original_start_date && (
                                                                        <Badge variant="warning" size="sm" icon={Pencil} className="group/badge relative">
                                                                            Editado
                                                                            <span data-surface="tooltip" className="absolute bottom-full left-0 mb-1.5 hidden group-hover/badge:flex flex-col gap-0.5 text-micro font-bold px-3 py-2 whitespace-nowrap z-sidebar pointer-events-none">
                                                                                <span className="text-content-tooltip-2 font-black uppercase tracking-widest text-micro mb-0.5">Fecha original</span>
                                                                                <span>{fmtShort(p.metadata.original_start_date)} → {fmtShort(p.metadata.original_end_date)} · {p.metadata.original_days}d</span>
                                                                                <span className="text-content-tooltip-2 font-black uppercase tracking-widest text-micro mt-1 mb-0.5">Fecha actual</span>
                                                                                <span>{fmtShort(p.start_date)} → {fmtShort(p.end_date)} · {p.days}d</span>
                                                                            </span>
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                            </DataCell>
                                                            <DataCell hideBelow="2xl" className="text-content-3 font-medium">{p.branch?.name || '—'}</DataCell>
                                                            <DataCell className="text-content-2 font-medium whitespace-nowrap">
                                                                {fmtShort(p.start_date)}{p.start_time ? ` ${fmtHora(p.start_time.slice(0, 5))}` : ''} → {fmtShort(p.end_date)}{p.end_time ? ` ${fmtHora(p.end_time.slice(0, 5))}` : ''}
                                                            </DataCell>
                                                            <DataCell hideBelow="2xl" className="font-black text-content-2">{p.days}</DataCell>
                                                            <DataCell hideBelow="2xl">
                                                                <Badge variant={remaining >= 0 ? 'info' : 'danger'} size="sm">
                                                                    {Math.max(0, remaining)}<span className="font-medium opacity-60">/15</span>
                                                                </Badge>
                                                            </DataCell>
                                                            <DataCell hideBelow="2xl" className="max-w-[160px]">
                                                                {p.notes
                                                                    ? <p className="text-label text-content-3 font-medium leading-snug line-clamp-2">{p.notes}</p>
                                                                    : <span className="text-caption text-content-3">—</span>
                                                                }
                                                            </DataCell>
                                                            <DataCell><StatusBadge status={p.status} /></DataCell>
                                                            <DataCell align="right">
                                                                <div className="flex items-center justify-end gap-1 lg:opacity-0 lg:group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity duration-[var(--dur-base)]">
                                                                    {(p.status === 'PLANNED' || p.status === 'CONFIRMED') && (
                                                                        <Button
                                                                            icon={Pencil}
                                                                            iconOnly
                                                                            size="xs"
                                                                            tone="warning"
                                                                            soft
                                                                            title="Editar"
                                                                            onClick={() => handleStartEdit({ id: p.id, employee_id: p.employee_id, start_date: p.start_date, end_date: p.end_date, start_time: p.start_time, end_time: p.end_time, notes: p.notes || '', employee: p.employee })}
                                                                            disabled={!canEdit}
                                                                        />
                                                                    )}
                                                                    {p.status === 'PLANNED' && (
                                                                        <Button tone="success" size="xs" icon={Check} disabled={!canEdit} title="Confirmar" iconOnly onClick={() => handleConfirmPlan(p.id)} />
                                                                    )}
                                                                    {(p.status === 'PLANNED' || p.status === 'CONFIRMED') && (
                                                                        <Button variant="destructive" size="xs" icon={Trash2} disabled={!canEdit} title="Cancelar" iconOnly onClick={() => handleCancelPlan(p.id)} />
                                                                    )}
                                                                </div>
                                                            </DataCell>
                                                        </DataRow>
                                                );
                                            })}
                                </DataTable>
                                </>
                            )}
                        </div>

                        {/* Solicitudes de cambio */}
                        {vacationChangeRequests.length > 0 && (
                            <div data-surface="card" className="border-warning/30 p-6">
                                <p className="text-caption font-black uppercase tracking-widest text-warning flex items-center gap-1.5 mb-4">
                                    <MessageSquare size={10} /> Solicitudes de cambio ({vacationChangeRequests.length})
                                </p>
                                <div className="space-y-3">
                                    {vacationChangeRequests.map(req => {
                                        const meta = req.metadata || {};
                                        const isProcessing = processingRequestId === req.id;
                                        const emp = req.employee;
                                        return (
                                            <div key={req.id} className="bg-warning/10 border border-warning/30 rounded-2xl p-4">
                                                <div className="flex flex-wrap items-start gap-3 justify-between">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-8 h-8 rounded-full overflow-hidden bg-surface-card-hover border border-surface-card shadow-sm flex-shrink-0 flex items-center justify-center text-content-3 font-black text-label">
                                                            <AvatarConEstado emp={emp} px={36} radio="rounded-full" marco="" />
                                                        </div>
                                                        <div>
                                                            <p className="text-body-sm font-black text-content">{shortEmployeeName(emp)}</p>
                                                            <p className="text-caption text-content-3 font-medium">
                                                                Solicita: <strong>{fmtShort(meta.requested_start)}</strong>
                                                                <ArrowRight size={10} className="inline mx-1" strokeWidth={2.5} />
                                                                <strong>{fmtShort(meta.requested_end)}</strong>
                                                            </p>
                                                            {meta.original_start && (
                                                                <p className="text-micro text-content-3 mt-0.5">
                                                                    Original: {fmtShort(meta.original_start)} → {fmtShort(meta.original_end)}
                                                                </p>
                                                            )}
                                                            {req.note && (
                                                                <p className="text-caption text-warning-text mt-1 italic">"{req.note}"</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {canEdit && (
                                                        <div className="flex items-center gap-2">
                                                            <Button tone="success" disabled={isProcessing} onClick={() => handleProcessRequest(req, 'APPROVED')}>{isProcessing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} strokeWidth={3} />}
                                                                Aprobar</Button>
                                                            <Button variant="destructive" icon={X} disabled={isProcessing} onClick={() => setRechazandoCambio(req)}>Rechazar</Button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </GlassViewLayout>

            {/* Un rechazo se explica. `required` no es adorno: sin motivo el
                empleado ve «rechazado» y no sabe qué corregir, y en la base no
                quedaba nada — este camino ni siquiera escribía `approver_note`.
                Es `PromptModal` y no un diálogo propio porque el mismo pedido
                se hace en la auditoría de asistencia. */}
            <PromptModal
                isOpen={Boolean(rechazandoCambio)}
                onClose={() => setRechazandoCambio(null)}
                onConfirm={(motivo) => handleProcessRequest(rechazandoCambio, 'REJECTED', motivo)}
                title="Rechazar el cambio"
                message="Se mantienen las fechas originales. Decile por qué."
                placeholder="Por qué no se puede cambiar..."
                confirmText="Rechazar"
                isProcessing={Boolean(processingRequestId)}
                required
            />
        </>
    );
};

export default VacationPlanView;
