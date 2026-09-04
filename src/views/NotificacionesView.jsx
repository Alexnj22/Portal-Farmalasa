import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bell, BellOff, Check, RotateCcw, Search, Inbox,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
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
import { fetchNotificationsPage, DIAS_VISIBLES } from '../data/notifications';

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

/* Los dos cortes del listado.
 *
 * «Todas» primero y por defecto: esta pantalla es el REGISTRO —lo que se quita
 * de la campana sigue acá— y lo primero que uno quiere ver es todo.
 *
 * Hubo una tercera, «Fuera de la campana», y duró una hora: el usuario la mandó
 * quitar el mismo día —«esto no debe estar, debe salir en el listado completo
 * siempre»—. Es la misma idea llevada hasta el final: una pestaña aparte vuelve
 * a partir el listado justo por el criterio que se acababa de decidir que no
 * debe partirlo, y deja al aviso quitado en un rincón al que hay que ir. Lo
 * único que lo distingue ahora es su propio botón de «Devolver». */
const PESTANAS = [
    { key: 'todas',    label: 'Todas',    icon: Inbox },
    { key: 'sin_leer', label: 'Sin leer', icon: Bell },
];

const POR_PAGINA_DEFECTO = 25;

export default function NotificacionesView() {
    const navigate  = useNavigate();
    const { isDark } = useTheme();
    const cx = useMemo(() => paletaDeAviso(isDark), [isDark]);
    const showToast = useToastStore(s => s.showToast);

    const branches  = useStaff(s => s.branches);
    const markNotificationRead      = useStaff(s => s.markNotificationRead);
    const restoreNotificationsByIds = useStaff(s => s.restoreNotificationsByIds);

    const [tab, setTab]           = usePestanaEnUrl(PESTANAS, 'todas');
    const [busqueda, setBusqueda] = useState('');

    const [filas, setFilas]       = useState([]);
    const [total, setTotal]       = useState(0);
    const [cargando, setCargando] = useState(true);
    const [error, setError]       = useState(null);
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
        avisos: filas, activo: true, origen: 'historial',
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

    /* Cambiar de pestaña o de búsqueda vuelve a la página 1: la 7 de una lista
       de 300 no existe en una de 12, y la tabla saldría vacía sin decir por qué.
       Pero ENTRAR con `?pag=3` tiene que respetarla — es la mitad del motivo por
       el que la página vive en la dirección.

       Se compara el VALOR anterior en vez de contar corridas. La primera versión
       usaba un `useRef` de «primera vez» y `StrictMode` la rompía: en desarrollo
       React monta el efecto dos veces, la primera consumía el guard y la segunda
       borraba el `pag` de la URL. El síntoma era exacto y silencioso —entrar a
       `?pag=3` devolvía la página 1 con la dirección limpia— y sólo pasaba en
       desarrollo, así que cualquiera lo habría leído como «no funciona» sin
       poder reproducirlo en producción. Comparar valores es correcto en los dos
       lados: la segunda corrida ve lo mismo y no hace nada. */
    const ultimoCorte = useRef(null);
    useEffect(() => {
        const corte = `${tab}\u0000${buscaAplicada}`;
        if (ultimoCorte.current === null) { ultimoCorte.current = corte; return; }
        if (ultimoCorte.current === corte) return;
        ultimoCorte.current = corte;
        setPage(1);
    // `setPage` viene memoizado del hook y no entra: si entrara, escribir la
    // página dispararía este efecto que la vuelve a 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, buscaAplicada]);

    /* La respuesta VIEJA no puede pisar a la nueva. Con la búsqueda escribiendo
       y la paginación cambiando, dos consultas viajan a la vez y no hay ninguna
       garantía de que contesten en orden: sin este freno, borrar una letra podía
       dejar en pantalla el resultado de la palabra entera. */
    const peticion = useRef(0);
    useEffect(() => {
        const mia = ++peticion.current;
        setCargando(true);
        setError(null);
        /* Sin `desde` ni `tipo`: la lista muestra TODO lo que el portal guarda
           —los 90 días del cron de purga— porque el filtro se quitó. Un recorte
           por defecto que no se puede ver ni cambiar esconde avisos sin decirlo,
           que es peor que mostrarlos todos. */
        fetchNotificationsPage({
            estado: tab, busca: buscaAplicada || null,
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
    }, [tab, buscaAplicada, page, pageSize, recarga]);

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

    const restaurar = useCallback(async (n) => {
        try {
            await restoreNotificationsByIds([n.id]);
            showToast('Devuelta a la campana', '', 'success');
            recargar();
        } catch (e) {
            showToast('No se pudo devolver', mensajeAmigable(e), 'error');
        }
    }, [restoreNotificationsByIds, showToast, recargar]);

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

                {/* Sin barra de filtros — decisión del usuario, 2026-09-04: «que no
                    haya filter». Las tres pestañas ya son el corte que se usa
                    (sin leer / todas / borradas) y el buscador cubre el resto;
                    un filtro por tipo y otro por período eran dos controles que
                    partían el mismo listado por criterios que nadie pedía, y
                    ocupaban el ancho donde ahora va el aviso.

                    Con el filtro de período afuera, la lista muestra TODO lo que
                    el portal guarda —los 90 días de `purge-notifications-daily`—
                    y no un recorte que había que recordar quitar. */}
                <div className="max-w-3xl mx-auto">
                    <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                        {tab === 'sin_leer' ? 'Sin leer' : 'En total'}
                    </span>
                    <span className="block text-h3 font-black tabular-nums text-content">
                        {cargando ? '—' : total.toLocaleString('es-SV')}
                    </span>
                </div>

                {/* Cuánto atrás llega el listado. Va escrito porque el plazo NO
                    se puede deducir de la pantalla: una lista que se acaba se ve
                    igual si no hubo más avisos que si el corte ya se los comió. */}
                <div className="max-w-3xl mx-auto">
                    <Notice variant="info" icon={Bell}>
                        {`El listado guarda los últimos ${DIAS_VISIBLES} días. Lo que se quita de la campana sigue apareciendo aquí y se puede devolver.`}
                    </Notice>
                </div>

                {error ? (
                    <EmptyState compact icon={BellOff} title="No se pudo leer el historial"
                        subtitle={mensajeAmigable(error)}
                        action={<Button variant="secondary" onClick={recargar}>Reintentar</Button>} />
                ) : cargando ? (
                    <LoadingState label="Leyendo tus notificaciones" />
                ) : !filas.length ? (
                    <VacioDe tab={tab} busqueda={buscaAplicada}
                        onLimpiar={() => setBusqueda('')} />
                ) : (
                    <>
                        {/* La lista se acota a un ancho de lectura. A pantalla
                            completa la tarjeta medía más de 1,800px y su texto
                            quedaba en un renglón larguísimo con los controles a
                            medio metro del título — la misma tarjeta que en la
                            campana se lee de un vistazo. Un aviso es un mensaje,
                            no una tabla: lo que gana con el ancho es nada. */}
                        <div className="space-y-2 max-w-3xl mx-auto">
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
                                    acciones={acciones}
                                    /* En el listado NO se borra — decisión del
                                       usuario: «que solo se borren de ahí [la
                                       campana]». Lo único que se ofrece es
                                       devolver a la bandeja lo que se quitó. */
                                    controlDeBorrado={n.deleted_at ? (
                                        <Button variant="ghost" size="xs" icon={RotateCcw}
                                            title="Devolver a la campana"
                                            className={cx.iconBtn}
                                            onClick={(e) => { e.stopPropagation(); restaurar(n); }}>
                                            Devolver
                                        </Button>
                                    ) : null}
                                />
                            ))}
                        </div>

                        <div className="max-w-3xl mx-auto">
                        <TablePagination
                            page={page} totalPages={totalPages} onPageChange={setPage}
                            pageSize={pageSize} onPageSizeChange={setPageSize}
                            total={total} unit="avisos"
                        />
                        </div>
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
const VacioDe = ({ tab, busqueda, onLimpiar }) => {
    if (busqueda) {
        return (
            <EmptyState compact icon={Search} title="Sin resultados"
                subtitle={`Ningún aviso coincide con «${busqueda}» en lo que estás mirando.`}
                action={<Button variant="secondary" onClick={onLimpiar}>Limpiar la búsqueda</Button>} />
        );
    }
    if (tab === 'sin_leer') {
        return <EmptyState compact icon={Check} title="Estás al día"
            subtitle="No te queda ningún aviso sin leer." />;
    }
    return <EmptyState compact icon={Inbox} title="Sin avisos"
        subtitle="Aquí va a quedar todo lo que te llegue por la campana." />;
};
