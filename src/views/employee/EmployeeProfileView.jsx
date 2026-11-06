import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { EmptyState } from '../../components/common/StateViews';
import {
    User, Phone, HeartPulse, Briefcase, Droplet,
    Clock, Pencil, Calendar, ArrowRightLeft, Cake, Palmtree,
    MapPin, CreditCard, Award, ClipboardList, SlidersHorizontal, ChevronDown, ChevronUp, ChevronRight, X, Stethoscope, FileText,
    FolderOpen, UserRound, CalendarDays,
} from 'lucide-react';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { EVENT_TYPES } from '@nucleo/data/constants';
import {
    fetchOwnEventsFull, fetchOwnPendingRequestsCount, fetchOwnVacationPlansActive,
} from '@nucleo/data/employeeSelfService';
import GlassViewLayout from '../../components/GlassViewLayout';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import { formatTime12h } from '@nucleo/utils/helpers';
import { aMinutos } from '@nucleo/utils/turnoDelDia';
import SearchInput from '../../components/common/SearchInput';
import EmployeeDocumentsList from '../../components/common/EmployeeDocumentsList';
import SegmentedControl from '../../components/common/SegmentedControl';
import ElegirNombreDialog from '../../components/layout/ElegirNombreDialog';
import { shortEmployeeName, tieneNombreQueElegir } from '@nucleo/utils/nameUtils';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { ESTADO_DE_PLAN, ausenciaDelDia, cumpleEn, filtrarHistorial, historialDePerfil, proximasVacaciones, semanaDelPerfil, tieneHorarioPublicado, tiempoEnLaEmpresa } from '@nucleo/utils/miPerfil';

const formatDate = (d) => d
    ? fechaTexto(d, { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
const diaCorto = (d) => fechaTexto(d, { day: 'numeric', month: 'short' });

// Tokenizado T7 — mismo criterio que RequestsView.jsx (comparten el mismo
// enum de `type`, deben verse iguales en ambas vistas): VACATION/DISABILITY
// son severidad real (positivo/negativo), el resto es categórico puro,
// mapeado a los MISMOS chart-N que RequestsView para el tipo compartido.
const EVENT_THEMES = {
    VACATION:    { dot: 'border-success',  glow: 'hover:shadow-[var(--shadow-glow-success)]', variante: 'success' },
    PERMIT:      { dot: 'border-success',  glow: 'hover:shadow-[var(--shadow-glow-success)]', variante: 'success' },
    DISABILITY:  { dot: 'border-danger',   glow: 'hover:shadow-[var(--shadow-glow-danger)]',  variante: 'danger'  },
    SHIFT_CHANGE:{ dot: 'border-chart-3',  glow: 'hover:shadow-[var(--shadow-glow-chart-3)]', variante: 'chart-3' },
    SALARY:      { dot: 'border-chart-6',  glow: 'hover:shadow-[var(--shadow-glow-chart-6-lg)]', variante: 'chart-6' },
    TRANSFER:    { dot: 'border-chart-1',  glow: 'hover:shadow-[var(--shadow-glow-chart-1)]', variante: 'chart-1' },
    HIRING:      { dot: 'border-success',  glow: 'hover:shadow-[var(--shadow-glow-success)]', variante: 'success' },
};
const DEFAULT_THEME = { dot: 'border-brand', glow: 'hover:shadow-[var(--shadow-glow-brand)]', variante: 'neutral' };

// Las ausencias que pueden cubrir un día de la semana.
const AUSENCIA = {
    VACATION:   { label: 'Vacaciones',  Icon: Palmtree,    barra: 'bg-success', text: 'text-success-text' },
    DISABILITY: { label: 'Incapacidad', Icon: Stethoscope, barra: 'bg-danger',  text: 'text-danger-text'  },
    PERMIT:     { label: 'Permiso',     Icon: FileText,    barra: 'bg-success', text: 'text-success-text' },
};

// La franja que dibuja cada día: de 6:00 a 22:00. Un turno fuera de ella se
// recorta al borde — la hora exacta va escrita al lado, la barra sólo ubica.
const FRANJA_INICIO = 6 * 60;
const FRANJA_FIN    = 22 * 60;
const tramoEnFranja = (inicio, fin) => {
    const i = aMinutos(inicio);
    let f = aMinutos(fin);
    if (f <= i) f += 1440;
    const total = FRANJA_FIN - FRANJA_INICIO;
    const desde = Math.max(0, Math.min(total, i - FRANJA_INICIO));
    const hasta = Math.max(0, Math.min(total, f - FRANJA_INICIO));
    return { desde: (desde / total) * 100, largo: Math.max(4, ((hasta - desde) / total) * 100) };
};

const SectionCard = ({ children, className = '' }) => (
    <section data-surface="card" className={`p-5 md:p-6 ${className}`}>
        {children}
    </section>
);

/** Encabezado de sección: rótulo a la izquierda, lo que la acompañe a la derecha. */
const SectionHeader = ({ icon: Icon, label, children }) => (
    <div className="flex items-center justify-between gap-2 mb-4 min-h-[var(--tap-min)]">
        <h3 className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
            <Icon size={12} /> {label}
        </h3>
        {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
);

/** Un renglón de dato: ícono con su color, rótulo y valor. Lo que falta se dice. */
const Dato = ({ icon: Icon, tinte, label, value, sub }) => (
    <div className="flex items-center gap-3.5 py-3">
        <div className="size-9 grid place-items-center bg-surface-card border border-divider rounded-xl shadow-sm shrink-0">
            <Icon size={15} className={tinte} strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
            <p className="text-micro font-black text-content-3 uppercase tracking-widest mb-0.5">{label}</p>
            <p className={`text-body-sm truncate ${value ? 'font-bold text-content' : 'font-medium text-content-3 italic'}`}>
                {value || 'No registrado'}
            </p>
        </div>
        {sub && <Badge uppercase={false} size="sm" className="shrink-0">{sub}</Badge>}
    </div>
);

/** Un signo vital dentro de la tarjeta de la persona. Si lleva a algún lado, es botón. */
const Signo = ({ icon: Icon, tinte, fondo, label, value, sub, onClick }) => {
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag type={onClick ? 'button' : undefined} onClick={onClick}
            data-interactive={onClick ? '' : undefined}
            className={`group flex items-center gap-3 px-4 py-4 text-left min-w-0 ${onClick ? 'rounded-2xl hover:bg-surface-card-hover active:scale-[0.97] transition-all duration-[var(--dur-base)]' : ''}`}>
            <div className={`size-10 grid place-items-center rounded-xl shrink-0 ${fondo}`}>
                <Icon size={18} className={tinte} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-micro font-black text-content-3 uppercase tracking-widest truncate">{label}</p>
                <p className="text-body-lg font-black text-content leading-tight truncate">{value}</p>
                {sub && <p className="text-caption font-bold text-content-3 truncate">{sub}</p>}
            </div>
            {onClick && <ChevronRight size={14} className="text-content-3 shrink-0 group-hover:translate-x-0.5 transition-transform duration-[var(--dur-base)]" />}
        </Tag>
    );
};

const edadDe = (nacimiento, hoy) => {
    if (!nacimiento) return null;
    const [ny, nm, nd] = String(nacimiento).slice(0, 10).split('-').map(Number);
    const [hy, hm, hd] = hoy.split('-').map(Number);
    return hy - ny - ((hm < nm || (hm === nm && hd < nd)) ? 1 : 0);
};

const horasTexto = (minutos) => {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
};

const EmployeeProfileView = ({ openModal }) => {
    const { user, hasPermission } = useAuth();
    const navigate = useNavigate();
    // «Mi perfil» es de LECTURA salvo para quien además administra personal.
    // El botón existía siempre y guardar reventaba con un error de PostgREST:
    // la policy de `employees` exige `staff_list.can_edit` y no hay ninguna que
    // deje a una persona escribir su propia ficha. Ofrecer una acción que la
    // base va a rechazar no es un permiso de más, es una promesa que no se
    // cumple — mejor decirlo con la pantalla que con un error.
    const puedeEditarSuFicha = hasPermission('staff_list', 'can_edit');
    const puedeVerSolicitudes = hasPermission('requests_personales', 'can_view');
    const employees = useStaffStore(s => s.employees);
    const branches  = useStaffStore(s => s.branches);
    const shifts    = useStaffStore(s => s.shifts);

    const emp    = employees.find(e => String(e.id) === String(user?.id)) || user;
    const branch = branches.find(b => String(b.id) === String(emp?.branchId || emp?.branch_id));
    const hoy    = hoySV();

    const [events, setEvents]           = useState([]);
    const [eligiendoNombre, setEligiendoNombre] = useState(false);
    const [evLoading, setEvLoading]     = useState(true);
    const [activeCount, setActiveCount] = useState(null);
    const [myVacPlans, setMyVacPlans]   = useState([]);
    const [timelineLimit, setTimelineLimit]           = useState(6);
    const [showTimelineFilter, setShowTimelineFilter] = useState(false);
    const [filterFrom, setFilterFrom]                 = useState('');
    const [filterTo, setFilterTo]                     = useState('');
    const [filterType, setFilterType]                 = useState('');
    const [searchQuery, setSearchQuery]               = useState('');

    useEffect(() => {
        if (!user?.id) return;
        let vivo = true;
        const load = async () => {
            setEvLoading(true);
            const [{ data: evData }, { count }, { data: planes }] = await Promise.all([
                fetchOwnEventsFull(user.id),
                fetchOwnPendingRequestsCount(user.id),
                fetchOwnVacationPlansActive(user.id),
            ]);
            if (!vivo) return;
            setEvents(evData || []);
            setActiveCount(count || 0);
            setMyVacPlans(planes || []);
            setEvLoading(false);
        };
        load();
        return () => { vivo = false; };
    }, [user?.id]);

    const hireDate = emp?.hire_date || emp?.hireDate;
    const birthDate = emp?.birth_date || emp?.birthDate;

    const tenure = useMemo(() => tiempoEnLaEmpresa(hireDate), [hireDate]);
    const timeline = useMemo(() => historialDePerfil(events, hireDate, branch?.name), [events, hireDate, branch]);

    // De lunes a domingo, con el turno de cada día: `semanaDelPerfil` (núcleo),
    // que resuelve cada día con el canónico de horarios.
    const hayHorario = tieneHorarioPublicado(emp?.weeklySchedule);
    const semana = useMemo(() => semanaDelPerfil(emp?.weeklySchedule || {}, shifts), [emp?.weeklySchedule, shifts]);
    const minutosDeLaSemana = useMemo(() => semana.reduce((t, d) => t + (d.minutos || 0), 0), [semana]);
    const diasQueTrabaja = semana.filter(d => d.turno).length;
    const diaDeHoy = semana.find(d => d.fecha === hoy) || null;
    const ausHoy = diaDeHoy ? ausenciaDelDia(events, hoy) : null;
    const AUSENCIA_HOY = ausHoy ? AUSENCIA[ausHoy.type] : null;

    const availableTypes = useMemo(() =>
        [...new Set(timeline.map(ev => ev.type))].filter(Boolean)
    , [timeline]);

    const hayFiltro = !!(filterFrom || filterTo || filterType || searchQuery.trim());
    const filtrada = useMemo(
        () => filtrarHistorial(timeline, { desde: filterFrom, hasta: filterTo, tipo: filterType, busqueda: searchQuery, rotulos: EVENT_TYPES }),
        [timeline, filterFrom, filterTo, filterType, searchQuery]);
    const visibleTimeline = !hayFiltro && timelineLimit !== null ? filtrada.slice(0, timelineLimit) : filtrada;

    const nextVacation = useMemo(() => proximasVacaciones(myVacPlans), [myVacPlans]);
    const cumple = useMemo(() => cumpleEn(birthDate), [birthDate]);
    const edad = edadDe(birthDate, hoy);
    const documentos = Array.isArray(emp?.employee_documents) ? emp.employee_documents : [];

    if (!emp) return (
        <GlassViewLayout icon={User} title="Mi perfil" transparentBody={true}>
            <div className="max-w-7xl mx-auto w-full pb-12 space-y-5 animate-in fade-in duration-[var(--dur-slow)]">
                <div className="skeleton rounded-modal h-56" />
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <div className="lg:col-span-8 space-y-5">
                        <div className="skeleton rounded-modal h-48" />
                        <div className="skeleton rounded-modal h-72" />
                    </div>
                    <div className="lg:col-span-4 space-y-5">
                        <div className="skeleton rounded-modal h-80" />
                        <div className="skeleton rounded-modal h-44" />
                    </div>
                </div>
            </div>
        </GlassViewLayout>
    );

    const eligeNombre = tieneNombreQueElegir(emp);
    const filtersContent = (eligeNombre || puedeEditarSuFicha) ? (
        <div data-surface="card" className="flex items-center h-[4rem] md:h-[4.5rem] p-2 md:p-3 gap-2">
            {/* Cuál de sus nombres y apellidos usa en el portal (2026-10-30). */}
            {eligeNombre && (
                <Button variant="secondary" icon={UserRound} onClick={() => setEligiendoNombre(true)}
                    title={`En el portal apareces como ${shortEmployeeName(emp)}`}>
                    <span className="hidden sm:inline">Mi nombre</span>
                </Button>
            )}
            {puedeEditarSuFicha && (
                <Button icon={Pencil} onClick={() => openModal('editContact', emp)}><span className="hidden sm:inline">Editar</span></Button>
            )}
            {/* Sin botón de cambiar contraseña, a propósito: la contraseña sólo
                la restablece alguien con permiso (FormSetPassword). Desde acá
                se cambiaba la de la cuenta CON LA QUE SE ENTRÓ, y entrando con
                el carné eso era la del carné, cuya clave tiene que ser su propio
                código: el carné dejaba de abrir y la contraseña personal seguía
                igual. Pasó dos veces (8-sep y 22-sep-2026). */}
        </div>
    ) : null;

    const hayEmergencia = emp.emergency_contact_name || emp.emergency_contact_phone || emp.blood_type;

    return (
        <GlassViewLayout icon={User} title="Mi perfil" filtersContent={filtersContent} transparentBody={true}>
            <ElegirNombreDialog empleado={emp} open={eligiendoNombre} onClose={() => setEligiendoNombre(false)} />
            <div className="max-w-7xl mx-auto w-full pb-12 space-y-5 md:space-y-6 animate-in fade-in duration-[var(--dur-lento)]">

                {/* ── LA PERSONA — misma anatomía que la ficha de Personal:
                    degradé de marca arriba, foto con aro, nombre y cargo. Los
                    signos vitales van DENTRO de la tarjeta y no como fila de
                    StatCard: topadas en 200px dejaban media fila vacía. ── */}
                <section data-surface="card" className="relative overflow-hidden">
                    <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-brand/15 to-transparent pointer-events-none" />
                    <div className="relative z-base p-5 md:p-7 flex flex-col md:flex-row md:items-center gap-5 md:gap-7">
                        <div className="rounded-full p-1.5 bg-surface-card border border-border-card shadow-xl shrink-0 self-center md:self-auto">
                            <AvatarConEstado emp={emp} px={104} marco="" />
                        </div>
                        <div className="min-w-0 flex-1 text-center md:text-left">
                            <h2 className="text-title md:text-display font-black text-content leading-tight tracking-tight">{emp.name}</h2>
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-2">
                                <Badge variant="info">{emp.role || 'Sin cargo asignado'}</Badge>
                                {branch && (
                                    <span className="inline-flex items-center gap-1 text-caption font-bold text-content-2">
                                        <MapPin size={12} className="text-content-3" /> {branch.name}
                                    </span>
                                )}
                            </div>
                            {eligeNombre && (
                                <p className="text-caption font-medium text-content-3 mt-2">
                                    En el portal apareces como <span className="font-black text-content-2">{shortEmployeeName(emp)}</span>
                                </p>
                            )}
                        </div>
                        {/* Lo que más se viene a mirar: qué toca hoy. */}
                        {diaDeHoy && (
                            <div className={`shrink-0 self-center md:self-auto rounded-2xl border px-4 py-3 flex items-center gap-3 ${
                                ausHoy ? 'bg-success/10 border-success/30' : diaDeHoy.turno ? 'bg-brand/10 border-brand/30' : 'bg-surface-card-hover/60 border-divider'}`}>
                                <div className={`size-10 grid place-items-center rounded-xl ${ausHoy ? 'bg-success/15' : diaDeHoy.turno ? 'bg-brand/15' : 'bg-surface-card'}`}>
                                    {ausHoy
                                        ? <AUSENCIA_HOY.Icon size={18} className={AUSENCIA_HOY.text} strokeWidth={2} />
                                        : <Clock size={18} className={diaDeHoy.turno ? 'text-brand-text' : 'text-content-3'} strokeWidth={2} />}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-micro font-black text-content-3 uppercase tracking-widest">Hoy</p>
                                    <p className="text-body font-black text-content leading-tight whitespace-nowrap">
                                        {ausHoy ? AUSENCIA_HOY.label
                                            : diaDeHoy.turno ? `${formatTime12h(diaDeHoy.turno.start)} – ${formatTime12h(diaDeHoy.turno.end)}`
                                            : hayHorario ? 'Día libre' : 'Sin horario publicado'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="relative z-base border-t border-divider grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x divide-divider px-1 md:px-2 py-1">
                        <Signo icon={Award} fondo="bg-chart-1/10" tinte="text-chart-1-text"
                            label="Antigüedad" value={tenure}
                            sub={hireDate ? `Desde ${formatDate(hireDate)}` : 'Sin fecha de ingreso'} />
                        <Signo icon={ClipboardList} fondo="bg-warning/10" tinte="text-warning-text"
                            label="Solicitudes"
                            value={activeCount === null ? '…' : activeCount === 0 ? 'Nada pendiente' : `${activeCount} pendiente${activeCount === 1 ? '' : 's'}`}
                            sub={puedeVerSolicitudes ? 'Ver mis solicitudes' : (activeCount ? 'En revisión' : 'Nada en espera')}
                            onClick={puedeVerSolicitudes ? () => navigate('/solicitudes-personales') : undefined} />
                        <Signo icon={Palmtree} fondo="bg-success/10" tinte="text-success-text"
                            label="Próximas vacaciones"
                            value={nextVacation ? diaCorto(nextVacation.start_date) : 'Sin planificar'}
                            sub={nextVacation
                                ? `${nextVacation.days} días · ${nextVacation.status === 'CONFIRMED' ? 'confirmadas' : 'planificadas'}`
                                : 'Nada en el calendario'} />
                        <Signo icon={Cake} fondo="bg-chart-6/10" tinte="text-chart-6-text"
                            label="Cumpleaños"
                            value={birthDate ? diaCorto(birthDate) : 'Sin fecha'}
                            sub={cumple || (edad != null ? `${edad} años` : null)} />
                    </div>
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 md:gap-6 items-start">

                    {/* ── COLUMNA PRINCIPAL — la semana y el historial ── */}
                    <div className="lg:col-span-8 space-y-5 md:space-y-6 min-w-0">

                        <SectionCard>
                            <SectionHeader icon={CalendarDays} label="Mi semana">
                                <span className="text-caption font-bold text-content-3 hidden sm:inline">
                                    {diaCorto(semana[0]?.fecha)} – {diaCorto(semana[6]?.fecha)}
                                </span>
                                {hayHorario && (
                                    <Badge variant="info" uppercase={false}>
                                        {horasTexto(minutosDeLaSemana)} · {diasQueTrabaja} {diasQueTrabaja === 1 ? 'día' : 'días'}
                                    </Badge>
                                )}
                            </SectionHeader>

                            {!hayHorario && (
                                <EmptyState linea icon={CalendarDays} className="mb-3 !py-3"
                                    title="Tu horario de esta semana aún no está publicado"
                                    subtitle="Cuando lo publiquen, aquí verás tus turnos día por día." />
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
                                {semana.map(d => {
                                    const esHoy = d.fecha === hoy;
                                    const pasado = d.fecha < hoy;
                                    const aus = ausenciaDelDia(events, d.fecha);
                                    const cfg = aus ? AUSENCIA[aus.type] : null;
                                    const tramo = !cfg && d.turno ? tramoEnFranja(d.turno.start, d.turno.end) : null;
                                    return (
                                        <div key={d.id} aria-current={esHoy ? 'date' : undefined}
                                            className={`rounded-2xl p-3 flex sm:flex-col items-center sm:items-stretch gap-3 sm:gap-2 sm:text-center border transition-colors duration-[var(--dur-base)]
                                                ${esHoy ? 'bg-brand/10 border-brand' : 'bg-surface-card-hover/50 border-divider'}
                                                ${pasado ? 'opacity-55' : ''}`}>
                                            <div className="flex sm:flex-col items-baseline sm:items-center gap-1.5 sm:gap-0.5 w-14 sm:w-auto shrink-0">
                                                <span className={`text-micro font-black uppercase tracking-widest ${esHoy ? 'text-brand-text' : 'text-content-3'}`}>
                                                    {esHoy ? 'Hoy' : d.short}
                                                </span>
                                                <span className={`text-subtitle font-black leading-none ${esHoy ? 'text-brand-text' : 'text-content'}`}>
                                                    {Number(d.fecha.slice(8))}
                                                </span>
                                            </div>

                                            {/* La franja: 6:00 arriba, 22:00 abajo (a lo ancho en el teléfono). */}
                                            <div aria-hidden="true" className="relative flex-1 sm:flex-none h-2 sm:h-20 sm:w-2.5 sm:mx-auto rounded-full bg-divider overflow-hidden">
                                                {cfg && <div className={`absolute inset-0 ${cfg.barra} opacity-60`} />}
                                                {tramo && (
                                                    <>
                                                        <div className={`absolute inset-y-0 sm:hidden rounded-full ${esHoy ? 'bg-brand' : 'bg-chart-1'}`}
                                                            style={{ left: `${tramo.desde}%`, width: `${tramo.largo}%` }} />
                                                        <div className={`absolute inset-x-0 hidden sm:block rounded-full ${esHoy ? 'bg-brand' : 'bg-chart-1'}`}
                                                            style={{ top: `${tramo.desde}%`, height: `${tramo.largo}%` }} />
                                                    </>
                                                )}
                                            </div>

                                            <div className="w-28 sm:w-auto shrink-0 min-w-0">
                                                {cfg ? (
                                                    <p className={`text-caption font-black flex sm:justify-center items-center gap-1 ${cfg.text}`}>
                                                        <cfg.Icon size={12} strokeWidth={2} /> {cfg.label}
                                                    </p>
                                                ) : d.turno ? (
                                                    <>
                                                        <p className="text-caption font-black text-content leading-tight">{formatTime12h(d.turno.start)}</p>
                                                        <p className="text-caption font-bold text-content-3 leading-tight">{formatTime12h(d.turno.end)}</p>
                                                    </>
                                                ) : (
                                                    <p className="text-caption font-bold text-content-3">{hayHorario ? 'Libre' : '—'}</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </SectionCard>

                        {/* Historial de eventos */}
                        <SectionCard>
                            <SectionHeader icon={Clock} label="Mi historial">
                                <Badge uppercase={false}>{hayFiltro ? `${filtrada.length} de ${timeline.length}` : timeline.length}</Badge>
                                {/* Buscador expandible — Tipo 2b (widget inline con filtro al lado), ver DESIGN.md §24 */}
                                <SearchInput expandable value={searchQuery} onChange={setSearchQuery} placeholder="Buscar…" />
                                <Button
                                    size="xs"
                                    aria-expanded={showTimelineFilter}
                                    variant={showTimelineFilter ? undefined : 'secondary'}
                                    tone={showTimelineFilter ? 'chart-8' : null}
                                    icon={SlidersHorizontal}
                                    onClick={() => setShowTimelineFilter(v => !v)}
                                >
                                    <span className="hidden sm:inline">Filtrar</span>
                                    {showTimelineFilter ? <ChevronUp size={10} className="inline ml-1" /> : <ChevronDown size={10} className="inline ml-1" />}
                                </Button>
                            </SectionHeader>

                            {showTimelineFilter && (
                                <div data-surface="card" className="mb-4 p-3 bg-surface-card-hover/80 space-y-3 animate-in fade-in slide-in-from-top-1 duration-[var(--dur-base)]">
                                    <div className="flex items-center gap-2">
                                        <LiquidDatePicker compact shortcuts value={filterFrom} onChange={setFilterFrom} />
                                        <span className="text-content-3 text-body-sm font-bold shrink-0">→</span>
                                        <LiquidDatePicker compact shortcuts value={filterTo} onChange={setFilterTo} />
                                        {(filterFrom || filterTo || filterType) && (
                                            <Button tone="danger" soft size="sm" icon={X} title="Limpiar filtros" iconOnly onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterType(''); }} />
                                        )}
                                    </div>
                                    {/* "Todos" es la primera opción del grupo, no un botón
                                        suelto: así el lector de pantalla cuenta bien. */}
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
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className="flex gap-3 pl-7 relative">
                                            <div className="absolute -left-[10px] top-2 w-4 h-4 rounded-full skeleton" />
                                            <div className="flex-1 skeleton rounded-2xl h-16" />
                                        </div>
                                    ))}
                                </div>
                            ) : timeline.length === 0 ? (
                                <EmptyState compact icon={Clock} title="Sin eventos" />
                            ) : visibleTimeline.length === 0 ? (
                                <EmptyState linea icon={Clock} title="Sin resultados" />
                            ) : (
                                <>
                                <ol className="relative border-l-[2px] border-divider ml-3 space-y-3 pb-1">
                                    {visibleTimeline.map((ev, idx) => {
                                        const theme = EVENT_THEMES[ev.type] || DEFAULT_THEME;
                                        const label = ev.type === 'HIRING' ? 'Contratación inicial' : (EVENT_TYPES[ev.type]?.label || 'Movimiento');
                                        const meta        = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                                        const isCancelled = meta.status === 'CANCELLED';
                                        const isEdited    = meta.status === 'SUPERSEDED';
                                        return (
                                            <li key={ev.id || `ev-${idx}`} className="relative pl-7 group/ev">
                                                <div className={`absolute -left-[9px] top-4 w-[14px] h-[14px] rounded-full bg-surface-card border-2 shadow-sm group-hover/ev:scale-125 transition-transform duration-[var(--dur-slow)] z-base ${theme.dot}`} />
                                                <div data-surface="card" className={`p-4 transition-all duration-[var(--dur-slow)] ${theme.glow} ${isCancelled || isEdited ? 'opacity-50' : ''}`}>
                                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                        <div className="flex items-center gap-1.5">
                                                            <Badge variant={theme.variante} size="sm">{label}</Badge>
                                                            {(isCancelled || isEdited) && (
                                                                <Badge variant={isCancelled ? 'danger' : 'neutral'} size="sm">{isCancelled ? 'Cancelado' : 'Editado'}</Badge>
                                                            )}
                                                        </div>
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
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ol>
                                {!hayFiltro && timeline.length > 6 && (
                                    <div className="mt-3 pt-3 border-t border-divider">
                                        {timelineLimit !== null
                                            ? <Button variant="secondary" onClick={() => setTimelineLimit(null)}>Ver todo ({timeline.length})</Button>
                                            : <Button variant="secondary" onClick={() => setTimelineLimit(6)}>Mostrar menos</Button>}
                                    </div>
                                )}
                                </>
                            )}
                        </SectionCard>
                    </div>

                    {/* ── COLUMNA LATERAL — mis datos, emergencia, expediente ── */}
                    <div className="lg:col-span-4 space-y-5 md:space-y-6 min-w-0">

                        <SectionCard>
                            <SectionHeader icon={User} label="Mis datos" />
                            <div className="divide-y divide-divider -my-3">
                                <Dato icon={Phone}      tinte="text-success-text"   label="Celular"          value={emp.phone} />
                                <Dato icon={CreditCard} tinte="text-chart-3-text"   label="DUI"              value={emp.dui} />
                                <Dato icon={MapPin}     tinte="text-chart-4-text"   label="Sucursal"         value={branch?.name} />
                                <Dato icon={Briefcase}  tinte="text-brand-text"     label="Contrato"         value={emp.contract_type}
                                    sub={emp.weekly_hours ? `${emp.weekly_hours} h/sem` : null} />
                                <Dato icon={Calendar}   tinte="text-chart-1-text"   label="Fecha de ingreso" value={hireDate ? formatDate(hireDate) : null} />
                                <Dato icon={Cake}       tinte="text-chart-6-text"   label="Nacimiento"       value={birthDate ? formatDate(birthDate) : null} />
                            </div>
                        </SectionCard>

                        <SectionCard>
                            <SectionHeader icon={HeartPulse} label="En caso de emergencia" />
                            {hayEmergencia ? (
                                <div className="divide-y divide-divider -my-3">
                                    <Dato icon={User}    tinte="text-danger-text" label="Avisar a"       value={emp.emergency_contact_name} />
                                    <Dato icon={Phone}   tinte="text-danger-text" label="Teléfono"       value={emp.emergency_contact_phone} />
                                    <Dato icon={Droplet} tinte="text-danger-text" label="Tipo de sangre" value={emp.blood_type} />
                                </div>
                            ) : (
                                <EmptyState linea icon={HeartPulse} iconClass="text-danger-text" className="!py-2"
                                    title="Sin contacto registrado"
                                    subtitle="Pídele a Talento Humano que agregue a quién avisar y tu tipo de sangre." />
                            )}
                        </SectionCard>

                        {/* Mi Expediente — credenciales (employee_documents JSONB): CV, Contrato,
                            DUI, y (si aplica por Cargo/Profesión) Carné + Anualidad JVPQF/JVPE.
                            Nombrado distinto de "Mis documentos" (menú aparte, adjuntos de
                            solicitudes) para no confundir ambos conceptos. */}
                        <SectionCard>
                            <SectionHeader icon={FolderOpen} label="Mi expediente">
                                {documentos.length > 0 && <Badge uppercase={false}>{documentos.length}</Badge>}
                            </SectionHeader>
                            <EmployeeDocumentsList documents={documentos} />
                        </SectionCard>

                        {/* Plan de vacaciones */}
                        {myVacPlans.length > 0 && (
                            <SectionCard>
                                <SectionHeader icon={Palmtree} label="Plan de vacaciones" />
                                <div className="space-y-2">
                                    {myVacPlans.map(vp => {
                                        const s = ESTADO_DE_PLAN[vp.status] || ESTADO_DE_PLAN.PLANNED;
                                        const proxima = vp.end_date >= hoy;
                                        return (
                                            <div key={vp.id} className={`flex items-center gap-3 p-3 border rounded-2xl ${proxima ? 'bg-success/10 border-success/30' : 'border-divider'}`}>
                                                <div className={`p-2 rounded-xl flex-shrink-0 ${proxima ? 'bg-success/10' : 'bg-surface-card-hover'}`}>
                                                    <Palmtree size={13} className={proxima ? 'text-success-text' : 'text-content-3'} strokeWidth={2} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-body-sm font-black text-content-2 truncate">{diaCorto(vp.start_date)} → {formatDate(vp.end_date)}</p>
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
                </div>
            </div>
        </GlassViewLayout>
    );
};

export default EmployeeProfileView;
