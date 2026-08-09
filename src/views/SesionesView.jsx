import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MonitorSmartphone, Smartphone, Monitor, LogOut, Clock, Info, AlertCircle, MapPin } from 'lucide-react';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import LiquidAvatar from '../components/common/LiquidAvatar';
import LiquidModal from '../components/common/LiquidModal';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import ConfirmModal from '../components/common/ConfirmModal';
import Notice from '../components/common/Notice';
import { EmptyState } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import {
    fetchSesiones, cerrarSesion, cerrarTodasDe, agruparPorPersona,
    describirDispositivo, haceCuanto, describirLimite, diasDesde,
} from '../data/sesiones';
import { tokenMatch } from '../utils/searchUtils';

const EMPTY_ARRAY = [];
const POLL_MS = 60_000;

const SesionesView = () => {
    const { user, hasPermission, logout } = useAuth();
    const canEdit = hasPermission('sesiones', 'can_edit');
    const appendAuditLog = useStaff(s => s.appendAuditLog);
    const showToast = useToastStore(s => s.showToast);

    const [busqueda, setBusqueda] = useState('');
    const [soloHoy, setSoloHoy] = useState(false);
    const [soloOlvidadas, setSoloOlvidadas] = useState(false);
    const [filas, setFilas] = useState(EMPTY_ARRAY);
    const [cargando, setCargando] = useState(true);
    // Un fallo NO puede verse igual que una lista vacía. La primera versión
    // hacía `console.error` y dejaba las filas en cero, así que el rechazo del
    // servidor salía en pantalla como «Sin conexiones» y lo único que la persona
    // podía reportar era «me sale vacía».
    const [fallo, setFallo] = useState(null);
    const [abierta, setAbierta] = useState(null);      // persona cuyo detalle se ve
    const [porCerrar, setPorCerrar] = useState(null);  // { tipo: 'una'|'todas', … }
    const [cerrando, setCerrando] = useState(false);

    const cargar = useCallback(async () => {
        const { data, error } = await fetchSesiones();
        if (error) {
            console.error('SesionesView: list_sessions falló:', error.message);
            setFallo(error.code === '42501'
                ? 'Tu cargo todavía no tiene acceso a Conexiones. Pídele a quien administra los permisos que te lo habilite.'
                : 'No se pudo cargar la lista. Vuelve a intentar en un momento.');
        } else {
            setFallo(null);
        }
        setFilas(data || EMPTY_ARRAY);
        setCargando(false);
    }, []);

    useEffect(() => {
        cargar(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + refresco periódico (mismo patrón que SyncHealthView.jsx)
        const t = setInterval(cargar, POLL_MS);
        return () => clearInterval(t);
    }, [cargar]);

    const personas = useMemo(() => agruparPorPersona(filas), [filas]);

    const visibles = useMemo(() => personas.filter(p => {
        if (busqueda.trim() && !tokenMatch(busqueda, p.empleado, p.cuenta, p.cargo)) return false;
        const dias = diasDesde(p.ultimo_movimiento);
        if (soloHoy && dias > 1) return false;
        if (soloOlvidadas && dias <= 7) return false;
        return true;
    }), [personas, busqueda, soloHoy, soloOlvidadas]);

    // La persona abierta se relee de `personas` en cada refresco: si se guardara
    // el objeto, el detalle seguiría mostrando conexiones ya cerradas.
    const detalle = useMemo(
        () => (abierta ? personas.find(p => p.persona_id === abierta) || null : null),
        [abierta, personas],
    );

    const confirmarCierre = useCallback(async () => {
        if (!porCerrar) return;
        setCerrando(true);
        const esTodas = porCerrar.tipo === 'todas';
        const { data, error } = esTodas
            ? await cerrarTodasDe(porCerrar.persona.persona_id)
            : await cerrarSesion(porCerrar.conexion.session_id);
        setCerrando(false);

        // ¿Me cerré a mí mismo? Con «Cerrar todas» sobre la propia cuenta, sí —
        // y el aviso lo dice. Hay que actuar en consecuencia ACÁ: el navegador
        // se queda con un token que el servidor ya no reconoce, y como la API de
        // datos lo sigue aceptando hasta que vence, el portal seguía pintando el
        // tablero como si nada. Lo reportó el usuario: «le di en cerrar sesión a
        // mis sesiones, pero no me sacó».
        const meCerreAMi = esTodas
            ? porCerrar.persona.tiene_esta
            : porCerrar.conexion.es_actual;

        if (error) {
            showToast?.('No se pudo cerrar', 'Vuelve a intentar en un momento.', 'error');
        } else {
            appendAuditLog?.(esTodas ? 'SESIONES_CERRADAS_PERSONA' : 'SESION_CERRADA', user?.id, {
                persona: porCerrar.persona.empleado,
                cuenta: porCerrar.persona.cuenta,
                cerradas: esTodas ? data : 1,
                sessionId: esTodas ? undefined : porCerrar.conexion.session_id,
                actorName: user?.name,
            });
            showToast?.(
                esTodas ? `${data} conexiones cerradas` : 'Conexión cerrada',
                meCerreAMi
                    ? 'Cerraste también la de este equipo: hay que volver a entrar.'
                    : 'Esos dispositivos ya no pueden renovar su acceso.',
                'success',
            );
            if (esTodas) setAbierta(null);
            if (meCerreAMi) { setPorCerrar(null); logout(); return; }
        }
        setPorCerrar(null);
        cargar();
    }, [porCerrar, appendAuditLog, user, showToast, cargar, logout]);

    const filtrosActivos = (soloHoy ? 1 : 0) + (soloOlvidadas ? 1 : 0);

    // El buscador va en la píldora del encabezado; los filtros, en su propia
    // barra a la derecha del cuerpo. `trailingActions` de `ViewTabBar` NO se
    // usa: se retiró el 2026-07-30 justamente porque se había vuelto el cajón
    // donde terminaban los filtros, y el encabezado no filtra (DESIGN.md §17).
    const filtersContent = (
        <ViewTabBar
            tabs={EMPTY_ARRAY}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar por persona…"
        />
    );

    const barraFiltros = (
        <FilterBar
            activeCount={filtrosActivos}
            onClear={() => { setSoloHoy(false); setSoloOlvidadas(false); }}
        >
            {/* Chips y no un segmentado: son independientes y pueden estar los
                dos apagados, que es el estado normal de la vista. */}
            <FilterBar.Section label="estado">
                <div className="flex items-center gap-1">
                    <FilterBar.Chip tone="success" active={soloHoy} onToggle={() => setSoloHoy(v => !v)}>
                        Activas hoy
                    </FilterBar.Chip>
                    <FilterBar.Chip tone="warning" active={soloOlvidadas} onToggle={() => setSoloOlvidadas(v => !v)}>
                        Olvidadas
                    </FilterBar.Chip>
                </div>
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <GlassViewLayout icon={MonitorSmartphone} title="Conexiones" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-4">
                {fallo && <Notice variant="danger" icon={AlertCircle}>{fallo}</Notice>}

                {/* Corto y en tono neutro a propósito: la primera versión eran
                    ocho renglones en azul y negrita que se comían la pantalla
                    antes de dejar ver una sola tarjeta. El resto de la
                    explicación —de dónde salen el dispositivo y el lugar— vive
                    en el detalle, que es donde esos datos se ven. */}
                <Notice variant="neutral" icon={Info}>
                    Cada vez que alguien entra al portal se abre una conexión nueva, y hoy ninguna se
                    cierra sola: por eso una misma persona puede acumular muchas.
                </Notice>

                <div className="flex justify-end min-w-0">{barraFiltros}</div>

                {cargando ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} data-surface="card" className="h-[104px] animate-pulse" />
                        ))}
                    </div>
                ) : visibles.length === 0 ? (
                    <EmptyState
                        compact
                        icon={MonitorSmartphone}
                        title="Sin conexiones"
                        subtitle="Nadie tiene una sesión abierta que coincida con este filtro."
                    />
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {visibles.map(p => (
                            <button
                                key={p.persona_id || p.cuenta}
                                type="button"
                                data-surface="card"
                                onClick={() => setAbierta(p.persona_id)}
                                className="p-4 text-left w-full flex items-center gap-3 active:scale-[0.99] transition-transform duration-[var(--dur-base)]"
                            >
                                <LiquidAvatar
                                    src={p.foto}
                                    alt={p.empleado}
                                    fallbackText={p.empleado}
                                    className="w-12 h-12 rounded-2xl shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="text-label font-bold text-content-2 truncate">{p.empleado}</div>
                                    {p.cargo && <div className="text-caption text-content-3 truncate">{p.cargo}</div>}
                                    <div className="text-caption text-content-3 flex items-center gap-1 mt-1">
                                        <Clock size={10} /> {haceCuanto(p.ultimo_movimiento) || '—'}
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                    <Badge variant={p.conexiones.length > 5 ? 'warning' : 'neutral'} size="sm">
                                        {p.conexiones.length}
                                    </Badge>
                                    {p.tiene_esta && <Badge variant="info" size="sm">Aquí</Badge>}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ── El detalle de una persona ───────────────────────────────── */}
            <LiquidModal
                open={!!detalle}
                onClose={() => setAbierta(null)}
                maxWidth="max-w-lg"
                className="max-h-[85vh] h-fit"
                ariaLabel={`Conexiones de ${detalle?.empleado || ''}`}
            >
                <LiquidModal.Header>
                    <div className="flex items-center gap-3">
                        <LiquidAvatar
                            src={detalle?.foto}
                            alt={detalle?.empleado}
                            fallbackText={detalle?.empleado}
                            className="w-11 h-11 rounded-2xl shrink-0"
                        />
                        <div className="min-w-0">
                            <h3 className="text-body font-bold text-content truncate">{detalle?.empleado}</h3>
                            <p className="text-caption text-content-3 truncate">
                                {detalle?.conexiones.length === 1
                                    ? '1 conexión abierta'
                                    : `${detalle?.conexiones.length} conexiones abiertas`}
                            </p>
                        </div>
                    </div>
                </LiquidModal.Header>

                <LiquidModal.Body className="space-y-2">
                    <p className="text-caption text-content-3 px-0.5 pb-1">
                        Cerrar una conexión le quita a ese dispositivo la posibilidad de renovar su
                        acceso; sale del todo en cuanto se le venza el que ya tiene, y puede tardar
                        unos minutos. El dispositivo y el lugar son los que declaró el equipo al
                        conectarse: sirven para reconocer algo raro, no como comprobante.
                    </p>
                    {detalle?.conexiones.map(c => {
                        const esApp = c.clase === 'app';
                        const Icono = esApp ? Smartphone : Monitor;
                        return (
                            <div key={c.session_id} data-surface="card" className="p-3 flex items-start gap-3">
                                <Icono size={15} className="text-content-3 shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-label font-bold text-content-2 flex items-center gap-1.5 flex-wrap">
                                        {describirDispositivo(c.agente)}
                                        {c.es_actual && <Badge variant="info" size="sm">Este equipo</Badge>}
                                    </div>
                                    <div className="text-caption text-content-3 mt-0.5 flex items-center gap-1">
                                        <Clock size={10} /> {haceCuanto(c.ultimo_uso || c.ultima_renovacion || c.inicio) || '—'}
                                        {c.ip && (
                                            <>
                                                <span className="text-content-4">·</span>
                                                <MapPin size={10} /> {c.ip}
                                            </>
                                        )}
                                    </div>
                                    <div className="text-micro text-content-3 mt-0.5">
                                        {esApp ? 'App instalada' : 'Navegador'}
                                        {c.limite_min != null && ` · se cierra sola tras ${describirLimite(c.limite_min)}`}
                                    </div>
                                </div>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    icon={LogOut}
                                    iconOnly
                                    disabled={!canEdit}
                                    title="Cerrar esta conexión"
                                    onClick={() => setPorCerrar({ tipo: 'una', persona: detalle, conexion: c })}
                                />
                            </div>
                        );
                    })}
                </LiquidModal.Body>

                <LiquidModal.Footer>
                    <Button variant="secondary" onClick={() => setAbierta(null)}>Volver</Button>
                    <Button
                        variant="destructive"
                        icon={LogOut}
                        disabled={!canEdit || !detalle?.conexiones.length}
                        onClick={() => setPorCerrar({ tipo: 'todas', persona: detalle })}
                    >
                        Cerrar todas
                    </Button>
                </LiquidModal.Footer>
            </LiquidModal>

            <ConfirmModal
                isOpen={!!porCerrar}
                onClose={() => setPorCerrar(null)}
                onConfirm={confirmarCierre}
                isProcessing={cerrando}
                title={porCerrar?.tipo === 'todas' ? '¿Cerrar todas sus conexiones?' : '¿Cerrar esta conexión?'}
                message={
                    porCerrar?.tipo === 'todas'
                        ? `${porCerrar?.persona?.empleado} tendrá que volver a entrar en todos sus dispositivos${porCerrar?.persona?.tiene_esta ? ', incluido este' : ''}. Puede tardar unos minutos en salir del todo.`
                        : porCerrar?.conexion?.es_actual
                            ? 'Es la conexión de este mismo equipo: vas a tener que volver a entrar.'
                            : `${porCerrar?.persona?.empleado} tendrá que volver a entrar en ese dispositivo. Puede tardar unos minutos en salir del todo.`
                }
                confirmText="Sí, cerrar"
            />
        </GlassViewLayout>
    );
};

export default SesionesView;
