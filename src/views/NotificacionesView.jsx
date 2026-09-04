import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bell, BellOff, Check, CalendarClock, RotateCcw, Search, Tag, Trash2, Inbox,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import TablePagination from '../components/common/TablePagination';
import TarjetaDeAviso from '../components/common/TarjetaDeAviso';
import { paletaDeAviso } from '../components/common/paletaDeAviso';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useTheme } from '../context/ThemeContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { usePaginaEnUrl } from '../hooks/usePaginaEnUrl';
import usePestanaEnUrl from '../hooks/usePestanaEnUrl';
import useAccionesDeAviso from '../hooks/useAccionesDeAviso';
import { mensajeAmigable } from '../utils/errorMessages';
import { nombreDeTipo } from '../utils/notificacionTexto';
import { fetchNotificationsPage, fetchNotificationTypes } from '../data/notifications';

/* El historial de avisos — y la papelera (2026-09-04).
 *
 * Nació de una pregunta de una línea: «una vez eliminada, ¿no hay forma de
 * verla?». No la había. El botón de la campana hacía un DELETE real y la fila
 * se iba de la base sin dejar rastro. Hoy borrar es OCULTAR (migración
 * `20260904141450`) y acá se ven y se devuelven.
 *
 * Pero el borrado no era el único agujero, y el otro era más grande: la campana
 * carga 100 avisos y nada más. Medido en producción el mismo día, **28 de 46
 * personas ya pasaron las 100** y la que más tiene 608 — o sea que para más de
 * la mitad del personal parte de su historial ya era invisible SIN haber
 * borrado nada. Como no falla nada, nadie lo reporta. Por eso esta vista pagina
 * de verdad contra el servidor en vez de filtrar en el navegador una lista que
 * ya venía recortada: un tope se aplica ANTES del filtro, y lo que el servidor
 * cortó no existe para el filtro (CLAUDE.md, la regla de las 1000 filas).
 *
 * ── La tarjeta es LA MISMA que la de la campana ──────────────────────────────
 * La primera versión la escribió de nuevo en forma simplificada y el usuario lo
 * vio de una: «en la vista no se ven las notificaciones modernas, como en la
 * notificación». Lo que faltaba no era estilo, era la mitad de lo que la tarjeta
 * hace — los anillos que DIBUJAN el cierre de metas y el faltante de caja, el
 * detalle desplegable de una solicitud, y Aprobar/Rechazar/Confirmar el corte.
 *
 * Hoy sale de `TarjetaDeAviso` y las acciones de `useAccionesDeAviso`, los dos
 * compartidos con la campana. Una copia no se «desincroniza con el tiempo»:
 * nace incompleta, que es exactamente lo que pasó acá.
 */

/* Los tres estados. `sin_leer` primero porque es a lo que se entra a hacer algo;
   `borradas` al final porque es el que se visita a propósito. */
const PESTANAS = [
    { key: 'sin_leer', label: 'Sin leer', icon: Bell },
    { key: 'activas',  label: 'Todas',    icon: Inbox },
    { key: 'borradas', label: 'Borradas', icon: Trash2 },
];

/* El período se ofrece hasta donde LLEGA el dato y ni un día más: prometer
   «último año» sobre una tabla que se purga a los 90 días sería un filtro que
   devuelve vacío sin que nada esté mal. Si algún día cambia la retención, este
   es el sitio — y `dias: null` («todo lo que quede») lo hace resistente: no
   promete un plazo, muestra lo que hay. */
const PERIODOS = [
    { value: '30',   label: 'Últimos 30 días', dias: 30 },
    { value: '90',   label: 'Últimos 90 días', dias: 90 },
    { value: 'todo', label: 'Todo lo que quede', dias: null },
];

const POR_PAGINA_DEFECTO = 25;

export default function NotificacionesView() {
    const navigate  = useNavigate();
    const { isDark } = useTheme();
    const cx = useMemo(() => paletaDeAviso(isDark), [isDark]);
    const showToast = useToastStore(s => s.showToast);

    const branches  = useStaff(s => s.branches);
    const markNotificationRead      = useStaff(s => s.markNotificationRead);
    const deleteNotificationsByIds  = useStaff(s => s.deleteNotificationsByIds);
    const restoreNotificationsByIds = useStaff(s => s.restoreNotificationsByIds);

    const [tab, setTab]           = usePestanaEnUrl(PESTANAS, 'sin_leer');
    const [busqueda, setBusqueda] = useState('');
    const [tipo, setTipo]         = useState('');
    const [periodo, setPeriodo]   = useState('30');

    const [filas, setFilas]       = useState([]);
    const [total, setTotal]       = useState(0);
    const [cargando, setCargando] = useState(true);
    const [error, setError]       = useState(null);
    const [tipos, setTipos]       = useState([]);
    const [recarga, setRecarga]   = useState(0);
    const recargar = useCallback(() => setRecarga(n => n + 1), []);

    /* Qué tarjetas están abiertas y cuáles tienen el cuerpo cortado — el mismo
       contrato que usa la campana. `marcarCuerpoCortado` es estable a propósito:
       viaja como prop a cada párrafo y ahí vive dentro de un efecto; si cambiara
       en cada pintada, el efecto se volvería a montar solo. */
    const [expandidas, setExpandidas] = useState(() => new Set());
    const [cuerposCortados, setCuerposCortados] = useState(() => new Set());

    const alternarExpansion = useCallback((id) => setExpandidas(prev => {
        const s = new Set(prev);
        s.has(id) ? s.delete(id) : s.add(id);
        return s;
    }), []);

    const marcarCuerpoCortado = useCallback((id, cortado) => {
        setCuerposCortados(prev => {
            if (prev.has(id) === cortado) return prev;
            const s = new Set(prev);
            cortado ? s.add(id) : s.delete(id);
            return s;
        });
    }, []);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({
        total, tamPorDefecto: POR_PAGINA_DEFECTO,
    });

    /* Aprobar, rechazar, confirmar el corte, revisar el traslado — la misma
       máquina que la campana. En la papelera NO se pasan: un aviso borrado se
       lee, no se decide desde ahí, y ofrecer «Aprobar» sobre algo que se sacó
       de la bandeja invita a resolverlo por el camino que no es. */
    const { acciones, dialogos, empleadosPorId } = useAccionesDeAviso({
        avisos: filas, activo: tab !== 'borradas', origen: 'historial',
    });

    /* La búsqueda espera 350 ms. Sin eso cada tecla es una consulta al servidor
       —el defecto que `gate:perf` nació midiendo: un buscador que salía con la
       primera letra— y además cada respuesta que llega tarde puede pisar a una
       más nueva. */
    const [buscaAplicada, setBuscaAplicada] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setBuscaAplicada(busqueda.trim()), 350);
        return () => clearTimeout(t);
    }, [busqueda]);

    /* Cambiar de pestaña, de filtro o de búsqueda vuelve a la página 1: la 7 de
       una lista de 300 no existe en una de 12, y la tabla saldría vacía sin
       decir por qué. */
    const primeraVez = useRef(true);
    useEffect(() => {
        if (primeraVez.current) { primeraVez.current = false; return; }
        setPage(1);
    // `setPage` viene memoizado del hook y no entra: si entrara, escribir la
    // página dispararía este efecto que la vuelve a 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, tipo, periodo, buscaAplicada]);

    /* La respuesta VIEJA no puede pisar a la nueva. Con la búsqueda escribiendo
       y la paginación cambiando, dos consultas viajan a la vez y no hay ninguna
       garantía de que contesten en orden: sin este freno, borrar una letra podía
       dejar en pantalla el resultado de la palabra entera. */
    const peticion = useRef(0);
    useEffect(() => {
        const mia = ++peticion.current;
        setCargando(true);
        setError(null);
        /* El piso de la fecha se calcula ACÁ y no en un `useMemo`: `Date.now()`
           es impuro y leerlo durante el render le da al compilador de React un
           valor distinto en cada pasada. */
        const dias = PERIODOS.find(x => x.value === periodo)?.dias ?? null;
        const desde = dias ? new Date(Date.now() - dias * 86400000).toISOString() : null;
        fetchNotificationsPage({
            estado: tab, tipo: tipo || null, desde, busca: buscaAplicada || null,
            pagina: page - 1, porPagina: pageSize,
        }).then(({ data, error: err, count }) => {
            if (mia !== peticion.current) return;
            if (err) throw err;
            setFilas(data || []);
            setTotal(count ?? 0);
        }).catch((e) => {
            if (mia !== peticion.current) return;
            console.error('Error cargando el historial de notificaciones:', e);
            setError(e);
            setFilas([]);
            setTotal(0);
        }).finally(() => {
            if (mia === peticion.current) setCargando(false);
        });
    }, [tab, tipo, periodo, buscaAplicada, page, pageSize, recarga]);

    /* Los tipos que ESTA persona tiene. Se leen una vez: cambian cuando llega un
       aviso de una categoría nueva, y en ese caso el filtro se pone al día en la
       próxima entrada — pedirlos en cada consulta serían dos viajes por página
       para llenar un desplegable que casi nunca cambia. */
    useEffect(() => {
        fetchNotificationTypes()
            .then(({ data, error: err }) => { if (!err) setTipos((data || []).map(r => r.type)); })
            .catch(() => { /* sin la lista el filtro queda en «Todos», que es el default */ });
    }, []);

    const sucursalesPorId = useMemo(() => {
        const m = new Map();
        (branches || []).forEach(b => m.set(String(b.id), b.name));
        return m;
    }, [branches]);

    const buscarEmpleadoPorId = useCallback(
        (id) => empleadosPorId.get(String(id)) ?? null, [empleadosPorId]);

    /* El mismo toque que en la campana: marca leída y sale a la pantalla del
       aviso. `n.link` ya trae la forma correcta para cada familia —incluida
       `minmax:<id>`, que es otra tabla—; el respaldo sólo cubre avisos viejos,
       escritos antes de que el enlace se guardara. */
    const abrir = useCallback((n) => {
        if (!n.read_at && !n.deleted_at) markNotificationRead(n.id);
        if (n.link || n.metadata?.request_id) {
            navigate(n.link || `/requests?solicitud=${n.metadata?.request_id ?? ''}`);
        }
    }, [navigate, markNotificationRead]);

    const borrar = useCallback(async (n) => {
        await deleteNotificationsByIds([n.id]);
        showToast('Se movió a Borradas', 'Se puede devolver desde esa pestaña', 'success');
        recargar();
    }, [deleteNotificationsByIds, showToast, recargar]);

    const restaurar = useCallback(async (n) => {
        try {
            await restoreNotificationsByIds([n.id]);
            showToast('Devuelta a la campana', '', 'success');
            recargar();
        } catch (e) {
            showToast('No se pudo devolver', mensajeAmigable(e), 'error');
        }
    }, [restoreNotificationsByIds, showToast, recargar]);

    const filtrosActivos = (tipo ? 1 : 0) + (periodo !== '30' ? 1 : 0);

    const filtersContent = (
        <ViewTabBar
            tabs={PESTANAS}
            activeTab={tab}
            onTabChange={setTab}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar en el texto del aviso…"
        />
    );

    return (
        <GlassViewLayout icon={Bell} title="Notificaciones" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-4">

                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                        <span className="min-w-0">
                            <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                                {tab === 'borradas' ? 'Borradas' : tab === 'sin_leer' ? 'Sin leer' : 'En total'}
                            </span>
                            <span className="block text-h3 font-black tabular-nums text-content">
                                {cargando ? '—' : total.toLocaleString('es-SV')}
                            </span>
                        </span>
                    </div>

                    <FilterBar
                        onClear={() => { setTipo(''); setPeriodo('30'); }}
                        activeCount={filtrosActivos}
                    >
                        {/* Con un solo tipo no se dibuja: un control con una
                            opción no es una elección y ocupa el lugar de una. */}
                        {tipos.length > 1 && (
                            <FilterBar.Section active={!!tipo} onClear={() => setTipo('')} label="tipo">
                                <FilterBar.Opciones
                                    label="Tipo" icon={Tag}
                                    value={tipo} onChange={(v) => setTipo(v || '')}
                                    options={[{ value: '', label: 'Todos' },
                                        ...tipos.map(t => ({ value: t, label: nombreDeTipo(t) }))]}
                                    ancho="215px"
                                />
                            </FilterBar.Section>
                        )}
                        <FilterBar.Section active={periodo !== '30'} onClear={() => setPeriodo('30')} label="período">
                            <FilterBar.Opciones
                                label="Período" icon={CalendarClock}
                                value={periodo} onChange={(v) => setPeriodo(v || '30')}
                                options={PERIODOS.map(p => ({ value: p.value, label: p.label }))}
                                ancho="190px"
                            />
                        </FilterBar.Section>
                    </FilterBar>
                </div>

                {/* Qué guarda el portal y por cuánto. Va escrito porque el plazo
                    NO se puede deducir de la pantalla: una papelera vacía se lee
                    igual si nadie borró nada que si ya se limpió sola. */}
                {tab === 'borradas' && (
                    <Notice variant="info" icon={Trash2}>
                        Un aviso borrado se guarda 90 días y después se limpia solo.
                        Mientras tanto se puede devolver a la campana.
                    </Notice>
                )}

                {error ? (
                    <EmptyState compact icon={BellOff} title="No se pudo leer el historial"
                        subtitle={mensajeAmigable(error)}
                        action={<Button variant="secondary" onClick={recargar}>Reintentar</Button>} />
                ) : cargando ? (
                    <LoadingState label="Leyendo tus notificaciones" />
                ) : !filas.length ? (
                    <VacioDe tab={tab} busqueda={buscaAplicada} filtros={filtrosActivos}
                        onLimpiar={() => { setBusqueda(''); setTipo(''); setPeriodo('30'); }} />
                ) : (
                    <>
                        {/* La lista se acota a un ancho de lectura. A pantalla
                            completa la tarjeta medía más de 1,800px y su texto
                            quedaba en un renglón larguísimo con los controles a
                            medio metro del título — la misma tarjeta que en la
                            campana se lee de un vistazo. Un aviso es un mensaje,
                            no una tabla: lo que gana con el ancho es nada. */}
                        <div className="space-y-2 max-w-3xl">
                            {filas.map(n => (
                                <TarjetaDeAviso
                                    key={n.id}
                                    n={n}
                                    cx={cx}
                                    isDark={isDark}
                                    quien={n.created_by ? empleadosPorId.get(String(n.created_by)) : null}
                                    sucursal={n.branch_id ? sucursalesPorId.get(String(n.branch_id)) : null}
                                    buscarEmpleado={buscarEmpleadoPorId}
                                    expandida={expandidas.has(n.id)}
                                    cuerpoCortado={cuerposCortados.has(n.id)}
                                    onAlternarExpansion={alternarExpansion}
                                    onRecorte={marcarCuerpoCortado}
                                    onAbrir={abrir}
                                    acciones={tab === 'borradas' ? null : acciones}
                                    controlDeBorrado={tab === 'borradas' ? (
                                        <Button variant="ghost" size="xs" icon={RotateCcw}
                                            title="Devolver a la campana"
                                            className={cx.iconBtn}
                                            onClick={(e) => { e.stopPropagation(); restaurar(n); }}>
                                            Devolver
                                        </Button>
                                    ) : (
                                        <Button variant="ghost" icon={Trash2} iconOnly
                                            title="Mover a Borradas"
                                            className={cx.iconBtn}
                                            onClick={(e) => { e.stopPropagation(); borrar(n); }} />
                                    )}
                                />
                            ))}
                        </div>

                        <TablePagination
                            page={page} totalPages={totalPages} onPageChange={setPage}
                            pageSize={pageSize} onPageSizeChange={setPageSize}
                            total={total} unit="avisos"
                        />
                    </>
                )}
            </div>

            {/* Fuera de la lista: el diálogo de rechazo y el detalle del corte se
                dibujan por encima de todo y tienen que sobrevivir a que la fila
                que los abrió se vaya de la página. */}
            {dialogos}
        </GlassViewLayout>
    );
}

/* El vacío dice CUÁL de los vacíos es. «Sin resultados» sobre una bandeja al día
   se lee como que algo falló, y sobre una búsqueda sin coincidencias se lee como
   que el aviso no existe — son dos mensajes distintos y la diferencia importa. */
const VacioDe = ({ tab, busqueda, filtros, onLimpiar }) => {
    if (busqueda || filtros) {
        return (
            <EmptyState compact icon={Search} title="Sin resultados"
                subtitle={busqueda
                    ? `Ningún aviso coincide con «${busqueda}» en lo que estás mirando.`
                    : 'Ningún aviso entra en los filtros elegidos.'}
                action={<Button variant="secondary" onClick={onLimpiar}>Limpiar los filtros</Button>} />
        );
    }
    if (tab === 'borradas') {
        return <EmptyState compact icon={Trash2} title="Sin borrados"
            subtitle="Lo que saques de la campana aparece aquí y se puede devolver." />;
    }
    if (tab === 'sin_leer') {
        return <EmptyState compact icon={Check} title="Estás al día"
            subtitle="No te queda ningún aviso sin leer." />;
    }
    return <EmptyState compact icon={Inbox} title="Sin avisos"
        subtitle="Aquí va a quedar todo lo que te llegue por la campana." />;
};
