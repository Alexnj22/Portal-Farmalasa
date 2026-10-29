import React, { useMemo, useCallback, useState, useEffect, memo } from "react";
import LiquidTooltip from '../components/common/LiquidTooltip';
import OjoDeTarjeta from '../components/common/OjoDeTarjeta';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import LiquidSelect from '../components/common/LiquidSelect';
import FilterBar from '../components/common/FilterBar';
import ViewTabBar from '../components/common/ViewTabBar';
import { AiThinkingState, Skeleton, SkeletonText } from '../components/common/StateViews';
import { useNavigate, Link } from "react-router-dom";
import {
    Building2, MapPin, Phone, Smartphone, Clock, Pencil, Trash2, Plus,
    Users, Monitor, AlertTriangle, CheckCircle2, Info, AlertCircle,
    Search, Filter, X, Copy, MessageCircle,
    Briefcase, Shield, Stethoscope, Sparkles
} from "lucide-react";
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { kioscosActivos, LIMITE_KIOSCOS } from '@nucleo/utils/kioscos';
import { clickable } from '@nucleo/utils/clickable';
import { abiertaAhora, alertasDeSucursal, completitudDelPerfil, horarioDefinido, horarioDeHoy, leerAjustes, ORDEN_DE_TIPOS, TIPOS_DE_SUCURSAL } from "@nucleo/utils/sucursales";
import ConfirmModal from "../components/common/ConfirmModal";
import AlertModal from "../components/common/AlertModal";
import GlassViewLayout from '../components/GlassViewLayout';
import { useToastStore } from '@nucleo/store/toastStore';
import { useAuth } from '@nucleo/context/AuthContext';

import { smartFilter } from '@nucleo/utils/searchUtils';
import { fetchBranchKiosks } from '@nucleo/data/branches';
import { soloPersonalEnPlanilla } from '@nucleo/utils/tipoDeFicha';
import { esInmuebleAlquilado } from '@nucleo/utils/gastosDeSucursal';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

const FILTER_OPTIONS = [
    { value: "ALL", label: "Todas" },
    { value: "ALERTS", label: "Con alertas" },
    { value: "INACTIVE", label: "Inactivas" },
    { value: "RENTED", label: "Alquiladas" },
    { value: "OWNED", label: "Propias" },
];

// `color` era la paleta SOFT de `Badge` escrita a mano; ahora es el nombre de
// la variante y el color lo pone el canónico (2026-07-28, D3.5).
const BRANCH_TYPE_META = TIPOS_DE_SUCURSAL;
const TYPE_ORDER = ORDEN_DE_TIPOS;

const safeParse = leerAjustes;   // núcleo (`sucursales`)

// ============================================================================
// 🧠 FUNCIONES PURAS
// ============================================================================

// Horario, apertura, completitud y alertas: `sucursales` (núcleo, las mismas de la app).
// Las alertas traen el NOMBRE del ícono; acá se vuelve componente y se le pone el estilo.
const ICONOS_DE_ALERTA = { AlertTriangle, AlertCircle, Info, Clock, Users, Briefcase, Shield, Stethoscope, CheckCircle2 };
const isScheduleDefined = horarioDefinido;
const isBranchOpenNow = abiertaAhora;
const getTodaySchedule = horarioDeHoy;
const getProfileCompletion = completitudDelPerfil;
const getAlertStatus = (branch, currentTimestamp, branchEmployees = []) => {
    const r = alertasDeSucursal(branch, currentTimestamp, branchEmployees);
    return {
        ...r,
        icon: ICONOS_DE_ALERTA[r.icono],
        list: r.list.map((a) => ({ ...a, icon: ICONOS_DE_ALERTA[a.icono] })),
        cardStyles: '',
        badgeStyles: !r.hasAlerts ? 'hidden' : r.critica
            ? 'bg-danger-solid text-white shadow-[var(--shadow-glow-danger)] border-danger'
            : 'bg-warning-solid text-white shadow-[var(--shadow-glow-warning)] border-warning',
    };
};

// ── La tarjeta de la sucursal (rehecha el 2026-10-29) ────────────────────
// Antes eran SIETE cajas de vidrio dentro de la tarjeta (dirección, dos
// teléfonos, horario, tres paneles) más un pie de otro ancho, y la tarjeta
// misma no era una superficie: sin `data-surface` no tenía fondo, así que el
// pie —que sí lo tenía— parecía una pieza suelta más ancha que lo de arriba.
// Además cada caja tenía su sombra, su lift y su transición: decenas de capas
// animándose a la vez al pasar el puntero, que es lo que se sentía trabado.
//
// Ahora es UNA superficie (`data-surface="card"`, §5) con renglones separados
// por divisores, y la tarjeta entera abre la ficha (§5.3, el ojo arriba a la
// derecha). Las acciones van siempre visibles en el pie: escondidas detrás del
// hover no existían en el teléfono.

// Una línea de dato: ícono, texto y —si hay— la acción a la derecha.
const Renglon = ({ icono: Icono, children, accion }) => (
    <div className="flex items-start gap-3 py-2.5">
        <Icono size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-content-3" aria-hidden="true" />
        <div className="min-w-0 flex-1">{children}</div>
        {accion}
    </div>
);

// Un teléfono es un botón: en el teléfono llama, en la computadora copia.
const Telefono = ({ icono: Icono, etiqueta, numero, onAccion }) => (
    <button type="button" onClick={onAccion} disabled={!numero}
        aria-label={`${etiqueta}: ${numero || 'sin número'}`}
        className="inline-flex items-center gap-1.5 min-h-[var(--tap-min)] rounded-lg -mx-1 px-1 text-body-sm font-semibold text-content-2 tabular-nums transition-colors duration-[var(--dur-fast)] hover:text-brand-text disabled:text-content-3 disabled:cursor-default active:scale-[0.97]">
        <Icono size={14} strokeWidth={2} className="text-content-3" aria-hidden="true" />
        {numero || 'Sin número'}
    </button>
);

// El avance de una parte del expediente. Cuando la parte no aplica (local
// propio, sala que no es farmacia) vale 100 y se dice «Completo».
const Avance = ({ etiqueta, pct, titulo, disabled, onClick }) => {
    const tono = pct >= 100 ? 'bg-success' : pct === 0 ? 'bg-danger' : 'bg-warning';
    return (
        <button type="button" onClick={onClick} disabled={disabled} title={titulo}
            aria-label={`${titulo}: ${pct}% completo`}
            className="flex flex-col gap-1.5 min-h-[var(--tap-min)] justify-center text-left rounded-lg transition-opacity duration-[var(--dur-fast)] hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100 active:scale-[0.97]">
            <span className="flex items-baseline justify-between gap-2">
                <span className="text-caption font-bold text-content-3">{etiqueta}</span>
                <span className={`text-caption font-black tabular-nums ${pct >= 100 ? 'text-success-text' : pct === 0 ? 'text-danger-text' : 'text-warning-text'}`}>{pct}%</span>
            </span>
            <span data-medida="dato" className="block h-1 w-full rounded-full bg-divider overflow-hidden">
                <span className={`block h-full rounded-full ${tono}`} style={{ width: `${Math.max(pct, 3)}%` }} />
            </span>
        </button>
    );
};

const textoDelHorario = (horario) => String(horario || '').replace(' - ', ' – ');

const BranchCard = memo(({
    branch, branchEmployees, count, asignados = count, activeKiosks, currentTime,
    handleViewProfile, openModal, handleDeleteClick, handlePhoneAction, handleWhatsAppAction,
    canEdit = false, staggerIndex = 0
}) => {
    const conKioscos = !['ADMINISTRATIVA', 'EXTERNA'].includes(branch.type);

    // `asignados` cuenta a TODA ficha con esta sala, dadas de baja incluidas:
    // es la misma regla con la que `deleteBranch` (branchSlice) se niega a
    // borrar. Con `count` (sólo activos en planilla) el botón aparecía sobre una
    // sala con gente de baja y el borrado fallaba después de confirmar.
    const deleteDisabled = asignados > 0;
    const isInactive = count === 0 && activeKiosks === 0;
    const scheduleDefined = isScheduleDefined(branch);

    const alertStatus = getAlertStatus(branch, currentTime.timestamp, branchEmployees);
    const currentStatus = isBranchOpenNow(branch, currentTime.day, currentTime.timeStr);
    const todaySchedule = getTodaySchedule(branch, currentTime.day);
    const completion = getProfileCompletion(branch);
    const direccion = [branch.address, branch.settings?.location?.municipality, branch.settings?.location?.department].filter(Boolean).join(', ');
    const mapa = branch.settings?.location?.mapsUrl
        || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion || branch.name)}`;

    // El estado de hoy en una frase: el punto dice el color y el texto lo dice
    // en palabras (el color solo no lo lee nadie con daltonismo).
    const estado = isInactive
        ? { punto: 'bg-warning', texto: 'Inactiva' }
        : !scheduleDefined
            ? { punto: 'bg-danger', texto: 'Sin horario' }
            : todaySchedule === 'CERRADO'
                ? { punto: 'bg-content-3', texto: 'Cerrada hoy' }
                : currentStatus.status === 'OPEN'
                    ? { punto: 'bg-success', texto: `Abierta · ${textoDelHorario(todaySchedule)}` }
                    : { punto: 'bg-content-3', texto: `Cerrada · ${textoDelHorario(todaySchedule)}` };

    // Los controles de adentro no pueden abrir además la ficha.
    const sinAbrir = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn?.(e); };

    return (
        <article
            data-surface="card"
            {...clickable(() => handleViewProfile(branch), { label: `Abrir la ficha de ${branch.name}` })}
            // Sin `hover:-translate-y-*`: `data-surface="card"` ya levanta con
            // `--lift-card`, y un segundo lift se SUMA (DESIGN.md §5).
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 340px', '--stagger-delay': `${Math.min(staggerIndex, 8) * 45}ms` }}
            className={`animate-stagger-child group relative flex flex-col h-full overflow-hidden p-5 cursor-pointer ${isInactive ? 'opacity-80' : ''}`}
        >
            {/* ── Encabezado ── */}
            <header className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-brand/10 text-brand-text flex items-center justify-center shrink-0" aria-hidden="true">
                    <Building2 size={20} strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="text-subtitle font-black text-content leading-tight truncate group-hover:text-brand-text transition-colors duration-[var(--dur-base)]">
                            <Link to={`/sucursales/${branch.id}`} onClick={(e) => e.stopPropagation()} tabIndex={-1} className="outline-none">{branch.name}</Link>
                        </h3>
                        {branch.type && branch.type !== 'FARMACIA' && (
                            <Badge variant={BRANCH_TYPE_META[branch.type]?.variante || 'neutral'} size="sm">
                                {BRANCH_TYPE_META[branch.type]?.label}
                            </Badge>
                        )}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-caption font-semibold text-content-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${estado.punto}`} aria-hidden="true" />
                        <span className="truncate">{estado.texto}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {alertStatus.hasAlerts && (
                        <LiquidTooltip variant="rich" side="bottom" content={
                            <ul className="space-y-1.5 min-w-[180px]">
                                {alertStatus.list.map((al, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-caption font-semibold">
                                        <al.icon size={13} strokeWidth={2.5} className={`mt-0.5 shrink-0 ${al.level === 'critical' ? 'text-danger' : 'text-warning'}`} aria-hidden="true" />
                                        <span className="text-content-tooltip">{al.message}</span>
                                    </li>
                                ))}
                            </ul>
                        }>
                            <Badge variant={alertStatus.critica ? 'danger' : 'warning'} icon={AlertTriangle} size="sm" uppercase={false}
                                aria-label={alertStatus.list.map(a => a.message).join(', ')}>
                                {alertStatus.list.length === 1 ? '1 alerta' : `${alertStatus.list.length} alertas`}
                            </Badge>
                        </LiquidTooltip>
                    )}
                    <OjoDeTarjeta className="mt-0.5" />
                </div>
            </header>

            {/* ── Datos ── */}
            <div className="mt-3 divide-y divide-divider border-y border-divider">
                <Renglon icono={MapPin} accion={direccion ? (
                    <Button variant="ghost" size="sm" icon={Copy} iconOnly title="Copiar dirección"
                        onClick={sinAbrir(() => { navigator.clipboard.writeText(direccion); useToastStore.getState().showToast('Copiado', 'Dirección copiada.', 'success'); })} />
                ) : null}>
                    <a href={mapa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        className="text-body-sm text-content-2 leading-snug line-clamp-2 hover:text-brand-text transition-colors duration-[var(--dur-fast)]"
                        title="Abrir en el mapa">
                        {direccion || 'Sin dirección registrada'}
                    </a>
                </Renglon>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 py-1.5">
                    <Telefono icono={Phone} etiqueta="Fijo" numero={branch.phone}
                        onAccion={(e) => handlePhoneAction(e, branch.phone, 'Fijo')} />
                    <span className="inline-flex items-center gap-1">
                        <Telefono icono={Smartphone} etiqueta="Celular" numero={branch.cell}
                            onAccion={(e) => handlePhoneAction(e, branch.cell, 'Celular')} />
                        {branch.cell && (
                            <Button variant="ghost" size="sm" icon={MessageCircle} iconOnly title="Escribir por WhatsApp"
                                onClick={(e) => handleWhatsAppAction(e, branch.cell)} />
                        )}
                    </span>
                </div>
            </div>

            {/* ── Expediente ── */}
            {!branch.expedienteOculto && completion.legal != null && (
                <div className="grid grid-cols-3 gap-4 pt-3">
                    <Avance etiqueta="Legal" pct={completion.legal} titulo="Datos legales" disabled={!canEdit}
                        onClick={sinAbrir(() => openModal?.('editBranchLegal', branch))} />
                    <Avance etiqueta="Local" pct={completion.property} titulo="Datos del inmueble" disabled={!canEdit}
                        onClick={sinAbrir(() => openModal?.('editBranchInmueble', branch))} />
                    <Avance etiqueta="Servicios" pct={completion.services} titulo="Servicios básicos" disabled={!canEdit}
                        onClick={sinAbrir(() => openModal?.('editBranchServicios', branch))} />
                </div>
            )}

            {/* ── Pie: gente, kioscos y acciones ── */}
            <footer className="mt-auto pt-4 flex items-center gap-1">
                <button type="button" onClick={sinAbrir(() => openModal?.('viewBranchEmployees', branch))}
                    className="inline-flex items-center gap-1.5 min-h-[var(--tap-min)] rounded-lg px-2 -ml-2 text-body-sm text-content-2 transition-colors duration-[var(--dur-fast)] hover:text-brand-text active:scale-[0.97]"
                    title="Ver el personal">
                    <Users size={15} strokeWidth={2} className="text-content-3" aria-hidden="true" />
                    <span className="font-black text-content tabular-nums">{count}</span>
                    <span>{count === 1 ? 'persona' : 'personas'}</span>
                </button>
                {conKioscos && (
                    // Gestionar —o sea, poder revocar— es de quien edita sucursales.
                    <button type="button" disabled={!canEdit} onClick={sinAbrir(() => canEdit && openModal?.('manageKiosks', branch))}
                        className="inline-flex items-center gap-1.5 min-h-[var(--tap-min)] rounded-lg px-2 text-body-sm text-content-2 transition-colors duration-[var(--dur-fast)] hover:text-brand-text disabled:hover:text-content-2 disabled:cursor-default active:scale-[0.97]"
                        title={canEdit ? 'Gestionar kioscos' : 'Kioscos activos'}>
                        <Monitor size={15} strokeWidth={2} className={activeKiosks > 0 ? 'text-success' : 'text-content-3'} aria-hidden="true" />
                        <span className="font-black text-content tabular-nums">{activeKiosks}</span>
                        <span>de {LIMITE_KIOSCOS} kioscos</span>
                    </button>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                    {canEdit && (
                        <Button variant="ghost" size="sm" icon={Pencil} iconOnly title="Editar sucursal"
                            onClick={sinAbrir(() => openModal?.('editBranch', branch))} />
                    )}
                    {canEdit && !deleteDisabled && (
                        <Button variant="ghost" tone="danger" size="sm" icon={Trash2} iconOnly title="Eliminar sucursal"
                            onClick={sinAbrir(() => handleDeleteClick(branch, asignados))} />
                    )}
                </div>
            </footer>
        </article>
    );
});
BranchCard.displayName = 'BranchCard';

// ============================================================================
// 🚀 VISTA PRINCIPAL
// ============================================================================
const BranchesView = ({ openModal }) => {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('branches', 'can_edit');
    const branches = useStaff(state => state.branches);
    const employees = useStaff(state => state.employees);
    const deleteBranch = useStaff(state => state.deleteBranch);

    // 🚨 LEEMOS EL CACHÉ GLOBAL DE ZUSTAND SI EXISTE (Si no, lo inicializamos)
    // Asumiremos que el Store tiene un "kiosksCountCache" o usamos un estado local pre-cargado
    const [kiosksCount, setKiosksCount] = useState({});
    
    // 🚨 MODIFICACIÓN: Si ya tenemos branches, NO bloqueamos la pantalla completa.
    const [isLoadingKiosks, setIsLoadingKiosks] = useState(branches.length === 0);
    // Una lectura de kioscos que falla NO es «0 kioscos»: con cero la sala se
    // pinta «Inactiva» y entra en el filtro de inactivas. Se avisa y se
    // conserva el último conteo bueno de esa sala.
    const [kioskError, setKioskError] = useState(null);
    
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, branch: null });
    const [alertDialog, setAlertDialog] = useState({ isOpen: false, title: '', message: '', type: 'error' });

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('ALL');


    const [currentTime, setCurrentTime] = useState(() => {
        const d = new Date();
        return { day: d.getDay(), timeStr: d.toTimeString().slice(0, 5), timestamp: d.getTime() };
    });

    const isMobile = useMemo(() => /Mobi|Android|iPhone/i.test(navigator.userAgent), []);


    // 🚨 OPTIMIZACIÓN: Carga silenciosa en segundo plano (Stale-While-Revalidate)
    useEffect(() => {
        let isMounted = true;
        const refreshData = async () => {
            const d = new Date();
            setCurrentTime({ day: d.getDay(), timeStr: d.toTimeString().slice(0, 5), timestamp: d.getTime() });

            if (branches.length > 0) {
                // Ya no bloqueamos la UI con skeleton si ya teníamos data
                const results = await Promise.all(
                    branches.map(async (branch) => {
                        try {
                            const { data, error } = await fetchBranchKiosks(branch.id);
                            if (error) throw error;
                            return { id: branch.id, count: kioscosActivos(data || []).length };
                        } catch (error) {
                            return { id: branch.id, error };
                        }
                    })
                );
                if (!isMounted) return;
                const fallidas = results.filter(r => r.error);
                if (fallidas.length) console.error('Error cargando kioscos', fallidas[0].error);
                setKioskError(fallidas.length
                    ? mensajeAmigable(fallidas[0].error, `No se pudieron leer los kioscos de ${fallidas.length === 1 ? 'una sucursal' : `${fallidas.length} sucursales`}: su conteo puede no estar al día.`)
                    : null);
                setKiosksCount(prev => {
                    const next = { ...prev };
                    results.forEach(res => { if (!res.error) next[res.id] = res.count; });
                    return next;
                });
                setIsLoadingKiosks(false); // Solo apaga el skeleton si estaba prendido
            } else {
                setIsLoadingKiosks(false);
            }
        };

        refreshData();
        const timer = setInterval(refreshData, 60000); // Se refresca en silencio cada minuto
        return () => { isMounted = false; clearInterval(timer); };
    }, [branches]);

    // `soloPersonalEnPlanilla`, igual que la ficha (`BranchDetailView`): el
    // número de la tarjeta y el «N Activos» de la ficha cuentan las mismas
    // cabezas. Sin el filtro, «QA Testing» y el «Contador Externo» inflaban
    // el personal de su sala sólo en esta lista.
    const employeesMap = useMemo(() => {
        const m = new Map();
        soloPersonalEnPlanilla(employees || []).forEach((e) => {
            if ((e.status || '').toUpperCase() === 'INACTIVO') return;
            const k = String(e.branchId || e.branch_id);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(e);
        });
        return m;
    }, [employees]);

    // Toda ficha con la sala asignada —de baja incluida—: la regla con la que
    // `deleteBranch` se niega a borrar (compara `branchId` de TODOS los
    // empleados del store). El botón de eliminar se decide con esto.
    const asignadosPorSala = useMemo(() => {
        const m = new Map();
        (employees || []).forEach((e) => {
            if (e.branchId === undefined || e.branchId === null) return;
            const k = String(e.branchId);
            m.set(k, (m.get(k) || 0) + 1);
        });
        return m;
    }, [employees]);

    const filteredBranchesBase = useMemo(() => {
        return branches.filter(b => {
            if ((b.type || 'FARMACIA') === 'EXTERNA') return false;
            const branchEmps = employeesMap.get(String(b.id)) || [];
            const count = branchEmps.length;
            const activeK = kiosksCount[b.id] || 0;
            const isInactive = count === 0 && activeK === 0;
            const alert = getAlertStatus(b, currentTime.timestamp, branchEmps);
            const pType = b.propertyType || safeParse(b.settings)?.propertyType;
            if (filterStatus === 'ALERTS' && !alert.hasAlerts) return false;
            if (filterStatus === 'INACTIVE' && !isInactive) return false;
            if (filterStatus === 'RENTED' && !esInmuebleAlquilado({ propertyType: pType })) return false;
            if (filterStatus === 'OWNED' && pType !== 'OWNED') return false;
            return true;
        });
    }, [branches, filterStatus, employeesMap, kiosksCount, currentTime.timestamp]);

    const { results: filteredBranches, isFuzzy: isBranchSearchFuzzy } = useMemo(() => {
        if (!searchTerm.trim()) return { results: filteredBranchesBase, isFuzzy: false };
        return smartFilter(searchTerm, filteredBranchesBase, b => [b.name, b.address], { orden: 'relevancia' });
    }, [filteredBranchesBase, searchTerm]);

    // Una sola navegación: `setActiveBranch` (App.jsx) ya era un `navigate`
    // a la misma dirección, y llamarlo antes de éste empujaba dos entradas.
    const handleViewProfile = useCallback((branch) => {
        navigate(`/sucursales/${branch.id}`);
    }, [navigate]);

    const handleDeleteClick = useCallback((branch, count) => {
        if (!branch) return;
        if (count > 0) {
            setAlertDialog({ isOpen: true, title: 'Operación bloqueada', message: `No se puede eliminar "${branch.name}" porque tiene ${count} ficha(s) asignada(s), contando las dadas de baja. Reasígnalas a otra sucursal primero.`, type: 'error' });
            return;
        }
        setConfirmDialog({ isOpen: true, branch });
    }, []);

    // `deleteBranch` tiene DOS formas de fallar: lanza si hay fichas asignadas
    // y devuelve `false` si la base rechazó el borrado. Antes sólo se miraba
    // la primera, así que un `false` terminaba en «Sucursal Eliminada» sobre
    // una sucursal que seguía ahí.
    const executeDelete = async () => {
        if (!confirmDialog.branch) return;
        const { id, name } = confirmDialog.branch;
        try {
            const ok = await deleteBranch(id);
            if (ok === false) {
                useToastStore.getState().showToast('No se eliminó', `La sucursal ${name} no se pudo eliminar: la base rechazó el cambio. Intenta nuevamente.`, 'error');
            } else {
                useToastStore.getState().showToast('Sucursal Eliminada', `La sucursal ${name} ha sido borrada del sistema.`, 'success');
            }
        } catch (err) {
            // El freno de fichas asignadas lo escribe el store para una persona
            // («No se puede eliminar: Hay empleados…») y se muestra tal cual;
            // un error de la base pasa por la traducción.
            const texto = err instanceof Error && !('code' in err) && err.message
                ? err.message
                : mensajeAmigable(err, 'No se pudo eliminar la sucursal. Intenta nuevamente.');
            useToastStore.getState().showToast('No se eliminó', texto, 'error');
        } finally {
            setConfirmDialog({ isOpen: false, branch: null });
        }
    };

    const handlePhoneAction = useCallback((e, phone, type) => {
        e.preventDefault(); e.stopPropagation();
        if (!phone) return;
        const cleanPhone = phone.replace(/\D/g, '');
        if (isMobile) { window.location.href = `tel:${cleanPhone}`; }
        else { navigator.clipboard.writeText(phone); useToastStore.getState().showToast('Copiado', `Número ${type} copiado al portapapeles.`, 'success'); }
    }, [isMobile]);

    const handleWhatsAppAction = useCallback((e, phone) => {
        e.preventDefault(); e.stopPropagation();
        if (!phone) return;
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length === 8) cleanPhone = `503${cleanPhone}`;
        window.open(`https://wa.me/${cleanPhone}`, '_blank');
    }, []);

    // D3.9 (2026-07-27): barra reescrita a mano → canónico.
    // El filtro de estado era una píldora que se expandía EN LÍNEA en las 5
    // opciones, colapsando el resto de la barra: un tercer estado propio y un
    // dropdown escrito a mano, que es lo que la regla del proyecto prohíbe
    // (feedback_liquid_select). Pasa a LiquidSelect, igual que Facturación,
    // Monitor y Auditoría — y con eso desaparece el tercer estado.
    //
    // §17: el filtro de estado vive en el CUERPO, y desde el 2026-07-30 la acción
    // también. El header queda con lo que le corresponde: el buscador.
    const renderFiltersContent = () => (
        <ViewTabBar
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            placeholder="Buscar sucursal o dirección..."
        />
    );

    const filtrosCuerpo = (
        <FilterBar
            onClear={() => setFilterStatus('ALL')}
            activeCount={filterStatus !== 'ALL' ? 1 : 0}
            acciones={canEdit ? [{
                key: 'nueva', icon: Plus, label: 'Nueva sucursal', variant: 'primary',
                onClick: () => openModal?.('newBranch'),
            }] : []}
        >
            {/* Valor "sin filtrar": la cadena 'ALL' */}
            <FilterBar.Section active={filterStatus !== 'ALL'} onClear={() => setFilterStatus('ALL')} label="estado">
                <div className="w-[180px]">
                    <LiquidSelect
                        value={filterStatus}
                        onChange={val => setFilterStatus(val || 'ALL')}
                        options={FILTER_OPTIONS}
                        icon={Filter}
                        placeholder="Todas"
                        compact bare clearable={false}
                    />
                </div>
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <>
            <ConfirmModal isOpen={confirmDialog.isOpen} onClose={() => setConfirmDialog({ isOpen: false, branch: null })} onConfirm={executeDelete} title={`¿Eliminar "${confirmDialog.branch?.name}"?`} message="Esta acción eliminará permanentemente la sucursal y toda su configuración operativa del sistema." confirmText="Eliminar" />
            <AlertModal isOpen={alertDialog.isOpen} onClose={() => setAlertDialog({ isOpen: false, title: '', message: '', type: 'error' })} title={alertDialog.title} message={alertDialog.message} type={alertDialog.type} />

            <GlassViewLayout icon={Building2} title="Sucursales" filtersContent={renderFiltersContent()} transparentBody={true}>
                <div className="w-full flex-1 pb-12">
                    {/* Barra de filtros: cuerpo, a la derecha (§17) */}
                    <div className="flex justify-end px-2 pt-4">{filtrosCuerpo}</div>
                    {kioskError && (
                        <div className="px-2 pt-4">
                            <Notice variant="danger" icon={AlertTriangle}>{kioskError}</Notice>
                        </div>
                    )}
                    {isLoadingKiosks ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 auto-rows-max pt-4 px-2">
                            {/* BUG REAL (2026-07-27): acá se llamaba a
                                `BranchCardSkeleton`, un componente que NO EXISTE en
                                ningún lado del proyecto — ni definido ni importado.
                                La vista reventaba con ReferenceError cada vez que
                                `isLoadingKiosks` quedaba en true el tiempo suficiente
                                para pintar, y el ErrorBoundary mostraba "Algo salió
                                mal". Explica el crash de /branches que quedó anotado
                                como observación sin reproducir: no era la red, era
                                que la red lenta mantenía viva la rama de carga.
                                Ahora usa el `Skeleton` canónico (D3.1). */}
                            {[1, 2, 3].map(i => (
                                <div key={i} data-surface="card" className="p-5 flex flex-col gap-4">
                                    <div className="flex items-center gap-3">
                                        <Skeleton w={48} h={48} rounded="1rem" />
                                        <div className="flex-1 flex flex-col gap-2">
                                            <Skeleton w="60%" h={14} />
                                            <Skeleton w="40%" h={10} />
                                        </div>
                                    </div>
                                    <SkeletonText lines={2} />
                                    <div className="flex gap-2">
                                        <Skeleton w={70} h={24} rounded="999px" />
                                        <Skeleton w={70} h={24} rounded="999px" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredBranches.length === 0 ? (
                        <div className="py-24 text-center flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-[var(--dur-lento)]">
                            <div data-surface="card" className={`p-6 mb-5 transition-all duration-[var(--dur-slow)] ${filterStatus === 'ALERTS' ? 'text-success' : 'text-content-3'}`}>
                                {filterStatus === 'ALERTS' ? <CheckCircle2 size={48} strokeWidth={1.5} /> : <Building2 size={48} strokeWidth={1.5} />}
                            </div>
                            <h3 className="text-title font-black text-content tracking-tight">
                                {filterStatus === 'ALERTS' ? 'Todo en orden' : 'Sin sucursales'}
                            </h3>
                            <p className="text-body-lg text-content-3 mt-2 font-medium max-w-[300px] leading-relaxed">
                                {filterStatus === 'ALERTS'
                                    ? 'Ninguna de tus sucursales presenta alertas críticas en este momento.'
                                    : 'No encontramos sucursales que coincidan con tu búsqueda.'}
                            </p>
                        </div>
                    ) : (() => {
                        const grouped = TYPE_ORDER.reduce((acc, t) => {
                            const group = filteredBranches.filter(b => (b.type || 'FARMACIA') === t);
                            if (group.length) acc.push({ type: t, branches: group });
                            return acc;
                        }, []);
                        return (
                            <div className="space-y-8 pt-4 px-2 pb-12">
                                {isBranchSearchFuzzy && searchTerm && (
                                    <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
                                )}
                                {grouped.map(({ type, branches: groupBranches }) => (
                                    <div key={type}>
                                        {grouped.length > 1 && (
                                            <div className="flex items-center gap-3 mb-4">
                                                <Badge variant={BRANCH_TYPE_META[type]?.variante || 'neutral'}>
                                                    {BRANCH_TYPE_META[type]?.sectionLabel}
                                                </Badge>
                                                <div className="flex-1 h-px bg-divider" />
                                                <span className="text-caption font-bold text-content-3">{groupBranches.length}</span>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-max">
                                            {groupBranches.map((branch, i) => (
                                                <BranchCard
                                                    key={branch.id}
                                                    staggerIndex={i}
                                                    branch={branch}
                                                    branchEmployees={employeesMap.get(String(branch.id)) || []}
                                                    count={employeesMap.get(String(branch.id))?.length || 0}
                                                    asignados={asignadosPorSala.get(String(branch.id)) || 0}
                                                    activeKiosks={kiosksCount[branch.id] || 0}
                                                    currentTime={currentTime}
                                                    isMobile={isMobile}
                                                    handleViewProfile={handleViewProfile}
                                                    openModal={openModal}
                                                    handleDeleteClick={handleDeleteClick}
                                                    handlePhoneAction={handlePhoneAction}
                                                    handleWhatsAppAction={handleWhatsAppAction}
                                                    canEdit={canEdit}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            </GlassViewLayout>
        </>
    );
};

export default BranchesView;