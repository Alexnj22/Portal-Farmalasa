import React, { useState, useEffect, useMemo } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { EmptyState } from '../../components/common/StateViews';
import { tokenMatch } from '../../utils/searchUtils';
import {
    User, Phone, HeartPulse, Briefcase, KeyRound,
    Clock, Pencil, Calendar, ArrowRightLeft, Sparkles, Palmtree,
    MapPin, CreditCard, Coffee, Zap, Award, TrendingUp, SlidersHorizontal, ChevronDown, ChevronUp, X, Stethoscope, FileText,
    FolderOpen
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { EVENT_TYPES } from '../../data/constants';
import {
    fetchOwnEventsFull, fetchOwnPendingRequestsCount, fetchOwnVacationPlansActive,
} from '../../data/employeeSelfService';
import GlassViewLayout from '../../components/GlassViewLayout';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import { formatTime12h } from '../../utils/helpers';
import SearchInput from '../../components/common/SearchInput';
import EmployeeDocumentsList from '../../components/common/EmployeeDocumentsList';
import SegmentedControl from '../../components/common/SegmentedControl';

const formatDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

// Tokenizado T7 — mismo criterio que RequestsView.jsx (comparten el mismo
// enum de `type`, deben verse iguales en ambas vistas): VACATION/DISABILITY
// son severidad real (positivo/negativo), el resto es categórico puro,
// mapeado a los MISMOS chart-N que RequestsView para el tipo compartido.
const EVENT_THEMES = {
    VACATION:    { bg: 'bg-success/10',  text: 'text-success-text', border: 'border-success/30', dot: 'border-success',  glow: 'hover:shadow-[var(--shadow-glow-success)]', variante: 'success' },
    PERMIT:      { bg: 'bg-success/10',  text: 'text-success-text', border: 'border-success/30', dot: 'border-success',  glow: 'hover:shadow-[var(--shadow-glow-success)]', variante: 'success'  },
    DISABILITY:  { bg: 'bg-danger/10',   text: 'text-danger-text',  border: 'border-danger/30',  dot: 'border-danger',   glow: 'hover:shadow-[var(--shadow-glow-danger)]', variante: 'danger'   },
    SHIFT_CHANGE:{ bg: 'bg-chart-3/10',  text: 'text-chart-3-text', border: 'border-chart-3/30', dot: 'border-chart-3',  glow: 'hover:shadow-[var(--shadow-glow-chart-3)]', variante: 'chart-3'   },
    SALARY:      { bg: 'bg-chart-6/10',  text: 'text-chart-6-text', border: 'border-chart-6/30', dot: 'border-chart-6',  glow: 'hover:shadow-[var(--shadow-glow-chart-6-lg)]', variante: 'chart-6'  },
    TRANSFER:    { bg: 'bg-chart-1/10',  text: 'text-chart-1-text', border: 'border-chart-1/30', dot: 'border-chart-1',  glow: 'hover:shadow-[var(--shadow-glow-chart-1)]', variante: 'chart-1'  },
    HIRING:      { bg: 'bg-success/10',  text: 'text-success-text', border: 'border-success/30', dot: 'border-success',  glow: 'hover:shadow-[var(--shadow-glow-success)]', variante: 'success' },
};
const DEFAULT_THEME = { bg: 'bg-surface-card-hover', text: 'text-content-2', border: 'border-border-card', dot: 'border-brand', glow: 'hover:shadow-[var(--shadow-glow-brand)]', variante: 'neutral' };

const WEEK_DAYS = [
    { id: 1, short: 'Lu' }, { id: 2, short: 'Ma' }, { id: 3, short: 'Mi' },
    { id: 4, short: 'Ju' }, { id: 5, short: 'Vi' }, { id: 6, short: 'Sá' },
    { id: 0, short: 'Do' },
];

const SectionCard = ({ children, className = '' }) => (
    <div data-surface="card" className={`p-5 transition-all duration-[var(--dur-slow)] ${className}`}>
        {children}
    </div>
);

const SectionLabel = ({ icon: Icon, label, color = 'text-content-3' }) => (
    <p className={`text-caption font-black uppercase tracking-widest ${color} flex items-center gap-1.5 mb-3`}>
        <Icon size={10} /> {label}
    </p>
);

const Field = ({ label, value, icon: Icon }) => (
    <div data-surface="card" className="p-3.5 hover:bg-surface-card transition-all duration-[var(--dur-base)] cursor-default">
        <div className="flex items-center gap-1.5 mb-0.5">
            {Icon && <Icon size={9} className="text-content-3 flex-shrink-0" />}
            <p className="text-micro font-black text-content-3 uppercase tracking-[0.15em]">{label}</p>
        </div>
        <p className="text-body font-bold text-content-2 truncate">{value || 'No registrado'}</p>
    </div>
);

const EmployeeProfileView = ({ openModal }) => {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const branches  = useStaffStore(s => s.branches);
    const shifts    = useStaffStore(s => s.shifts);

    const emp    = employees.find(e => String(e.id) === String(user?.id)) || user;
    const branch = branches.find(b => String(b.id) === String(emp?.branchId || emp?.branch_id));

    const [events, setEvents]           = useState([]);
    const [evLoading, setEvLoading]     = useState(true);
    const [activeCount, setActiveCount] = useState(0);
    const [myVacPlans, setMyVacPlans]   = useState([]);
    const [timelineLimit, setTimelineLimit]           = useState(8);
    const [showTimelineFilter, setShowTimelineFilter] = useState(false);
    const [filterFrom, setFilterFrom]                 = useState('');
    const [filterTo, setFilterTo]                     = useState('');
    const [filterType, setFilterType]                 = useState('');
    const [searchQuery, setSearchQuery]               = useState('');

    useEffect(() => {
        if (!user?.id) return;
        const load = async () => {
            setEvLoading(true);
            const [{ data: evData }, { count }] = await Promise.all([
                fetchOwnEventsFull(user.id),
                fetchOwnPendingRequestsCount(user.id),
            ]);
            setEvents(evData || []);
            setActiveCount(count || 0);
            setEvLoading(false);
        };
        load();
    }, [user?.id]);

    useEffect(() => {
        if (!user?.id) return;
        fetchOwnVacationPlansActive(user.id).then(({ data }) => setMyVacPlans(data || []));
    }, [user?.id]);


    const tenure = useMemo(() => {
        const hd = emp?.hire_date || emp?.hireDate;
        if (!hd) return '—';
        const h = new Date(hd + 'T12:00:00'), now = new Date();
        let y = now.getFullYear() - h.getFullYear();
        let m = now.getMonth() - h.getMonth();
        if (m < 0) { y--; m += 12; }
        if (y === 0 && m === 0) return 'Nuevo';
        return `${y > 0 ? `${y} año${y > 1 ? 's' : ''} ` : ''}${m > 0 ? `${m} mes${m > 1 ? 'es' : ''}` : ''}`.trim();
    }, [emp?.hire_date, emp?.hireDate]);

    const timeline = useMemo(() => {
        const hd = emp?.hire_date || emp?.hireDate;
        const synthetic = hd ? [{ id: 'hiring-event', type: 'HIRING', date: hd, isSystem: true, note: `Inicio de labores. Sucursal: ${branch?.name || 'N/A'}`, metadata: {} }] : [];
        return [...events, ...synthetic].sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [events, emp?.hire_date, emp?.hireDate, branch]);

    const weeklySchedule = useMemo(() => {
        if (!emp?.weeklySchedule) return [];
        const now = new Date(); now.setHours(0,0,0,0);
        const day = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
        return WEEK_DAYS.map(d => {
            const raw = emp.weeklySchedule[d.id] ?? emp.weeklySchedule[String(d.id)];
            const shiftId = typeof raw === 'object' ? raw?.shiftId : raw;
            const shift = shiftId && shiftId !== 'LIBRE' ? shifts.find(s => String(s.id) === String(shiftId)) : null;
            const offset = d.id === 0 ? 6 : d.id - 1;
            const date = new Date(monday);
            date.setDate(monday.getDate() + offset);
            return { ...d, shift, date };
        });
    }, [emp, shifts]);

    const availableTypes = useMemo(() =>
        [...new Set(timeline.map(ev => ev.type))].filter(Boolean)
    , [timeline]);

    // Devuelve el evento (VACATION/DISABILITY/PERMIT) activo en una fecha dada
    const getEventForDate = useMemo(() => (dateStr) => {
        return events.find(ev => {
            if (!['VACATION', 'DISABILITY', 'PERMIT'].includes(ev.type)) return false;
            const meta = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
            const s = meta.startDate || ev.date;
            const e = meta.endDate   || ev.date;
            return dateStr >= s && dateStr <= e;
        }) || null;
    }, [events]);

    const visibleTimeline = useMemo(() => {
        let list = timeline;
        if (filterFrom) list = list.filter(ev => ev.date >= filterFrom);
        if (filterTo)   list = list.filter(ev => ev.date <= filterTo);
        if (filterType) list = list.filter(ev => ev.type === filterType);
        if (searchQuery.trim()) {
            list = list.filter(ev => tokenMatch(searchQuery,
                ev.note,
                EVENT_TYPES[ev.type]?.label,
                ev.type
            ));
        }
        const hasFilter = filterFrom || filterTo || filterType || searchQuery.trim();
        if (!hasFilter && timelineLimit !== null) list = list.slice(0, timelineLimit);
        return list;
    }, [timeline, filterFrom, filterTo, filterType, searchQuery, timelineLimit]);

    const nextVacation = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return myVacPlans.find(vp => vp.end_date >= today && (vp.status === 'PLANNED' || vp.status === 'CONFIRMED')) || null;
    }, [myVacPlans]);

    const birthdayCountdown = useMemo(() => {
        if (!emp?.birth_date) return null;
        const today = new Date(); today.setHours(0,0,0,0);
        const bd = new Date(emp.birth_date + 'T12:00:00');
        let next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
        if (next < today) next.setFullYear(today.getFullYear() + 1);
        const diff = Math.round((next - today) / (1000 * 60 * 60 * 24));
        if (diff === 0) return '¡Hoy! 🎉';
        if (diff === 1) return 'Mañana';
        if (diff <= 30) return `en ${diff} días`;
        return null;
    }, [emp]);

    if (!emp) return (
        <GlassViewLayout icon={User} title="Mi perfil" transparentBody={true}>
            <div className="pt-4 md:pt-6 px-4 md:px-6 pb-10 flex flex-col lg:flex-row gap-5 items-start animate-in fade-in duration-[var(--dur-slow)]">
                <div className="w-full lg:w-[400px] shrink-0 space-y-4">
                    <div className="skeleton rounded-header h-80" />
                    <div className="grid grid-cols-2 gap-3">
                        <div className="skeleton rounded-2xl h-11" />
                        <div className="skeleton rounded-2xl h-11" />
                    </div>
                    <div className="skeleton rounded-modal h-44" />
                </div>
                <div className="flex-1 min-w-0 space-y-4">
                    <div className="skeleton rounded-modal h-24" />
                    <div className="skeleton rounded-modal h-32" />
                    <div className="skeleton rounded-modal h-72" />
                </div>
            </div>
        </GlassViewLayout>
    );

    const VAC_STATUS = {
        PLANNED:   { label: 'Planificado', bg: 'bg-chart-1/10',    text: 'text-chart-1-text',    border: 'border-chart-1/30'    , variante: 'chart-1' },
        CONFIRMED: { label: 'Confirmado',  bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30' , variante: 'success' },
        TAKEN:     { label: 'Completado',  bg: 'bg-surface-card-hover',  text: 'text-content-3',   border: 'border-divider'   , variante: 'neutral' },
    };

    const headerLeft = (
        <div className="flex items-center gap-3.5">
            <div className="relative shrink-0">
                <div className="w-10 h-10 md:w-11 md:h-11 rounded-full overflow-hidden border-2 border-border-card shadow-md">
                    {emp.photo || emp.photo_url
                        ? <img src={emp.photo || emp.photo_url} className="w-full h-full object-cover" alt="" />
                        : <div className="w-full h-full bg-gradient-to-br from-chart-8 to-chart-8-text flex items-center justify-center text-white">
                            <User size={18} strokeWidth={2} />
                          </div>
                    }
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-success rounded-full border-2 border-border-card shadow-sm" />
            </div>
            <div className="min-w-0">
                <p className="text-caption font-black text-content-2 uppercase tracking-widest">Mi perfil</p>
                <h2 className="font-black text-title md:text-display text-content tracking-tight leading-tight truncate">{emp.name}</h2>
                <p className="text-caption font-bold text-content-3 truncate">
                    {emp.role || 'Empleado'}{branch ? ` · ${branch.name}` : ''}
                </p>
            </div>
        </div>
    );

    const filtersContent = (
        <div data-surface="card" className="flex items-center h-[4rem] md:h-[4.5rem] p-2 md:p-3 gap-2">
            {/* Info chips */}
            {emp.phone && (
                <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-surface-card border border-border-card rounded-2xl">
                    <Phone size={11} className="text-content-3 shrink-0" />
                    <span className="text-label font-bold text-content-2 whitespace-nowrap">{emp.phone}</span>
                </div>
            )}
            {emp.dui && (
                <div className="hidden lg:flex items-center gap-2 px-3 py-2 bg-surface-card border border-border-card rounded-2xl">
                    <CreditCard size={11} className="text-content-3 shrink-0" />
                    <span className="text-label font-bold text-content-2 whitespace-nowrap">{emp.dui}</span>
                </div>
            )}
            {(emp.phone || emp.dui) && <div className="hidden md:block w-px h-6 bg-divider mx-0.5 shrink-0" />}
            {/* Edit button */}
            <Button icon={Pencil} onClick={() => openModal('editContact', emp)}><span className="hidden sm:inline">Editar</span></Button>
            {/* Password button */}
            <Button tone="warning" icon={KeyRound} title="Cambiar contraseña" iconOnly onClick={() => openModal('changeOwnPassword', {})} />
        </div>
    );

    return (
        <GlassViewLayout headerLeft={headerLeft} filtersContent={filtersContent} transparentBody={true}>
            <div className="pt-4 md:pt-6 px-4 md:px-6 pb-10 flex flex-col lg:flex-row gap-5 items-start">

                {/* ── COLUMNA IZQUIERDA — todas las cards informativas ── */}
                <div className="w-full lg:w-[400px] shrink-0 space-y-4">

                    {/* Stats 2-col */}
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Antigüedad',  value: tenure,           icon: Award, color: 'text-chart-1-text',  bg: 'bg-chart-1/10'  },
                            { label: 'Pendientes',  value: activeCount ?? 0, icon: Zap,   color: 'text-warning', bg: 'bg-warning/10' },
                        ].map(({ label, value, icon: Icon, color, bg }) => (
                            <div key={label} className={`${bg} border border-border-card rounded-2xl p-4 flex flex-col items-center text-center hover:translate-y-[var(--lift-card)] hover:shadow-[var(--shadow-elevation-sm)] transition-all duration-[var(--dur-base)] cursor-default`}>
                                <Icon size={16} className={`${color} mb-1.5`} strokeWidth={2} />
                                <p className="text-subtitle font-black text-content-2 leading-tight">{value}</p>
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest mt-0.5">{label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Quick info 2×2 */}
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Fecha de Ingreso',    value: emp.hire_date  ? formatDate(emp.hire_date)  : '—', icon: Calendar,  color: 'text-chart-1-text',   bg: 'bg-chart-1/10'   },
                            { label: 'Fecha de Nacimiento', value: emp.birth_date ? formatDate(emp.birth_date) : '—', icon: Sparkles,  color: 'text-chart-6',   bg: 'bg-chart-6/10',  extra: birthdayCountdown },
                            { label: 'Tipo de Contrato',    value: emp.contract_type || '—',                           icon: Briefcase, color: 'text-chart-3-text', bg: 'bg-chart-3/10' },
                            { label: 'Horas Semanales',     value: emp.weekly_hours ? `${emp.weekly_hours}h` : '—',   icon: Clock,     color: 'text-warning',  bg: 'bg-warning/10'  },
                        ].map(({ label, value, icon: Icon, color, bg, extra }) => (
                            <div key={label} className={`${bg} border border-border-card rounded-2xl p-4 hover:translate-y-[var(--lift-card)] hover:shadow-[var(--shadow-elevation-sm)] transition-all duration-[var(--dur-base)] cursor-default`}>
                                <Icon size={14} className={`${color} mb-2`} strokeWidth={2} />
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">{label}</p>
                                <p className="text-body font-black text-content-2 leading-tight">{value}</p>
                                {extra && <p className="text-caption font-bold text-chart-6 mt-0.5">{extra}</p>}
                            </div>
                        ))}
                    </div>

                    {/* Próximas vacaciones */}
                    {nextVacation && (
                        <div className="flex items-center gap-2.5 bg-success/10 border border-success/30 rounded-2xl px-4 py-3">
                            <Palmtree size={14} className="text-success shrink-0" strokeWidth={2} />
                            <div className="min-w-0">
                                <p className="text-micro font-black text-success uppercase tracking-widest">Próximas vacaciones</p>
                                <p className="text-body-sm font-black text-success-text truncate">
                                    {new Date(nextVacation.start_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    {nextVacation.status === 'CONFIRMED' && <span className="ml-1.5 text-success font-bold">· Confirmadas</span>}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Contacto */}
                    <SectionCard>
                        <SectionLabel icon={Phone} label="Contacto" />
                        <div className="space-y-2">
                            <Field label="Celular"         value={emp.phone}  icon={Phone} />
                            <Field label="Documento (DUI)" value={emp.dui}    icon={CreditCard} />
                            <Field label="Sucursal"        value={branch?.name} icon={MapPin} />
                        </div>
                    </SectionCard>

                    {/* Mi Expediente — credenciales (employee_documents JSONB): CV, Contrato,
                        DUI, y (si aplica por Cargo/Profesión) Carné + Anualidad JVPQF/JVPE.
                        Nombrado distinto de "Mis documentos" (menú aparte, adjuntos de
                        solicitudes) para no confundir ambos conceptos. */}
                    <SectionCard>
                        <SectionLabel icon={FolderOpen} label="Mi Expediente" />
                        <EmployeeDocumentsList documents={emp.employee_documents} />
                    </SectionCard>

                    {/* Emergencia */}
                    {(emp.emergency_contact_name || emp.emergency_contact_phone || emp.blood_type) && (
                        <div className="bg-danger/10 border border-danger/30 rounded-modal p-5 shadow-[var(--shadow-glow-danger)] hover:shadow-[var(--shadow-glow-danger)] hover:translate-y-[var(--lift-card)] transition-all duration-[var(--dur-slow)]">
                            <SectionLabel icon={HeartPulse} label="Contacto de Emergencia" color="text-danger" />
                            <div className="space-y-2">
                                <Field label="Avisar a"            value={emp.emergency_contact_name}  icon={User} />
                                <Field label="Teléfono emergencia" value={emp.emergency_contact_phone} icon={Phone} />
                                {emp.blood_type && <Field label="Tipo de sangre" value={emp.blood_type} icon={HeartPulse} />}
                            </div>
                        </div>
                    )}

                    {/* Plan de vacaciones */}
                    {myVacPlans.length > 0 && (
                        <SectionCard>
                            <SectionLabel icon={Palmtree} label="Plan de vacaciones" color="text-success" />
                            <div className="space-y-2">
                                {myVacPlans.map(vp => {
                                    const s = VAC_STATUS[vp.status] || VAC_STATUS.PLANNED;
                                    const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
                                    const isUpcoming = vp.end_date >= new Date().toISOString().split('T')[0];
                                    // Un solo ternario para las dos cosas, porque dependen de la MISMA
                                    // condición: cuando la vacación ya pasó el elemento es
                                    // `data-surface="card"` y el canónico lo levanta con `--lift-card`;
                                    // cuando es próxima no hay superficie que lo levante, así que el
                                    // lift va a mano. Las dos ramas dan los mismos 2px. Antes estaban
                                    // separados y el lift a mano se SUMABA al canónico en la rama de
                                    // tarjeta: la misma fila se movía 4px o 2px según la fecha.
                                    return (
                                        <div key={vp.id} data-surface={isUpcoming ? undefined : 'card'} className={`flex items-center gap-3 p-3 border rounded-2xl hover:shadow-[var(--shadow-elevation-sm)] transition-all duration-[var(--dur-base)] ${isUpcoming ? 'bg-success/10 border-success/30 hover:translate-y-[var(--lift-card)]' : ''}`}>
                                            <div className={`p-2 rounded-xl flex-shrink-0 ${isUpcoming ? 'bg-success/10' : 'bg-surface-card-hover'}`}>
                                                <Palmtree size={13} className={isUpcoming ? 'text-success' : 'text-content-3'} strokeWidth={2} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-body-sm font-black text-content-2 truncate">{fmt(vp.start_date)} → {fmt(vp.end_date)}</p>
                                                <p className="text-caption text-content-3 font-medium">{vp.days} días · {vp.year}</p>
                                            </div>
                                            <Badge variant={s.variante} size="sm" className="flex-shrink-0">{s.label}</Badge>
                                        </div>
                                    );
                                })}
                            </div>
                        </SectionCard>
                    )}
                </div>

                {/* ── COLUMNA DERECHA — horario e historial ── */}
                <div className="flex-1 min-w-0 space-y-4">

                    {/* Horario habitual */}
                    {weeklySchedule.length > 0 && (
                        <SectionCard>
                            <SectionLabel icon={Clock} label="Mi Horario Habitual" color="text-content-3" />
                            <div className="overflow-x-auto w-full">
                            <div className="grid grid-cols-7 gap-1.5 min-w-[320px]">
                                {weeklySchedule.map(d => {
                                    const todayStr = new Date().toDateString();
                                    const isToday  = d.date?.toDateString() === todayStr;
                                    const dateStr  = d.date?.toISOString().split('T')[0];
                                    const ev       = dateStr ? getEventForDate(dateStr) : null;
                                    const evCfg    = ev ? {
                                        VACATION:   { label: 'Vac', Icon: Palmtree,    bg: 'bg-success', light: 'bg-success/10 border-success/30', text: 'text-success-text' },
                                        DISABILITY: { label: 'Incapacidad', Icon: Stethoscope, bg: 'bg-danger',     light: 'bg-danger/10 border-danger/30',         text: 'text-danger-text'     },
                                        PERMIT:     { label: 'Per', Icon: FileText,    bg: 'bg-success',   light: 'bg-success/10 border-success/30',     text: 'text-success-text'   },
                                    }[ev.type] : null;
                                    return (
                                        <div key={d.id} className={`flex flex-col items-center rounded-2xl p-2 transition-all duration-[var(--dur-base)] ${
                                            isToday   ? 'bg-chart-8 shadow-md'
                                            : evCfg   ? `${evCfg.light} border`
                                            : d.shift ? 'bg-surface-card border border-border-card'
                                                      : 'bg-surface-card-hover/80 border border-divider'
                                        }`}>
                                            <p className={`text-micro font-black uppercase tracking-widest ${isToday ? 'text-white/50' : evCfg ? evCfg.text : 'text-content-2'}`}>{d.short}</p>
                                            <p className={`text-subtitle font-black leading-none mb-1 ${isToday ? 'text-white' : evCfg ? evCfg.text : 'text-content-2'}`}>{d.date?.getDate()}</p>
                                            {evCfg ? (
                                                <>
                                                    <evCfg.Icon size={10} className={evCfg.text} strokeWidth={2} />
                                                    <p className={`text-micro font-black mt-1 text-center leading-tight ${evCfg.text}`}>{evCfg.label}</p>
                                                </>
                                            ) : d.shift ? (
                                                <>
                                                    <Coffee size={10} className={isToday ? 'text-chart-4-text' : 'text-chart-4-text'} strokeWidth={2} />
                                                    <p className={`text-micro font-black mt-1 text-center leading-tight ${isToday ? 'text-white' : 'text-content-2'}`}>
                                                        {formatTime12h(d.shift.start).replace(' AM','a').replace(' PM','p').replace(' am','a').replace(' pm','p')}
                                                    </p>
                                                    <p className={`text-micro font-medium text-center leading-tight ${isToday ? 'text-white/50' : 'text-content-3'}`}>
                                                        {formatTime12h(d.shift.end).replace(' AM','a').replace(' PM','p').replace(' am','a').replace(' pm','p')}
                                                    </p>
                                                </>
                                            ) : (
                                                <p className="text-micro font-bold text-content-3 mt-1">Libre</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            </div>
                        </SectionCard>
                    )}

                    {/* Historial de eventos */}
                    <SectionCard>
                        <div className="flex items-center justify-between mb-3">
                            <SectionLabel icon={Clock} label="Historial de Eventos" />
                            <div className="flex items-center gap-2 -mt-3">
                                <Badge uppercase={false}>{visibleTimeline.length}/{timeline.length}</Badge>
                                {/* Buscador expandible — Tipo 2b (widget inline con filtro al lado), ver DESIGN.md §24 */}
                                <SearchInput
                                    expandable
                                    value={searchQuery}
                                    onChange={setSearchQuery}
                                    placeholder="Buscar…"
                                />
                                <Button
                                    size="xs"
                                    aria-expanded={showTimelineFilter}
                                    variant={showTimelineFilter ? undefined : 'secondary'}
                                    tone={showTimelineFilter ? 'chart-8' : null}
                                    icon={SlidersHorizontal}
                                    onClick={() => setShowTimelineFilter(v => !v)}
                                >
                                    Filtrar
                                    {showTimelineFilter ? <ChevronUp size={10} className="inline ml-1" /> : <ChevronDown size={10} className="inline ml-1" />}
                                </Button>
                            </div>
                        </div>

                        {/* Filter panel */}
                        {showTimelineFilter && (
                            <div data-surface="card" className="mb-4 p-3 bg-surface-card-hover/80 space-y-3 animate-in fade-in slide-in-from-top-1 duration-[var(--dur-base)]">
                                {/* Date range */}
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
                                        <LiquidDatePicker compact shortcuts value={filterFrom} onChange={setFilterFrom} />
                                    </div>
                                    <span className="text-content-3 text-body-sm font-bold shrink-0">→</span>
                                    <div className="flex-1 bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
                                        <LiquidDatePicker compact shortcuts value={filterTo} onChange={setFilterTo} />
                                    </div>
                                    {(filterFrom || filterTo || filterType) && (
                                        <Button tone="danger" soft size="sm" icon={X} title="Limpiar filtros" iconOnly onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterType(''); setTimelineLimit(8); }} />
                                    )}
                                </div>
                                {/* "Todos" estaba FUERA del `SegmentedControl` al que
                                    pertenece: un `<button>` suelto al lado del grupo.
                                    Visualmente parecía una opción más, pero para un
                                    lector de pantalla el grupo decía "1 de 4" cuando en
                                    realidad hay 5 opciones, y "Todos" ni siquiera
                                    figuraba como parte del conjunto. Es la primera
                                    opción del grupo, no un botón. */}
                                {availableTypes.length > 1 && (
                                    <SegmentedControl
                                        size="sm"
                                        options={[
                                            { value: '', label: 'Todos' },
                                            ...availableTypes.map(type => ({
                                                value: type,
                                                label: type === 'HIRING' ? 'Contratación' : (EVENT_TYPES[type]?.label || type),
                                            })),
                                        ]}
                                        value={filterType}
                                        onChange={t => setFilterType(filterType === t ? '' : t)}
                                        label="Tipo de evento" />
                                )}
                            </div>
                        )}

                        {evLoading ? (
                            <div className="space-y-3 animate-in fade-in duration-[var(--dur-slow)]">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="flex gap-3 pl-7 relative">
                                        <div className="absolute -left-[10px] top-2 w-4 h-4 rounded-full skeleton" />
                                        <div className="flex-1 skeleton rounded-2xl h-16" />
                                    </div>
                                ))}
                            </div>
                        ) : timeline.length === 0 ? (
                            <EmptyState compact icon={Clock} title="Sin eventos" />
                        ) : (
                            <>
                            <div className="relative border-l-[2px] border-divider ml-3 space-y-3 pb-2">
                                {visibleTimeline.map((ev, idx) => {
                                    const theme = EVENT_THEMES[ev.type] || DEFAULT_THEME;
                                    const label = ev.type === 'HIRING' ? 'Contratación Inicial' : (EVENT_TYPES[ev.type]?.label || ev.type);
                                    const meta        = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                                    const isCancelled = meta.status === 'CANCELLED';
                                    const isEdited    = meta.status === 'SUPERSEDED';
                                    return (
                                        <div key={ev.id || `ev-${idx}`} className="relative pl-7 group/ev">
                                            <div className={`absolute -left-[9px] top-2.5 w-[14px] h-[14px] rounded-full bg-white border-2 shadow-sm group-hover/ev:scale-125 transition-transform duration-[var(--dur-slow)] z-base ${theme.dot}`} />
                                            <div data-surface="card" className={`p-4 transition-all duration-[var(--dur-slow)] ${theme.glow} ${isCancelled || isEdited ? 'opacity-50' : ''}`}>
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                    <Badge variant={theme.variante} size="sm">{label}</Badge>
                                                    <span className="text-caption font-bold text-content-3">{formatDate(ev.date)}</span>
                                                </div>
                                                <p className="text-body-sm text-content-2 leading-relaxed font-medium">{ev.note || 'Evento registrado.'}</p>
                                                {meta.endDate && (
                                                    <p className="text-label text-content-3 font-medium mt-1.5 flex items-center gap-1">
                                                        <Calendar size={10} /> Hasta: {formatDate(meta.endDate)}
                                                    </p>
                                                )}
                                                {meta.permissionDates?.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {meta.permissionDates.map((d, i) => (
                                                            <Badge key={i} variant="warning" uppercase={false}>{formatDate(d)}</Badge>
                                                        ))}
                                                    </div>
                                                )}
                                                {meta.old_value && meta.new_value && (
                                                    <p className="text-label font-medium text-content-3 mt-2 bg-surface-card p-2 rounded-lg border border-divider flex gap-2 items-center">
                                                        <span className="font-bold line-through opacity-70">{meta.old_value}</span>
                                                        <ArrowRightLeft size={10} />
                                                        <span className="font-bold text-brand-text">{meta.new_value}</span>
                                                    </p>
                                                )}
                                                {(isCancelled || isEdited) && (
                                                    <Badge variant={isCancelled ? 'danger' : 'neutral'} size="sm" className="mt-2">{isCancelled ? 'Cancelado' : 'Editado'}</Badge>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Ver todo / Mostrar menos — solo cuando no hay filtros activos */}
                            {!filterFrom && !filterTo && !filterType && (
                                timelineLimit !== null && timeline.length > timelineLimit ? (
                                    <div className="mt-3 pt-3 border-t border-divider">
                                        <Button variant="secondary" onClick={() => setTimelineLimit(null)}>Ver todo ({timeline.length})</Button>
                                    </div>
                                ) : timelineLimit === null ? (
                                    <div className="mt-3 pt-3 border-t border-divider">
                                        <Button variant="secondary" onClick={() => { setTimelineLimit(8); setShowTimelineFilter(false); }}>Mostrar menos</Button>
                                    </div>
                                ) : null
                            )}
                            </>
                        )}
                    </SectionCard>
                </div>
            </div>
        </GlassViewLayout>
    );
};

export default EmployeeProfileView;
