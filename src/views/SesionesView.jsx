import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MonitorSmartphone, Smartphone, Monitor, LogOut, Clock, Info, AlertCircle } from 'lucide-react';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import ConfirmModal from '../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { fetchSesiones, cerrarSesion, describirDispositivo, haceCuanto, describirLimite } from '../data/sesiones';
import { tokenMatch } from '../utils/searchUtils';

const EMPTY_ARRAY = [];
const POLL_MS = 60_000;

const TABS = [
    { key: 'reales',  label: 'Del personal' },
    { key: 'todas',   label: 'Incluir pruebas' },
];

const SesionesView = () => {
    const { user, hasPermission } = useAuth();
    const canEdit = hasPermission('sesiones', 'can_edit');
    const appendAuditLog = useStaff(s => s.appendAuditLog);
    const showToast = useToastStore(s => s.showToast);

    const [tab, setTab] = useState('reales');
    const [busqueda, setBusqueda] = useState('');
    const [filas, setFilas] = useState(EMPTY_ARRAY);
    const [cargando, setCargando] = useState(true);
    // Un fallo NO puede verse igual que una lista vacía.
    //
    // La primera versión hacía `console.error` y dejaba las filas en cero, así
    // que el rechazo del servidor —«sin permiso para ver las conexiones»— salía
    // en pantalla como «Sin conexiones». El usuario abrió la vista y sólo pudo
    // decir «me sale vacía»: la pantalla le estaba dando una respuesta a la
    // pregunta equivocada, y encima una que parecía normal.
    const [fallo, setFallo] = useState(null);
    const [porCerrar, setPorCerrar] = useState(null);
    const [cerrando, setCerrando] = useState(false);

    const incluirPruebas = tab === 'todas';

    const cargar = useCallback(async () => {
        const { data, error } = await fetchSesiones(incluirPruebas);
        if (error) {
            console.error('SesionesView: list_sessions falló:', error.message);
            // 42501 es el que devuelve la propia RPC cuando el cargo no tiene el
            // módulo otorgado. Se distingue porque tiene arreglo concreto y la
            // persona lo puede pedir: no es «se cayó algo».
            setFallo(error.code === '42501'
                ? 'Tu cargo todavía no tiene acceso a Conexiones. Pídele a quien administra los permisos que te lo habilite.'
                : 'No se pudo cargar la lista. Vuelve a intentar en un momento.');
        } else {
            setFallo(null);
        }
        setFilas(data || EMPTY_ARRAY);
        setCargando(false);
    }, [incluirPruebas]);

    useEffect(() => {
        cargar(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + refresco periódico (mismo patrón que SyncHealthView.jsx)
        const t = setInterval(cargar, POLL_MS);
        return () => clearInterval(t);
    }, [cargar]);

    const visibles = useMemo(() => {
        if (!busqueda.trim()) return filas;
        return filas.filter(f => tokenMatch(busqueda, f.empleado, f.cuenta));
    }, [filas, busqueda]);

    const confirmarCierre = useCallback(async () => {
        if (!porCerrar) return;
        setCerrando(true);
        const { data, error } = await cerrarSesion(porCerrar.session_id);
        setCerrando(false);
        if (error || data === false) {
            showToast?.(
                error ? 'No se pudo cerrar' : 'Ya no estaba abierta',
                error ? 'La conexión sigue abierta. Intenta de nuevo.' : 'Esa conexión ya se había cerrado.',
                'error',
            );
        } else {
            appendAuditLog?.('SESION_CERRADA', user?.id, {
                sessionId: porCerrar.session_id,
                persona: porCerrar.empleado,
                cuenta: porCerrar.cuenta,
                actorName: user?.name,
            });
            showToast?.('Conexión cerrada', 'Ese dispositivo ya no puede renovar su acceso.', 'success');
        }
        setPorCerrar(null);
        cargar();
    }, [porCerrar, appendAuditLog, user, showToast, cargar]);

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={tab}
            onTabChange={setTab}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar por persona…"
        />
    );

    return (
        <GlassViewLayout icon={MonitorSmartphone} title="Conexiones" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-4">
                {/* Lo que la pantalla tiene que admitir y no disimular: cerrar
                    una conexión corta la renovación, no el acceso en curso. */}
                <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-surface-card">
                    <Info size={14} className="text-content-3 shrink-0 mt-0.5" />
                    <p className="text-caption text-content-2">
                        Al cerrar una conexión, ese dispositivo deja de poder renovar su acceso y queda
                        fuera en cuanto se le venza el que ya tiene — puede tardar unos minutos, no es
                        inmediato. El dispositivo y el lugar son los que declaró el equipo al conectarse:
                        sirven para reconocer algo raro, no como comprobante.
                    </p>
                </div>

                {fallo && (
                    <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-danger/[0.12] border border-danger/30">
                        <AlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                        <p className="text-caption font-semibold text-danger-text">{fallo}</p>
                    </div>
                )}

                <DataTable
                    columns={[
                        { key: 'persona',    label: 'Persona' },
                        { key: 'dispositivo', label: 'Dispositivo' },
                        { key: 'ultimo',     label: 'Último uso' },
                        { key: 'inicio',     label: 'Se conectó', hideBelow: 'md' },
                        { key: 'lugar',      label: 'Lugar', hideBelow: 'lg' },
                        { key: 'accion',     label: '' },
                    ]}
                    // Los papeles de la ficha van DECLARADOS y no inferidos, por
                    // dos cosas que se vieron abriéndola en el teléfono:
                    //
                    //  · El ancla por defecto es la última columna útil, así que
                    //    agarraba la IP y la pintaba en grande, con más peso que
                    //    el nombre de la persona. El dato menos importante como
                    //    motivo de la pantalla. El motivo real es **cuándo se usó
                    //    por última vez**: es lo que dice si una conexión sobra.
                    //  · `acciones` es opt-in: sin esto el botón de cerrar
                    //    sencillamente no existe en el teléfono, que es donde más
                    //    falta hace. La ficha se veía completa y no lo era.
                    //
                    // La IP cae a la hoja, que es su lugar: contexto, no titular.
                    movil={{
                        identidad: 'persona',
                        ancla: 'ultimo',
                        chips: ['dispositivo', 'inicio'],
                        acciones: true,
                    }}
                    loading={cargando}
                    empty={{
                        icon: MonitorSmartphone,
                        message: 'Sin conexiones',
                        subtext: 'Nadie tiene una sesión abierta que coincida con este filtro.',
                    }}
                >
                    {visibles.map((f, i) => {
                        const esApp = f.clase === 'app';
                        const Icono = esApp ? Smartphone : Monitor;
                        const inicio = f.inicio ? new Date(f.inicio) : null;
                        const usoTexto = haceCuanto(f.ultimo_uso || f.ultima_renovacion || f.inicio);
                        return (
                            <DataRow key={f.session_id} index={i}>
                                <DataCell>
                                    <div className="text-label font-bold text-content-2 flex items-center gap-1.5">
                                        {f.empleado}
                                        {f.es_actual && <Badge variant="info" size="sm">Este equipo</Badge>}
                                    </div>
                                    <div className="text-caption text-content-3 mt-0.5">{f.cuenta}</div>
                                </DataCell>
                                <DataCell>
                                    <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-content-2">
                                        <Icono size={11} className="text-content-3" />
                                        {describirDispositivo(f.agente)}
                                    </span>
                                    <div className="text-micro text-content-3 mt-0.5">
                                        {esApp ? 'App instalada' : 'Navegador'}
                                        {f.limite_min != null && ` · se cierra sola a las ${describirLimite(f.limite_min)}`}
                                    </div>
                                </DataCell>
                                <DataCell>
                                    <span className="inline-flex items-center gap-1 text-caption text-content-2">
                                        <Clock size={10} className="text-content-3" />
                                        {usoTexto || '—'}
                                    </span>
                                </DataCell>
                                <DataCell hideBelow="md" className="text-caption text-content-3">
                                    {inicio ? inicio.toLocaleDateString('es-SV') : '—'}
                                </DataCell>
                                <DataCell hideBelow="lg" className="text-caption text-content-3">
                                    {f.ip || '—'}
                                </DataCell>
                                <DataCell>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        icon={LogOut}
                                        iconOnly
                                        disabled={!canEdit}
                                        title="Cerrar esta conexión"
                                        onClick={() => setPorCerrar(f)}
                                    />
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>
            </div>

            <ConfirmModal
                isOpen={!!porCerrar}
                onClose={() => setPorCerrar(null)}
                onConfirm={confirmarCierre}
                isProcessing={cerrando}
                title="¿Cerrar esta conexión?"
                message={
                    porCerrar?.es_actual
                        ? 'Es la conexión de este mismo equipo: vas a tener que volver a entrar.'
                        : `${porCerrar?.empleado} tendrá que volver a entrar en ese dispositivo. Puede tardar unos minutos en salir del todo.`
                }
                confirmText="Sí, cerrar"
            />
        </GlassViewLayout>
    );
};

export default SesionesView;
